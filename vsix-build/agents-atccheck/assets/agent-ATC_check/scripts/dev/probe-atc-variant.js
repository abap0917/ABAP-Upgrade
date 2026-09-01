#!/usr/bin/env node
/* probe-atc-variant.js — 探测 ATC 检查变体配置端点 */
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
      agent, headers: { Authorization: AUTH, 'User-Agent': 'probe-var', Accept: accept }, timeout: 30000,
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

(async () => {
  for (const [p, accept] of [
    ['/sap/bc/adt/atc/checkvariants', 'application/xml'],
    ['/sap/bc/adt/atc/checkvariants/ZABAP_CLOUD_DEV_CHECK', 'application/xml'],
    ['/sap/bc/adt/atc/checkvariants/ZABAP_CLOUD_DEV_CHECK', 'application/json'],
    ['/sap/bc/adt/atc/checkvariantconfig/ZABAP_CLOUD_DEV_CHECK', 'application/xml'],
  ]) {
    const r = await get(p, accept);
    console.log(`== ${p} (Accept: ${accept}) → HTTP ${r.status} (${r.body.length} chars)`);
    console.log(r.body.slice(0, 700).replace(/\s+/g, ' '));
    console.log('');
  }
})();
