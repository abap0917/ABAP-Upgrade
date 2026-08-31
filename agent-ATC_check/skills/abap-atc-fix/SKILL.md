---
name: abap-atc-fix
description: 常见 ATC 告警的修复流程：SELECT/ORDER BY、命名规范、硬编码（字面量→常量）、激活、传输与验证闭环。适用于对 ABAP 程序做 ATC 整改。
---

# ABAP ATC 告警修复流程

## 何时使用
- 已拿到 ATC worklist，需要按推荐顺序修复告警。
- 需要把字面量批量迁移为常量、修命名规范、消除 SELECT 相关告警。

## 推荐修复顺序（风险从低到高）
1. SELECT/ORDER BY（低风险，纯语法改写）
2. 命名规范（中风险，重命名需查同名冲突）
3. 硬编码（中风险，批量脚本化，注意 EHP4 类型兼容）
4. 文本元素迁移（可选，见 `abap-text-element` 技能）

---

## 1. SELECT/ORDER BY（EHP4 修法）

**坑**：`SELECT SINGLE ... ORDER BY PRIMARY KEY` 在 EHP4 报语法错误
`ORDER is not allowed here`。

正确写法：
```abap
* 错误
SELECT SINGLE field FROM table WHERE ... ORDER BY PRIMARY KEY.

* 正确（EHP4 兼容）
SELECT field FROM table WHERE ... UP TO 1 ROWS
  ORDER BY PRIMARY KEY.
ENDSELECT.
```
`READ TABLE ... INDEX 1` 告警：核对逻辑后通常可消除或属误报。

## 2. 命名规范（CL_CI_TEST_ABAP_NAMING_NEW）

| 检查消息 | 要求 | 修法 |
|---|---|---|
| FORM 的无效名称 | FORM 名必须以 `FRM_` 开头 | 重命名 FORM 及所有 PERFORM 调用点 |
| USING 参数 (FORM) 的无效名称 | 参数必须以 `U([VTOS])?_` 开头 | 如 `uo_object`、`ut_table` |
| TYPES（全局）的无效名称 | 以 `GTY_` 开头 | ⚠ 若变体正则本身有缺陷（任何前缀都报），**代码无法修复**，需改变体或豁免 |

**重命名陷阱**：
- 大小写不敏感：声明 `uo_object` 与用法 `UO_OBJECT` 视为同名；改名后检查 `= 自身` 的赋值冲突（如 `uo_object = uo_object`）。
- 类方法参数（如 `e_object`、`er_data_changed`）与 FORM 参数（`uo_*`）分开处理：类接口参数恢复原名，FORM 参数保留新前缀，避免交叉冲突。
- 全量替换用脚本 + 大小写不敏感正则，替换后做残留引用校验。

## 3. 硬编码：字面量 → 常量（脚本化）

要点（参考 `hardcode-migrate6.js`）：
1. **分段处理 CONSTANTS 块**：声明块末尾条目以 `'.'` 结尾（非 `','`），正则必须兼容 `[,.]?`。
2. 名称生成：从字面量派生，**≤30 字符**；大小写不敏感去重（同名加后缀）。
3. 类型匹配 EHP4：
   - 传给 char 形参的常量必须**精确长度**：`TYPE c LENGTH N`（`TYPE c VALUE 'VBELN'` 会被截断成 1 字符！）。
   - `TYPE string` 常量/变量与 char 形参**不兼容**（EHP4 怪癖）——传函数/方法 char 参数时用定长 `TYPE c LENGTH N`。
   - 空格字面量 `' '` 正则易误匹配空串 `''`：排除空格或用精确上下文（`lfart <> ' '`、`DELETING LEADING ' '`）。
4. 迁移后校验：扫描"已迁移常量名是否仍出现在非注释行"（大小写不敏感），有残留即失败中断。

## 4. 激活与传输

- 传输包（非 $TMP）中的对象，Update*/Create* 必须传 `transport_request`，否则报
  `Parameter corrNr could not be found`。
- 创建/复用传输：`CreateTransport`（workbench K / customizing T）；`GetTransport` 确认 `status` 为"可修改的 (D)"。
- 批量激活：`ActivateObjects`（支持循环引用，一次编译作用域）。
- `UpdateProgram` 步骤：lock → check_new_code → update → unlock → check_inactive → activate。
  **check 失败 = 未改动**，可安全试错；激活警告（如 MSEG 替换对象）单独记录。

## 5. 验证闭环（每轮必做）

1. 重跑 ATC（见 `abap-atc-run`），对比告警总数与 FINDING_STATS。
2. 读回活动源码与本地比对（`ReadProgram` → 嵌套 JSON 取 `source_code` → 行级 diff）。
3. `GetInactiveObjects` 确认目标对象不在未激活列表。
4. 生成 Before/After diff 文件并归档交付。

## 项目纪律（推荐，模型无关）
- **任何 Update\* 调用前必须展示 Before/After diff**（源码、方法签名等变更点）——这是可追溯性的硬要求，任何模型都应遵守。
- 任务验证完成后，**如运行环境提供文档/知识库工具（如 Notion、Confluence MCP）**，记录变更条目（含 Before/After 代码块）；无此类工具时在交付目录写变更说明即可。
