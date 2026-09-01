# XXX升级项目 — 子 Agent 库

本目录汇聚 XXX 升级项目使用的子 agent，均为自包含目录（指令 + 技能 + 脚本 + 资产），并由**调度 Agent** 统一编排。

## 📄 部署文档（给其他人）

全新环境部署本套 agent（Node.js、MCP 服务器、.env、SAP 侧桥接、验证与排错）：[`docs\部署文档.md`](./docs/部署文档.md)

## 调度 Agent

| 调度 Agent | 目录 | 职责 | 入口 |
|---|---|---|---|
| **agent-scheduler** | `agent-scheduler\` | 先调用 `agent-system_initialization` 初始化项目（**每个项目只执行一次**，由 `projects-registry.json` 保证），再调用 `agent-ATC_check` 处理 ATC 执行后的结果 | [`agent-scheduler\AGENT.md`](./agent-scheduler/AGENT.md) |

- 子 agent 索引：`agent-scheduler\agents-index.json`
- 项目注册表：`agent-scheduler\projects-registry.json`（执行计划 + 步骤状态机 + 初始化状态 + ATC 历史 + 日志）
- 注册表工具：`node agent-scheduler\scripts\registry.js <list|status|plan|step|log|init|add-run|verify-index|summary|clear> ...`
- 前置自检：`node agent-scheduler\scripts\scheduler-check.js [--projectDir=<path>]`（Node 版本/注册表/索引路径/可写性）
- **断点续跑**：步骤状态机 `init/atc/complete` 记录进度，中断后 `status` 显示阶段，从对应步骤继续

## 子 Agent 清单

| 子 Agent | 目录 | 用途 | 入口 |
|---|---|---|---|
| **系统初始化 Agent** | `agent-system_initialization\` | 新系统初始化（ZMCP_ADT 安装、连接配置、ATC 基线） | [`agent-system_initialization\docs\SYSTEM_INIT_AGENT.md`](./agent-system_initialization/docs/SYSTEM_INIT_AGENT.md) |
| **ATC 执行 Agent** | `agent-ATC_check\` | 按 8 步流程对 ABAP 对象执行 ATC 检查、源码拉取、人工确认、修改、部署激活、复查与报告 | [`agent-ATC_check\AGENT.md`](./agent-ATC_check/AGENT.md) |

## 使用方式

- 调度：按 `agent-scheduler\AGENT.md` 执行，调度器负责"每个项目只初始化一次"与按序委派。
- 每个子 agent 目录独立自包含，也可直接挂载或按入口文档单独执行。
- ATC 执行 Agent 在运行时需确认：连接（.env 路径或参数）、ATC 变体 ID、创建人账号、创建日期、项目目录、传输策略。
- 初始化模板 Agent 见其 `docs\` 下的安装指南与使用说明。

## 目录说明

```
XXX升级项目\
├── agent-scheduler\                ← 调度 Agent
│   ├── AGENT.md                    （编排指令：初始化→ATC，每项目一次）
│   ├── agents-index.json           （子 agent 名称→目录/入口）
│   ├── projects-registry.json      （初始化状态 + ATC 历史）
│   └── scripts\registry.js         （注册表工具）
├── agent-system_initialization\    ← 子 Agent：系统初始化
│   ├── docs\                       (SYSTEM_INIT_AGENT.md / ZMCP_ADT_SRV 安装指南 / 使用说明)
│   ├── abap\                       (ZMCP_ADT DPC/MPC 扩展、flush cache)
│   ├── mcp-pack\                   (.env / .sc4sap / agent-configs / scripts)
│   └── README.md / .gitignore
├── agent-ATC_check\                ← 子 Agent：ATC 执行
│   ├── AGENT.md
│   ├── skills\                     (abap-atc-run / abap-atc-fix / abap-text-element / abap-mcp-toolkit)
│   └── scripts\                    (mcp-invoke / atc-run-csrf3 / fetch-atc-latest / fetch-object-sources / archive-prev-run / make-diff ...)
└── XXX升级项目-初始化模板.zip        ← 初始化模板原始打包（参考存档）
```
