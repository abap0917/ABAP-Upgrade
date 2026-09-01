#!/usr/bin/env node
/**
 * verify-deployed.js — 部署后校验：读回 SAP 活动源码与本地快照比对（步骤 7 收尾）
 * 用途：确保"系统与 diff 文件一致"（AGENT.md 步骤 7 的自动化替代人工比对）
 *
 * 用法:
 *   node verify-deployed.js <workDir> [envPath] [launcherPath]
 *   node verify-deployed.js <workDir> --env=<envPath> --launcher=<launcherPath>
 *
 * 逻辑:
 *   1. 读 <workDir>/objects-summary.json → 对象列表 (name/type/sourceFile)
 *   2. 每个对象经 MCP 读回活动源码（ReadProgram/ReadClass/...，按类型映射）
 *   3. 与本地 sourceFile 行级比对（LF 归一化）
 *   4. 输出每对象 一致/不一致(前 5 行差异)；全部一致退出码 0，任一不一致退出码 1
 */
const fs = require('node:fs');
const path = require('node:path');
const { resolveEnvPath, resolveFlag, mcpCall } = require('./shared/mcp');

const workDir = path.resolve(process.argv[2] || '');
const envPath = resolveEnvPath(process.argv, process.argv[3] || '.env');
let launcher = resolveFlag(process.argv, '--launcher=') || (process.argv[4] ? process.argv[4] : path.resolve(path.dirname(envPath), '..', 'adt-dev', 'dist', 'server', 'launcher.js'));
if (!workDir) { console.error('用法: node verify-deployed.js <workDir> [envPath] [launcherPath]'); process.exit(2); }
if (!fs.existsSync(launcher)) { console.error(`launcher 不存在: ${launcher}`); process.exit(2); }
launcher = path.resolve(launcher);

const TOOL_BY_TYPE = {
  'PROG': 'ReadProgram', 'PROG/P': 'ReadProgram',
  'CLAS': 'ReadClass', 'CLAS/OC': 'ReadClass',
  'INTF': 'ReadInterface', 'INTF/OI': 'ReadInterface',
  'DDLS': 'ReadView', 'DDLS/DF': 'ReadView',
  'FUGR': 'ReadFunctionGroup',
  'TABL': 'ReadTable',
  'DOMA': 'ReadDomain',
  'DTEL': 'ReadDataElement',
};
const ARG_BY_TOOL = {
  ReadProgram: 'program_name', ReadClass: 'class_name', ReadInterface: 'interface_name',
  ReadView: 'view_name', ReadFunctionGroup: 'function_group_name', ReadTable: 'table_name',
  ReadDomain: 'domain_name', ReadDataElement: 'data_element_name',
};

function normalize(s) { return String(s || '').replace(/\r\n/g, '\n').replace(/\s+$/, ''); }

(async () => {
  const summaryFile = path.join(workDir, 'objects-summary.json');
  if (!fs.existsSync(summaryFile)) { console.error(`找不到 ${summaryFile}（先运行 fetch-object-sources.js）`); process.exit(2); }
  const objects = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
  if (!objects.length) { console.error('objects-summary.json 为空'); process.exit(2); }

  // 并行比对各对象（每对象独立 MCP 读回）
  const results = await Promise.all(objects.map(async (obj) => {
    const tool = TOOL_BY_TYPE[obj.type] || TOOL_BY_TYPE[obj.type.split('/')[0]];
    const localFile = obj.sourceFile ? path.resolve(obj.sourceFile) : null;
    if (!tool || !localFile || !fs.existsSync(localFile)) {
      console.log(`  ${obj.name}: 跳过（无本地快照或类型不支持: ${obj.type}）`);
      return { name: obj.name, ok: true };
    }
    const argName = ARG_BY_TOOL[tool] || 'name';
    const { data, error } = await mcpCall({ launcher, envPath, tool, args: { [argName]: obj.name } });
    if (error) {
      console.log(`  ${obj.name}: 读回失败 - ${error}`);
      return { name: obj.name, ok: false };
    }
    const remote = normalize(data?.source_code ?? data);
    const local = normalize(fs.readFileSync(localFile, 'utf8'));
    if (remote === local) {
      console.log(`  ✓ ${obj.name}: 与系统一致 (${local.split('\n').length} 行)`);
      return { name: obj.name, ok: true };
    }
    const rl = remote.split('\n'), ll = local.split('\n');
    console.log(`  ✗ ${obj.name}: 与系统不一致 (本地 ${ll.length} 行 vs 系统 ${rl.length} 行)`);
    let shown = 0;
    for (let i = 0; i < Math.max(rl.length, ll.length) && shown < 5; i++) {
      const a = ll[i] ?? '<EOF>', b = rl[i] ?? '<EOF>';
      if (a !== b) { console.log(`      L${i + 1} 本地[${a.slice(0, 70)}]  系统[${b.slice(0, 70)}]`); shown++; }
    }
    return { name: obj.name, ok: false };
  }));
  const fail = results.filter((r) => !r.ok).length;
  console.log(fail ? `\n结果: ${fail} 个对象不一致（部署未完成或 diff 未更新）` : '\n结果: 全部与系统一致');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
