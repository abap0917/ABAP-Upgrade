#!/usr/bin/env node
/* rfc-table-read.js — 经 SOAP RFC 调用 RFC_READ_TABLE 读任意表（探测用）
 * 用法: node rfc-table-read.js <table> <fields逗号分隔> [where] [rowcount] [envPath]
 * 说明: 支持表参数（FIELDS/DATA 用 <item> 结构），供读取 ATC 配置表等。
 */
const https = require('node:https');
const fs = require('node:fs');
const { loadEnv, resolveEnvPath } = require('../shared/mcp');

const table = (process.argv[2] || '').toUpperCase();
const fields = (process.argv[3] || '*').split(',').map((s) => s.trim()).filter(Boolean);
const where = process.argv[4] || '';
const rowcount = process.argv[5] || '50';
const env = loadEnv(resolveEnvPath(process.argv, process.argv[6] || '.env'));
if (!table) { console.error('用法: node rfc-table-read.js <table> <fields> [where] [rowcount] [envPath]'); process.exit(2); }

const base = (env.SAP_URL || '').replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${env.SAP_USERNAME}:${env.SAP_PASSWORD}`).toString('base64');

function escapeXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }

function soapCall(fmName, params, tableParams, useItemWrapper) {
  // params: 简单参数; tableParams: { FIELDS: [{FIELDNAME}], ... }
  let paramXml = Object.entries(params).map(([k, v]) => `      <${k}>${escapeXml(v)}</${k}>`).join('\n');
  for (const [tpName, items] of Object.entries(tableParams || {})) {
    let itemsXml;
    if (useItemWrapper) {
      itemsXml = items.map((it) => '        <item>' + Object.entries(it).map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`).join('') + '</item>').join('\n');
    } else {
      // SAP SOAP RFC 常规: 表参数 = 重复的同名元素，每行含行结构子元素
      itemsXml = items.map((it) => '        ' + Object.entries(it).map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`).join('')).join('\n');
    }
    paramXml += `\n      <${tpName}>\n${itemsXml}\n      </${tpName}>`;
  }
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:sap-com:document:sap:rfc:functions">
  <soap-env:Header/>
  <soap-env:Body>
    <urn:${fmName}>
${paramXml}
    </urn:${fmName}>
  </soap-env:Body>
</soap-env:Envelope>`;
  return new Promise((resolve, reject) => {
    const req = https.request(base + '/sap/bc/soap/rfc', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'urn:sap-com:document:sap:rfc:functions', 'Content-Length': Buffer.byteLength(body) },
      rejectUnauthorized: false, timeout: 60000,
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(body);
    req.end();
  });
}

(async () => {
  const params = { QUERY_TABLE: table, DELIMITER: '|', ROWCOUNT: rowcount };
  const tableParams = { FIELDS: fields.map((f) => ({ FIELDNAME: f })) };
  // OPTIONS 也是表参数(RFC_DB_OPT{TEXT})，不能作为简单参数传
  if (where) tableParams.OPTIONS = [{ TEXT: where }];
  const r = await soapCall('RFC_READ_TABLE', params, tableParams, process.argv.includes('--item'));
  console.log(`HTTP ${r.status}`);
  // 提取 DATA 行
  const dataMatches = [...r.body.matchAll(/<DATA>\s*<item>\s*<WA>([\s\S]*?)<\/WA>\s*<\/item>\s*<\/DATA>/g)];
  if (dataMatches.length) {
    console.log(`行数: ${dataMatches.length}`);
    for (const m of dataMatches.slice(0, rowcount)) {
      console.log('  ' + m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    }
  } else {
    console.log(r.body.slice(0, 1200));
  }
})();
