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
const { resolveEnvPath, resolveFlag, mcpCall } = require('./shared/mcp');

// 统一 CLI 约定: --env=<path> / --launcher=<path> 优先, 兼容旧位置参数
// 旧: node fetch-object-sources.js <worklistXml> <outDir> <envPath> [launcherPath]
const worklistXml = path.resolve(process.argv[2] || '');
const outDir = path.resolve(process.argv[3] || '.');
const envPath = resolveEnvPath(process.argv, process.argv[4] || '.env');
// launcher: --launcher= > 旧位置参数 > envPath 同级推断 (…\<parent>\adt-dev\dist\server\launcher.js)
let launcher = resolveFlag(process.argv, '--launcher=') || (process.argv[5] ? process.argv[5] : path.resolve(path.dirname(envPath), '..', 'adt-dev', 'dist', 'server', 'launcher.js'));
if (!fs.existsSync(launcher)) {
  console.error(`launcher 不存在: ${launcher}\n用法: node fetch-object-sources.js <worklistXml> <outDir> <envPath> [launcherPath]  或 --env= --launcher=`);
  process.exit(2);
}
launcher = path.resolve(launcher);

if (!worklistXml) { console.error('用法: node fetch-object-sources.js <worklistXml> <outDir> <envPath> [launcherPath]  或 --env= --launcher='); process.exit(2); }

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

// 薄封装: 用公共 mcpCall (shared/mcp.js), 统一错误处理与嵌套 JSON 解包
async function mcpCallTool(tool, args) {
  const { data, error } = await mcpCall({ launcher, envPath, tool, args });
  if (error) return { error };
  if (data && typeof data === 'object' && data.source_code != null) return { source: data.source_code };
  if (typeof data === 'string') return { source: data };
  return { source: data == null ? '' : JSON.stringify(data) };
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

  // 并行拉取各对象源码（每对象独立 MCP 调用）
  const summary = await Promise.all(objects.map(async (obj) => {
    const folder = path.join(outDir, obj.name);
    fs.mkdirSync(folder, { recursive: true });
    const mapping = TOOL_BY_TYPE[obj.type] || TOOL_BY_TYPE[obj.type.split('/')[0]];
    if (!mapping) {
      console.warn(`!! ${obj.name}: 类型 ${obj.type} 无对应拉取工具，跳过源码`);
      return { ...obj, sourceFile: null, error: `unsupported type ${obj.type}` };
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
    const r = await mcpCallTool(mapping.tool, callArgs);
    if (r.error) {
      console.warn(`!! ${obj.name}: 拉取失败 ${r.error}`);
      return { ...obj, sourceFile: null, error: r.error };
    }
    const src = r.source;
    const srcFile = path.join(folder, `${obj.name}.${mapping.ext}`);
    fs.writeFileSync(srcFile, src, 'utf8');
    console.log(`✓ ${obj.name}: ${srcFile} (${src.split('\n').length} 行)`);
    return { ...obj, sourceFile: srcFile, lines: src.split('\n').length };
  }));
  fs.writeFileSync(path.join(outDir, 'objects-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\n对象清单: ${path.join(outDir, 'objects-summary.json')}`);
  const failed = summary.filter(s => s.error);
  if (failed.length) { console.warn(`!! ${failed.length} 个对象拉取失败，详见 objects-summary.json`); process.exitCode = 1; }
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
