---
name: abap-atc-run
description: 运行 ABAP Test Cockpit (ATC) 检查、解析 worklist XML、按检查类型汇总告警并分类。适用于任何"拉取某对象 ATC 结果/重跑 ATC/分析告警"的任务。
---

# ABAP ATC 运行与结果解析

## 何时使用
- 需要获取某 ABAP 对象的 ATC 检查结果（指定检查变体）。
- 修改代码后重跑 ATC 验证告警数量变化。
- 需要按检查类汇总告警、定位源码行号。

## 背景
- 检查变体：`ZABAP_CLOUD_DEV_CHECK`
- 连接：`.env`（basic auth），通过 `mcp-invoke.js` 或直接 HTTP 调用 ADT REST。

## 1. 正确运行流程（关键：指定检查变体）

**坑**：直接 POST `/sap/bc/adt/atc/runs` 会使用 **DEFAULT 变体**，结果与目标变体完全不同。必须走 worklist 两步流程并显式传 `checkVariant`。

```
1. HEAD /sap/bc/adt/atc/worklists       头: X-CSRF-Token: Fetch
   → 响应头取 X-CSRF-Token + Set-Cookie（会话）
2. POST /sap/bc/adt/atc/worklists?checkVariant=ZABAP_CLOUD_DEV_CHECK
   → 返回 worklistId
3. POST /sap/bc/adt/atc/runs?worklistId=<worklistId>
   → 触发运行（响应含 FINDING_STATS，形如 "0,7,4" = P1,P2,P3 计数）
4. 轮询 GET /sap/bc/adt/atc/worklists/<worklistId> 直到结果就绪，保存 XML
```

参考脚本：`atc-run-csrf3.js <objectUrl> <variant>`，其中 objectUrl 形如
`/sap/bc/adt/programs/programs/zzzprog001/source/main`。
**每次请求必须带会话 Cookie**（`atc-run-csrf3.js` 用 keepAlive agent + cookieJar 维护）。

## 2. 解析 worklist XML

worklist XML 是**单行压缩格式**。逐条抽取 finding：

```js
for (const fm of xml.matchAll(/<atcfinding:finding\b[^>]*>/g)) {
  const tag = fm[0];
  const g = (n) => (tag.match(new RegExp(`atcfinding:${n}="([^"]*)"`)) || [])[1] || '';
  const loc = tag.match(/atcfinding:location="[^"]*#start=(\d+),0"/);
  const line = loc ? +loc[1] : 0;
  const prio = g('priority');        // 1|2|3|4
  const checkId = g('checkId');      // 检查唯一 ID
  const check = g('checkTitle');     // 检查名
  const msg = g('messageTitle');     // 消息名
  const exempt = g('exemptionKind'); // 豁免状态
}
```

汇总模式：按 `P<prio> check | msg` 分组计数，并列出每条告警的源码行号（`atc-parse.js` 已实现）。

## 3. 已知检查 ID 速查

| checkId | 检查 | 常见消息 |
|---|---|---|
| `72A957741371F564DD485C7C51D7705E` | Check Program hardcode | Hardcode string literal found |
| `F8607CD40A0F8B30BDF8590205B306E8` | 扩展程序检查 (SLIN) | 未定义 GUI 状态 / 缺少文本元素 / EXCEPTION 返回码 |
| `2529EE348FDEF7DB2E8A3E7D67B8D1EF` | SELECT/OPEN CURSOR without ORDER BY | SELECT SINGLE is possibly not unique |
| `AMB_SINGLE` | 同上（消息 ID） | — |

## 4. 分类与可修性判断

- 按 **checkId + 源码位置** 归类，优先看 P1。
- 先区分三类：
  1. **代码可修**：硬编码、命名规范、SELECT/ORDER BY、部分 SLIN。
  2. **变体/配置缺陷**：GLOB_TYPE 命名正则错误（任何 TYPES 前缀都报）→ 代码改不动，需改变体或豁免。
  3. **系统/运行期特性**：GUI 状态 STANDARD_FULLSCREEN（运行时自动生成）、MSEG 替换对象警告 → 记录说明，不修。
- **功能正确性优先**：SELECT *（UPDATE FROM 需整行）、FOR ALL ENTRIES（中风险 JOIN 转换）→ 有意保留并写明理由。

## 5. 验证闭环
- 修改后重跑 ATC，对比 FINDING_STATS（如 `0,7,4`）与告警总数。
- 导出 HTML 报告（`atc-xml-to-html.js <input.xml> <output.html> [title]`）。

## 坑清单
- 内联 JSON 引号会被 shell 处理（PowerShell/bash 均会）→ 参数一律 `@file.json`。
- 响应结果在 `content[0].text` 内，可能是**嵌套 JSON 字符串**，需二次解析（PowerShell `ConvertFrom-Json` / bash `jq`）。
- worklist 有"Last Check Run"对象集，确认 `usedObjectSet` 与运行时间对应的是本次结果。
- 豁免（exemptions）：POST 需要审批人；系统 `SATC_CI_APPROVER` 为空时 API 提交会被拒（提示"为免除指定审批人"），需 SAP GUI `SATC_ADMIN` 配置审批人。
