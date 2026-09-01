# Agents-ATCcheck

**架构**：三个 agent（指令/技能/脚本）是**用户级**模板，装一次全工作区可用；**MCP 配置与 .env（连接）是项目级**，每个项目各自初始化。

## 用户级（装一次，所有工作区生效）

1. **agents 模板**：自动安装到 `%USERPROFILE%\xxx-upgrade-agents\`（三 agent + AGENTS.md + docs + 工作区文件）。
2. **用户级任务**：注册 `Agents-ATCcheck` 任务提供器，每个工作区 `Terminal → Run Task` 都有 ATC/调度任务；任务运行在**当前项目**上，自动使用当前项目的 `.env`。

## 项目级（每个项目独立）

每个项目执行一次 **`Agents-ATCcheck: 初始化本项目 MCP 配置(.env + mcp.json)`**：
- 生成项目根 `.env`（模板，填真实 SAP 连接；勿提交 git）
- 生成 `.vscode\mcp.json`（`mcp-abap-adt` 指向**本项目** `.env`）
- 然后允许 VSCode 加载该 MCP 服务器，即可对话调 SAP

## 命令（Ctrl+Shift+P）

| 命令 | 层级 | 作用 |
|---|---|---|
| Agents-ATCcheck: 初始化本项目 MCP 配置 | 项目 | 生成 `.env` + `.vscode\mcp.json`（指向本项目 .env） |
| Agents-ATCcheck: 刷新用户目录 agents 模板 | 用户 | 重新同步 `%USERPROFILE%\xxx-upgrade-agents\` |
| Agents-ATCcheck: 打开用户目录 agents 模板 | 用户 | 以工作区打开用户模板（含 .code-workspace） |

## 使用

- 新项目：打开项目 → 运行"初始化本项目 MCP 配置" → 填 `.env` → 允许 MCP → Run Task / 对话执行。
- 详细操作见 `%USERPROFILE%\xxx-upgrade-agents\docs\多工具操作手册.md`。
- 换机器/环境：改 `.env`（项目）与 `extension.js` 里的 `LAUNCHER`（用户级基础设施路径）。
