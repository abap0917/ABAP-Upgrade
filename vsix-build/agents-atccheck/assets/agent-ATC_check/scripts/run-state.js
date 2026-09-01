#!/usr/bin/env node
/**
 * run-state.js — 单次 ATC 执行的运行参数 + 步骤状态机（断点续跑）
 * 区别于调度器 registry：本文件是 agent-ATC_check 单次 8 步运行的本地状态，
 * 写在工作目录 run-params.json；中断后 status 显示当前步骤，从对应步骤续跑。
 *
 * 命令:
 *   init <workDir> --project= --variant= --creator= --transport= [--checks=a,b] [--mode=interactive|batch] [--projectDir=]
 *   step <workDir> <step> <done|fail> [note]
 *   status <workDir>
 *
 * 步骤（对应 AGENT.md）: fetch(2) objects(3) select(4) archive(5) diff(6) deploy(7) rerun(8)
 */
const fs = require('node:fs');
const path = require('node:path');

const STEPS = ['fetch', 'objects', 'select', 'archive', 'diff', 'deploy', 'rerun'];

function paramsFile(workDir) { return path.join(workDir, 'run-params.json'); }
function load(workDir) {
  const f = paramsFile(workDir);
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}
function save(workDir, p) { fs.writeFileSync(paramsFile(workDir), JSON.stringify(p, null, 2) + '\n', 'utf8'); }
function getFlag(args, name) {
  const a = args.find((x) => x.startsWith(name + '='));
  return a ? a.slice(name.length + 1) : null;
}
function phase(p) {
  const s = p.steps || {};
  for (const step of STEPS) {
    if (s[step] === 'fail') return `失败于 ${step}（可修复后从该步续跑）`;
    if (s[step] !== 'done') return `进行中：${step}`;
  }
  return '全部完成';
}

const [cmd, workDirRaw, ...args] = process.argv.slice(2);
const workDir = path.resolve(workDirRaw || '');

switch (cmd) {
  case 'init': {
    if (!workDir) { console.error('用法: run-state.js init <workDir> --project= --variant= --creator= --transport= [--checks=] [--mode=]'); process.exit(2); }
    fs.mkdirSync(workDir, { recursive: true });
    const p = {
      project: getFlag(args, '--project') || '',
      variant: getFlag(args, '--variant') || 'ZABAP_CLOUD_DEV_CHECK',
      creator: getFlag(args, '--creator') || '',
      transport: getFlag(args, '--transport') || '',
      projectDir: getFlag(args, '--projectDir') || '',
      checks: (getFlag(args, '--checks') || '').split(',').map((s) => s.trim()).filter(Boolean),
      mode: getFlag(args, '--mode') || 'interactive',
      createdAt: new Date().toISOString(),
      steps: {},
    };
    save(workDir, p);
    console.log(`运行参数已初始化: ${workDir}\\run-params.json（模式=${p.mode} 变体=${p.variant}）`);
    break;
  }
  case 'step': {
    const [stepName, state, ...noteParts] = args;
    if (!workDir || !STEPS.includes(stepName) || !['done', 'fail'].includes(state)) {
      console.error(`用法: run-state.js step <workDir> <${STEPS.join('|')}> <done|fail> [note]`);
      process.exit(2);
    }
    const p = load(workDir);
    if (!p) { console.error(`未初始化（先运行 init）: ${paramsFile(workDir)}`); process.exit(2); }
    p.steps = p.steps || {};
    p.steps[stepName] = state;
    p.notes = p.notes || {};
    if (noteParts.length) p.notes[stepName] = noteParts.join(' ');
    save(workDir, p);
    console.log(`步骤已更新: ${stepName}=${state}  阶段: ${phase(p)}`);
    break;
  }
  case 'status': {
    if (!workDir) { console.error('用法: run-state.js status <workDir>'); process.exit(2); }
    const p = load(workDir);
    if (!p) { console.log(`NOT_INITIALIZED（无 run-params.json）: ${paramsFile(workDir)}`); process.exit(0); }
    console.log(`项目: ${p.project}  变体: ${p.variant}  创建人: ${p.creator}  传输: ${p.transport}`);
    console.log(`模式: ${p.mode}  创建时间: ${p.createdAt}`);
    if (p.checks && p.checks.length) console.log(`勾选检查: ${p.checks.join(', ')}`);
    console.log(`阶段: ${phase(p)}`);
    console.log(`步骤: ${STEPS.map((s) => `${s}=${(p.steps || {})[s] || 'pending'}`).join('  ')}`);
    process.exit(p.steps && STEPS.every((s) => p.steps[s] === 'done') ? 0 : 1);
    break;
  }
  default:
    console.log(`未知命令: ${cmd}\n支持: init | step | status（步骤: ${STEPS.join(', ')}）`);
    process.exit(2);
}
