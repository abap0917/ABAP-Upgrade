#!/usr/bin/env node
/**
 * registry.js — 调度 Agent 的项目注册表工具
 * 记录每个项目的初始化状态与 ATC 执行历史（"每个项目只执行一次"由 initialized 标记保证）
 *
 * 用法:
 *   node registry.js list                                 列出所有项目
 *   node registry.js status <projectKey>                  查询某项目初始化状态
 *   node registry.js init <projectKey> <name> <path> [summary]   标记已初始化（幂等）
 *   node registry.js add-run <projectKey> <variant> <summary> [reportFile]   记录一次 ATC 执行
 *   node registry.js clear <projectKey>                   清除某项目记录（需 --force 或交互确认）
 *
 * 注册表文件: <本脚本目录>/../projects-registry.json
 */
const fs = require('node:fs');
const path = require('node:path');

const REGISTRY = path.resolve(__dirname, '..', 'projects-registry.json');

function load() {
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); }
  catch { return { version: 1, projects: {} }; }
}
function save(r) { fs.writeFileSync(REGISTRY, JSON.stringify(r, null, 2) + '\n', 'utf8'); }

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case 'list': {
    const r = load();
    const keys = Object.keys(r.projects || {});
    if (!keys.length) { console.log('（无已记录项目）'); break; }
    for (const k of keys) {
      const p = r.projects[k];
      console.log(`  ${k}  initialized=${p.initialized}  initAt=${p.initAt || '-'}  项目=${p.name}  ATC执行次数=${(p.atcRuns || []).length}`);
    }
    break;
  }
  case 'status': {
    const r = load();
    const k = args[0];
    if (!k) { console.error('用法: registry.js status <projectKey>'); process.exit(2); }
    const p = r.projects[k];
    if (!p) { console.log(`NOT_INITIALIZED (${k} 无记录)`); process.exit(0); }
    console.log(`initialized=${p.initialized}  initAt=${p.initAt || '-'}  name=${p.name}  path=${p.path}`);
    for (const run of p.atcRuns || []) {
      console.log(`  run ${run.at}  variant=${run.variant}  摘要=${run.summary}  报告=${run.reportFile || '-'}`);
    }
    process.exit(p.initialized ? 0 : 1);
    break;
  }
  case 'init': {
    const [k, name, pth, summary] = args;
    if (!k || !name || !pth) { console.error('用法: registry.js init <projectKey> <name> <path> [summary]'); process.exit(2); }
    const r = load();
    const p = r.projects[k] || { name, path: pth, atcRuns: [] };
    if (p.initialized) { console.log(`已初始化，跳过（${k} 于 ${p.initAt}）`); process.exit(0); }
    p.name = name; p.path = pth;
    p.initialized = true;
    p.initAt = new Date().toISOString();
    if (summary) p.initSummary = summary;
    r.projects[k] = p;
    save(r);
    console.log(`已标记初始化: ${k} @ ${p.initAt}`);
    break;
  }
  case 'add-run': {
    const [k, variant, summary, reportFile] = args;
    if (!k || !variant) { console.error('用法: registry.js add-run <projectKey> <variant> <summary> [reportFile]'); process.exit(2); }
    const r = load();
    const p = r.projects[k] || { name: k, path: '', initialized: false, atcRuns: [] };
    p.atcRuns = p.atcRuns || [];
    p.atcRuns.push({ at: new Date().toISOString(), variant, summary: summary || '', reportFile: reportFile || '' });
    r.projects[k] = p;
    save(r);
    console.log(`已记录 ATC 执行: ${k} / ${variant} @ ${p.atcRuns[p.atcRuns.length - 1].at}`);
    break;
  }
  case 'clear': {
    const k = args[0];
    if (!k) { console.error('用法: registry.js clear <projectKey>'); process.exit(2); }
    const r = load();
    if (!r.projects[k]) { console.log(`无记录: ${k}`); process.exit(0); }
    if (!args.includes('--force')) { console.error('安全保护：请加 --force 确认清除'); process.exit(3); }
    delete r.projects[k];
    save(r);
    console.log(`已清除: ${k}`);
    break;
  }
  default:
    console.log(`未知命令: ${cmd}\n支持: list | status | init | add-run | clear`);
    process.exit(2);
}
