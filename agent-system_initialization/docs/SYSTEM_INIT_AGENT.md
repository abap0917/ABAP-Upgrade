# 系统初始化 Agent — SAP MCP 连接初始化指令

> 用途:引导 AI 客户端(或人工)完成 SAP MCP 连接从零初始化:确认配置 → 写 `.env` → 自动配置 agent → 测试。
> 对应项目:`XXX升级项目`;服务器:`ABAP-MCP2\adt-dev`。
> 可并行参考:PowerShell 自动化版 `scripts\system-init.ps1`(步骤一致)。

---

## 前置说明(先读)

- **两个配置文件职责不同**(已实证):
  - `.env`(**选择性**加载):白名单 8 键 + 所有 `SAP_RFC_*` 前缀;**`SAP_PASSWORD` 不生效**(白名单外);
  - `.sc4sap\sap.env`(**全量**加载,优先级最高):所有键都进 process.env,且先加载、`.env` 不覆盖。
- **`SAP_RFC_BACKEND` 必须在 node 启动前注入**(模块加载时读取),`.env` / `sap.env` 都太晚 → 放 agent 配置 `env` 字段或启动脚本 `set`。
- **Screen / GUI Status 工具在当前系统(XXX)不可用**(标准 FM `RPY_DYNPRO_*`/`RS_CUA_*` 在非对话环境抛 `CX_SY_DYN_CALL_*`),TextElement 工具可用。验证时**不要**把 Screen/GUI 列为预期成功项。

---

## 步骤 0:系统探测(只读,先于一切配置)

**向用户询问并确认:**
1. SAP 系统 URL(默认 `https://<host>:<port>`)
2. Client(默认 `100`)
3. SAP 用户名 / 密码(**密码不要明文回显在对话里**)

**执行探测(用 curl,容忍自签名):**
```bash
curl -sk -o /dev/null -w "%{http_code}" -u "用户:密码" \
  "https://<host>:<port>/sap/bc/adt/discovery?sap-client=100"
```
- `200` → ADT 可达 ✅
- `401` → 认证失败,让用户核对账号密码;
- 其他 → 网络/端口/防火墙问题。

**判定系统类型**:`onprem`(URL 形如 IP/主机:端口,ADT discovery 可用)/ `cloud`(abap.xxx.hana.ondemand.com)/ `legacy`(BASIS<7.50,无 ADT 需 RFC)。向用户确认。

---

## 步骤 1:收集并确认 `.env` 配置

逐项与用户确认(给出默认值,用户可改),至少包含:

| 键 | 说明 |
|---|---|
| `SAP_URL` | 探测值 |
| `SAP_CLIENT` | 探测值 |
| `SAP_LANGUAGE` | 默认 `ZH` |
| `SAP_SYSTEM_TYPE` | onprem/cloud/legacy |
| `SAP_AUTH_TYPE` | `basic`(本项目) |
| `SAP_USERNAME` / `SAP_PASSWORD` | 探测值 |
| `SAP_MASTER_SYSTEM` | onprem 建对象必需(如 `ZZZ`) |
| `SAP_RESPONSIBLE` | 默认同用户名 |
| **`SAP_RFC_BACKEND`** | **运行时询问**:`soap`(零安装,需 ICF 节点激活)或 `odata`(需服务端 `ZMCP_ADT_SRV` 已装) |
| `SAP_RFC_ODATA_SERVICE_URL` | 仅选 odata 时需要;默认 `<SAP_URL>/sap/opu/odata/sap/ZMCP_ADT_SRV` |

**后端前提探测**(选哪个查哪个):
- `soap` → `curl .../sap/bc/soap/rfc` 期望 `415`(端点存在);
- `odata` → `curl .../ZMCP_ADT_SRV/$metadata` 期望 `200`(404/403=未注册,500=MPC 问题)。

**密码注入方式询问**(三选一):
- **A) `.sc4sap\sap.env`(推荐)**:SAP_PASSWORD 全量生效;前提服务器 cwd=`mcp-pack`(启动脚本已 `cd`);
- B) agent 配置 `env` 字段:随客户端启动注入;
- C) 两者都写。

最后**汇总确认表**,用户确认后才进入下一步。

---

## 步骤 2:确认 MCP 读取路径

向用户确认三个路径:
1. **launcher.js 路径**(服务器):默认 `C:\path\to\your\ABAP-MCP2\adt-dev\dist\server\launcher.js`(需存在);
2. **`.env` 路径**:默认 `XXX升级项目\mcp-pack\.env`(agent 配置的 `--env-path` 指向它);
3. **agent-configs 目录**:默认 `XXX升级项目\mcp-pack\agent-configs`(要生成/更新的全部 json 所在处)。

说明 `.sc4sap` 依赖服务器 cwd;若用 agent 直启且 cwd 不可控,建议用方式 B(env 字段)。

---

## 步骤 3:写入 `.env`(与 .sc4sap)

按确认值写入 `mcp-pack\.env`(UTF-8 无 BOM,键=值,注释说明来源)。
- 若方式 A/C:同时写 `mcp-pack\.sc4sap\sap.env`,含 `SAP_PASSWORD`(+ odata 时含 `SAP_RFC_ODATA_SERVICE_URL`)。
- **写完不要打印密码明文**,用 `******` 代替。
- 确认 `.gitignore` 已排除 `.env` 与 `.sc4sap/`(项目已有)。

---

## 步骤 4:自动配置全部 agent-configs

遍历 `agent-configs\*.json`,对每个 `mcpServers` 条目:
1. `args` 中 launcher 路径 → 替换为步骤 2 确认的 launcher(注意 JSON 用正斜杠 `C:/...`);
2. `args` 中 `--env-path=...` → 替换为步骤 2 的 `.env` 路径;
3. `env` 字段确保包含:
   - `NODE_TLS_REJECT_UNAUTHORIZED = "0"`(自签名证书);
   - 若选 odata:`SAP_RFC_BACKEND = "odata"`(**必须在此,启动前注入**);
   - 若方式 B/C:`SAP_PASSWORD = "<值>"`。
4. 保留原 JSON 其他字段(`disabled` 等)。

特殊文件:
- `http-remote.json`(URL 型,无 args)→ 不动,提示用户配 URL 型客户端时指向 `http://127.0.0.1:3000/mcp/stream/http`;
- `multi-system.json`(dev.env/prod.env)→ 更新 launcher 路径;两个 env 文件需自备,仅作模板。

完成后列出"更新了哪几份"。

---

## 步骤 5:验证(运行时让用户三选一)

**① 仅启动级**
```bash
node "<launcher>" --version
```
- 输出版本号 = 模块加载 + 后端解析正常(非法 `SAP_RFC_BACKEND` 会在此抛错);
- 失败排查:launcher 路径、`SAP_RFC_BACKEND` 取值。

**② 只读验证(推荐)** = ① + :
```bash
# ADT 可达
curl -sk -o /dev/null -w "%{http_code}" -u "用户:密码" "<SAP_URL>/sap/bc/adt/discovery?sap-client=100"   # 期望 200
# RFC 桥端点
# soap:
curl -sk -o /dev/null -w "%{http_code}" -u "用户:密码" "<SAP_URL>/sap/bc/soap/rfc?sap-client=100"        # 期望 415
# odata:
curl -sk -u "用户:密码" "<ODATA_URL>/$metadata?sap-client=100" | head -c 200                             # 期望 200 + edmx
```
若选 odata,可选做 TextElement 直测(CSRF 两步 + POST `/Textpool` READ,参考 `docs\ZMCP_ADT_SRV-安装指南.md`)。

**③ 含读写验证** = ② + 提示用户在 MCP 客户端内手动:
1. 重启客户端(让 env 注入生效);
2. `CreateProgram` 在 `$TMP` 建临时程序(如 `ZTEST_INIT_<随机>`);
3. `SearchObject` 确认存在;
4. `DeleteProgram` 删除收尾。
> 脚本/AI 在 HTTP 层无法代替客户端做 MCP 级读写,读写验证必须走客户端。

---

## 失败排查速查

| 症状 | 原因 | 处理 |
|---|---|---|
| `SAP_PASSWORD is required...` | 密码只写进 `.env`(白名单外) | 改走 `.sc4sap\sap.env` 或 agent `env` 字段 |
| `SAP_RFC_BACKEND must be...` | 非法值/或值写在 .env(加载太晚) | 放启动前环境;取 soap/native/gateway/odata |
| `SAP_RFC_ODATA_SERVICE_URL is required` | 默认 odata 但没配 URL | 配 URL 或显式 `SAP_RFC_BACKEND=soap` |
| ADT 401 | 凭据错 | 核对账号密码 |
| ADT 无法连接 | 网络/TLS | 确认 URL 端口;自签名已用 `-k` 忽略 |
| OData `$metadata` 404/403 | 服务未注册 | 见 `docs\ZMCP_ADT_SRV-安装指南.md` |
| Screen/GUI 工具报 `CX_SY_DYN_CALL_*` | 标准 FM 环境限制(已知) | 属预期;TextElement 不受影响 |

---

## 收尾提醒(告知用户)

- `.env` / `.sc4sap\sap.env` 含密码,勿提交 git;
- 切后端只需改启动前 `SAP_RFC_BACKEND`(agent env 字段或脚本 `set`)后重启;
- 服务器 cwd 建议为 `mcp-pack`(`.sc4sap` 生效 + 启动脚本约定);
- 详细服务端安装/排错见 `docs\ZMCP_ADT_SRV-安装指南.md`。
