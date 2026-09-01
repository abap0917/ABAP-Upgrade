# XXX升级项目 — Agent 指令

本工作区包含 3 个自包含 agent。**用 AI 助手（VSCode Copilot / Claude 等）处理任务时，先读取对应 agent 的入口文档并按其执行。**

## Agent 清单

| Agent | 目录 | 入口文档 | 职责 |
|---|---|---|---|
| **调度** | `agent-scheduler\` | `AGENT.md` | 编排：先初始化（每项目一次）→ 再 ATC 检查；注册表状态机 + 断点续跑 |
| **系统初始化** | `agent-system_initialization\` | `docs\SYSTEM_INIT_AGENT.md` | 探测/配置 SAP MCP 连接、ZMCP_ADT 桥接、agent-configs |
| **ATC 检查** | `agent-ATC_check\` | `AGENT.md` | 8 步流程：拉取 ATC→对象→勾选→归档→候选补丁→部署验证→回归断言→报告 |

## 使用流程（推荐）

1. **首次接入系统** → 执行 `agent-system_initialization`（或其 `scripts\system-init.ps1`）完成连接初始化；
2. **日常 ATC 检查** → 按 `agent-scheduler\AGENT.md` 调度（自动跳过已初始化），或直接按 `agent-ATC_check\AGENT.md` 执行 8 步；
3. **修复辅助** → `agent-ATC_check\scripts\` 的脚本（`gen-patch` 候选补丁、`fix-guide` 修复指引、`verify-deployed` 校验、`assert-regression` 断言），脚本分类见 `agent-ATC_check\scripts\README.md`。

## VSCode 集成

- **MCP 服务器**：`.vscode\mcp.json` 已注册 `mcp-abap-adt`（node + launcher + `.env`）。路径为当前机器默认值，换环境改此文件即可（或改 `.env`）。
- **任务**：`.vscode\tasks.json` 提供常用操作（重跑 ATC / 拉历史 / HTML / 校验 / 断言 / 候选补丁 / 调度自检），Terminal → Run Task 直接运行。
- **连接配置**：`.env` 在 `your-abap-mcp\mcp-pack\.env`（见 `agent-system_initialization\docs\SYSTEM_INIT_AGENT.md` 与根目录 `docs\部署文档.md`）。

## 关键约定

- 所有连接类脚本统一支持 `--env=<path>`；MCP 调用参数用 `@file.json`；文本池工具自动注入 `SAP_RFC_BACKEND=soap`。
- 修改对象必须走"展示 diff → 用户确认 → Update → 激活 → verify-deployed 校验 → 更新 diff"。
- 不可修项记录原因跳过（`gen-unfixed` 自动生成）；回归断言必须通过。
