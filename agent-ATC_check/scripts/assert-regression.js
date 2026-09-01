#!/usr/bin/env node
/**
 * assert-regression.js — 修正前后回归断言（步骤 8 收尾自动化）
 * 断言:
 *   1. 对象集不变（before/after worklist 的对象集合一致）
 *   2. 勾选检查（或全部）告警数不增：after <= before
 *   3. 无新增 P1：after 的 P1 数 <= before 的 P1 数
 * 全部通过 exit 0；任一失败 exit 1 并列出失败断言。
 *
 * 用法:
 *   node assert-regression.js <beforeXml> <afterXml> [--select=检查1,检查2]
 */
const fs = require('node:fs');
const path = require('node:path');

const beforeXml = path.resolve(process.argv[2] || '');
const afterXml = path.resolve(process.argv[3] || '');
const selectFlag = process.argv.find((a) => a.startsWith('--select='));
const selected = selectFlag ? selectFlag.slice('--select='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;
if (!beforeXml || !afterXml) { console.error('用法: node assert-regression.js <beforeXml> <afterXml> [--select=检查1,检查2]'); process.exit(2); }

function parse(xml) {
  const objects = new Set();
  const findings = [];
  for (const om of xml.matchAll(/<atcobject:object\b([^>]*)>/g)) {
    const name = (om[1].match(/adtcore:name="([^"]*)"/) || [])[1] || '';
    if (name) objects.add(name);
  }
  for (const fm of xml.matchAll(/<atcfinding:finding\b[^>]*>/g)) {
    const tag = fm[0];
    const g = (n) => (tag.match(new RegExp(`atcfinding:${n}="([^"]*)"`)) || [])[1] || '';
    findings.push({ prio: Number(g('priority') || 0), check: g('checkTitle') });
  }
  const prio1 = findings.filter((f) => f.prio === 1).length;
  return { objects, findings, prio1 };
}

function countByCheck(findings) {
  const m = {};
  for (const f of findings) m[f.check] = (m[f.check] || 0) + 1;
  return m;
}
function matches(f, sel) { return sel.some((s) => f.includes(s) || s.includes(f)); }

const before = parse(fs.readFileSync(beforeXml, 'utf8'));
const after = parse(fs.readFileSync(afterXml, 'utf8'));

const results = [];
function assert(name, ok, detail) { results.push({ name, ok, detail }); }

// 1) 对象集一致
const objDiff = [...before.objects].filter((o) => !after.objects.has(o)).concat([...after.objects].filter((o) => !before.objects.has(o)));
assert('对象集一致', objDiff.length === 0, objDiff.length ? `对象差异: ${objDiff.join(', ')}` : `${before.objects.size} 个对象`);

// 2) 勾选检查告警数不增（模糊匹配检查名，容忍尾点/大小写差异）
function matches(f, sel) { return sel.some((s) => f.includes(s) || s.includes(f)); }
const beforeByCheck = countByCheck(before.findings);
const afterByCheck = countByCheck(after.findings);
let checkFail = [];
if (selected) {
  for (const s of selected) {
    const b = before.findings.filter((f) => matches(f.check, [s])).length;
    const a = after.findings.filter((f) => matches(f.check, [s])).length;
    if (a > b) checkFail.push(`${s}: ${b} → ${a}`);
  }
} else {
  const checkNames = [...new Set([...Object.keys(beforeByCheck), ...Object.keys(afterByCheck)])];
  for (const c of checkNames) {
    const b = beforeByCheck[c] || 0, a = afterByCheck[c] || 0;
    if (a > b) checkFail.push(`${c}: ${b} → ${a}`);
  }
}
assert('勾选检查告警数不增', checkFail.length === 0, checkFail.length ? '增加: ' + checkFail.join('; ') : `全部 ${selected ? selected.length : checkNames.length} 个检查项未增加`);

// 3) 无新增 P1
assert('P1 数不增', after.prio1 <= before.prio1, `P1: ${before.prio1} → ${after.prio1}`);

// 输出
console.log('=== 回归断言（before vs after）===');
console.log(`  对象: ${before.objects.size} → ${after.objects.size}`);
console.log(`  告警总数: ${before.findings.length} → ${after.findings.length}`);
console.log(`  P1: ${before.prio1} → ${after.prio1}`);
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}  ${r.detail ? '(' + r.detail + ')' : ''}`);
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n结果: ${failed.length} 项断言失败` : '\n结果: 全部断言通过');
process.exit(failed.length ? 1 : 0);
