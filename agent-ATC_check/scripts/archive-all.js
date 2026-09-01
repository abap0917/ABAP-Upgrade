#!/usr/bin/env node
/**
 * archive-all.js — 统一归档项目目录下所有对象文件夹的上一次执行结果（步骤 5）
 * 用法:
 *   node archive-all.js <projectDir> [timestamp]
 * 说明:
 *   - 读 <projectDir>/objects-summary.json 获取对象列表
 *   - 对每个对象文件夹执行与 archive-prev-run.js 相同的归档（根目录文件 → <时间戳>/）
 *   - 所有对象使用**同一个时间戳**（默认当前时间；可传入统一指定），保证批次一致
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectDir = path.resolve(process.argv[2] || '');
const timestamp = process.argv[3] || '';
if (!projectDir) { console.error('用法: node archive-all.js <projectDir> [timestamp]'); process.exit(2); }

const summaryFile = path.join(projectDir, 'objects-summary.json');
if (!fs.existsSync(summaryFile)) { console.error(`找不到 ${summaryFile}（先运行 fetch-object-sources.js）`); process.exit(2); }
const objects = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
if (!objects.length) { console.error('objects-summary.json 为空'); process.exit(2); }

const archiveJs = path.resolve(__dirname, 'archive-prev-run.js');
let fail = 0;
for (const obj of objects) {
  const folder = path.join(projectDir, obj.name);
  if (!fs.existsSync(folder)) { console.log(`  ${obj.name}: 文件夹不存在，跳过`); continue; }
  const r = spawnSync(process.execPath, [archiveJs, folder, timestamp], { encoding: 'utf8', timeout: 30000 });
  const outLines = (r.stdout || '').trim().split('\n');
  const summaryLine = outLines.find((l) => /已归档|无历史文件|失败/.test(l)) || outLines[outLines.length - 1] || '';
  const ok = r.status === 0 || /无历史文件|已归档/.test(summaryLine);
  console.log(`  ${obj.name}: ${ok ? summaryLine : '归档失败: ' + (r.stderr || summaryLine).slice(0, 120)}`);
  if (!ok) fail++;
}
console.log(fail ? `\n结果: ${fail} 个对象归档失败` : '\n结果: 全部对象归档完成（统一时间戳 ' + (timestamp || '当前时间') + '）');
process.exit(fail ? 1 : 0);
