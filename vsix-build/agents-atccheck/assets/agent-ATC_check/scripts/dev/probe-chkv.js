#!/usr/bin/env node
/* probe-chkv.js — 读 ATC 检查变体对象 (CHKV/TYP) */
const https = require('node:https');
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
      agent, headers: { Authorization: AUTH, 'User-Agent': 'probe-chkv', Accept: accept }, timeout: 30000,
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
  const uri = '/sap/bc/adt/atc/checkvariants/zabap_cloud_dev_check';
  for (const a of [
    'application/xml',
    'application/vnd.sap.adt.atc.checkvariant.v1+xml',
    'application/vnd.sap.adt.atc.checkvariantconfig.v1+xml',
    'application/vnd.sap.adt.atc.checkvariantlist.v1+xml',
    'application/vnd.sap.adt.atc.v1+xml',
    'application/atom+xml',
  ]) {
    const r = await get(uri, a);
    console.log(`Accept: ${a} → HTTP ${r.status} (${r.body.length} chars)`);
    if (r.status === 200) {
      console.log(r.body.slice(0, 2500).replace(/\s+/g, ' '));
      break;
    }
  }
})();
