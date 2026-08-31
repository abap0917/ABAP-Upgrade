#!/usr/bin/env node
/**
 * atc-run-csrf3.js — correct ATC run flow with session cookies:
 *   1. POST /atc/worklists?checkVariant=<variant>  → worklist ID
 *   2. POST /atc/runs?worklistId=<worklistId>      → run result ID
 *   3. poll /atc/worklists/<runId> until ready
 * Usage: node atc-run-csrf3.js <objectUrl> <variant> [maxVerdicts]
 */
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

function loadEnv(file) {
  const out = {};
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
    }
  } catch {}
  return out;
}
// 环境路径: 可选第 5 个位置参数 (url, variant, [maxVerdicts], envPath; 默认脚本同目录 .env)
const envPathArg = process.argv[5] || path.join(__dirname, '.env');
const env = loadEnv(envPathArg);
const base = new URL(env.SAP_URL || 'https://180.167.68.213:44304');
const HOST = base.hostname;
const PORT = Number(base.port || 443);
const USER = env.SAP_USERNAME || '123456';
const PASS = env.SAP_PASSWORD || '';
const CLIENT = env.SAP_CLIENT || '100';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
let cookieJar = '';

function call(pathName, method = 'GET', body = null, headers = {}, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const hdrs = { Authorization: AUTH, 'User-Agent': 'atc-csrf3', ...headers };
    if (cookieJar) hdrs.Cookie = cookieJar;
    const req = https.request(
      { host: HOST, port: PORT, path: pathName, method, agent, headers: hdrs, timeout },
      (res) => {
        const setc = res.headers['set-cookie'];
        if (setc) {
          const kept = setc.map((c) => c.split(';')[0]).join('; ');
          cookieJar = cookieJar ? cookieJar + '; ' + kept : kept;
        }
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getCsrf() {
  const r = await call(
    `/sap/bc/adt/atc/worklists?sap-client=${CLIENT}`,
    'HEAD',
    null,
    { Accept: 'text/plain', 'X-CSRF-Token': 'Fetch' },
    30000,
  );
  const t = r.headers['x-csrf-token'];
  console.log('CSRF:', t ? t.slice(0, 12) + '...' : '(none)', '| status', r.status);
  return t;
}

(async () => {
  const objectUrl = process.argv[2];
  const variant = process.argv[3] || 'ZABAP_CLOUD_DEV_CHECK';
  const maxVerdicts = Number(process.argv[4] || 500);
  if (!objectUrl) { console.log('Usage: node atc-run-csrf3.js <objectUrl> [variant] [maxVerdicts]'); process.exit(1); }

  // session warmup
  await call(`/sap/bc/adt/discovery?sap-client=${CLIENT}`, 'GET', null, { Accept: 'application/xml' }, 30000);

  const csrf1 = await getCsrf();

  // 1. create worklist for variant
  const wlResp = await call(
    `/sap/bc/adt/atc/worklists?sap-client=${CLIENT}&checkVariant=${encodeURIComponent(variant)}`,
    'POST',
    null,
    { Accept: 'text/plain', 'X-CSRF-Token': csrf1 },
    120000,
  );
  console.log('POST worklists?checkVariant ->', wlResp.status);
  console.log('worklist body:', wlResp.body.slice(0, 300));
  const worklistId = wlResp.body.trim();
  if (!worklistId || worklistId === '00000000000000000000000000000000') {
    console.log('No valid worklist ID returned.');
    process.exit(2);
  }
  console.log('worklistId:', worklistId);

  // 2. create run using that worklist
  const csrf2 = await getCsrf();
  const runBody =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<atc:run maximumVerdicts="${maxVerdicts}" xmlns:atc="http://www.sap.com/adt/atc">` +
    `<objectSets xmlns:adtcore="http://www.sap.com/adt/core">` +
    `<objectSet kind="inclusive">` +
    `<adtcore:objectReferences>` +
    `<adtcore:objectReference adtcore:uri="${objectUrl}"/>` +
    `</adtcore:objectReferences>` +
    `</objectSet>` +
    `</objectSets>` +
    `</atc:run>`;
  const rr = await call(
    `/sap/bc/adt/atc/runs?sap-client=${CLIENT}&worklistId=${encodeURIComponent(worklistId)}`,
    'POST',
    runBody,
    { Accept: 'application/xml', 'Content-Type': 'application/xml', 'X-CSRF-Token': csrf2 },
    120000,
  );
  console.log('POST runs ->', rr.status);
  console.log(rr.body.slice(0, 1200));
  const idMatch = rr.body.match(/<[a-zA-Z0-9_:]*worklistId[^>]*>([^<]+)<\/[a-zA-Z0-9_:]*worklistId>/);
  const idAttr = rr.body.match(/worklistId="([^"]+)"/);
  const runId = (idMatch && idMatch[1] !== '00000000000000000000000000000000' && idMatch[1]) || (idAttr && idAttr[1]);
  if (!runId) {
    console.log('No valid run worklistId yet — run may still be processing.');
    process.exit(3);
  }
  console.log('run worklistId:', runId);

  // 3. poll worklist
  const wlAccept = 'application/atc.worklist.v1+xml';
  for (let i = 0; i < 15; i++) {
    const wl = await call(
      `/sap/bc/adt/atc/worklists/${encodeURIComponent(runId)}?sap-client=${CLIENT}`,
      'GET',
      null,
      { Accept: wlAccept },
      120000,
    );
    const empty = /worklistId>00000000000000000000000000000000</.test(wl.body);
    if (!empty && wl.status === 200) {
      const outFile = path.join(__dirname, `atc-worklist-${runId}.xml`);
      fs.writeFileSync(outFile, wl.body, 'utf8');
      console.log('worklist saved:', outFile, `(${wl.body.length} bytes)`);
      console.log(wl.body.slice(0, 2500));
      process.exit(0);
    }
    console.log(`poll ${i + 1}: not ready (${wl.status}, ${wl.body.length}B) — waiting 10s...`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  console.log('Timed out. Check ATC results list.');
  process.exit(4);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(5); });
