#!/usr/bin/env node
/**
 * fetch-atc-latest.js — 拉取指定创建人/变体下最新一条 ATC 历史结果（步骤 2）
 * 用法:
 *   node fetch-atc-latest.js <envPath> <createdBy> [variant] [outDir]
 * 说明:
 *   - GET /sap/bc/adt/atc/results?createdBy=<账号>   (Accept: application/xml)
 *   - 按 checkVariant 过滤（默认 ZABAP_CLOUD_DEV_CHECK），取 createdAt 最新一条
 *   - GET /sap/bc/adt/atc/results/<displayId> 拉完整结果 XML
 * 输出:
 *   <outDir>/ATC-worklist-<displayId>.xml   完整结果（供 atc-xml-to-html.js 转 HTML）
 *   <outDir>/atc-latest-meta.json           元数据（displayId/变体/时间/计数）
 */
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv, resolveEnvPath } = require('./shared/mcp');

// 统一 CLI 约定: --env=<path> 优先, 兼容旧位置参数 <envPath> <createdBy> [variant] [outDir]
const envPath = resolveEnvPath(process.argv, process.argv[2] || '.env');
const createdBy = (process.argv[3] || '').toUpperCase();
const variant = process.argv[4] || 'ZABAP_CLOUD_DEV_CHECK';
const outDir = path.resolve(process.argv[5] || '.');

if (!createdBy) { console.error('用法: node fetch-atc-latest.js <envPath> <createdBy> [variant] [outDir]  或 --env=<path> <createdBy> [variant] [outDir]'); process.exit(2); }

const env = loadEnv(envPath);
const base = (env.SAP_URL || '').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from(`${env.SAP_USERNAME}:${env.SAP_PASSWORD}`).toString('base64');
const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

function get(pathName) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + pathName);
    const req = https.request({
      host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET',
      agent, headers: { Authorization: AUTH, 'User-Agent': 'fetch-atc-latest', Accept: 'application/xml' },
      timeout: 120000,
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.on('error', reject);
    req.end();
  });
}
const el = (xml, tag) => { const m = xml.match(new RegExp(`<atcresult:${tag}>([^<]*)</atcresult:${tag}>`)); return m ? m[1] : ''; };
const num = (xml, tag) => { const m = xml.match(new RegExp(`<atcresult:${tag}>(\\d+)</atcresult:${tag}>`)); return m ? +m[1] : 0; };

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  // 1) 列表
  const list = await get(`/sap/bc/adt/atc/results?createdBy=${encodeURIComponent(createdBy)}`);
  if (list.status !== 200) { console.error(`列表拉取失败 HTTP ${list.status}: ${list.body.slice(0, 500)}`); process.exit(1); }
  // 2) 解析所有 result 条目
  const entries = [];
  const re = /<atcresult:result>([\s\S]*?)<\/atcresult:result>/g;
  let m;
  while ((m = re.exec(list.body))) {
    const block = m[1];
    entries.push({
      displayId: el(block, 'displayId'),
      title: el(block, 'title'),
      checkVariant: el(block, 'checkVariant'),
      createdAt: el(block, 'createdAt'),
      prio1: num(block, 'numPrio1'), prio2: num(block, 'numPrio2'),
      prio3: num(block, 'numPrio3'), prio4: num(block, 'numPrio4'),
      failure: num(block, 'numFailure'),
    });
  }
  if (!entries.length) { console.error('该创建人下没有 ATC 结果记录'); process.exit(1); }
  // 3) 按变体过滤 + 取最新
  const filtered = entries.filter((e) => e.checkVariant === variant);
  if (!filtered.length) {
    console.error(`变体 ${variant} 无结果。现有变体: ${[...new Set(entries.map(e => e.checkVariant))].join(', ')}`);
    process.exit(1);
  }
  filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const latest = filtered[0];
  console.log(`最新一条: ${latest.title} | 变体 ${latest.checkVariant} | ${latest.createdAt} | P1:${latest.prio1} P2:${latest.prio2} P3:${latest.prio3} P4:${latest.prio4} F:${latest.failure}`);
  console.log(`displayId: ${latest.displayId}`);
  // 4) 拉完整结果
  const detail = await get(`/sap/bc/adt/atc/results/${latest.displayId}`);
  if (detail.status !== 200) { console.error(`明细拉取失败 HTTP ${detail.status}`); process.exit(1); }
  const xmlFile = path.join(outDir, `ATC-worklist-${latest.displayId}.xml`);
  fs.writeFileSync(xmlFile, detail.body, 'utf8');
  fs.writeFileSync(path.join(outDir, 'atc-latest-meta.json'), JSON.stringify(latest, null, 2), 'utf8');
  console.log(`完整结果已保存: ${xmlFile}`);
  console.log(`元数据已保存: ${path.join(outDir, 'atc-latest-meta.json')}`);
  console.log(`\n下一步: node atc-xml-to-html.js "${xmlFile}" "<outDir>/ATC-汇总报告.html"`);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
