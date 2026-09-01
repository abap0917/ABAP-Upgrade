#!/usr/bin/env node
/* probe-chkv2.js — 探索 ATC 服务文档与 checkvariants 集合的媒体类型 */
const https = require('node:https');
const { loadEnv, resolveEnvPath } = require('../shared/mcp');

const env = loadEnv(resolveEnvPath(process.argv, process.argv[2] || '.env'));
const base = (env.SAP_URL || '').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from(`${env.SAP_USERNAME}:${env.SAP_PASSWORD}`).toString('base64');
const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

function get(pathName, accept, method = 'GET') {
  return new Promise((resolve, reject) => {
    const u = new URL(base + pathName);
    const req = https.request({
      host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method,
      agent, headers: { Authorization: AUTH, 'User-Agent': 'probe-chkv2', Accept: accept }, timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  // 1) ATC 服务根
  for (const p of ['/sap/bc/adt/atc', '/sap/bc/adt/atc/']) {
    for (const a of ['application/atom+xml', 'application/xml', '*/*']) {
      const r = await get(p, a);
      console.log(`== ${p} Accept=${a} → HTTP ${r.status} (${r.body.length} chars)`);
      if (r.status === 200) { console.log(r.body.slice(0, 1500).replace(/\s+/g, ' ')); break; }
    }
    console.log('');
  }
  // 2) checkvariants 集合（不同 Accept）
  for (const a of ['application/atom+xml', 'application/xml', 'application/vnd.sap.adt.collection.v1+xml', '*/*']) {
    const r = await get('/sap/bc/adt/atc/checkvariants', a);
    console.log(`== /atc/checkvariants Accept=${a} → HTTP ${r.status} (${r.body.length} chars) Allow=${r.headers.allow || ''}`);
    if (r.status === 200) { console.log(r.body.slice(0, 1200).replace(/\s+/g, ' ')); break; }
  }
})();
