#!/usr/bin/env node
/**
 * fix-guide.js — 修复引导生成器（步骤 4 勾选后使用，替代人肉翻技能）
 * 用法:
 *   node fix-guide.js <worklistXml> <outFile> [--select=<检查名1,检查名2>] [--title=]
 * 逻辑:
 *   - 解析 worklist 告警，按检查名分组
 *   - 内置"检查→修复指引"表（含对应 SKILL 引用与是否可代码修复标记）
 *   - 默认输出全部检查；--select= 逗号分隔过滤（对应步骤 4 的多选）
 *   - 输出 markdown：每个检查的修复指引 + 告警行号 + skill 引用
 */
const fs = require('node:fs');
const path = require('node:path');

const worklistXml = path.resolve(process.argv[2] || '');
const outFile = path.resolve(process.argv[3] || '');
const selectFlag = process.argv.find((a) => a.startsWith('--select='));
const titleFlag = process.argv.find((a) => a.startsWith('--title='));
const title = titleFlag ? titleFlag.slice('--title='.length) : 'ATC 修复引导';
const selected = selectFlag ? selectFlag.slice('--select='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;

if (!worklistXml || !outFile) { console.error('用法: node fix-guide.js <worklistXml> <outFile> [--select=检查1,检查2] [--title=]'); process.exit(2); }

// 内置修复指引表（key: 检查名子串；fix: 修复要点；skill: 技能引用；fixable: 是否可代码修复）
const GUIDE = [
  { key: 'Check Program hardcode', fix: '字面量提升为常量（技术值）或迁移文本元素（中文/UI 文本）；EHP4 注意 string 常量与 char 形参不兼容、常量需精确长度', skill: 'skills/abap-atc-fix §3 + skills/abap-text-element', fixable: true },
  { key: '程序的扩展命名规则', fix: 'FORM→FRM_、USING 参数→U([VTOS])?_；GLOB_TYPE（TYPES）为变体正则缺陷不可代码修复（见 gen-unfixed）', skill: 'skills/abap-atc-fix §2', fixable: true },
  { key: 'SELECT/OPEN CURSOR without ORDER BY', fix: 'SELECT SINGLE ... ORDER BY PRIMARY KEY → SELECT ... UP TO 1 ROWS ... ORDER BY PRIMARY KEY. ENDSELECT.（EHP4）', skill: 'skills/abap-atc-fix §1', fixable: true },
  { key: 'Search problematic SELECT *', fix: 'UPDATE FROM 工作区需整行时保留；确可精简时显式列出字段', skill: 'skills/abap-atc-fix §1', fixable: false },
  { key: 'FOR ALL ENTRIES', fix: '中风险 JOIN 转换，按功能正确性优先决定是否执行', skill: 'skills/abap-atc-fix', fixable: false },
  { key: '扩展程序检查 (SLIN)', fix: '按消息类型区分：GUI 状态/EXCEPTION 返回码/替换对象多为系统配置或良性；"缺少文本元素"→ 迁移 TEXT-xxx', skill: 'skills/abap-text-element + skills/abap-atc-run §3', fixable: 'partial' },
];

function parseFindings(xml) {
  const out = [];
  for (const fm of xml.matchAll(/<atcfinding:finding\b[^>]*>/g)) {
    const tag = fm[0];
    const g = (n) => (tag.match(new RegExp(`atcfinding:${n}="([^"]*)"`)) || [])[1] || '';
    const loc = tag.match(/atcfinding:location="[^"]*#start=(\d+),0"/);
    out.push({ line: loc ? +loc[1] : 0, prio: g('priority'), check: g('checkTitle'), msg: g('messageTitle') });
  }
  return out;
}

const xml = fs.readFileSync(worklistXml, 'utf8');
const findings = parseFindings(xml);
if (!findings.length) { console.error('worklist 中没有解析到告警'); process.exit(2); }

// 检查名分组（取最长匹配的指引）
const byCheck = {};
for (const f of findings) {
  const g = GUIDE.find((g2) => f.check.includes(g2.key));
  const groupKey = g ? g.key : f.check;
  (byCheck[groupKey] = byCheck[groupKey] || []).push(f);
}

const lines = [];
lines.push(`# ${title}`);
lines.push('');
lines.push(`> 由 fix-guide.js 自动生成｜${new Date().toISOString()}`);
lines.push(`> 依据告警行号与对应技能逐项修复；不可代码修复项转 gen-unfixed 记录。`);
lines.push('');

let total = 0;
for (const [checkName, fs] of Object.entries(byCheck)) {
  if (selected && !selected.some((s) => checkName.includes(s) || s.includes(checkName))) continue;
  total += fs.length;
  const g = GUIDE.find((g2) => g2.key === checkName);
  lines.push(`## ${checkName}（${fs.length} 条）`);
  if (g) {
    lines.push('');
    lines.push(`- **修复指引**：${g.fix}`);
    lines.push(`- **技能引用**：\`${g.skill}\``);
    lines.push(`- **可代码修复**：${typeof g.fixable === 'boolean' ? (g.fixable ? '✅ 可修' : '❌ 不可修（记录原因跳过）') : g.fixable}`);
  }
  lines.push('');
  lines.push('| 行号 | 优先级 | 消息 |');
  lines.push('|---|---|---|');
  for (const f of fs) lines.push(`| ${f.line} | P${f.prio} | ${f.msg} |`);
  lines.push('');
}
if (!total) { lines.push('（所选检查在本次结果中无告警）'); }

fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
console.log(`已生成: ${outFile}（覆盖 ${Object.keys(byCheck).length} 个检查名 / ${total} 条告警${selected ? '，按 --select 过滤' : ''}）`);
