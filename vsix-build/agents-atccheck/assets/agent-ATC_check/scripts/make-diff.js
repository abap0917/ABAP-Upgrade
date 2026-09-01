#!/usr/bin/env node
/**
 * make-diff.js — 生成 Before/After 统一 diff（步骤 6/7）
 * 用法:
 *   node make-diff.js <beforeFile> <afterFile> <diffOut> [label]
 * 说明:
 *   - before/after 为 ABAP 源码文件（或任意文本）
 *   - 输出 unified diff（@@ 头 + 行级 -/+），UTF-8
 *   - 步骤 7 修复后重新执行本脚本即可让 diff 与系统一致
 * 示例:
 *   node make-diff.js ZZZPROG001-before.abap ZZZPROG001.abap ZZZPROG001.diff
 */
const fs = require('node:fs');
const path = require('node:path');

const beforeFile = path.resolve(process.argv[2] || '');
const afterFile = path.resolve(process.argv[3] || '');
const diffOut = path.resolve(process.argv[4] || '');
if (!beforeFile || !afterFile || !diffOut) { console.error('用法: node make-diff.js <beforeFile> <afterFile> <diffOut> [label]'); process.exit(2); }

const oldLines = fs.readFileSync(beforeFile, 'utf8').replace(/\r\n/g, '\n').split('\n');
const newLines = fs.readFileSync(afterFile, 'utf8').replace(/\r\n/g, '\n').split('\n');

// 简单 unified diff（滑动窗口匹配）
const diff = [];
let oi = 0, ni = 0;
while (oi < oldLines.length || ni < newLines.length) {
  if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) { oi++; ni++; continue; }
  let matchO = -1, matchN = -1;
  for (let w = 1; w <= 25 && matchO < 0; w++) {
    for (let o = oi; o <= Math.min(oi + w, oldLines.length - 1); o++) {
      for (let n = ni; n <= Math.min(ni + w, newLines.length - 1); n++) {
        if (oldLines[o] === newLines[n]) { matchO = o; matchN = n; break; }
      }
      if (matchO >= 0) break;
    }
  }
  if (matchO < 0) { matchO = oldLines.length; matchN = newLines.length; }
  diff.push(`@@ -${oi + 1},${matchO - oi} +${ni + 1},${matchN - ni} @@`);
  for (let o = oi; o < matchO; o++) diff.push(`-${oldLines[o]}`);
  for (let n = ni; n < matchN; n++) diff.push(`+${newLines[n]}`);
  oi = matchO; ni = matchN;
}

fs.writeFileSync(diffOut, diff.join('\n') + '\n', 'utf8');
console.log(`diff 已生成: ${diffOut} (${diff.length} 行)`);
console.log(`  before: ${path.basename(beforeFile)} (${oldLines.length} 行)`);
console.log(`  after:  ${path.basename(afterFile)} (${newLines.length} 行)`);
