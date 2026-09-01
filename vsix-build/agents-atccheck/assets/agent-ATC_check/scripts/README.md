# agent-ATC_check 脚本说明

脚本分两类：**流程脚本**（agent 执行 8 步流程时按 AGENT.md 调用）与 **开发/诊断脚本**（排查用，不参与流程）。

## 流程脚本（`scripts\` 根目录，17 个）

| 类别 | 脚本 | 用途 |
|---|---|---|
| **连接/调用** | `mcp-invoke.js` | 通用 MCP 调用桥（自动注入 `SAP_RFC_BACKEND=soap`；参数一律 `@file.json`，结果 `--out=`） |
| | `shared\mcp.js` | 公共库：`loadEnv` / `resolveEnvPath`（`--env=`）/ `mcpCall`（含重试）/ 结果解析 |
| **ATC 运行/拉取** | `atc-run-csrf3.js` | 重跑 ATC（worklist 两步 + CSRF；`--outDir=` 指定落盘目录） |
| | `fetch-atc-latest.js` | 审计：拉该变体最新一条历史结果（`createdBy` 必填） |
| | `fetch-variant-rules.js` | 可选（步骤 1.5）：变体规则快照，供 gen-patch `--rules=` |
| | `atc-parse.js` | worklist XML 解析/按检查分类 |
| | `atc-xml-to-html.js` | worklist → HTML 报告 |
| **对象/归档** | `fetch-object-sources.js` | 按对象建文件夹 + 并行拉源码（读 objects-summary.json） |
| | `archive-all.js` / `archive-prev-run.js` | 统一/单对象归档旧结果到时间戳子目录 |
| **修复辅助** | `fix-guide.js` | 勾选检查 → 修复指引（行号 + 技能引用） |
| | `gen-patch.js` | 候选补丁生成器（FORM/参数命名、SELECT SINGLE；`--rules=` 可读变体规则快照） |
| | `gen-unfixed.js` | 不可修原因自动生成（内置原因表） |
| | `make-diff.js` | Before/After 统一 diff |
| | `migrate-text.js` | 字面量→常量迁移（硬编码专项，配合 skills/abap-text-element） |
| **验证/状态** | `verify-deployed.js` | 部署后读回比对（系统 vs 本地快照） |
| | `assert-regression.js` | 前后 worklist 回归断言（对象集/勾选检查/P1） |
| | `run-state.js` | 单次运行参数 + 步骤状态机（断点续跑） |

## 开发/诊断脚本（`scripts\dev\`，15 个）

探测端点/表可读性/桥接能力用，**不参与流程**：

- `probe-rfc.js` / `test-soap.js` — RFC 桥接（SOAP/OData）探测与直测
- `probe-atc-results*.js`（×4）— ATC results 列表端点探测（createdBy/Accept）
- `probe-atc-variant*.js` / `probe-chkv*.js` / `probe-table-data.js` / `probe-adtsvc.js` — 检查变体(CHKV)与 SATC 配置表读取路径探测
- `rfc-table-read.js` — RFC_READ_TABLE 直读表（当前 SOAP 桥不支持复杂参数）
- `analyze-consts2.js` — 常量用途分析（迁移辅助）
- `prep-args.js` — 生成 MCP 调用参数文件（迁移辅助）

## 调用约定（所有需要连接的脚本统一）

```
--env=<path>       连接配置路径（.env）；旧位置参数仍兼容
--launcher=<path>  MCP 服务器 launcher（需要时）
--outDir=<path>    输出目录（atc-run-csrf3 等）
```
