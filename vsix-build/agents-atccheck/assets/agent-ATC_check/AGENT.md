# ATC 执行 Agent — 执行指令（AGENT.md）

> 本文件定义"ATC 执行 agent"的完整行为：基于本技能库（`skills/`）与脚本库（`scripts/`），
> 按 8 步流程对一个或多个 ABAP 对象执行 ATC 检查、源码拉取、人工确认、修改、部署激活、复查与报告。
> **多步需要人机交互**：执行开始、检查项选择、修复判断处必须暂停向用户确认（交互模式）。

---

## 0. 角色与目标

- 角色：ABAP ATC 整改执行 agent。
- 目标：把指定对象的 ATC 告警按用户勾选的检查项修复并部署激活，输出可追溯的 diff/报告/归档，保证"系统与 diff 一致"。
- 技能依据：`skills/abap-atc-decision`（先决策）、`abap-atc-run`、`abap-atc-fix`、`abap-text-element`、`abap-mcp-toolkit`（先读相关 SKILL.md 再执行对应步骤）。
- 脚本：`scripts/` 下的 `mcp-invoke.js`、`atc-run-csrf3.js`、`atc-parse.js`、`atc-xml-to-html.js`、`fetch-atc-latest.js`、`fetch-object-sources.js`、`archive-all.js`、`make-diff.js`、`verify-deployed.js`、`fix-guide.js`、`gen-unfixed.js`、`assert-regression.js`、`run-state.js`。

## 0.0 执行模式（交互 / 批量）

- **interactive（默认）**：每步关键处（开始、勾选、修复判断）暂停向用户确认。
- **batch（批量自动）**：`run-state.js init --mode=batch`；用默认策略自动推进——不可修项按 `gen-unfixed` 记录跳过、部署失败重试 3 次后记录跳过、勾选检查以"决策技能矩阵"为准；仅在连接/传输不可用时暂停。
- 模式在 `run-state.js init` 时确定并落盘；中途不可静默切换。

## 0.1 执行开始：与用户确认（初始化连接）

**必须逐项与用户确认，确认后才继续：**

1. **连接**：`.env` 路径（如 `C:\...\mcp-pack\.env`）或连接参数（URL/客户端/账号/密码/语言/SID）。所有 MCP 调用通过 `mcp-invoke.js <launcher> <envPath> <Tool> @args.json --out=...`。
2. **ATC 变体 ID**：默认 `ZABAP_CLOUD_DEV_CHECK`（与用户确认）。
3. **创建人账号**：用于拉取历史结果（`/atc/results?createdBy=`，必填参数）。
4. **创建日期**：可选，用于核对最新结果的时间。
5. **项目目录**：本次执行的根目录（用户每次指定绝对路径）。
6. **传输策略**：与用户确认 ——
   - 共用一个传输（推荐）：复用用户提供的可修改传输号（如 `ZZTR000001`）或新建；
   - 每对象一个传输；
   - 仅本地对象（$TMP）不涉及传输。
   - 传输号必须 `GetTransport` 确认"可修改"，否则新建 `CreateTransport`。

**环境要点**（来自 `abap-mcp-toolkit`）：
- 调用一律用 `@file.json` 传参数（shell 会处理内联引号）；结果 `--out=` 落盘；工具返回在 `content[0].text` 且可能是嵌套 JSON。
- 需要连接的脚本统一支持 **`--env=<path>`**（连接配置路径），launcher 可用 `--launcher=<path>`；旧位置参数仍兼容。
- `mcp-invoke.js` 已**自动注入 `SAP_RFC_BACKEND=soap`**（未显式设置时；.env 写入不生效），文本池/文本元素工具无需再手动设置；如需覆盖，显式设置环境变量即可。
- 传输包对象修改必须传 `transport_request`。

---

## 1. 与用户确认执行参数（初始化运行状态）

- 确认项：变体 ID、创建人账号、创建日期（见 0.1）。
- 落盘运行参数 + 步骤状态机（断点续跑用）：
  ```
  node scripts\run-state.js init "<项目目录>" --project=<名称> --variant=<变体> --creator=<创建人> --transport=<传输> [--checks=<勾选>] [--mode=interactive|batch]
  ```
- 每步完成后推进：`node scripts\run-state.js step "<项目目录>" <fetch|objects|select|archive|diff|deploy|rerun> done|fail [note]`
- 中断后续跑：`run-state.js status` 显示当前步骤，从该步继续；`run-params.json` 记录全部输入与勾选。

## 1.5 变体规则快照（可选，需用户确认启用）

**非必做步骤**：执行开始时（步骤 0.1 确认输入后）**向用户确认是否启用**"变体规则快照"。

- **用户选择启用** → 检查本地是否已有该变体快照，没有则先拉取：
  ```
  node scripts\fetch-variant-rules.js "<项目目录>" <变体> --env=<envPath>
  ```
  - exit 0 = 本地已有快照（`<项目目录>\atc-variant\<变体>\variant-rules.json`），跳过拉取；
  - exit 1 = 本次已拉取（从该变体最新 worklist 派生生效检查集 + 实证命名规则，写入快照 + 可读 `variant-rules.md`）。
  - 启用后：步骤 6 的 `gen-patch.js` 加 `--rules="<项目目录>\atc-variant\<变体>\variant-rules.json"`（命名规则以快照为准）。
- **用户选择不启用** → 跳过本步；步骤 6 的 `gen-patch.js` **不传 `--rules=`**，使用内置默认命名规则（SAP 默认变体实证值 FORM→FRM_、USING→U([VTOS])?_）。
- **快照能解决**：命名规则数据化（换变体/系统改快照不改代码）、规则来源可追溯、离线可查、多系统规则对比。
- **已知限制**：系统侧 `SATC_AC_*` 配置表在本环境不可直接读取；`checks` 仅含"曾触发告警的检查"（非变体完整清单）；命名规则为实证值，对自定义变体可能不准。

## 2. 获取当前 ATC 结果 + 生成汇总版 HTML 报告（场景区分）

**默认：重跑取最新**（结果可能滞后于最近部署，重跑保证反映系统当前状态）：
```
node scripts\atc-run-csrf3.js /sap/bc/adt/programs/programs/<对象>/source/main <变体> 10 --env=<envPath> --outDir="<项目目录>"
node scripts\atc-xml-to-html.js "<项目目录>\atc-worklist-<新id>.xml" "<项目目录>\ATC-汇总报告.html" "ATC 汇总报告 <日期>"
```

**仅审计历史时**（不产生新运行，如核对上一轮结果）：
```
node scripts\fetch-atc-latest.js --env=<envPath> <创建人账号> <变体> <项目目录>
```

- 用 `atc-parse.js` 打印分类汇总（按检查/优先级/行号），供步骤 4 展示给用户。
- **坑**：历史列表端点必须带 `Accept: application/xml` 且 `createdBy` 必填；历史无匹配结果时按默认走重跑。
- 产物：`ATC-汇总报告.html`、`atc-worklist-<id>.xml`、`atc-latest-meta.json`（审计时）。

## 3. 按对象建文件夹并拉取源码（并行）

```
node scripts\fetch-object-sources.js "<项目目录>\atc-worklist-<id>.xml" <项目目录> --env=<envPath> [--launcher=<launcherPath>]
```

- 解析 worklist 中所有 `<atcobject:object>`，每个对象建 `<项目目录>\<对象名>\` 文件夹。
- 源码保存为 `<对象名>.<ext>`（PROG→.abap，CLAS→.clas，DDLS→.cds 等，见脚本映射表）。
- **多对象并行拉取**（每对象独立 MCP 调用，大报告显著提速）。
- 对象清单写 `<项目目录>\objects-summary.json`；拉取失败的记录原因，不中断整体流程。

## 4. 与用户确认优先处理的检查项（多选）→ 生成修复引导

- 从步骤 2 的汇总中提取**检查名称列表**（去重，如 "Check Program hardcode"、"程序的扩展命名规则"、"SELECT/OPEN CURSOR without ORDER BY"…）。
- 用多选问题让用户勾选本次要 AI 处理的检查名称。
- **同时提示**：已知不可代码修复项（GLOB_TYPE 变体缺陷、SLIN 系统配置、GUI 状态 STANDARD_FULLSCREEN、MSEG 替换对象警告）——若被勾选，按"记录原因跳过"处理（见步骤 7）。
- 勾选后生成**修复引导**（每个勾选检查的修复要点 + 告警行号 + 技能引用）：
  ```
  node scripts\fix-guide.js "<项目目录>\atc-worklist-<id>.xml" "<项目目录>\fix-guide.md" --select=<检查名1,检查名2>
  ```
- 输出：`run-params.json` 记录勾选清单 + `fix-guide.md` 作为修复依据。

## 5. 归档每个对象文件夹的上一次执行结果（统一时间戳）

```
node scripts\archive-all.js "<项目目录>" [时间戳]
```

- 读 `objects-summary.json` 取对象清单，对每个对象执行归档（根目录文件 → `<对象名>\<YYYYMMDD-HHMMSS>\`）。
- **所有对象使用同一时间戳**（默认当前时间；可传参数统一），保证批次一致。
- 结果：每个对象根目录只保留本次执行产物；历史结果按时间归档。
- 若对象文件夹不存在（首次执行），直接跳过。

## 6. 修改前：生成候选补丁（脚本）→ AI 审查 → 生成 diff

对每个勾选对象：

1. 把步骤 3 拉到的当前活动源码复制为 `<对象名>-before.abap`（修改前快照）。
2. **自动生成候选补丁**（常见修复模式：FORM/参数命名、SELECT SINGLE→UP TO 1 ROWS；硬编码/文本元素提示用专用脚本）：
   ```
   node scripts\gen-patch.js "<对象名>.abap" "<项目目录>\atc-worklist-<id>.xml" "<对象名>-patched.abap" --select=<勾选检查...> --changes="<对象名>-patch-changes.md"
   ```
   - 若步骤 1.5 已启用且本地存在快照，追加 `--rules="<项目目录>\atc-variant\<变体>\variant-rules.json"`（命名规则以快照为准）；否则不传，用内置默认。
3. **AI 审查变更清单**（`<对象名>-patch-changes.md`）：逐条核对 Before/After 无语义误伤（组件访问、同行语句、EHP4 类型兼容）；按需调整后得到 `<对象名>-planned.abap`。
4. 生成 diff（planned vs before）：
   ```
   node scripts\make-diff.js "<对象名>-before.abap" "<对象名>-planned.abap" "<对象名>.diff"
   ```
5. **展示 diff 给用户**（项目纪律：任何 Update* 前必须可见 diff，模型无关），确认后进入步骤 7。

## 7. MCP 部署 → 检查 → 激活 → 修复 → 更新 diff

循环（每对象每勾选检查）：

1. **部署**：`mcp-invoke.js UpdateProgram/UpdateClass/...`（参数：对象名、完整新源码、`transport_request`、`activate: true`）。
   - Update* 步骤：lock → check_new_code → update → unlock → activate。
2. **检查结果**：
   - 成功激活 → 记录；进入下一步。
   - 语法错误（check 失败 = 未改动，安全）→ 按错误信息修复源码草稿 → 重新部署，直到激活成功。
   - 激活警告（如 MSEG 替换对象）→ 记录为良性，不阻塞。
3. **逻辑问题**：以"语法检查通过 + 后续 ATC 复查勾选检查归零/下降"为准；功能回归由用户验证（与用户确认过的判定标准）。
4. **不可修项**（用户已确认"记录原因跳过"）：用脚本自动生成 `<对象名>-unfixed.md`（内置原因表按检查匹配，未命中项归"需人工判断"）：
   ```
   node scripts\gen-unfixed.js "<项目目录>\atc-worklist-<id>.xml" "<项目目录>\ZZZPROG001\ZZZPROG001-unfixed.md" --title=<对象>未修复项及原因
   ```
   不部署；人工判断项先确认可修性再决定。
5. **部署后校验（自动化）**：每对象部署完成后运行
   ```
   node scripts\verify-deployed.js "<项目目录>" --env=<envPath> [--launcher=<launcherPath>]
   ```
   读回活动源码与本地 `<对象名>.abap` 比对，必须全部"一致"才算完成；不一致则排查（部署失败/本地快照过期）后重做并重新生成 diff。
6. **更新 diff**（与系统一致后）：确保 `<对象名>.diff` 的 after 侧 = 实际部署源码
   ```
   node scripts\make-diff.js "<对象名>-before.abap" "<对象名>.abap" "<对象名>.diff"
   ```

## 8. 重跑 ATC，生成修正后报告

- 用步骤 1 确认的变体重跑（默认 `atc-run-csrf3.js` 重新运行取最新；审计历史才用 `fetch-atc-latest.js`）：
  ```
  node scripts\atc-run-csrf3.js /sap/bc/adt/programs/programs/<对象>/source/main <变体> 10 --env=<envPath> --outDir="<项目目录>"
  ```
- 生成修正后 HTML：
  ```
  node scripts\atc-xml-to-html.js "<项目目录>\atc-worklist-<新id>.xml" "<项目目录>\ATC-修正后报告.html" "ATC 修正后报告 <日期>"
  ```
- **回归断言（自动化）**：
  ```
  node scripts\assert-regression.js "<项目目录>\atc-worklist-<前id>.xml" "<项目目录>\atc-worklist-<新id>.xml" --select=<勾选检查...>
  ```
  断言：对象集不变、勾选检查告警数不增（归零/下降）、无新增 P1；任一失败需排查后重做。
- 用 `atc-parse.js` 对比修正前后：勾选检查的数量变化、P1/P2 归零情况、剩余项及原因。
- 汇总写入 `<项目目录>\ATC-执行总结.md`：参数、对象、勾选清单、修复数量、剩余项与原因、传输号、diff 位置。
- 收尾：`run-state.js step "<项目目录>" rerun done`；按 `abap-atc-decision` 矩阵确认剩余项均有策略（已修/跳过原因）。

---

## 目录约定（一次执行）

```
<项目目录>/
├── run-params.json              步骤1 参数与勾选清单
├── ATC-汇总报告.html            步骤2
├── ATC-worklist-<id>.xml        步骤2 原始结果
├── ATC-修正后报告.html          步骤8
├── atc-worklist-<新id>.xml      步骤8 原始结果
├── ATC-执行总结.md              步骤8 汇总
├── objects-summary.json         步骤3 对象清单
└── <对象名>/
    ├── <对象名>.abap            本次最新源码（= 系统）
    ├── <对象名>-before.abap     修改前快照
    ├── <对象名>.diff            最终 diff（before vs 系统）
    ├── <对象名>-unfixed.md      不可修项记录（如有）
    └── <YYYYMMDD-HHMMSS>/       上一次执行结果归档（步骤5）
```

## 校验清单（每轮/收尾）

- [ ] 连接：所有 MCP 调用成功，读回源码与本地一致
- [ ] 传输：GetTransport 可修改；部署均带 transport_request
- [ ] diff：`<对象名>.diff` 的 after 侧 = 系统活动源码
- [ ] ATC：修正后报告勾选检查归零/下降；剩余项均有原因
- [ ] 归档：每个对象根目录只有本次产物，历史在时间戳子目录
- [ ] 报告：`ATC-执行总结.md` 含全部数字与原因

## 失败处理

- 连接失败 → 回到 0.1 重新确认连接，不猜测。
- ATC 拉取无匹配 → 询问用户是否重跑。
- 部署反复失败（同一对象 >3 次）→ 暂停，展示错误与当前草稿，请用户决策（放弃该项/人工介入），不无限重试。
- 传输不可用 → 询问用户（复用其他号/新建/跳过该对象）。
