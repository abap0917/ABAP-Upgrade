# ABAP ATC 修改经验总结（ZZZPROG001 全流程）

> 对象：ZZZPROG001（三方贸易收发货关联过账，包 ZZZPKG001，传输 ZZTR000001）
> 系统：XXX / ZZZ（S/4HANA on-prem，EHP4 兼容），检查变体 `ZABAP_CLOUD_DEV_CHECK`
> 时间：2026-08（含文本元素迁移）
> 结论先行：**413 条基线告警 → 11 条残留（全部为不可代码修复项）**

---

## 一、阶段回顾

### 阶段 0：环境与工具准备
- 连接配置在 `mcp-pack\.env`（XXX，basic auth，语言 ZH，SID ZZZ）。
- 所有 MCP 调用走 `mcp-invoke.js`（stdio JSON-RPC）；**参数必须用 `@file.json`**（PowerShell 会吞内联引号），结果用 `--out=file` 落盘。
- 教训：先探测系统（SearchObject、GetSession、ADT discovery）再动手；本系统的 RFC 桥接 FM（ZMCP_ADT_*）存在但 OData 服务缺失——这类"半配置"状态要先验证。

### 阶段 1：ATC 运行（正确流程）
- 坑：直接 POST `/atc/runs` 会拿到 **DEFAULT 变体**而不是目标变体。
- 正确流程（脚本 `atc-run-csrf3.js`）：
  1. HEAD `/sap/bc/adt/atc/worklists` 带 `X-CSRF-Token: Fetch` 取 CSRF + 会话 Cookie；
  2. POST `/sap/bc/adt/atc/worklists?checkVariant=ZABAP_CLOUD_DEV_CHECK` → worklistId；
  3. POST `/sap/bc/adt/atc/runs?worklistId=<id>` → 运行；
  4. 轮询 `/sap/bc/adt/atc/worklists/<id>` 直到结果就绪，保存 XML。
- worklist XML 是**单行压缩格式**，用正则逐条抽取 finding（`atc-parse.js`：按 checkId/priority/messageTitle 汇总并列出源码行号）。

### 阶段 2：基线分析与分类（413 条）
| 类别 | 数量 | 可修？ |
|---|---|---|
| 硬编码（P1） | 335 | 可修（→ 常量/文本元素） |
| 命名规范（P2） | 68 | 可修 |
| SELECT/ORDER BY（P3） | 5 | 可修 |
| SELECT *（P3） | 2 | **不可修**（UPDATE FROM 需整行） |
| FOR ALL ENTRIES（P2） | 2 | 中风险，未转 |
| SLIN（P3） | 1 | 部分可修 |
- 分类原则：按 **checkId + 源码位置** 归类；先区分"代码可改"与"配置/变体缺陷/系统配置"。

### 阶段 3：分轮修复
1. **SELECT/ORDER BY（5→0）**：`SELECT SINGLE ... ORDER BY PRIMARY KEY` 在 EHP4 报错 → 改 `SELECT ... UP TO 1 ROWS ... ORDER BY PRIMARY KEY. ENDSELECT.`；`READ TABLE ... INDEX 1` 告警核对逻辑后消除。
2. **命名规范（68→4）**：FORM 名 `FRM_`、USING 参数 `U([VTOS])?_` 前缀；**重命名注意同名参数冲突**（如 `uo_object = uo_object`），类方法参数恢复原名、FORM 参数保留新名。
3. **硬编码（335→12）**：脚本化字面量→常量迁移（`hardcode-migrate6.js`：分段 CONSTANTS 块、大小写不敏感去重、名称 ≤30 字符）。
4. **文本元素迁移（本轮，12→0）**：中文/UI 常量 → TEXT-xxx（见 `abap-text-element` 技能）。

### 阶段 4：验证与部署
- 每次 Update* 前展示 **Before/After diff**（项目纪律：可追溯性硬要求，模型无关）。
- UpdateProgram 步骤：lock → check_new_code → update → unlock → check_inactive → activate；**check 失败 = 未改动**（安全试错）。
- 传输：传输包中的对象必须给 `transport_request`；用 GetTransport 确认"可修改"。
- 部署后验证：读回活动源码比对、GetInactiveObjects 确认无未激活、重跑 ATC 对比 FINDING_STATS。

### 阶段 5：交付
- 生成 Before/After diff（统一 diff 格式）、分类结果 MD、HTML 报告（XML→HTML 脚本）。
- 交付物集中在 `ATC项目目录`；按用户偏好**中文报告**。

---

## 二、最终结果

| 检查 | 基线 | 中间 | 最终 |
|---|---|---|---|
| 硬编码 P1 | 335 | 12 | **0** |
| 命名规范 P2 | 68 | 4 | 4（GLOB_TYPE 变体缺陷） |
| SELECT/ORDER BY | 5 | 1 | 0 |
| SLIN | 1 | 5 | 3（2 条文本元素警告已消除） |
| SELECT * | 2 | 2 | 2（有意保留） |
| FAE | 2 | 2 | 2（中风险未转） |
| **合计** | **413** | **25** | **11**（P1:0, P2:7, P3:4） |

**不可修项**：GLOB_TYPE 命名（变体 `ZABAP_CLOUD_DEV_CHECK` 正则缺陷，任何 TYPES 前缀都触发）、GUI 状态 STANDARD_FULLSCREEN（运行时自动生成）、MSEG 替换对象警告（系统配置）、FAE/SELECT*（中风险/功能需要）。

---

## 三、核心教训（沉淀为技能）

1. **先验证工具链，再批量操作**：RFC 桥接后端、CSRF 流程、语言键等环境细节不验证就动手会浪费大量轮次。
2. **用 $TMP 测试程序验证编译器行为**：EHP4 对常量/文本元素的兼容性实测（PERFORM 传参、方法参数、CONCATENATE）比查文档可靠，一次测试避免反复失败。
3. **脚本化批量迁移 + 精准校验**：迁移脚本要输出"残留引用检查"（大小写不敏感），失败即中断。
4. **每轮闭环**：改 → 检查/激活 → 重跑 ATC → 对比数字 → 交付 diff。
5. **区分"能改"与"不该改"**：ATC 告警 ≠ 都要改；功能正确性优先（SELECT*、FAE 有意保留并记录理由）。
6. **项目纪律（模型无关）**：Update 前展示 diff；完成后如环境有 Notion/文档库工具则记录变更（本会话无，未执行）。
