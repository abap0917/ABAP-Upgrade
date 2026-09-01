---
name: abap-text-element
description: 把 ABAP 程序中的中文/UI 常量或字面量迁移为文本元素（TEXT-xxx）的完整流程：RFC 桥接后端选择、语言键、WriteTextElementsBulk 语义、源码替换、EHP4 位置兼容性、SALV 方法专项。
---

# ABAP 文本元素（TEXT-xxx）迁移

> ⚠ **跨平台说明**：命令示例为 **Windows / PowerShell** 写法；所有脚本为纯 Node.js，跨平台。
> Linux/macOS 用 `export SAP_RFC_BACKEND=soap` 等价替换即可。

## 何时使用
- 用户要求"中文/UI 硬编码改为文本元素"（可翻译、可维护）。
- ATC/SLIN 报"字符串中缺少文本元素"。
- 需要把常量方案升级为文本池方案。

## 1. 文本元素 vs 常量（选型）
- **文本元素 TEXT-xxx**：面向用户的显示文本（消息、列标题、按钮、弹窗标题、提示）→ 进文本池，语言相关、可翻译。
- **常量**：技术值（字段名 `VBELN`、移动类型 `601`、状态码 `'S'/'E'`、功能码、图标、程序名）→ 绝不进文本池（翻译会破坏逻辑）。
- 判断规则：含 CJK 或"用户可见完整文本" → 文本元素；否则常量。

## 2. RFC 桥接（前置条件，最重要）
文本池读写**只能走 RFC 桥接**（TPOOL RFC），无 ADT 原生端点。

- 依赖 FM：`ZMCP_ADT_TEXTPOOL`（函数组 `ZMCP_ADT_UTILS`），动作 `READ|WRITE|WRITE_INACTIVE`，
  参数 `IV_ACTION/IV_PROGRAM/IV_LANGUAGE/IV_TEXTPOOL_JSON`。
- 后端选择（`SAP_RFC_BACKEND`）：
  - `odata`（默认）：需 OData 服务 `ZMCP_ADT_SRV` —— **很多系统未安装**（`/IWFND/MED/170` 服务未找到）。
  - `soap`：走内置 `/sap/bc/soap/rfc`，直接调 FM —— 优先尝试。
- **验证顺序**：
  1. `SearchObject "ZMCP_ADT*"` 确认 FM 存在；
  2. 探测 `/sap/bc/soap/rfc`（GET 返回 415 = 节点存在）与 `/sap/opu/odata/sap/ZMCP_ADT_SRV/$metadata`（403 且错误码 MED/170 = 服务不存在）；
  3. 构造 SOAP POST 实测 READ。
- **env 注入时序坑**：launcher 的 env 文件注入（`hydrateSystemContextFromEnvFile`）晚于 `rfcBackend` 模块加载，`.env` 里写 `SAP_RFC_BACKEND=soap` **不生效**。必须在**子进程环境变量**传（Windows 示例；Linux/macOS 用 `export SAP_RFC_BACKEND=soap`）：
  ```powershell
  $env:SAP_RFC_BACKEND='soap'
  node mcp-invoke.js ..\adt-dev\dist\server\launcher.js .env <Tool> @args.json --out=out.json
  ```

## 3. 语言键
- FM 取 `IV_LANGUAGE` **首字符**（`lv_language = iv_language(1)`）。
- 中文文本池语言键 = **`'1'`**（不是 'ZH'！'ZH' → 'Z' 会失败）。
- 读取现有池时：`ReadTextElementsBulk {program_name, language:'1'}`；
  结果在 `content[0].text` 嵌套 JSON 的 `symbols` / `counts` 字段（`counts.total` = 行数）。

## 4. WriteTextElementsBulk 语义（两个陷阱）
- **`replace_existing` 默认 = true = 整个替换文本池！** 必须显式 `replace_existing: false` 做合并（先 READ 现有池 → 按 (ID,KEY) merge → 写回）。
- `activate: true` → 动作 WRITE（STATE 'A' 立即激活）；`false` → WRITE_INACTIVE（程序激活时提升）。
- 条目格式：`{type:'I', key:'001', text:'...'}`（I=文本符号；key 3 位）。
- 推荐顺序：**先写文本池（激活）→ 再 UpdateProgram（激活源码）**；池先就绪可避免激活期文本符号缺失疑虑（实测缺失也能激活，但池先写好更稳）。

## 5. 源码迁移（脚本化，参考 `migrate-text.js`）
1. 提取常量：声明正则 `^\s*(cns_\w+)\s+TYPE\s+\S+\s+VALUE\s+'([^']*)'[,.]?\s*$` —— **必须兼容行尾 `','` 和 `'.'`**（每块最后一条以 `.` 结尾，漏掉会漏迁）。
2. 迁移集：含 CJK 的常量 + 被 SLIN 点名的 UI 文本常量。
3. 分配 TEXT-001.. 键（按声明行序，确定性映射）。
4. 用法替换：大小写不敏感 `\bcns_X\b` → TEXT-xxx（声明行除外，先标记删除再替换）。
5. 删除已迁移声明行；CONSTANTS 块重组：保留行修正逗号/句号；**整块清空时连 `CONSTANTS:` 头一起删除**（空头行会让 EHP4 解析器吞掉下一条语句，报 `"TYPE LINE" or "LIKE LINE" expected, not "BEGIN"`）。
6. 校验：迁移后源码不得再出现已迁移常量名（非注释行），否则中断。

## 6. EHP4 位置兼容性（实测结论）
以下位置 TEXT-xxx 均可用（用 $TMP 测试程序先验证，验证后删除）：
- `MESSAGE TEXT-xxx TYPE 'S'` ✅
- `lv = TEXT-xxx`、`|{ TEXT-xxx }|` ✅
- `CONCATENATE TEXT-xxx lv INTO ...` ✅
- `PERFORM f USING TEXT-xxx`（by-ref `TYPE string` 形参、只读）✅
- 方法参数（见下）—— 视形参类型而定
- 文本符号**无需预先存在于文本池**即可通过语法检查/激活（运行期显示空串，所以要先写池）。

## 7. SALV 方法专项（本系统实测）
| 方法 | 形参 | 结论 |
|---|---|---|
| `set_long_text/set_medium_text/set_short_text` | `!value TYPE scrtext_l/m/s`（按引用只读） | **TEXT-xxx 直传 ✅**；字面量 ✅；`TYPE string` 常量 ❌ |
| `get_column` | `!columnname TYPE lvc_fname`（char30 按引用） | string 常量 ❌；**用 `lv_colname TYPE c LENGTH 30` 变量** ✅；列名是技术值，保留常量不建文本元素 |

写法：
```abap
DATA: lv_colname TYPE c LENGTH 30.
lv_colname = cns_VBELN.
lo_col = lo_cols->get_column( lv_colname ).
lo_col->set_long_text( TEXT-011 ).   " 交货单
```

## 8. 验证清单
- 读回文本池：`counts.total` = 原条目 + 新增条目；抽查关键 TEXT-key 文本正确。
- 重跑 ATC：P1 硬编码归零、SLIN"缺少文本元素"警告归零。
- 读回活动源码与本地 diff 一致；GetInactiveObjects 不含目标对象。
- 交付：映射 JSON（常量→TEXT）、Before/After diff、最终源码、HTML/XML 报告。
