#!/usr/bin/env node
/* probe-table-data.js — 探测 ADT Data Preview 端点读 SATC_AC 配置表 */
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
      agent, headers: { Authorization: AUTH, 'User-Agent': 'probe-tab', Accept: accept }, timeout: 30000,
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
  const tables = ['SATC_AC_CHECK_VARIANT', 'SATC_AC_CV_CHECK_REF', 'SATC_AC_CHECK_CONFIGURATION'];
  for (const t of tables) {
    for (const [p, a] of [
      [`/sap/bc/adt/ddic/tables/${t}/data?rowNumber=20`, 'application/json'],
      [`/sap/bc/adt/ddic/tables/${t}/data?maxRows=20`, 'application/xml'],
    ]) {
      const r = await get(p, a);
      console.log(`== ${t} ${p.split('/').pop().split('?')[0]} → HTTP ${r.status} (${r.body.length} chars)`);
      console.log(r.body.slice(0, 400).replace(/\s+/g, ' '));
      console.log('');
    }
  }
})();
