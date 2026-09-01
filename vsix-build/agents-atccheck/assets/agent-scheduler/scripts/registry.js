#!/usr/bin/env node
/**
 * registry.js — 调度 Agent 的项目注册表工具（增强版）
 * 记录每个项目的：执行计划、初始化状态、步骤状态机、ATC 执行历史、运行日志
 * "每个项目只执行一次"由 initialized 标记保证；断点续跑由 steps 状态机支持。
 *
 * 命令:
 *   list                                   列出所有项目
 *   status <projectKey>                    查询项目状态（含步骤机；已初始化 exit 0 / 未初始化 exit 1）
 *   plan <projectKey> --name= --path= --variant= --creator= --transport= [--projectDir=]
 *                                          创建/更新执行计划（落盘输入参数）
 *   step <projectKey> <step> <done|fail> [note]   推进状态机（step: init|atc|complete）
 *   log <projectKey> <message>             追加运行日志
 *   init <projectKey> <name> <path> [summary]     标记已初始化（幂等，自动 step init done）
 *   add-run <projectKey> <variant> <summary> [reportFile]   记录 ATC 执行（自动 step atc done）
 *   verify-index [schedulerDir]            校验 agents-index.json 路径存在性
 *   summary <projectKey>                   生成执行总结（markdown 打印）
 *   clear <projectKey>                     清除记录（需 --force）
 *
 * 注册表文件: <本脚本目录>/../projects-registry.json（原子写：tmp + rename）
 */
const fs = require('node:fs');
const path = require('node:path');

const REGISTRY = path.resolve(__dirname, '..', 'projects-registry.json');
const AGENTS_INDEX = path.resolve(__dirname, '..', 'agents-index.json');
const STEPS = ['init', 'atc', 'complete'];

function load() {
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); }
  catch { return { version: 1, projects: {} }; }
}
function save(r) {
  // 原子写：先写临时文件再 rename，避免写一半崩溃损坏 JSON
  const tmp = REGISTRY + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(r, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, REGISTRY);
}

// 并发写锁：所有读-改-写操作经 update() 串行化，避免多实例同时写丢更新
const LOCK = REGISTRY + '.lock';
function withLock(fn) {
  for (let i = 0; i < 50; i++) {
    try {
      const fd = fs.openSync(LOCK, 'wx'); // 排他创建，已存在则抛 EEXIST
      fs.closeSync(fd);
      try { return fn(); } finally { try { fs.rmSync(LOCK, { force: true }); } catch { /* 忽略 */ } }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const end = Date.now() + 100; // 锁被占用，短暂等待后重试
      while (Date.now() < end) { /* busy-wait */ }
    }
  }
  throw new Error('registry 锁超时（另一实例正在写 projects-registry.json）');
}
function update(fn) {
  return withLock(() => {
    const r = load();
    const result = fn(r);
    save(r);
    return result;
  });
}
function getFlag(args, name) {
  const a = args.find((x) => x.startsWith(name + '='));
  return a ? a.slice(name.length + 1) : null;
}
function getProject(r, k) {
  if (!r.projects[k]) r.projects[k] = { name: k, path: '', initialized: false, steps: {}, atcRuns: [], log: [] };
  return normalize(r.projects[k]);
}
/** 规范化记录：补齐缺失字段；旧版记录（无 steps 但已初始化）迁移为 init=done */
function normalize(p) {
  p.steps = p.steps || {};
  p.atcRuns = p.atcRuns || [];
  p.log = p.log || [];
  if (p.initialized && p.steps.init == null) p.steps.init = 'done';
  if ((p.atcRuns || []).length && p.steps.atc == null) p.steps.atc = 'done';
  return p;
}
function stepState(p, name) { return (p.steps || {})[name] || 'pending'; }
function currentPhase(p) {
  if (stepState(p, 'init') !== 'done') return '等待初始化';
  if (stepState(p, 'atc') !== 'done') return '初始化完成，等待 ATC';
  if (stepState(p, 'complete') !== 'done') return 'ATC 完成，等待收尾';
  return '全部完成';
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case 'list': {
    const r = load();
    const keys = Object.keys(r.projects || {});
    if (!keys.length) { console.log('（无已记录项目）'); break; }
    for (const k of keys) {
      const p = normalize(r.projects[k]);
      console.log(`  ${k}  [${currentPhase(p)}]  initialized=${p.initialized}  initAt=${p.initAt || '-'}  项目=${p.name}  ATC执行次数=${(p.atcRuns || []).length}`);
    }
    break;
  }

  case 'status': {
    const r = load();
    const k = args[0];
    if (!k) { console.error('用法: registry.js status <projectKey>'); process.exit(2); }
    const p = r.projects[k] ? normalize(r.projects[k]) : null;
    if (!p) { console.log(`NOT_INITIALIZED (${k} 无记录)`); process.exit(0); }
    console.log(`projectKey: ${k}`);
    console.log(`项目: ${p.name}  路径: ${p.path}`);
    console.log(`阶段: ${currentPhase(p)}   initialized=${p.initialized}  initAt=${p.initAt || '-'}`);
    if (p.plan) console.log(`计划: 变体=${p.plan.variant || '-'} 创建人=${p.plan.creator || '-'} 传输=${p.plan.transport || '-'} 项目目录=${p.plan.projectDir || '-'}`);
    console.log(`步骤: ${STEPS.map((s) => `${s}=${stepState(p, s)}`).join('  ')}`);
    for (const run of p.atcRuns || []) {
      console.log(`  run ${run.at}  variant=${run.variant}  摘要=${run.summary}  报告=${run.reportFile || '-'}`);
    }
    if ((p.log || []).length) { console.log('日志:'); p.log.slice(-5).forEach((l) => console.log(`  ${l.at} ${l.msg}`)); }
    process.exit(p.initialized ? 0 : 1);
    break;
  }

  case 'plan': {
    const k = args[0];
    const name = getFlag(args, '--name') || k;
    const pth = getFlag(args, '--path') || '';
    const variant = getFlag(args, '--variant') || '';
    const creator = getFlag(args, '--creator') || '';
    const transport = getFlag(args, '--transport') || '';
    const projectDir = getFlag(args, '--projectDir') || '';
    if (!k) { console.error('用法: registry.js plan <projectKey> --name= --path= --variant= --creator= --transport= [--projectDir=]'); process.exit(2); }
    update((r) => {
      const p = getProject(r, k);
      p.name = name; p.path = pth;
      p.plan = { variant, creator, transport, projectDir, createdAt: p.plan?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    });
    console.log(`执行计划已保存: ${k} (变体=${variant} 创建人=${creator} 传输=${transport})`);
    break;
  }

  case 'step': {
    const [k, stepName, state, note] = args;
    if (!k || !STEPS.includes(stepName) || !['done', 'fail'].includes(state)) {
      console.error(`用法: registry.js step <projectKey> <${STEPS.join('|')}> <done|fail> [note]`);
      process.exit(2);
    }
    const p = update((r) => {
      const p2 = getProject(r, k);
      p2.steps[stepName] = state;
      if (note) p2.log.push({ at: new Date().toISOString(), msg: `step ${stepName}=${state}: ${note}` });
      return p2;
    });
    console.log(`步骤已更新: ${k} / ${stepName}=${state}  当前阶段: ${currentPhase(p)}`);
    break;
  }

  case 'log': {
    const [k, ...msgParts] = args;
    const msg = msgParts.join(' ');
    if (!k || !msg) { console.error('用法: registry.js log <projectKey> <message>'); process.exit(2); }
    update((r) => {
      const p = getProject(r, k);
      p.log.push({ at: new Date().toISOString(), msg });
    });
    console.log(`日志已追加: ${k} @ ${new Date().toISOString()}`);
    break;
  }

  case 'init': {
    const [k, name, pth, summary] = args;
    if (!k || !name || !pth) { console.error('用法: registry.js init <projectKey> <name> <path> [summary]'); process.exit(2); }
    // 幂等检查（只读，不进锁）
    const existing = load();
    if (existing.projects[k]?.initialized) { console.log(`已初始化，跳过（${k} 于 ${existing.projects[k].initAt}）`); process.exit(0); }
    const p = update((r) => {
      const p2 = getProject(r, k);
      if (p2.initialized) return p2;
      p2.name = name; p2.path = pth;
      p2.initialized = true;
      p2.initAt = new Date().toISOString();
      if (summary) p2.initSummary = summary;
      p2.steps.init = 'done';
      return p2;
    });
    console.log(`已标记初始化: ${k} @ ${p.initAt}`);
    break;
  }

  case 'add-run': {
    const [k, variant, summary, reportFile] = args;
    if (!k || !variant) { console.error('用法: registry.js add-run <projectKey> <variant> <summary> [reportFile]'); process.exit(2); }
    const p = update((r) => {
      const p2 = getProject(r, k);
      p2.atcRuns.push({ at: new Date().toISOString(), variant, summary: summary || '', reportFile: reportFile || '' });
      p2.steps.atc = 'done';
      return p2;
    });
    console.log(`已记录 ATC 执行: ${k} / ${variant} @ ${p.atcRuns[p.atcRuns.length - 1].at}`);
    break;
  }

  case 'verify-index': {
    const dir = args[0] ? path.resolve(args[0]) : path.resolve(__dirname, '..');
    const idxFile = path.join(dir, 'agents-index.json');
    if (!fs.existsSync(idxFile)) { console.error(`找不到 agents-index.json: ${idxFile}`); process.exit(1); }
    const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
    const agents = idx.agents || {};
    if (!Object.keys(agents).length) { console.error('agents-index.json 为空'); process.exit(1); }
    let fail = 0;
    for (const [name, a] of Object.entries(agents)) {
      const agentDir = path.resolve(dir, a.directory.replace(/\//g, path.sep));
      const entry = path.join(agentDir, a.entry.replace(/\//g, path.sep));
      const okDir = fs.existsSync(agentDir), okEntry = fs.existsSync(entry);
      console.log(`  ${name}: 目录=${okDir ? '✓' : '✗'}(${a.directory})  入口=${okEntry ? '✓' : '✗'}(${a.entry})`);
      if (!okDir || !okEntry) fail++;
    }
    console.log(fail ? `校验失败: ${fail} 个 agent 路径无效` : '索引校验通过');
    process.exit(fail ? 1 : 0);
    break;
  }

  case 'summary': {
    const k = args[0];
    if (!k) { console.error('用法: registry.js summary <projectKey>'); process.exit(2); }
    const r = load();
    const p = r.projects[k] ? normalize(r.projects[k]) : null;
    if (!p) { console.error(`无记录: ${k}`); process.exit(2); }
    const lines = [];
    lines.push(`# ${k} 调度执行总结`);
    lines.push('');
    lines.push(`- 项目：${p.name}（${p.path}）`);
    lines.push(`- 阶段：${currentPhase(p)}`);
    if (p.plan) lines.push(`- 计划：变体=${p.plan.variant || '-'} / 创建人=${p.plan.creator || '-'} / 传输=${p.plan.transport || '-'} / 项目目录=${p.plan.projectDir || '-'}`);
    lines.push(`- 初始化：${p.initialized ? '✅ ' + (p.initAt || '') : '❌ 未初始化'}${p.initSummary ? '（' + p.initSummary + '）' : ''}`);
    lines.push(`- 步骤：${STEPS.map((s) => `${s}=${stepState(p, s)}`).join(' / ')}`);
    lines.push(`- ATC 执行：${(p.atcRuns || []).length} 次`);
    for (const run of p.atcRuns || []) lines.push(`  - ${run.at}｜${run.variant}｜${run.summary}｜${run.reportFile || '-'}`);
    if ((p.log || []).length) {
      lines.push(`- 日志：${p.log.length} 条`);
      p.log.slice(-5).forEach((l) => lines.push(`  - ${l.at} ${l.msg}`));
    }
    console.log(lines.join('\n'));
    break;
  }

  case 'clear': {
    const k = args[0];
    if (!k) { console.error('用法: registry.js clear <projectKey>'); process.exit(2); }
    // 存在性检查（只读）
    const existing = load();
    if (!existing.projects[k]) { console.log(`无记录: ${k}`); process.exit(0); }
    if (!args.includes('--force')) { console.error('安全保护：请加 --force 确认清除'); process.exit(3); }
    update((r) => { delete r.projects[k]; });
    console.log(`已清除: ${k}`);
    break;
  }

  default:
    console.log(`未知命令: ${cmd}\n支持: list | status | plan | step | log | init | add-run | verify-index | summary | clear`);
    process.exit(2);
}
