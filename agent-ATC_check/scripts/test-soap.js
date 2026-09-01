#!/usr/bin/env node
/* test-soap.js — 实测 /sap/bc/soap/rfc 调用 ZMCP_ADT_TEXTPOOL (READ) */
const https = require('node:https');
const fs = require('node:fs');
const { loadEnv, resolveEnvPath } = require('./shared/mcp');

const env = loadEnv(resolveEnvPath(process.argv, '.env'));
const base = env.SAP_URL.replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${env.SAP_USERNAME}:${env.SAP_PASSWORD}`).toString('base64');

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function soapCall(fmName, params) {
  const paramXml = Object.entries(params).map(([k, v]) => `      <${k}>${escapeXml(v)}</${k}>`).join('\n');
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:sap-com:document:sap:rfc:functions">
  <soap-env:Header/>
  <soap-env:Body>
    <urn:${fmName}>
${paramXml}
    </urn:${fmName}>
  </soap-env:Body>
</soap-env:Envelope>`;
  return new Promise((resolve) => {
    const req = https.request(base + '/sap/bc/soap/rfc', {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: 'urn:sap-com:document:sap:rfc:functions',
        'Content-Length': Buffer.byteLength(body),
      },
      rejectUnauthorized: false,
      timeout: 30000,
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', (e) => resolve({ status: 'ERR', body: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT' }); });
    req.write(body);
    req.end();
  });
}

(async () => {
  // READ 动作: 读取 ZZZPROG001 中文文本池
  const r = await soapCall('ZMCP_ADT_TEXTPOOL', {
    IV_ACTION: 'READ',
    IV_PROGRAM: 'ZZZPROG001',
    IV_LANGUAGE: '1',
    IV_TEXTPOOL_JSON: '',
  });
  console.log(`HTTP ${r.status}`);
  console.log(r.body.slice(0, 3000));
})();
