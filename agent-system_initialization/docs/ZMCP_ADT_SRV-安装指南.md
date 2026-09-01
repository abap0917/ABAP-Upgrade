# 安装 OData 服务 ZMCP_ADT_SRV(XXX 系统)

> 用途:MCP ABAP ADT 的 `SAP_RFC_BACKEND=odata` 后端依赖此服务。
> 服务包装已有的 RFC 函数模块 `ZMCP_ADT_DISPATCH` / `ZMCP_ADT_TEXTPOOL`
> (你的 XXX 已有这两个 FM,soap 后端正在用),把 Screen / GUI Status /
> Text Element 操作以 OData v2 FunctionImport 形式暴露。
>
> 参考来源:[babamba2/superclaude-for-sap — odata-classes-install.md](https://github.com/babamba2/superclaude-for-sap/blob/main/skills/setup/odata-classes-install.md) 、[docs/odata-backend.md](https://github.com/babamba2/superclaude-for-sap/blob/main/docs/odata-backend.md)

## 总体流程

```
SEGW 建项目(手动) → 注入 MPC_EXT/DPC_EXT 源码(MCP 或 SE24)
→ 注册服务(Basis / 自助 / 应急) → 验证 $metadata → 客户端切 odata
```

---

## 第 1 步:SAPGUI 创建 SEGW 项目(必须手动,约 5 分钟)

SEGW 无法通过 ADT/MCP 创建,必须在 SAPGUI 操作:

1. SAPGUI → TCode `SEGW` → **Create Project**
2. 填写:
   - **Project**: `ZMCP_ADT`
   - **Type**: `Service with SAP Annotations`
   - **Package**: `$TMP`(或传输包)
3. SEGW 自动生成 4 个类:
   - `ZCL_ZMCP_ADT_MPC`(基础,勿改)
   - `ZCL_ZMCP_ADT_MPC_EXT`(扩展,注入我们的源码)
   - `ZCL_ZMCP_ADT_DPC`(基础,勿改)
   - `ZCL_ZMCP_ADT_DPC_EXT`(扩展,注入我们的源码)

完成后回到本指南第 2 步。

## 第 2 步:注入 MPC_EXT 源码(⚠️ 注意修复点)

**⚠️ 关键坑(本 fork 已踩过并修复,2026-04-22):** 上游基础版 MPC
只调了 `set_return_complex_type()`,`$metadata` 会缺 `ReturnType` 属性,
导致所有 POST 报 HTTP 500。本项目的 `abap/zcl_zmcp_adt_mpc_ext.abap`
**已加 `set_return_multiplicity( '1' )`**,不要用上游原版!

操作:SE24 → 打开 `ZCL_ZMCP_ADT_MPC_EXT` → 把
`agent-system_initialization\abap\zcl_zmcp_adt_mpc_ext.abap` 全文粘贴 → 激活。

## 第 3 步:注入 DPC_EXT 源码

SE24 → 打开 `ZCL_ZMCP_ADT_DPC_EXT` → 把
`agent-system_initialization\abap\zcl_zmcp_adt_dpc_ext.abap` 全文粘贴 → 激活。
(把 FunctionImport `Dispatch`/`Textpool` 路由到 `ZMCP_ADT_DISPATCH`/`ZMCP_ADT_TEXTPOOL`)

## 第 4 步:创建诊断/注册程序(可选但推荐)

SE38 → 创建程序 `ZMCP_ADT_FLUSH_CACHE`(可执行程序)→ 粘贴
`agent-system_initialization\abap\zmcp_adt_flush_cache.abap` → 激活。
三个勾选项:
- `P_FLUSH` — 清 OData 模型/别名缓存(默认勾)
- `P_DIAG` — 直接实例化 DPC_EXT 调 execute_action(默认勾,绕开 Gateway 验证 ABAP 逻辑)
- `P_REG` — 应急:程序化写入 /IWBEP 注册行(默认不勾)

## 第 5 步:注册服务(最麻烦的一步,三选一)

### 路径 A:Basis 协作(推荐,生产级)

把下面模板发给 Basis 团队(约 5 分钟):

```
Subject: 请注册 OData 服务 ZMCP_ADT_SRV on <SID>(5 分钟任务)

请在该系统注册自定义 OData v2 服务:

  Service name:         ZMCP_ADT_SRV
  Model name:           ZMCP_ADT_MDL
  Version:              0001
  Namespace:            (空)
  External name:        ZMCP_ADT_SRV
  Model Provider Class: ZCL_ZMCP_ADT_MPC_EXT
  Data Provider Class:  ZCL_ZMCP_ADT_DPC_EXT
  Package:              $TMP

步骤:
  1. /IWBEP/REG_SERVICE → Register → 填入以上值 → Save
  2. /IWFND/MAINT_SERVICE → Add Service
     - System Alias: LOCAL
     - External Service Name: ZMCP_ADT_SRV
     - Get Services → 选 ZMCP_ADT_SRV → Add Selected Services
     - Package: $TMP
  3. SICF → /default_host/sap/opu/odata/sap/ZMCP_ADT_SRV → Activate Service
  4. /IWFND/CACHE_CLEANUP → Clean Up Model Cache → Execute
```

### 路径 B:自助(需 `/IWBEP/SB` 权限)

SEGW 打开项目 `ZMCP_ADT`:
1. **Generate Runtime Objects**(F6)→ 接受默认类名 → Local Object($TMP)
2. **Activate**(Ctrl+F3)— 整个项目
3. **Register Service**(工具栏地球图标)→ System Alias `LOCAL` → Package `$TMP` → OK
4. `/IWFND/MAINT_SERVICE` → Add Service → System Alias `LOCAL` → Get Services
   → `ZMCP_ADT_SRV` → Add Selected Services → Package `$TMP`
5. **SICF** → `/default_host/sap/opu/odata/sap/ZMCP_ADT_SRV` → Activate Service

### 路径 C:应急(无 Basis 也无 /IWBEP/SB 权限)

SE38 → 运行 `ZMCP_ADT_FLUSH_CACHE` → 勾 `P_REG = X` → F8。
⚠️ 这是**部分**注册(只写 SRH/OHD/SRG 行),仍建议后续走路径 A 补全。

## 第 6 步:验证

```bash
# 1) $metadata 可达(应 200 + edmx XML)
curl -sk -u "用户:密码" "https://<host>:<port>/sap/opu/odata/sap/ZMCP_ADT_SRV/\$metadata?sap-client=100"

# 2) 检查每个 FunctionImport 都有 ReturnType 属性(缺则 HTTP 500)
# 3) 客户端切 odata 后,调用 GetScreen / GetGuiStatus / GetTextElement 验证
```

验证通过后,按 README「切换 OData RFC 后端」一节启动:
- 启动前注入 `SAP_RFC_BACKEND=odata`(agent env 字段或 `start-odata-http.cmd`)
- `.env` 加 `SAP_RFC_ODATA_SERVICE_URL=https://<host>:<port>/sap/opu/odata/sap/ZMCP_ADT_SRV`

## 排错速查

| 症状 | 原因 | 处理 |
|---|---|---|
| `$metadata` 404 | ICF 未激活或未注册 | SICF 激活 + /IWFND/MAINT_SERVICE Add Service |
| FunctionImport POST 500 | /IWBEP 后端行缺失 | 路径 A(Basis)或路径 C(P_REG) |
| POST 500 且 $metadata 无 ReturnType | MPC_EXT 缺 `set_return_multiplicity('1')` | 用本项目的修复版 MPC_EXT |
| 403 CSRF Token Required | 令牌过期/代理剥 cookie | odataRfc.ts 会自动重试;查代理是否剥 SAP_SESSIONID_* |
| 401 | 认证错 | 核对 SAP_USERNAME / SAP_PASSWORD |
| 400 无效 Function Import 参数 | 缺参数 | 检查 2(Dispatch)/4(Textpool)个参数都在 |
| Textpool READ 传 1 字符语言(E/'1')报 HTTP 500 | 系统 FM 被误改为 `iv_language(2)`(1 字符对象做长度 2 子串→运行时错误) | 改回 `iv_language(1)`(2026-08-31 已在 XXX 修复) |
| 语言参数兼容性 | 旧版 FM 只收 1 字符 SAP 键,ISO 码 `'ZH'` 被截成无效 `'Z'` | 已升级为 ISO 兼容版:1 字符直接用;2 字符按 `T002.LAISO→SPRAS` 映射(`ZH`→`1`、`KO`→`3`、`EL`→`G`),两种传法都支持 |

## 备注

- XXX 当前 soap 后端工作正常(实测 `/sap/bc/soap/rfc` 返回 415=端点存在)。
  如果 Basis 协作困难,继续用 soap 完全可行;odata 主要适用于
  "soap 被禁 + 无法装 node-rfc"的加固环境。
- 服务注册是权限敏感操作,属 Basis 职责,预留 1 次 Basis 工单时间。
