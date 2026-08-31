#!/usr/bin/env node
/* atc-parse.js — 解析 ATC worklist XML（单行压缩格式），按检查/消息汇总并列出行号
 * 用法: node atc-parse.js <file1.xml> [file2.xml ...]
 */
const fs = require('node:fs');

for (const f of process.argv.slice(2)) {
  const xml = fs.readFileSync(f, 'utf8');
  const aggr = {};
  const am = xml.match(/<atcresult:aggregates>(.*?)<\/atcresult:aggregates>/s);
  if (am) {
    for (const k of am[1].matchAll(/<atcresult:num(Prio\d|Failure)>(\d+)<\/atcresult:num\1>/g)) {
      aggr[k[1]] = +k[2];
    }
  }
  const findings = [];
  for (const fm of xml.matchAll(/<atcfinding:finding\b[^>]*>/g)) {
    const tag = fm[0];
    const g = (n) => {
      const x = tag.match(new RegExp(`atcfinding:${n}="([^"]*)"`));
      return x ? x[1] : '';
    };
    const loc = tag.match(/atcfinding:location="[^"]*#start=(\d+),0"/);
    findings.push({
      line: loc ? +loc[1] : 0,
      prio: g('priority'),
      checkId: g('checkId'),
      check: g('checkTitle'),
      msg: g('messageTitle'),
      exempt: g('exemptionKind'),
    });
  }
  console.log(`\n==== ${f} ====`);
  console.log('aggregates:', JSON.stringify(aggr));
  const by = {};
  for (const fd of findings) {
    const key = `P${fd.prio} ${fd.check} | ${fd.msg}`;
    (by[key] = by[key] || []).push(fd.line);
  }
  for (const [k, lines] of Object.entries(by)) {
    const shown = lines.slice(0, 40).join(',');
    console.log(`${k}  x${lines.length}  lines=[${shown}${lines.length > 40 ? ',...' : ''}]`);
  }
  console.log('total findings:', findings.length);
}
