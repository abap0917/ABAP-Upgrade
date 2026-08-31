---
name: abap-mcp-toolkit
description: ABAP MCP 工具链操作要点：mcp-invoke.js 用法、PowerShell 陷阱、.env 配置、EHP4 编译器怪癖、传输管理、验证工具。适用于任何通过 MCP 操作 SAP（ADT/ATC/文本池/传输）的任务。
---

# ABAP MCP 工具链操作要点

> ⚠ **跨平台说明**：本文命令示例为 **Windows / PowerShell** 写法（本项目宿主为 Windows）。
> 所有脚本均为**纯 Node.js**（仅依赖 `node:fs/https/path/child_process`），Linux/macOS 可直接运行；
> 仅需把 PowerShell 片段换成等价 bash（如 `export SAP_RFC_BACKEND=soap`、`jq` 解析 JSON）。

## 1. mcp-invoke.js（通用 MCP 调用器）

```
node mcp-invoke.js <launcher.js> <env-path> <toolName> @args.json [exposition] --out=result.json
```
- launcher：`..\adt-dev\dist\server\launcher.js`；env：`.env`。
- **参数必须用 `@file.json`**：PowerShell/bash 都会对内联 JSON 的引号做处理
  （`{"a":1}` → `{a:1}` 报 Invalid JSON）。这是最高频的坑，一律用 `@file.json`。
- 结果写 `--out=file`（UTF-8）；**工具返回在 `content[0].text`，且可能是嵌套 JSON 字符串**，
  需二次解析（PowerShell 示例；bash 用 `jq '.content[0].text'` 再解析）：
  ```powershell
  $r = Get-Content out.json -Raw | ConvertFrom-Json
  $inner = $r.content[0].text | ConvertFrom-Json
  $inner.source_code   # 或 .symbols / .objects 等
  ```
- `exposition`：如 `readonly,high,low,compact,customizing,debug`（工具找不到时检查该参数）。

## 2. Shell 陷阱（Windows / PowerShell 为主）
- 内联 JSON 引号被吞 → 用 `@file.json`（见上）。
- PowerShell `>` 重定向写 **UTF-16**（带 BOM）→ 一律用 Node `--out=` 或 `fs.writeFileSync`（bash 的 `>` 写 UTF-8 无此问题）。
- `node -e "..."` 内联脚本引号会被破坏 → 写 `.js` 文件再执行。
- 中文输出乱码：PowerShell 用 `-Encoding UTF8` 读写；Node 脚本用 `UTF8Encoding($false)` 写文件。

## 3. .env 配置要点
- 连接：`SAP_URL / SAP_CLIENT / SAP_LANGUAGE / SAP_AUTH_TYPE / SAP_USERNAME / SAP_PASSWORD / SAP_SYSTEM_TYPE / SAP_MASTER_SYSTEM / SAP_RESPONSIBLE`。
- **不要直接改 .env 依赖其生效来切换 RFC 后端**：launcher 的 env 注入晚于模块加载（`rfcBackend` 在 require 时就解析 `SAP_RFC_BACKEND`），
  正确做法是在**子进程环境变量**传（Windows: `$env:SAP_RFC_BACKEND='soap'`；Linux/macOS: `export SAP_RFC_BACKEND=soap`；服务器重启后 .env 方式才生效）。
- 探测端点用一次性脚本（`probe-rfc.js` 模式）：ZMCP_ADT_SRV metadata、`/sap/bc/soap/rfc`、ADT discovery。

## 4. EHP4 编译器怪癖汇总（实测）
| 场景 | 结论 |
|---|---|
| `SELECT SINGLE ... ORDER BY PRIMARY KEY` | 语法错误 → `SELECT ... UP TO 1 ROWS ... ORDER BY PRIMARY KEY. ENDSELECT.` |
| `TYPE string` 常量/变量 → char 形参 | **不兼容**（函数/方法按引用或定长形参均拒） |
| 常量 → char 形参 | 必须**精确长度** `TYPE c LENGTH N`（`TYPE c VALUE 'X'` 截断成 1 字符） |
| 文本符号 TEXT-xxx → 各种位置 | 兼容性最好：MESSAGE/赋值/CONCATENATE/字符串模板/PERFORM by-ref string/只读方法形参均可用 |
| CONSTANTS 块空头行 | 报 `"TYPE LINE" or "LIKE LINE" expected, not "BEGIN"` → 整块删除 |
| `set_long_text( value TYPE scrtext_l )` | 按引用只读；TEXT-xxx 直传可行，string 常量不行 |
| `get_column( columnname TYPE lvc_fname )` | char30 按引用；用 `lv_colname TYPE c LENGTH 30` 变量 |
- 经验法：**编译器行为用 $TMP 测试程序实测**（CreateProgram → UpdateProgram 触发 check，check 失败=未改动，安全试错；用完 DeleteProgram）。

## 5. 传输管理
- 传输包对象必须传 `transport_request`，否则 `Parameter corrNr could not be found`。
- `ListTransports {modifiable_only:true}` 找可用传输；`CreateTransport`（K=workbench）；`GetTransport {transport_number}` 确认 `status` = D（可修改）。
- $TMP 本地对象不需要传输。
- 激活：`ActivateObjects`（批量、循环引用一次编译）；`UpdateProgram {activate:true}` 单对象激活（步骤 lock→check→update→unlock→activate）。

## 6. 验证工具速查
| 目的 | 工具/方法 |
|---|---|
| 读回活动源码 | `ReadProgram {program_name, version:'active'}` → 嵌套 JSON `.source_code`（`\r\n` 转 LF 后行级 diff） |
| 未激活对象 | `GetInactiveObjects` → `counts` + `objects`（确认目标不在其中；历史测试对象可忽略） |
| 文本池 | `ReadTextElementsBulk`（SOAP 后端 + 语言键 '1'）→ `.counts/.symbols` |
| 对象是否存在 | `SearchObject {object_name:'Z*'}` |
| 传输内容 | `GetTransport {transport_number, include_objects:true}` |
| 检查当前连接 | `GetSession`（force_new 换会话）、`ReloadProfile`（sc4sap 切配置） |

## 7. 通用工作纪律
1. 改动前：读当前活动版本 → 生成 Before/After diff → 展示后再 Update。
2. 改动后：重跑验证（ATC / 读回比对 / 未激活检查）→ 归档交付物。
3. 批量脚本化时：迁移脚本必须内建**残留引用校验**（大小写不敏感），失败即中断，不产生半成品。
4. 交付物按用户偏好中文命名，集中在项目交付目录；中间脚本留在 `mcp-pack/`。
