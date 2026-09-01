#!/usr/bin/env node
/**
 * gen-unfixed.js — 自动生成不可修项记录（步骤 7 收尾，替代手写）
 * 用法:
 *   node gen-unfixed.js <worklistXml> <outFile> [--title=<标题>]
 * 逻辑:
 *   - 解析 worklist 的告警（checkTitle / messageTitle / 行号 / 优先级）
 *   - 按内置"已知不可修原因表"逐条匹配 → 生成 markdown 表格
 *   - 未匹配的告警归入"需人工判断"（不擅自标为不可修）
 */
const fs = require('node:fs');
const path = require('node:path');

const worklistXml = path.resolve(process.argv[2] || '');
const outFile = path.resolve(process.argv[3] || '');
const titleFlag = process.argv.find((a) => a.startsWith('--title='));
const title = titleFlag ? titleFlag.slice('--title='.length) : '未修复项及原因';

if (!worklistXml || !outFile) { console.error('用法: node gen-unfixed.js <worklistXml> <outFile> [--title=]'); process.exit(2); }

// 已知不可修原因表（按 检查名 + 消息 正则匹配；命中即视为不可代码修复）
const RULES = [
  { re: /程序的扩展命名规则.*TYPES（全局）/, reason: '变体 ZABAP_CLOUD_DEV_CHECK 的 GLOB_TYPE 正则缺陷：任何 TYPES 前缀（TY_/GTY_/LTY_/TTY_）都触发，代码无法满足；需改变体或豁免（当前系统无 ATC 审批人）' },
  { re: /SELECT \*.*Incomplete evaluation/, reason: 'UPDATE FROM 工作区需要完整行；显式列会清空未列字段，有意保留' },
  { re: /for all entries.*(join|joined)/i, reason: '中风险 JOIN 转换，按"功能正确性优先"未执行' },
  { re: /SLIN.*(未定义 GUI 状态|GUI state)/, reason: 'GUI 状态（如 STANDARD_FULLSCREEN）由 SALV/运行时自动生成，无需预定义' },
  { re: /SLIN.*(EXCEPTION|exception).*(返回码|return code)/i, reason: '良性：动态 CUA 写后无需分支处理 EXCEPTION 返回码，属标准用法' },
  { re: /(MSEG|替换对象|replacement object)/i, reason: '系统配置（S/4 替换对象），非代码问题' },
];

function parseFindings(xml) {
  const out = [];
  for (const fm of xml.matchAll(/<atcfinding:finding\b[^>]*>/g)) {
    const tag = fm[0];
    const g = (n) => (tag.match(new RegExp(`atcfinding:${n}="([^"]*)"`)) || [])[1] || '';
    const loc = tag.match(/atcfinding:location="[^"]*#start=(\d+),0"/);
    out.push({
      line: loc ? +loc[1] : 0,
      prio: g('priority'),
      check: g('checkTitle'),
      msg: g('messageTitle'),
    });
  }
  return out;
}

const xml = fs.readFileSync(worklistXml, 'utf8');
const findings = parseFindings(xml);
if (!findings.length) { console.error('worklist 中没有解析到告警'); process.exit(2); }

const rows = [];
const manual = [];
for (const f of findings) {
  const key = `${f.check} | ${f.msg}`;
  const rule = RULES.find((r) => r.re.test(key));
  if (rule) rows.push({ ...f, reason: rule.reason });
  else manual.push(f);
}

const lines = [];
lines.push(`# ${title}`);
lines.push('');
lines.push(`> 由 gen-unfixed.js 自动生成（内置不可修原因表匹配）｜${new Date().toISOString()}`);
lines.push(`> 处理策略：按用户确认"记录原因跳过，不阻塞流程"。`);
lines.push('');
lines.push('| # | 检查 | 消息 | 行号 | 优先级 | 不可修原因 |');
lines.push('|---|---|---|---|---|---|');
rows.forEach((r, i) => {
  lines.push(`| ${i + 1} | ${r.check} | ${r.msg} | ${r.line} | P${r.prio} | ${r.reason} |`);
});
if (manual.length) {
  lines.push('');
  lines.push('## 需人工判断（未命中内置原因表，不得擅自标为不可修）');
  lines.push('');
  lines.push('| 检查 | 消息 | 行号 | 优先级 |');
  lines.push('|---|---|---|---|');
  for (const m of manual) lines.push(`| ${m.check} | ${m.msg} | ${m.line} | P${m.prio} |`);
}
lines.push('');
lines.push('## 结论');
lines.push(`- 命中内置不可修原因：${rows.length} 条；需人工判断：${manual.length} 条。`);
lines.push(`- 命中项可直接作为"记录原因跳过"依据；未命中项需先判断可修性再决定。`);

fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
console.log(`已生成: ${outFile}（${rows.length} 条不可修 + ${manual.length} 条需人工判断）`);
