---
name: abap-atc-decision
description: ATC 告警优先级决策：判断每条告警"必须修 / 可修 / 可豁免 / 记录跳过"，按风险与可修性给出处理策略。适用于拿到 ATC 结果后决定改什么、怎么改、哪些不碰。
---

# ATC 告警优先级决策

## 何时使用
- 拿到 ATC worklist/报告后，需要决定处理范围（步骤 4 多选前）。
- 判断某条告警是否值得修、能否修、应否豁免。

## 决策流程（四步）

```
① 看优先级  →  P1 优先；P2/P3 按检查类型
② 判可修性  →  代码可改？还是变体/系统/运行期特性？
③ 评估风险  →  改动是否影响功能正确性（SELECT*/FAE 尤其注意）
④ 定策略    →  必须修 / 可修(推荐) / 可豁免 / 记录跳过（由用户确认）
```

## 决策矩阵（基于 ZABAP_CLOUD_DEV_CHECK 实测）

| 检查/消息 | 优先级 | 策略 | 说明 |
|---|---|---|---|
| Check Program hardcode（P1 硬编码） | P1 | **必须修** | 字面量→常量/文本元素；是 ATC 复查的核心指标 |
| 语法/编译类错误 | P1/P2 | **必须修** | 否则对象无法激活 |
| 命名规范（FORM/USING 参数） | P2 | 可修（推荐） | 重命名注意同名冲突，低风险 |
| 命名规范 TYPES（GLOB_TYPE） | P2 | **记录跳过** | 变体正则缺陷：任何 TYPES 前缀都触发，代码无法满足 |
| SELECT/OPEN CURSOR without ORDER BY | P3 | 可修（推荐） | EHP4 用 `UP TO 1 ROWS ... ENDSELECT` 改写 |
| SLIN 缺少文本元素 | P3 | 可修（推荐） | 迁移 TEXT-xxx（见 abap-text-element） |
| SELECT *（Incomplete evaluation） | P3 | **记录跳过** | UPDATE FROM 工作区需整行；显式列会清空字段 |
| FOR ALL ENTRIES | P2 | 记录跳过（谨慎） | 中风险 JOIN 转换；功能正确性优先，改前确认 |
| SLIN 未定义 GUI 状态 | P2 | **记录跳过** | STANDARD_FULLSCREEN 由运行时自动生成 |
| SLIN EXCEPTION 返回码 | P3 | 记录跳过 | 动态 CUA 写后无需分支，良性 |
| SLIN 替换对象（MSEG） | P3 | **记录跳过** | 系统配置（S/4 替换对象），非代码问题 |

## 判定原则

1. **能改 vs 不该改**：ATC 告警 ≠ 都要改。功能正确性优先（SELECT*、FAE 有意保留并写明理由）。
2. **变体/系统/运行期特性不可代码修复**：GLOB_TYPE、GUI 状态、替换对象、审批人未配置时的豁免 —— 记录原因，不阻塞流程（gen-unfixed.js 内置原因表覆盖）。
3. **豁免的前提**：系统已配置 ATC 审批人（`SATC_CI_APPROVER` 非空）；否则豁免 API 提交会被拒（"为免除指定审批人"）。
4. **修改边界**：一次只改勾选检查；改后必须"语法检查通过 + ATC 复查勾选检查归零/下降"（assert-regression.js 自动断言）。

## 与其他技能协作
- 决策后：`fix-guide.js` 生成修复指引（检查→修法→行号→技能引用）。
- 修复中：`abap-atc-fix`（SELECT/命名/硬编码）、`abap-text-element`（文本池）。
- 收尾：`gen-unfixed.js` 记录跳过项；`assert-regression.js` 回归断言。
