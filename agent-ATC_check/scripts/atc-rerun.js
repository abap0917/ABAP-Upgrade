#!/usr/bin/env node
/**
 * atc-rerun.js — 对"当前项目"的对象重跑 ATC（自动取对象，不锁定单个对象）
 * 用法: node atc-rerun.js [projectDir] [--variant=] [--env=] [--objectUri=]
 * 对象来源（按优先级）:
 *   1. --objectUri= 显式指定
 *   2. <projectDir>/atc-worklist-*.xml 中第一个对象（<atcobject:object adtcore:uri="...">）
 *   3. 提示失败：项目下无 worklist 时，先跑一次或显式传 --objectUri
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectDir = path.resolve(process.argv[2] || '.');
const getFlag = (n) => {
  const a = process.argv.find((x) => x.startsWith(n + '='));
  return a ? a.slice(n.length + 1) : null;
};
const variant = getFlag('--variant') || 'ZABAP_CLOUD_DEV_CHECK';
const envPath = getFlag('--env') || path.join(projectDir, '.env');
const objectUri = getFlag('--objectUri');

function resolveObjectUri() {
  if (objectUri) return objectUri;
  // 从项目最新 worklist 取第一个对象 URI
  const files = fs.readdirSync(projectDir).filter((f) => /^atc-worklist-.*\.xml$/i.test(f)).sort();
  for (const f of files.reverse()) {
    const xml = fs.readFileSync(path.join(projectDir, f), 'utf8');
    const m = xml.match(/<atcobject:object\b[^>]*adtcore:uri="([^"]+)"/);
    if (m) { console.log(`对象来源: ${f} → ${m[1]}`); return m[1]; }
  }
  return null;
}

const uri = resolveObjectUri();
if (!uri) {
  console.error('未找到 ATC 对象：当前项目无 worklist XML 且未传 --objectUri。');
  console.error('  方式1: 先跑一次 ATC 生成 worklist，再重跑本命令');
  console.error('  方式2: node atc-rerun.js <项目目录> --objectUri=/sap/bc/adt/programs/programs/<对象>/source/main');
  process.exit(2);
}

const script = path.resolve(__dirname, 'atc-run-csrf3.js');
const r = spawnSync(process.execPath, [script, uri, variant, '10', envPath, `--outDir=${projectDir}`], {
  encoding: 'utf8', timeout: 300000, stdio: 'inherit',
});
process.exit(r.status ?? 1);
