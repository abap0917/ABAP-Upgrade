#!/usr/bin/env node
/**
 * scheduler-check.js — 调度 Agent 执行前自检（pre-flight）
 * 检查项:
 *   1. Node.js 版本 ≥ 16
 *   2. registry.js 可运行（注册表可读）
 *   3. agents-index.json 存在且所有子 agent 路径/入口有效（复用 registry verify-index）
 *   4. 注册表文件可写（原子写测试）
 *   5. 项目目录（可选 --projectDir=）可创建
 * 全部通过 exit 0；任一失败 exit 1（不阻塞提示，列出失败项）
 *
 * 用法:
 *   node scheduler-check.js [schedulerDir] [--projectDir=<path>]
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const schedulerDir = path.resolve(process.argv[2] || __dirname + '/..');
const projectDirFlag = process.argv.find((a) => a.startsWith('--projectDir='));
const projectDir = projectDirFlag ? path.resolve(projectDirFlag.slice('--projectDir='.length)) : null;

const REGISTRY = path.join(schedulerDir, 'projects-registry.json');
const REGISTRY_JS = path.join(schedulerDir, 'scripts', 'registry.js');

const results = []; // {name, ok, detail}
function check(name, ok, detail) { results.push({ name, ok, detail }); }

// 1) Node 版本
const major = Number(process.versions.node.split('.')[0]);
check('Node.js ≥ 16', major >= 16, `当前 v${process.versions.node}`);

// 2) registry.js 可运行
if (fs.existsSync(REGISTRY_JS)) {
  const r = spawnSync(process.execPath, [REGISTRY_JS, 'list'], { encoding: 'utf8', timeout: 20000 });
  check('registry.js 可运行', r.status === 0 || (r.stdout || '').includes('（无已记录项目）'), (r.stdout || r.stderr || '').trim().slice(0, 80));
} else {
  check('registry.js 存在', false, REGISTRY_JS);
}

// 3) agents-index 校验（复用 registry verify-index）
if (fs.existsSync(REGISTRY_JS)) {
  const r = spawnSync(process.execPath, [REGISTRY_JS, 'verify-index', schedulerDir], { encoding: 'utf8', timeout: 20000 });
  check('agents-index 路径有效', r.status === 0, (r.stdout || r.stderr || '').trim().replace(/\n/g, ' | ').slice(0, 200));
} else {
  check('agents-index 路径有效', false, 'registry.js 缺失');
}

// 4) 注册表可写（原子写测试）
try {
  const tmp = REGISTRY + '.check';
  fs.writeFileSync(tmp, '{}', 'utf8');
  fs.renameSync(tmp, REGISTRY + '.check2');
  fs.rmSync(REGISTRY + '.check2', { force: true });
  check('注册表可写', true, REGISTRY);
} catch (e) {
  check('注册表可写', false, e.message.slice(0, 80));
}

// 5) 项目目录可创建
if (projectDir) {
  try {
    fs.mkdirSync(projectDir, { recursive: true });
    check('项目目录可创建', true, projectDir);
  } catch (e) {
    check('项目目录可创建', false, e.message.slice(0, 80));
  }
}

// 输出
console.log('=== 调度 Agent 前置自检 ===');
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}  ${r.detail ? '(' + r.detail + ')' : ''}`);
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n结果: ${failed.length} 项未通过（见上）` : '\n结果: 全部通过，可开始调度');
process.exit(failed.length ? 1 : 0);
