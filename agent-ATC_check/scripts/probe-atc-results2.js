#!/usr/bin/env node
/* probe-atc-results2.js — 带 createdBy 探测 /atc/results 列表 */
const https = require('node:https');
const fs = require('node:fs');
const { loadEnv, resolveEnvPath } = require('./shared/mcp');
const env = {};
const envPath = resolveEnvPath(process.argv, '.env');
Object.assign(env, loadEnv(envPath));
const base = (env.SAP_URL || '').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from(`${env.SAP_USERNAME}:${env.SAP_PASSWORD}`).toString('base64');
const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

function call(pathName) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + pathName);
    const req = https.request({
      host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET',
      agent, headers: { Authorization: AUTH, 'User-Agent': 'probe-atc2' }, timeout: 60000,
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
  const tries = [
    '/sap/bc/adt/atc/results?createdBy=123456',
    '/sap/bc/adt/atc/results?createdBy=123456&from=20260101&to=20261231',
    '/sap/bc/adt/atc/results?createdBy=123456&objectUri=' + encodeURIComponent('/sap/bc/adt/programs/programs/zzzprog001/source/main'),
    '/sap/bc/adt/atc/results?createdBy=123456&checkVariant=ZABAP_CLOUD_DEV_CHECK',
  ];
  for (const p of tries) {
    const r = await call(p);
    console.log(`== ${p.split('?')[1]} HTTP ${r.status} (${r.body.length} chars)`);
    console.log(r.body.slice(0, 1600));
    console.log('');
  }
})();
