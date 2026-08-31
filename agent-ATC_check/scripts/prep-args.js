#!/usr/bin/env node
/* prep-args.js — 生成 WriteTextElementsBulk 与 UpdateProgram 的参数文件 */
const fs = require('node:fs');

// 1) WriteTextElementsBulk 参数
const pool = JSON.parse(fs.readFileSync('zzzprog001-active-lf-text-pool.json', 'utf8'));
const writeArgs = {
  program_name: 'ZZZPROG001',
  language: '1',
  text_elements: pool,
  replace_existing: false,
  activate: true,
};
fs.writeFileSync('args-write-pool.json', JSON.stringify(writeArgs, null, 2), 'utf8');
console.log(`args-write-pool.json: ${pool.length} 条, language=1, replace_existing=false, activate=true`);

// 2) UpdateProgram 参数 (完整源码)
const src = fs.readFileSync('zzzprog001-active-lf-text.abap', 'utf8').replace(/\r?\n/g, '\n');
const updateArgs = {
  program_name: 'ZZZPROG001',
  source_code: src,
  transport_request: 'ZZTR000001',
  activate: true,
};
fs.writeFileSync('args-update-zzzprog001.json', JSON.stringify(updateArgs, null, 2), 'utf8');
console.log(`args-update-zzzprog001.json: ${src.split('\n').length} 行, transport=ZZTR000001, activate=true`);

// 3) 摘要: 校验 pool 条目数与 TEXT key 连续性
const keys = pool.map((e) => Number(e.key));
const minK = Math.min(...keys), maxK = Math.max(...keys);
const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
console.log(`pool keys: ${minK}..${maxK}, 去重后 ${new Set(keys).size}, 重复: ${dup.length}`);
// 校验文本长度
const over = pool.filter((e) => e.text.length > 132);
console.log(`超长条目(>132): ${over.length}`);
