#!/usr/bin/env node
/* probe-atc-results3.js — 试探 Accept 头 */
const https = require('node:https');
const fs = require('node:fs');
const { loadEnv, resolveEnvPath } = require('../shared/mcp');
const env = {};
const envPath = resolveEnvPath(process.argv, '.env');
Object.assign(env, loadEnv(envPath));
const base = (env.SAP_URL || '').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from(`${env.SAP_USERNAME}:${env.SAP_PASSWORD}`).toString('base64');
const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

function call(pathName, accept) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + pathName);
    const req = https.request({
      host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET',
      agent, headers: { Authorization: AUTH, 'User-Agent': 'probe-atc3', Accept: accept }, timeout: 60000,
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
  const path = '/sap/bc/adt/atc/results?createdBy=123456';
  for (const accept of ['application/xml', 'application/atom+xml', 'application/json', 'application/vnd.sap.adt.atc.result.v1+xml']) {
    const r = await call(path, accept);
    console.log(`== Accept: ${accept} → HTTP ${r.status} (${r.body.length} chars)`);
    console.log(r.body.slice(0, 900).replace(/\s+/g, ' '));
    console.log('');
    if (r.status === 200) break;
  }
})();
