# 调度 Agent（agent-scheduler）

> 编排两个子 agent：先 `agent-system_initialization` 初始化项目（**每个项目只执行一次**），
> 再 `agent-ATC_check` 处理 ATC 执行后的结果。
> 本 agent 是**编排器**：不重复实现子 agent 的能力，而是按 `agents-index.json` 委派。

## 1. 子 Agent 索引（agents-index.json）

| agent 名 | 目录 | 入口文档 | 职责 |
|---|---|---|---|
| `agent-system_initialization` | `../agent-system_initialization` | `docs/SYSTEM_INIT_AGENT.md` | 系统初始化：ZMCP_ADT 桥接安装/验证、连接配置、ATC 基线 |
| `agent-ATC_check` | `../agent-ATC_check` | `AGENT.md` | ATC 检查与整改（8 步流程：拉取→对象文件夹→勾选→diff→部署激活→复查→报告） |

## 2. 执行流程

```
启动
 ├─ ⓪ 前置自检（每轮开始可重复执行）
 │     node scripts/scheduler-check.js [--projectDir=<项目目录>]
 │     - 全部通过才继续；未通过项先解决（Node 版本/registry 可写/agents-index 路径/项目目录）
 │
 ├─ ① 确认输入（向用户收集一次，透传给子 agent）
 │     - 项目名称 / 项目路径（"每个项目"的唯一标识 = projectKey）
 │     - 连接（.env 路径或参数）
 │     - ATC 变体 ID（默认 ZABAP_CLOUD_DEV_CHECK）、创建人账号、创建日期
 │     - 传输策略（复用/新建/每对象）
 │     - 确认后落盘执行计划（后续可查/可续）：
 │         node scripts/registry.js plan <projectKey> --name=<名称> --path=<路径> ^
 │             --variant=<变体> --creator=<创建人> --transport=<传输> [--projectDir=<项目目录>]
 │
 ├─ ② 注册表检查（含断点判断）
 │     node scripts/registry.js status <projectKey>
 │     ├─ 阶段=全部完成      → 本轮已完成，结束（或询问用户是否仅重跑 ATC）
 │     ├─ 阶段=ATC 完成，等待收尾 → 直接从 ⑤ 收尾
 │     ├─ 阶段=初始化完成，等待 ATC → 直接从 ④（断点续跑）
 │     ├─ 阶段=等待初始化 且 initialized=true → step init done 后从 ④
 │     └─ 阶段=等待初始化 且未初始化 → 进入 ③
 │
 ├─ ③ 委派 agent-system_initialization（只执行一次）
 │     - 读取子 agent 入口文档，按其步骤执行（subagent 委派或同会话按文档执行）
 │     - 成功后：
 │         node scripts/registry.js init <projectKey> <名称> <路径> "<初始化摘要>"   # 自动 step init done
 │     - 失败：node scripts/registry.js step <projectKey> init fail "<原因>"；修复后重试，**禁止跳过失败标记为成功**
 │
 ├─ ④ 委派 agent-ATC_check 处理 ATC 执行后的结果
 │     - 读取 ../agent-ATC_check/AGENT.md，按其 8 步流程执行（拉最新结果→HTML、对象文件夹、
 │       多选勾选、归档、diff、部署激活、重跑复查、修正后报告）
 │     - 完成后：
 │         node scripts/registry.js add-run <projectKey> <变体> "<结果摘要>" "<报告文件路径>"   # 自动 step atc done
 │     - 失败/部分失败：node scripts/registry.js step <projectKey> atc fail "<原因>"，修复后从 ④ 重试
 │
 ├─ ⑤ 收尾
 │     node scripts/registry.js log <projectKey> "<关键运行日志>"
 │     node scripts/registry.js step <projectKey> complete done "<小结>"
 │     node scripts/registry.js summary <projectKey>      # 打印执行总结（可直接作为交付摘要）
 │
 └─ 输出执行总结（初始化状态、ATC 前后对比、剩余项、产物位置）
```

## 3. "每个项目只执行一次"的保证

- 唯一标识 = `projectKey`（建议 = 项目名称，可含客户/系统标识，如 `XXX-ZZZ-ZZZPROG001`）。
- 注册表 `projects-registry.json` 按 projectKey 记录 `initialized: true + initAt`。
- 已初始化项目再次执行调度时**自动跳过初始化**，只跑 ATC。
- 强制重初始化：需用户显式要求（`registry.js clear <projectKey> --force` 后再跑），调度 agent 不得自行清除。
- **状态机**：`init / atc / complete` 三步由 `registry.js step` 推进；执行中断后 `status` 显示当前阶段，从对应步骤**断点续跑**（见 §2 ②）。

## 4. 委派协议（模型无关）

调度 agent 不重复实现子 agent 能力，按宿主可用机制委派。**以下两种方式等价，均可接受，不得因缺少某种机制而跳过步骤：**

- **方式 A（宿主有子代理工具）**：subagent 委派 —— 任务 prompt 必须包含子 agent 入口文档全文 + 本次上下文
  （项目、连接、变体、创建人、传输、项目目录），并注明"按文档执行，遇到确认点暂停向用户询问"。
- **方式 B（宿主无子代理工具，如单会话模型）**：在同一会话内**读取子 agent 入口文档并按其步骤逐条内联执行**，
  视同已委派。缺失 subagent 工具不是跳过初始化或 ATC 步骤的理由。

- 子 agent 的**运行时确认点**（连接、勾选检查项、传输号）由调度 agent 统一向用户收集后透传，避免重复询问。

## 5. 产物与日志

- 注册表：`projects-registry.json`（执行计划 plan + 状态机 steps + 初始化状态 + ATC 执行历史 + 运行日志 log），供多轮调度回溯与断点续跑。
- 每轮 ATC 产物由 `agent-ATC_check` 写入其项目目录（报告 HTML/XML、对象文件夹、diff）。
- 调度日志：`registry.js log` 落盘 + 控制台输出；执行总结用 `registry.js summary` 生成。

## 6. 失败处理

| 场景 | 处理 |
|---|---|
| 前置自检未通过 | 先解决失败项再开始；不要带病执行 |
| 初始化失败 | `step init fail` 记录原因；修复子 agent 问题后重试 ③，不标记 initialized |
| 执行中断 | `status` 显示阶段，从对应步骤续跑（init done→④；atc done→⑤） |
| ATC 拉取无结果 | 询问用户重跑（atc-run-csrf3）或换创建人/变体 |
| 部署反复失败（>3 次/对象） | 暂停，展示错误请用户决策，不无限重试 |
| 传输不可用 | 询问用户（复用其他号/新建/跳过该对象） |
| 子 agent 入口文档缺失 | `registry.js verify-index` 定位，报错不猜测 |

## 7. 校验清单（每轮收尾）

- [ ] 前置自检：`scheduler-check.js` 全部通过
- [ ] 计划：`plan` 已落盘（变体/创建人/传输/项目目录）
- [ ] 注册表：本项目 `initialized=true`（initAt 为本轮或历史成功记录）
- [ ] 注册表：步骤机 `init/atc/complete` 状态正确（失败项有原因）
- [ ] 注册表：本轮 ATC run 已记录（variant / 摘要 / 报告路径）
- [ ] ATC：修正后报告已生成，勾选检查归零/下降，剩余项有原因
- [ ] 未误标：初始化失败时 initialized 必须为 false
