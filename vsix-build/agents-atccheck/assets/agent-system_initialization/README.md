# 系统初始化 Agent（agent-system_initialization）

基于 **MCP ABAP ADT Server** 的 SAP MCP 连接**初始化模板**：探测系统、生成 `.env`、
配置各 AI 客户端的 MCP 注册、安装/验证 ZMCP_ADT 桥接。是 `XXX升级项目` 的子 agent 之一
（调度见 `..\agent-scheduler\AGENT.md`）。

## 目录结构

```
agent-system_initialization\
├── README.md                  # 本文件
├── .gitignore                 # 排除 .env / .sc4sap
├── abap\                      # ZMCP_ADT 桥接源码（需部署到 SAP）
│   ├── zcl_zmcp_adt_dpc_ext.abap
│   ├── zcl_zmcp_adt_mpc_ext.abap
│   └── zmcp_adt_flush_cache.abap
├── docs\
│   ├── SYSTEM_INIT_AGENT.md   # AI 指令版初始化流程
│   ├── ZMCP_ADT_SRV-安装指南.md
│   └── 接收方使用说明.md
├── scripts\
│   └── system-init.ps1        # 自动化向导（Windows PowerShell）
└── mcp-pack\
    ├── .env.example           # 连接配置模板（无真实密码）
    ├── agent-configs\         # 各 AI 客户端的 MCP 注册配置（11 份）
    └── scripts\               # 启动脚本（HTTP 3000 / SSE 3001，已注入 SAP_RFC_BACKEND）
```

## 服务器位置

MCP 服务器源码位于 `C:\path\to\your\your-abap-mcp\adt-dev`(已构建)。
本目录下所有 agent 配置与启动脚本均指向其 `dist\server\launcher.js`。

## 快速开始

1. 检查 `mcp-pack\.env`(已填好真实连接,一般无需改动)。
2. 把 `mcp-pack\agent-configs\<你的客户端>.json` 中的 `mcpServers`
   粘贴到对应 AI 客户端的 MCP 服务器配置里,重启客户端即可。
3. 或者运行 `mcp-pack\scripts\start-http.cmd`(HTTP 模式,端口 3000)
   / `start-sse.cmd`(SSE 模式,端口 3001),让其他客户端走 URL 连接
   (参考 `agent-configs\http-remote.json`)。

## 系统初始化

首次接入或换系统时,按 `docs\SYSTEM_INIT_AGENT.md`(AI 指令版)
或运行 `scripts\system-init.ps1`(自动化向导,交互式)完成:
探测系统 → 确认 `.env` 配置 → 确认 MCP 读取路径 → 写入 `.env` →
自动更新全部 agent-configs → 按选择验证(启动级 / 只读 / 含读写)。

> `agent-configs\multi-system.json` 是"开发/生产双系统"示例,使用前需先在
> `mcp-pack` 下自备 `dev.env`、`prod.env` 两份连接配置。

## 分享给其他人使用

模板打包为 `XXX升级项目-初始化模板.zip`（位于 `..\` 项目根）：
- **自动排除**敏感与本机内容：`.env`、`.sc4sap`（真实密码/账号不外泄）；
- **自动中立化** `agent-configs` 里的本机 launcher / `.env` 路径为占位符；
- zip 内含 `使用说明-接收方.txt`。

**接收方步骤**：解压 → 准备好 MCP 服务器（adt-dev 或 npm 包）→ 运行
`scripts\system-init.ps1`（交互式填写自己的 SAP 连接、RFC 后端、launcher 路径）→
向导自动写 `.env` / `.sc4sap` 并更新 agent-configs → 按选择验证。

> 也可只分享单份 `docs\SYSTEM_INIT_AGENT.md` 给 AI 客户端作为指令执行。
> ⚠️ 分发前请先打开 zip 自查一遍；接收方填写的 `.env` 含其密码，勿回传。

## 连接与认证(当前)

| 项 | 值 |
|---|---|
| 系统类型 | On-Premise S/4HANA(`SAP_SYSTEM_TYPE=onprem`) |
| 认证 | Basic Auth(`SAP_AUTH_TYPE=basic`) |
| RFC 桥接 | `SAP_RFC_BACKEND=soap`(走 /sap/bc/soap/rfc;XXX 未装 OData 服务 ZMCP_ADT_SRV) |
| 主系统 | `SAP_MASTER_SYSTEM=ZZZ`(创建/更新对象需要) |

## 切换 OData RFC 后端(可选)

如后续 XXX 安装了 OData 服务 `ZMCP_ADT_SRV`,可切换到 `odata` 后端。

> ⚠️ 关键机制(已实证):`SAP_RFC_BACKEND` 在 **node 进程启动瞬间**就被读取
> (模块加载时),而 `.env` / `.sc4sap\sap.env` 都是服务器启动**之后**才加载,
> 所以 `SAP_RFC_BACKEND=odata` 写在 `.env` 或 `sap.env` 里**不生效**,
> 必须放在 node 启动前的环境里(见下)。`SAP_RFC_ODATA_SERVICE_URL` 是
> 调用时才读取,放 `.env` 即可。

### 步骤 1:SAP 侧前提(一次性)

OData 服务 `ZMCP_ADT_SRV` 必须已激活,含 FunctionImport `Dispatch` / `Textpool`
(转发到 `ZMCP_ADT_DISPATCH` / `ZMCP_ADT_TEXTPOOL`),且 MPC_EXT 类
`ZCL_ZMCP_ADT_MPC_EXT` 的每个 Action 都同时调用了 `set_return_complex_type()`
和 `set_return_multiplicity('1')`(缺后者所有 POST 会报 HTTP 500)。
验证:浏览器打开 `{服务地址}/$metadata`,检查每个 FunctionImport 有
`ReturnType="..."` 属性。

### 步骤 2:配置环境变量(两组,位置不同)

**A. 启动前注入(必填,放 node 之前的环境):**

```bat
set SAP_RFC_BACKEND=odata
```

- agent 场景:加在 `agent-configs\<客户端>.json` 的 `"env"` 字段里
  (与 `NODE_TLS_REJECT_UNAUTHORIZED` 并列),例如:

```json
"env": {
  "NODE_TLS_REJECT_UNAUTHORIZED": "0",
  "SAP_RFC_BACKEND": "odata"
}
```

**B. `.env` 里(调用时读取):**

```env
SAP_RFC_ODATA_SERVICE_URL=https://<host>:<port>/sap/opu/odata/sap/ZMCP_ADT_SRV
SAP_USERNAME=...
SAP_PASSWORD=...
SAP_CLIENT=100
```

(`SAP_RFC_ODATA_SERVICE_URL` 以 `SAP_RFC_` 开头,launcher 会自动透传到
process.env;认证复用 Basic Auth 三件套。)

### 步骤 3:重启并验证

1. 重启 MCP 服务器(或让 agent 重启)。
2. 调用一个走 RFC 桥的工具(如 `GetScreen` / `GetGuiStatus` / `GetTextElement`)。
   成功 = 首次调用会先 `GET $metadata`(带 `X-CSRF-Token: Fetch`)完成 CSRF 握手。
3. 失败排查:404 = 服务未装/URL 错;HTTP 500 = MPC_EXT 缺 `set_return_multiplicity`。

回退:`set SAP_RFC_BACKEND=soap` 恢复旧后端。

## 安全

- `.env` 与 `.sc4sap\sap.env` 含密码,已被 `.gitignore` 排除,勿提交 git。
- 自签名证书:各 agent 配置的 `env` 字段已设 `NODE_TLS_REJECT_UNAUTHORIZED=0`
  (`.env` 内的 TLS 变量不会自动进入 process.env,必须放在 agent 配置里)。