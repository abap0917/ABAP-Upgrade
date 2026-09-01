#!/usr/bin/env node
/* probe-atc-results.js — 探测 /sap/bc/adt/atc/results 列表端点结构 */
const https = require('node:https');
const fs = require('node:fs');
const { loadEnv, resolveEnvPath } = require('./shared/mcp');
const env = {};
const envPath = resolveEnvPath(process.argv, '.env');
Object.assign(env, loadEnv(envPath));
const base = (env.SAP_URL || '').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from(`${env.SAP_USERNAME}:${env.SAP_PASSWORD}`).toString('base64');
const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

function call(pathName, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + pathName);
    const req = https.request({
      host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method,
      agent, headers: { Authorization: AUTH, 'User-Agent': 'probe-atc', ...headers },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  // 1) 列表端点（不带参数）
  let r = await call('/sap/bc/adt/atc/results');
  console.log(`== /atc/results HTTP ${r.status} (${r.body.length} chars)`);
  console.log(r.body.slice(0, 2000));

  // 2) 带对象过滤
  r = await call('/sap/bc/adt/atc/results?objectUri=' + encodeURIComponent('/sap/bc/adt/programs/programs/zzzprog001/source/main'));
  console.log(`\n== /atc/results?objectUri= HTTP ${r.status} (${r.body.length} chars)`);
  console.log(r.body.slice(0, 1500));

  // 3) 带变体
  r = await call('/sap/bc/adt/atc/results?checkVariant=ZABAP_CLOUD_DEV_CHECK');
  console.log(`\n== /atc/results?checkVariant= HTTP ${r.status} (${r.body.length} chars)`);
  console.log(r.body.slice(0, 1500));
})();
