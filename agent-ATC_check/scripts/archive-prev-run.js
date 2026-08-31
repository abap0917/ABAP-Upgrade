#!/usr/bin/env node
/**
 * archive-prev-run.js — 归档对象文件夹下的上一次执行结果（步骤 5）
 * 用法:
 *   node archive-prev-run.js <objectFolder> [timestamp]
 * 说明:
 *   - 把 <objectFolder> 根目录下的所有"文件"（不含子目录）移动到
 *     <objectFolder>/<YYYYMMDD-HHMMSS>/ 子目录中
 *   - 这样每个对象的根目录只保留最新一次执行的结果；历史结果按时间归档
 *   - timestamp 默认当前时间；传入则用指定值（便于跨对象统一批次时间）
 * 注意:
 *   - 跳过隐藏/临时文件（.tmp-*）
 *   - 已有同名时间戳目录时自动 +1 秒避免覆盖
 */
const fs = require('node:fs');
const path = require('node:path');

const folder = path.resolve(process.argv[2] || '');
if (!folder || !fs.existsSync(folder)) { console.error('用法: node archive-prev-run.js <objectFolder> [timestamp]'); process.exit(2); }

function tsNow(offsetSec = 0) {
  const d = new Date(Date.now() + offsetSec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

let stamp = process.argv[3] || tsNow();
// 防重名
let i = 0;
let target = path.join(folder, stamp);
while (fs.existsSync(target)) { i++; target = path.join(folder, tsNow(i)); }

const files = fs.readdirSync(folder)
  .filter((f) => {
    const full = path.join(folder, f);
    return fs.statSync(full).isFile() && !f.startsWith('.tmp-');
  });

if (!files.length) { console.log(`${folder}: 根目录无历史文件，无需归档`); process.exit(0); }

fs.mkdirSync(target, { recursive: true });
for (const f of files) {
  fs.renameSync(path.join(folder, f), path.join(target, f));
}
console.log(`已归档 ${files.length} 个文件 → ${path.relative(folder, target)}/`);
files.forEach((f) => console.log(`  - ${f}`));
