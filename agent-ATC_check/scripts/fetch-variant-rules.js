#!/usr/bin/env node
/**
 * fetch-variant-rules.js — 拉取/检查 ATC 变体规则到本地项目（新增前置步骤）
 * 用途：在拉取 ATC 结果前，确保变体规则快照已在本地；没有则先拉取。
 *
 * 用法:
 *   node fetch-variant-rules.js <projectDir> [variant] [envPath] [--force]
 *
 * 本地位置: <projectDir>/atc-variant/<variant>/variant-rules.json + variant-rules.md
 * 检查逻辑:
 *   - 快照已存在 → 打印"已存在，跳过"（exit 0），不重复拉取
 *   - 不存在 → 从该变体最新 worklist 派生"生效的检查集"，写入快照（exit 1 表示"本次已拉取"）
 *
 * 快照内容:
 *   - variant / fetchedAt / source
 *   - checks: 从最新 worklist 聚合的检查（checkId/checkTitle/消息/优先级分布/告警行数）
 *   - namingRules: 命名规则（FORM→FRM_、USING→U([VTOS])?_、TYPES→GLOB_TYPE 缺陷）+
 *     实证依据（worklist 消息 + 修复验证 68→4）
 *   - limitation: 系统侧 SATC_AC_* 配置表经 Data Preview / SQL / RFC_READ_TABLE 均不可读，
 *     命名规则来自 worklist 实证与修复验证；若后续可导出变体配置，可覆盖本快照
 */
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv, resolveEnvPath } = require('./shared/mcp');

const projectDir = path.resolve(process.argv[2] || '');
const variant = (process.argv[3] || 'ZABAP_CLOUD_DEV_CHECK').toUpperCase();
const envPath = resolveEnvPath(process.argv, process.argv[4] || '.env');
const force = process.argv.includes('--force');

if (!projectDir) { console.error('用法: node fetch-variant-rules.js <projectDir> [variant] [envPath] [--force]'); process.exit(2); }

const varDir = path.join(projectDir, 'atc-variant', variant);
const jsonFile = path.join(varDir, 'variant-rules.json');
const mdFile = path.join(varDir, 'variant-rules.md');

// 1) 检查本地是否已有
if (!force && fs.existsSync(jsonFile)) {
  const existing = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  console.log(`✓ 变体规则已存在，跳过拉取: ${jsonFile}（fetchedAt=${existing.fetchedAt}）`);
  process.exit(0);
}

// 2) 需要拉取：先从该变体最新 worklist 派生生效检查
const env = loadEnv(envPath);
const base = (env.SAP_URL || '').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from(`${env.SAP_USERNAME}:${env.SAP_PASSWORD}`).toString('base64');
const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

function get(pathName) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + pathName);
    const req = https.request({
      host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET',
      agent, headers: { Authorization: AUTH, 'User-Agent': 'fetch-variant-rules', Accept: 'application/xml' },
      timeout: 120000,
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
const el = (xml, tag) => { const m = xml.match(new RegExp(`<atcresult:${tag}>([^<]*)</atcresult:${tag}>`)); return m ? m[1] : ''; };

async function fetchLatestWorklist() {
  const creator = env.SAP_USERNAME || '';
  const list = await get(`/sap/bc/adt/atc/results?createdBy=${encodeURIComponent(creator)}`);
  if (list.status !== 200) throw new Error(`结果列表拉取失败 HTTP ${list.status}`);
  const entries = [];
  const re = /<atcresult:result>([\s\S]*?)<\/atcresult:result>/g;
  let m;
  while ((m = re.exec(list.body))) {
    const b = m[1];
    entries.push({ displayId: el(b, 'displayId'), variant: el(b, 'checkVariant'), createdAt: el(b, 'createdAt') });
  }
  const mine = entries.filter((e) => e.variant === variant).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (!mine.length) return null;
  const detail = await get(`/sap/bc/adt/atc/results/${mine[0].displayId}`);
  if (detail.status !== 200) throw new Error(`结果明细拉取失败 HTTP ${detail.status}`);
  return detail.body;
}

(async () => {
  let checks = [];
  let worklistSource = '无（历史结果为空，未能派生检查集）';
  try {
    const wl = await fetchLatestWorklist();
    if (wl) {
      const map = {}; // checkId -> {checkId, checkTitle, messages:Set, prios:Set, count}
      for (const fm of wl.matchAll(/<atcfinding:finding\b[^>]*>/g)) {
        const tag = fm[0];
        const g = (n) => (tag.match(new RegExp(`atcfinding:${n}="([^"]*)"`)) || [])[1] || '';
        const id = g('checkId') || '?';
        const c = map[id] || (map[id] = { checkId: id, checkTitle: g('checkTitle'), messages: new Set(), prios: new Set(), count: 0 });
        c.messages.add(g('messageTitle'));
        c.prios.add(g('priority'));
        c.count++;
      }
      checks = Object.values(map).map((c) => ({
        checkId: c.checkId,
        checkTitle: c.checkTitle,
        findings: c.count,
        priorities: [...c.prios].sort().map((p) => `P${p}`),
        messages: [...c.messages].slice(0, 10),
      }));
      worklistSource = '最新 worklist（派生生效检查集）';
    }
  } catch (e) {
    console.warn(`!! 派生检查集失败: ${e.message}（快照仍写入，checks 为空）`);
  }

  // 3) 命名规则（worklist 实证 + 修复验证，非系统配置直接读取）
  const namingRules = {
    FORM: {
      requiredPrefix: 'FRM_',
      pattern: '^FRM_',
      evidence: 'worklist "FORM 的无效名称" 消息；按 FRM_ 修复后告警归零',
    },
    USING: {
      requiredPrefix: 'U([VTOS])?_',
      pattern: '^U([VTOS])?_',
      evidence: 'worklist "USING 参数 (FORM) 的无效名称" 消息；pv_→uv_、rt_→ut_ 修复后告警归零',
      mapping: { 'pv_': 'uv_', 'pt_': 'ut_', 'po_': 'uo_', 'ps_': 'us_', 'rt_': 'ut_', 'default': 'uo_' },
    },
    TYPES: {
      note: 'GLOB_TYPE 变体正则缺陷：任何 TYPES 前缀（TY_/GTY_/LTY_/TTY_）都触发，代码无法满足，需改变体或豁免',
    },
  };

  const snapshot = {
    variant,
    fetchedAt: new Date().toISOString(),
    source: worklistSource,
    checks,
    namingRules,
    limitation: '系统侧 SATC_AC_* 配置表经 Data Preview / SQL / RFC_READ_TABLE 均不可读（本环境）；命名规则来自 worklist 实证与修复验证。若后续可导出变体配置（SATC 管理界面），可覆盖本快照。',
  };

  fs.mkdirSync(varDir, { recursive: true });
  fs.writeFileSync(jsonFile, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  const md = [];
  md.push(`# ATC 变体规则快照 — ${variant}`);
  md.push('');
  md.push(`- fetchedAt: ${snapshot.fetchedAt}`);
  md.push(`- 来源: ${snapshot.source}`);
  md.push('');
  md.push('## 生效检查（从最新 worklist 派生）');
  md.push('');
  md.push('| 检查 | 告警数 | 优先级 | 消息示例 |');
  md.push('|---|---|---|---|');
  for (const c of checks) md.push(`| ${c.checkTitle} | ${c.findings} | ${c.priorities.join('/')} | ${(c.messages[0] || '').slice(0, 60)} |`);
  if (!checks.length) md.push('（无）');
  md.push('');
  md.push('## 命名规则（实证）');
  md.push('');
  md.push('| 对象 | 要求 | 依据 |');
  md.push('|---|---|---|');
  md.push(`| FORM | ${namingRules.FORM.requiredPrefix} | ${namingRules.FORM.evidence} |`);
  md.push(`| USING 参数 | ${namingRules.USING.requiredPrefix} | ${namingRules.USING.evidence}（映射: ${JSON.stringify(namingRules.USING.mapping)}） |`);
  md.push(`| TYPES | — | ${namingRules.TYPES.note} |`);
  md.push('');
  md.push(`> 限制: ${snapshot.limitation}`);
  fs.writeFileSync(mdFile, md.join('\n') + '\n', 'utf8');

  console.log(`已拉取变体规则到本地: ${jsonFile}`);
  console.log(`  生效检查: ${checks.length} 个（来自最新 worklist）`);
  console.log(`  可读文件: ${mdFile}`);
  process.exit(1); // exit 1 表示"本次执行了拉取"（供调用方区分：0=已存在）
})().catch((e) => { console.error('拉取失败:', e.message); process.exit(2); });
