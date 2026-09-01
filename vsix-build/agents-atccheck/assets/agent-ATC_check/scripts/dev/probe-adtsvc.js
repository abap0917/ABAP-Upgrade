#!/usr/bin/env node
/* probe-adtsvc.js — 拉 ADT discovery 全文 + 试更多 checkvariant URI */
const https = require('node:https');
const fs = require('node:fs');
const { loadEnv, resolveEnvPath } = require('../shared/mcp');

const env = loadEnv(resolveEnvPath(process.argv, process.argv[2] || '.env'));
const base = (env.SAP_URL || '').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from(`${env.SAP_USERNAME}:${env.SAP_PASSWORD}`).toString('base64');
const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

function get(pathName, accept) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + pathName);
    const req = https.request({
      host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET',
      agent, headers: { Authorization: AUTH, 'User-Agent': 'probe-svc', Accept: accept }, timeout: 30000,
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
  // 1) ADT discovery 全文，找 atc/variant 相关 collection 与 media type
  const d = await get('/sap/bc/adt/core/discovery', 'application/xml');
  console.log(`== discovery HTTP ${d.status} (${d.body.length} chars)`);
  const atcHits = d.body.match(/[^<>]*(?:atc|variant|check)[^<>]*/gi) || [];
  console.log('ATC/variant 相关片段:');
  for (const h of atcHits.slice(0, 20)) console.log('  ' + h.trim().slice(0, 150));
  console.log('');
  // 2) 更多候选 URI
  for (const p of [
    '/sap/bc/adt/atc/checkvariantconfigs/ZABAP_CLOUD_DEV_CHECK',
    '/sap/bc/adt/atc/checkvariants/ZABAP_CLOUD_DEV_CHECK/config',
    '/sap/bc/adt/atc/variants/ZABAP_CLOUD_DEV_CHECK',
    '/sap/bc/adt/atc/checkvariant/ZABAP_CLOUD_DEV_CHECK',
  ]) {
    const r = await get(p, 'application/xml');
    console.log(`== ${p} → HTTP ${r.status} (${r.body.length} chars)`);
    if (r.status === 200) console.log(r.body.slice(0, 800).replace(/\s+/g, ' '));
    console.log('');
  }
})();
