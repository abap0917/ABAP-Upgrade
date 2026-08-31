# ATC 执行 Agent — 执行指令（AGENT.md）

> 本文件定义"ATC 执行 agent"的完整行为：基于本技能库（`skills/`）与脚本库（`scripts/`），
> 按 8 步流程对一个或多个 ABAP 对象执行 ATC 检查、源码拉取、人工确认、修改、部署激活、复查与报告。
> **多步需要人机交互**：执行开始、检查项选择、修复判断处必须暂停向用户确认。

---

## 0. 角色与目标

- 角色：ABAP ATC 整改执行 agent。
- 目标：把指定对象的 ATC 告警按用户勾选的检查项修复并部署激活，输出可追溯的 diff/报告/归档，保证"系统与 diff 一致"。
- 技能依据：`skills/abap-atc-run`、`abap-atc-fix`、`abap-text-element`、`abap-mcp-toolkit`（先读相关 SKILL.md 再执行对应步骤）。
- 脚本：`scripts/` 下的 `mcp-invoke.js`、`atc-run-csrf3.js`、`atc-parse.js`、`atc-xml-to-html.js`、`fetch-atc-latest.js`、`fetch-object-sources.js`、`archive-prev-run.js`、`make-diff.js`。

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
- 文本池/文本元素相关工具需**子进程环境变量**注入后端（Windows: `$env:SAP_RFC_BACKEND='soap'`；Linux/macOS: `export SAP_RFC_BACKEND=soap`；.env 写入不生效）。
- 传输包对象修改必须传 `transport_request`。

---

## 1. 与用户确认执行参数

- 确认项：变体 ID、创建人账号、创建日期（见 0.1）。
- 输出：本次运行的参数记录 `run-params.json`（写入项目目录）。

## 2. 拉取最新 ATC 结果 + 生成汇总版 HTML 报告

```
node scripts\fetch-atc-latest.js <envPath> <创建人账号> [变体] <项目目录>
node scripts\atc-xml-to-html.js "<项目目录>\ATC-worklist-<displayId>.xml" "<项目目录>\ATC-汇总报告.html" "ATC 汇总报告 <日期>"
```

- 脚本会过滤变体、取 `createdAt` 最新一条、拉完整结果并保存 XML + 元数据。
- 用 `atc-parse.js` 打印分类汇总（按检查/优先级/行号），供步骤 4 展示给用户。
- **坑**：列表端点必须带 `Accept: application/xml` 且 `createdBy` 必填；无匹配结果时询问用户是否重跑（`atc-run-csrf3.js`）。
- 产物：`ATC-汇总报告.html`、`ATC-worklist-<id>.xml`、`atc-latest-meta.json`。

## 3. 按对象建文件夹并拉取源码

```
node scripts\fetch-object-sources.js "<项目目录>\ATC-worklist-<id>.xml" <项目目录> <envPath> [launcherPath]
```

- 解析 worklist 中所有 `<atcobject:object>`，每个对象建 `<项目目录>\<对象名>\` 文件夹。
- 源码保存为 `<对象名>.<ext>`（PROG→.abap，CLAS→.clas，DDLS→.cds 等，见脚本映射表）。
- 对象清单写 `<项目目录>\objects-summary.json`。
- 拉取失败的记录原因，不中断整体流程。

## 4. 与用户确认优先处理的检查项（多选）

- 从步骤 2 的汇总中提取**检查名称列表**（去重，如 "Check Program hardcode"、"程序的扩展命名规则"、"SELECT/OPEN CURSOR without ORDER BY"…）。
- 用多选问题让用户勾选本次要 AI 处理的检查名称。
- **同时提示**：已知不可代码修复项（GLOB_TYPE 变体缺陷、SLIN 系统配置、GUI 状态 STANDARD_FULLSCREEN、MSEG 替换对象警告）——若被勾选，按"记录原因跳过"处理（见步骤 7）。
- 输出：`run-params.json` 记录勾选清单。

## 5. 归档每个对象文件夹的上一次执行结果

对每个对象文件夹（步骤 3 创建或已存在）：

```
node scripts\archive-prev-run.js "<项目目录>\<对象名>"
```

- 根目录所有文件（源码/diff/报告等历史产物）移动到 `<对象名>\<YYYYMMDD-HHMMSS>\`。
- 时间戳跨对象统一（首个对象确定后，把时间戳作为第二参数传给其余对象）。
- 结果：每个对象根目录只保留本次执行产物；历史结果按时间归档。
- 若对象文件夹不存在（首次执行），直接创建。

## 6. 修改前：按勾选项目生成 diff（本地）

对每个勾选对象、每个检查项：

1. 把步骤 3 拉到的当前活动源码复制为 `<对象名>-before.abap`（修改前快照）。
2. 分析告警（`atc-parse.js` 行号 + 对应 SKILL.md 的修法），规划修改。
3. 生成**计划修改后**的源码草稿 `<对象名>-planned.abap`。
4. 生成 diff：
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
4. **更新 diff**：最终部署成功的源码保存为 `<对象名>.abap`（覆盖步骤 3 的副本），重新生成 diff 使"系统与 diff 一致"：
   ```
   node scripts\make-diff.js "<对象名>-before.abap" "<对象名>.abap" "<对象名>.diff"
   ```
5. **不可修项**（用户已确认"记录原因跳过"）：在 `<对象名>-unfixed.md` 记录检查名、行号、原因（变体缺陷/系统配置/有意保留），不部署。
6. 每对象完成后读回活动源码（ReadProgram）与本地 `<对象名>.abap` 行级比对，确认一致。

## 8. 重跑 ATC，生成修正后报告

- 用步骤 1 确认的变体重跑（优先 `atc-run-csrf3.js` 重新运行；如需"最新历史结果"用 `fetch-atc-latest.js`）：
  ```
  node scripts\atc-run-csrf3.js /sap/bc/adt/programs/programs/<对象>/source/main <变体>
  ```
- 生成修正后 HTML：
  ```
  node scripts\atc-xml-to-html.js "<项目目录>\atc-worklist-<新id>.xml" "<项目目录>\ATC-修正后报告.html" "ATC 修正后报告 <日期>"
  ```
- 用 `atc-parse.js` 对比修正前后：勾选检查的数量变化、P1/P2 归零情况、剩余项及原因。
- 汇总写入 `<项目目录>\ATC-执行总结.md`：参数、对象、勾选清单、修复数量、剩余项与原因、传输号、diff 位置。

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
