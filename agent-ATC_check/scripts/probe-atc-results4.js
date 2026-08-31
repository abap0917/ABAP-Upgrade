#!/usr/bin/env node
/* probe-atc-results4.js 鈥?楠岃瘉鎸?displayId 鎷夊畬鏁寸粨鏋?*/
const https = require('node:https');
const fs = require('node:fs');
const env = {};
const envPath = process.argv[2] || '.env';
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
}
const base = (env.SAP_URL || '').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from(`${env.SAP_USERNAME}:${env.SAP_PASSWORD}`).toString('base64');
const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

function call(pathName, accept) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + pathName);
    const req = https.request({
      host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET',
      agent, headers: { Authorization: AUTH, 'User-Agent': 'probe-atc4', Accept: accept }, timeout: 60000,
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
  const id = '00000000000000000000000000000000';
  for (const p of [
    `/sap/bc/adt/atc/results/${id}`,
    `/sap/bc/adt/atc/results/${id}?suppressMessages=false`,
  ]) {
    const r = await call(p, 'application/xml');
    console.log(`== ${p.split('/sap/bc/adt')[1]} HTTP ${r.status} (${r.body.length} chars)`);
    console.log(r.body.slice(0, 1200).replace(/\s+/g, ' '));
    console.log('');
  }
})();
