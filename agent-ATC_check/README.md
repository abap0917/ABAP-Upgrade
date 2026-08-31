# ABAP MCP 技能库（ABAP_MCP3）

由 ZZZPROG001 ATC 全流程整改（413 → 11 条告警）沉淀的**可复用技能**，适用于：
- 对 ABAP 程序做 ATC（ABAP Test Cockpit）检查与整改；
- 通过 MCP 工具链（`mcp-invoke.js` + abap-mcp-adt-powerup）操作 SAP；
- 处理 EHP4/老版本编译兼容性、文本池（文本元素）、传输等专项问题。

## ATC 执行 Agent

- **执行指令**：[`AGENT.md`](./AGENT.md) — 8 步流程的 agent 行为定义（连接/参数确认、拉取、归档、修改、部署激活、复查、报告），含确认点、目录约定、校验清单、失败处理。
- **新增支撑脚本**（`scripts/`）：
  - `fetch-atc-latest.js` — 步骤 2：按创建人/变体拉最新一条 ATC 历史结果（`/atc/results?createdBy=` + `Accept: application/xml`）→ XML + 元数据
  - `fetch-object-sources.js` — 步骤 3：按 worklist 对象建文件夹并拉源码（PROG/CLAS/INTF/DDLS/FUGR/TABL…）
  - `archive-prev-run.js` — 步骤 5：对象文件夹旧结果归档到 `YYYYMMDD-HHMMSS/` 子目录
  - `make-diff.js` — 步骤 6/7：Before/After 统一 diff（修复后重跑即与系统一致）
  - `probe-atc-results*.js` — ATC results 端点探测（已确认：`createdBy` 必填、`Accept: application/xml` 必需）
- **执行确认点**（AGENT.md 0.1）：连接（.env 路径/参数）、变体、创建人账号、创建日期、项目目录、传输策略 —— 均在运行时与用户确认。

## 目录

| 技能 | 用途 | 位置 |
|---|---|---|
| `abap-atc-run` | 运行 ATC、解析 worklist、按检查分类 | `skills/abap-atc-run/SKILL.md` |
| `abap-atc-fix` | 常见 ATC 告警的修复流程（SELECT/命名/硬编码/激活/验证） | `skills/abap-atc-fix/SKILL.md` |
| `abap-text-element` | 文本元素迁移专项（RFC 桥接、语言键、WriteTextElementsBulk、EHP4 位置限制） | `skills/abap-text-element/SKILL.md` |
| `abap-mcp-toolkit` | MCP 工具链使用要点（mcp-invoke、PowerShell 陷阱、EHP4 编译器怪癖、传输管理） | `skills/abap-mcp-toolkit/SKILL.md` |

## 经验总结

完整旅程复盘见 [`ATC修改经验总结.md`](./ATC修改经验总结.md)（413 → 11 的数字对比、分阶段过程、核心教训）。

## 使用方式

- 作为 Agent 技能：把 `skills/<技能名>/SKILL.md` 挂载到 agent 的 skills 目录即可按名调用。
- 作为速查手册：按需阅读对应技能；每个 SKILL.md 含背景、命令/脚本要点、坑、验证清单。
- 参考脚本：`scripts/` 目录（`mcp-invoke.js` MCP 调用器、`atc-run-csrf3.js` ATC 运行、`atc-parse.js` 解析、`atc-xml-to-html.js` HTML 报告、`migrate-text.js` 文本元素迁移、`analyze-consts2.js` 常量用途分析、`probe-rfc.js`/`test-soap.js` RFC 桥接探测）。

## 适用范围与边界

- 系统：XXX / ZZZ（S/4HANA on-prem，EHP4 兼容）；变体 `ZABAP_CLOUD_DEV_CHECK`。
- 连接：`mcp-pack\.env`（basic auth，语言 ZH）。
- 已知环境限制：文本池读写仅能走 RFC 桥接（本系统 OData 服务 `ZMCP_ADT_SRV` 未安装，需 SOAP 后端）；ATC 豁免审批人未配置（`SATC_CI_APPROVER` 为空）。
