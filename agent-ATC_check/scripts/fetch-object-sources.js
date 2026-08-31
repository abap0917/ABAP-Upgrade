#!/usr/bin/env node
/**
 * fetch-object-sources.js — 按 ATC worklist 中的对象逐个建文件夹并拉取源码（步骤 3）
 * 用法:
 *   node fetch-object-sources.js <worklistXml> <outDir> <envPath> [launcherPath]
 * 说明:
 *   - 解析 worklist XML 中的 <atcobject:object>（name / type / uri）
 *   - 每个对象建 <outDir>/<对象名>/ 文件夹，源码保存为 <对象名>.<ext>
 *   - 类型→工具映射: PROG→ReadProgram, CLAS/OC→ReadClass, INTF/OI→ReadInterface,
 *     DDLS/DF→ReadView, FUGR→ReadFunctionGroup, TABL→ReadTable
 *   - 对象信息与告警行号写入 <outDir>/<对象名>/objects-summary.json
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const worklistXml = path.resolve(process.argv[2] || '');
const outDir = path.resolve(process.argv[3] || '.');
const envPath = path.resolve(process.argv[4] || '.env');
// launcher: 显式参数 > envPath 同级推断 (…\<parent>\adt-dev\dist\server\launcher.js) > 报错
let launcher = process.argv[5]
  ? path.resolve(process.argv[5])
  : path.resolve(path.dirname(envPath), '..', 'adt-dev', 'dist', 'server', 'launcher.js');
if (!fs.existsSync(launcher)) {
  console.error(`launcher 不存在: ${launcher}\n用法: node fetch-object-sources.js <worklistXml> <outDir> <envPath> [launcherPath]`);
  process.exit(2);
}
launcher = path.resolve(launcher);

if (!worklistXml) { console.error('用法: node fetch-object-sources.js <worklistXml> <outDir> <envPath> [launcherPath]'); process.exit(2); }

const TOOL_BY_TYPE = {
  'PROG': { tool: 'ReadProgram', ext: 'abap' },
  'PROG/P': { tool: 'ReadProgram', ext: 'abap' },
  'CLAS': { tool: 'ReadClass', ext: 'clas' },
  'CLAS/OC': { tool: 'ReadClass', ext: 'clas' },
  'INTF': { tool: 'ReadInterface', ext: 'intf' },
  'INTF/OI': { tool: 'ReadInterface', ext: 'intf' },
  'DDLS': { tool: 'ReadView', ext: 'cds' },
  'DDLS/DF': { tool: 'ReadView', ext: 'cds' },
  'FUGR': { tool: 'ReadFunctionGroup', ext: 'fugr' },
  'TABL': { tool: 'ReadTable', ext: 'tabl' },
  'DOMA': { tool: 'ReadDomain', ext: 'doma' },
  'DTEL': { tool: 'ReadDataElement', ext: 'dtel' },
};

function mcpCall(tool, args) {
  const argFile = path.join(outDir, `.tmp-${tool}-${Date.now()}.json`);
  fs.writeFileSync(argFile, JSON.stringify(args), 'utf8');
  const res = spawnSync(process.execPath, [path.resolve(__dirname, 'mcp-invoke.js'), launcher, envPath, tool, `@${argFile}`, '--out=' + argFile + '.out'], {
    encoding: 'utf8', timeout: 180000, env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  });
  fs.rmSync(argFile, { force: true });
  const out = argFile + '.out';
  if (!fs.existsSync(out)) {
    fs.rmSync(out, { force: true });
    return { error: (res.stderr || 'no output').slice(0, 500) };
  }
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { }
  fs.rmSync(out, { force: true });
  if (!parsed || parsed.isError) return { error: (parsed?.content?.[0]?.text || 'call failed').slice(0, 500) };
  const text = parsed.content?.[0]?.text || '';
  try {
    const inner = JSON.parse(text);
    if (inner && inner.success === false) return { error: (inner.message || '').slice(0, 500) };
    return { source: inner.source_code ?? inner.text ?? text };
  } catch {
    return { source: text }; // 非 JSON 时按原文
  }
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const xml = fs.readFileSync(worklistXml, 'utf8');
  const objects = [];
  const re = /<atcobject:object\b([^>]*)>/g;
  let m;
  const names = new Set();
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const name = (attrs.match(/adtcore:name="([^"]*)"/) || [])[1] || '';
    const type = (attrs.match(/adtcore:type="([^"]*)"/) || [])[1] || '';
    const pkg = (attrs.match(/adtcore:packageName="([^"]*)"/) || [])[1] || '';
    if (name && !names.has(name)) { names.add(name); objects.push({ name, type, package: pkg }); }
  }
  if (!objects.length) { console.error('worklist 中没有解析到对象'); process.exit(1); }
  console.log(`解析到 ${objects.length} 个对象: ${objects.map(o => `${o.name}(${o.type})`).join(', ')}`);

  const summary = [];
  for (const obj of objects) {
    const folder = path.join(outDir, obj.name);
    fs.mkdirSync(folder, { recursive: true });
    const mapping = TOOL_BY_TYPE[obj.type] || TOOL_BY_TYPE[obj.type.split('/')[0]];
    if (!mapping) {
      console.warn(`!! ${obj.name}: 类型 ${obj.type} 无对应拉取工具，跳过源码`);
      summary.push({ ...obj, sourceFile: null, error: `unsupported type ${obj.type}` });
      continue;
    }
    const argName = mapping.tool === 'ReadProgram' ? 'program_name'
      : mapping.tool === 'ReadClass' ? 'class_name'
      : mapping.tool === 'ReadInterface' ? 'interface_name'
      : mapping.tool === 'ReadView' ? 'view_name'
      : mapping.tool === 'ReadTable' ? 'table_name'
      : mapping.tool === 'ReadFunctionGroup' ? 'function_group_name'
      : mapping.tool === 'ReadDomain' ? 'domain_name'
      : mapping.tool === 'ReadDataElement' ? 'data_element_name'
      : 'name';
    const callArgs = { [argName]: obj.name };
    const r = mcpCall(mapping.tool, callArgs);
    if (r.error) {
      console.warn(`!! ${obj.name}: 拉取失败 ${r.error}`);
      summary.push({ ...obj, sourceFile: null, error: r.error });
      continue;
    }
    const src = r.source;
    const srcFile = path.join(folder, `${obj.name}.${mapping.ext}`);
    fs.writeFileSync(srcFile, src, 'utf8');
    console.log(`✓ ${obj.name}: ${srcFile} (${src.split('\n').length} 行)`);
    summary.push({ ...obj, sourceFile: srcFile, lines: src.split('\n').length });
  }
  fs.writeFileSync(path.join(outDir, 'objects-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\n对象清单: ${path.join(outDir, 'objects-summary.json')}`);
  const failed = summary.filter(s => s.error);
  if (failed.length) { console.warn(`!! ${failed.length} 个对象拉取失败，详见 objects-summary.json`); process.exitCode = 1; }
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
