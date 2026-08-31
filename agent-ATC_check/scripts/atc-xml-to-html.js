#!/usr/bin/env node
/**
 * atc-xml-to-html.js — convert ATC XML (worklist or saved-result format) into
 * a self-contained HTML report.
 * Usage: node atc-xml-to-html.js <input.xml> <output.html> [title]
 */
const fs = require('node:fs');
const path = require('node:path');

const inFile = process.argv[2];
const outFile = process.argv[3];
const customTitle = process.argv[4] || '';

const xml = fs.readFileSync(inFile, 'utf8');

// ---------- helpers ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function attr(attrs, name) {
  const m = attrs.match(new RegExp('\\b' + name + '="([^"]*)"'));
  return m ? m[1] : '';
}
function el(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>'));
  return m ? m[1] : '';
}
const PRIO = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };
const PRIO_CLASS = { 1: 'p1', 2: 'p2', 3: 'p3', 4: 'p4' };
const PRIO_CN = { 1: '高', 2: '中', 3: '低', 4: '提示' };

// ---------- header ----------
let title = customTitle || path.basename(inFile, '.xml');
let checkVariant = '';
let createdAt = '';
let runId = '';

// ---------- parse objects & findings ----------
const objects = [];
const objRe = /<atcobject:object\b([^>]*)>([\s\S]*?)<\/atcobject:object>/g;
let om;
while ((om = objRe.exec(xml))) {
  const oa = om[1];
  const inner = om[2];
  const name = attr(oa, 'adtcore:name') || attr(oa, 'name') || '?';
  const type = attr(oa, 'adtcore:type') || attr(oa, 'type') || '?';
  const pkg = attr(oa, 'adtcore:packageName') || '';
  const uri = attr(oa, 'adtcore:uri') || '';
  const author = attr(oa, 'atcobject:author') || '';
  const findings = [...inner.matchAll(/<atcfinding:finding\b([^>]*)\/?>/g)].map(
    ([, fa]) => {
      const prio = Number(attr(fa, 'priority') || 0);
      const checkId = attr(fa, 'checkId');
      const checkTitle = attr(fa, 'checkTitle');
      const messageId = attr(fa, 'messageId');
      const messageTitle = attr(fa, 'messageTitle');
      const location = attr(fa, 'location');
      const ln = (location.match(/start=(\d+)/) || [])[1] || '';
      const processor = attr(fa, 'processor');
      return { prio, checkId, checkTitle, messageId, messageTitle, location, ln, processor };
    },
  );
  objects.push({ name, type, pkg, uri, author, findings });
}

// ---------- meta from result header (if result format) ----------
if (xml.includes('atcresult:resultList')) {
  const resRe = /<atcresult:result>([\s\S]*?)<\/atcresult:result>/g;
  const rm = resRe.exec(xml);
  if (rm) {
    runId = el(rm[1], 'atcresult:displayId');
    checkVariant = el(rm[1], 'atcresult:checkVariant');
    createdAt = el(rm[1], 'atcresult:createdAt');
    title = el(rm[1], 'atcresult:title') || title;
  }
} else if (xml.includes('atcworklist:worklist')) {
  const wl = xml.match(/<atcworklist:worklist\b([^>]*)>/);
  if (wl) {
    runId = attr(wl[1], 'atcworklist:id');
    createdAt = attr(wl[1], 'atcworklist:timestamp');
  }
}

// ---------- aggregate ----------
const totalFindings = objects.reduce((s, o) => s + o.findings.length, 0);
const byCheck = new Map();
const prioTot = { 1: 0, 2: 0, 3: 0, 4: 0 };
for (const o of objects) {
  for (const f of o.findings) {
    prioTot[f.prio] = (prioTot[f.prio] || 0) + 1;
    const key = f.checkId;
    if (!byCheck.has(key)) {
      byCheck.set(key, { checkId: key, checkTitle: f.checkTitle, count: 0, prios: { 1: 0, 2: 0, 3: 0, 4: 0 } });
    }
    const e = byCheck.get(key);
    e.count++;
    e.prios[f.prio] = (e.prios[f.prio] || 0) + 1;
  }
}
const checks = [...byCheck.values()].sort((a, b) => b.count - a.count);

// ---------- build HTML ----------
const rows = [];
for (const o of objects) {
  const sortedF = [...o.findings].sort((a, b) => a.prio - b.prio || Number(a.ln) - Number(b.ln));
  for (const f of sortedF) {
    rows.push(`      <tr>
        <td class="prio ${PRIO_CLASS[f.prio] || ''}">${PRIO[f.prio] || '?'}</td>
        <td class="chk">${esc(f.checkTitle)}</td>
        <td class="msg">${esc(f.messageTitle)}</td>
        <td class="loc">${esc(o.type)} ${esc(o.name)}${f.ln ? ' · 行 ' + esc(f.ln) : ''}</td>
      </tr>`);
  }
}

const prioBadges = [1, 2, 3, 4]
  .map((p) => `<span class="badge ${PRIO_CLASS[p]}">${PRIO[p]}: ${prioTot[p] || 0}</span>`)
  .join(' ');

const checkTable = checks
  .map(
    (c) => `<tr>
      <td class="chk">${esc(c.checkTitle)}</td>
      <td class="cid">${esc(c.checkId)}</td>
      <td class="num">${c.count}</td>
      <td class="num">P1:${c.prios[1] || 0} P2:${c.prios[2] || 0} P3:${c.prios[3] || 0} P4:${c.prios[4] || 0}</td>
    </tr>`,
  )
  .join('\n');

const objRows = objects
  .map((o) => {
    const p = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const f of o.findings) p[f.prio] = (p[f.prio] || 0) + 1;
    return `<tr><td>${esc(o.type)}</td><td>${esc(o.name)}</td><td>${esc(o.pkg)}</td><td>${o.findings.length}</td><td>P1:${p[1]} P2:${p[2]} P3:${p[3]} P4:${p[4]}</td></tr>`;
  })
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — ATC 检查报告</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; background: #f4f6f9; color: #2c3e50; padding: 24px; }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .sub { color: #7f8c8d; font-size: 13px; margin-bottom: 20px; }
  .card { background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08); padding: 20px; margin-bottom: 20px; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; font-size: 13px; }
  .meta b { color: #34495e; }
  .badges { margin-top: 12px; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 600; margin-right: 8px; color: #fff !important; }
  .badge.p1 { background: #e74c3c; }
  .badge.p2 { background: #e67e22; }
  .badge.p3 { background: #f1c40f; color: #333 !important; }
  .badge.p4 { background: #95a5a6; }
  h2 { font-size: 17px; margin-bottom: 12px; color: #2c3e50; border-left: 4px solid #3498db; padding-left: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #ecf0f1; text-align: left; padding: 8px 10px; font-weight: 600; color: #34495e; }
  td { padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
  tr:hover td { background: #f9fbfc; }
  .prio { font-weight: 700; white-space: nowrap; }
  .prio.p1 { color: #e74c3c; }
  .prio.p2 { color: #e67e22; }
  .prio.p3 { color: #b7950b; }
  .prio.p4 { color: #7f8c8d; }
  .chk { color: #34495e; }
  .cid { color: #95a5a6; font-family: Consolas, monospace; font-size: 12px; }
  .msg { color: #2c3e50; }
  .loc { color: #7f8c8d; white-space: nowrap; }
  .num { text-align: center; white-space: nowrap; }
  .summary-nums { display: flex; gap: 24px; font-size: 20px; font-weight: 700; margin-bottom: 8px; }
  .summary-nums span { color: #3498db; }
  .foot { text-align: center; color: #95a5a6; font-size: 12px; margin-top: 20px; }
  .empty { padding: 20px; text-align: center; color: #27ae60; font-size: 16px; }
</style>
</head>
<body>
<div class="container">
  <h1>📋 ${esc(title)} — ATC 检查报告</h1>
  <div class="sub">由 ABAP ADT MCP 服务器从 ATC XML 自动生成</div>

  <div class="card">
    <div class="meta">
      <div><b>检查变体：</b>${esc(checkVariant || '—')}</div>
      <div><b>运行 ID：</b>${esc(runId || '—')}</div>
      <div><b>时间：</b>${esc((createdAt || '').replace('T', ' ').replace('Z', '')) || '—'}</div>
      <div><b>对象数：</b>${objects.length}</div>
      <div><b>发现总数：</b>${totalFindings}</div>
    </div>
    <div class="badges">${prioBadges}</div>
  </div>

  <div class="card">
    <h2>按检查汇总（${checks.length} 类）</h2>
    <table>
      <thead><tr><th>检查名称</th><th>CheckId</th><th>数量</th><th>优先级分布</th></tr></thead>
      <tbody>${checkTable || '<tr><td colspan="4" class="empty">无发现</td></tr>'}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>按对象汇总</h2>
    <table>
      <thead><tr><th>类型</th><th>名称</th><th>包</th><th>数量</th><th>优先级分布</th></tr></thead>
      <tbody>${objRows || '<tr><td colspan="5" class="empty">无对象</td></tr>'}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>发现明细（${totalFindings} 条）</h2>
    ${totalFindings === 0 ? '<div class="empty">✅ 无 ATC 发现</div>' : `<table>
      <thead><tr><th>优先级</th><th>检查</th><th>消息</th><th>位置</th></tr></thead>
      <tbody>${rows.join('\n')}</tbody>
    </table>`}
  </div>

  <div class="foot">生成时间：${new Date().toISOString()} · 来源文件：${esc(path.basename(inFile))}</div>
</div>
</body>
</html>
`;

fs.writeFileSync(outFile, html, 'utf8');
console.log(`written: ${outFile} (${html.length} chars, ${totalFindings} findings)`);
