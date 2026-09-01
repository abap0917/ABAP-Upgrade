#!/usr/bin/env node
/* probe-rfc.js — 探测 XXX 上 RFC 桥接相关端点是否可用
 * 1) ZMCP_ADT_SRV OData 服务 (RFC 桥接所需)
 * 2) ADT 文本池端点 (备用方案)
 */
const https = require('node:https');
const fs = require('node:fs');
const { loadEnv, resolveEnvPath } = require('./shared/mcp');
const env = loadEnv(resolveEnvPath(process.argv, '.env'));
const base = env.SAP_URL.replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${env.SAP_USERNAME}:${env.SAP_PASSWORD}`).toString('base64');

function probe(path, label) {
  return new Promise((resolve) => {
    const url = `${base}${path}`;
    const req = https.request(url, {
      method: 'GET',
      headers: { Authorization: auth, Accept: '*/*', 'X-CSRF-Token': 'Fetch' },
      rejectUnauthorized: false,
      timeout: 20000,
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; if (body.length > 600) body = body.slice(0, 600); });
      res.on('end', () => {
        const csrf = res.headers['x-csrf-token'] || '';
        resolve(`[${label}] HTTP ${res.statusCode}  csrf=${csrf ? 'YES' : '-'}  body=${body.slice(0, 120).replace(/\s+/g, ' ')}`);
      });
    });
    req.on('error', (e) => resolve(`[${label}] ERROR ${e.message}`));
    req.on('timeout', () => { req.destroy(); resolve(`[${label}] TIMEOUT`); });
    req.end();
  });
}

(async () => {
  const probes = [
    ['/sap/opu/odata/sap/ZMCP_ADT_SRV/$metadata', 'ZMCP_ADT_SRV metadata'],
    ['/sap/opu/odata/sap/ZMCP_ADT_SRV/', 'ZMCP_ADT_SRV root'],
    ['/sap/bc/adt/programs/programs/zzzprog001/texts', 'ADT texts endpoint'],
    ['/sap/bc/adt/core/discovery', 'ADT discovery'],
    ['/sap/bc/soap/rfc', 'SOAP RFC node'],
  ];
  for (const [p, l] of probes) {
    const r = await probe(p, l);
    console.log(r);
  }
})();
