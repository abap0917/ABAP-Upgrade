#!/usr/bin/env node
/* analyze-consts2.js — 大小写不敏感的常量用途分析（在活动源码上运行）
 * 分类:
 *   MESSAGE_DIRECT : MESSAGE CNS_X ...                  -> 可迁移
 *   MSG_ASSIGN     : lv_msg = CNS_X                     -> 可迁移
 *   COL_HEADER     : lv_coltext = CNS_X (SALV scrtext)  -> 可迁移
 *   MENU_TEXT      : ls_fun / ls_toolbar 文本赋值     -> 可迁移
 *   FIELD_TEXT     : ls_field-fieldtext = CNS_X         -> 可迁移
 *   POPUP_TITLE    : popup_title = CNS_X                -> 可迁移
 *   OTHER_ASSIGN   : 其他赋值                           -> 审查
 *   PERFORM_USING  : PERFORM ... USING ... CNS_X        -> 保留(by-ref string 形参)
 *   CONCATENATE    : CONCATENATE 块内(含跨行)            -> 保留
 *   COL_NAME       : lv_colname = CNS_X                 -> 保留(技术)
 *   OTHER          : 其他                                -> 审查
 */
const fs = require('node:fs');

const src = fs.readFileSync(process.argv[2], 'utf8');
const lines = src.split(/\r?\n/);
const outIdx = process.argv.findIndex((a) => a === '--json');
const outFile = outIdx >= 0 ? process.argv[outIdx + 1] : null;
const cjk = /[\u4e00-\u9fff]/;

// 1) 提取常量定义（大小写不敏感匹配声明行，保留原始大小写）
const constDefs = {}; // lowerName -> {name, line, value, hasCjk}
lines.forEach((ln, i) => {
  const m = ln.match(/^\s*(cns_\w+)\s+TYPE\s+\S+\s+VALUE\s+'([^']*)',?\s*$/i);
  if (m) {
    const lower = m[1].toLowerCase();
    constDefs[lower] = { name: m[1], line: i + 1, value: m[2], hasCjk: cjk.test(m[2]) };
  }
});

// 2) 找出所有 CONCATENATE 语句块（可跨行，直到含 INTO 并以 . 结尾的行）
const concatBlocks = [];
for (let i = 0; i < lines.length; i++) {
  if (/^\s*CONCATENATE\b/i.test(lines[i])) {
    let j = i;
    while (j < lines.length) {
      if (/\.\s*$/.test(lines[j]) && /INTO\b/i.test(lines[j])) break;
      j++;
    }
    concatBlocks.push({ start: i + 1, end: j + 1 });
    i = j;
  }
}

// 3) 统计用法（大小写不敏感）
const usage = {}; // lowerName -> [{line, kind, text}]
Object.keys(constDefs).forEach((n) => { usage[n] = []; });

const classify = (lnText, lowerName, lineNo) => {
  const t = lnText.trim();
  if (new RegExp(`^${lowerName}\\s+TYPE`, 'i').test(t) || /^CONSTANTS/i.test(t)) return null;
  // 定义行或注释行
  if (/^\*/.test(t)) return null;
  // CONCATENATE 块内
  if (concatBlocks.some((b) => lineNo >= b.start && lineNo <= b.end)) return 'CONCATENATE';
  if (new RegExp(`\\bMESSAGE\\s+${lowerName}\\b`, 'i').test(t)) return 'MESSAGE_DIRECT';
  if (new RegExp(`\\blv_msg\\s*=\\s*${lowerName}\\b`, 'i').test(t)) return 'MSG_ASSIGN';
  if (new RegExp(`\\blv_coltext\\s*=\\s*${lowerName}\\b`, 'i').test(t)) return 'COL_HEADER';
  if (new RegExp(`\\blv_colname\\s*=\\s*${lowerName}\\b`, 'i').test(t)) return 'COL_NAME';
  if (new RegExp(`\\b(ls_fun|ls_toolbar)-\\w+\\s*=\\s*${lowerName}\\b`, 'i').test(t)) return 'MENU_TEXT';
  if (new RegExp(`\\bls_field-fieldtext\\s*=\\s*${lowerName}\\b`, 'i').test(t)) return 'FIELD_TEXT';
  if (new RegExp(`\\bpopup_title\\s*=\\s*${lowerName}\\b`, 'i').test(t)) return 'POPUP_TITLE';
  if (new RegExp(`\\bPERFORM\\b[^.]*\\b${lowerName}\\b`, 'i').test(t)) return 'PERFORM_USING';
  if (new RegExp(`=\\s*${lowerName}\\s*\\.?\\s*$`, 'i').test(t)) return 'OTHER_ASSIGN';
  if (new RegExp(`\\b${lowerName}\\b`, 'i').test(t)) return 'OTHER';
  return null;
};

lines.forEach((ln, i) => {
  for (const lower of Object.keys(constDefs)) {
    const re = new RegExp(`\\b${lower}\\b`, 'i');
    if (re.test(ln)) {
      const kind = classify(ln, lower, i + 1);
      if (kind) usage[lower].push({ line: i + 1, kind, text: ln.trim().slice(0, 100) });
    }
  }
});

// 4) 决策
const MIGRATE_KINDS = new Set(['MESSAGE_DIRECT', 'MSG_ASSIGN', 'COL_HEADER', 'MENU_TEXT', 'FIELD_TEXT', 'POPUP_TITLE']);
const result = { total: Object.keys(constDefs).length, cjk: 0, migrate: [], keep: [], review: [] };
for (const lower of Object.keys(constDefs).sort((a, b) => constDefs[a].line - constDefs[b].line)) {
  const d = constDefs[lower];
  if (d.hasCjk) result.cjk++;
  const kinds = new Set(usage[lower].map((u) => u.kind));
  const rec = { name: d.name, line: d.line, value: d.value, hasCjk: d.hasCjk, kinds: [...kinds], uses: usage[lower].length, usage: usage[lower] };
  if (!d.hasCjk) { rec.decision = 'keep-tech'; result.keep.push(rec); }
  else if (kinds.has('CONCATENATE') || kinds.has('PERFORM_USING')) { rec.decision = 'keep'; result.keep.push(rec); }
  else if (kinds.size === 0) { rec.decision = 'unused'; result.review.push(rec); }
  else if ([...kinds].every((k) => MIGRATE_KINDS.has(k))) { rec.decision = 'migrate'; result.migrate.push(rec); }
  else { rec.decision = 'review'; result.review.push(rec); }
}

console.log(`总常量 ${result.total}, 中文常量 ${result.cjk}`);
console.log(`-> 迁移文本元素: ${result.migrate.length}`);
console.log(`-> 保留常量: ${result.keep.length} (技术 ${result.keep.filter(r=>!r.hasCjk).length} / 拼接或PERFORM传参 ${result.keep.filter(r=>r.hasCjk).length})`);
console.log(`-> 审查: ${result.review.length}`);
console.log('\n--- 迁移清单 ---');
result.migrate.forEach((r) => console.log(`  ${r.name.padEnd(40)} L${String(r.line).padEnd(4)} [${r.kinds.join(',')}] '${r.value}'`));
console.log('\n--- 审查(中文) ---');
result.review.filter((r) => r.hasCjk).forEach((r) => {
  console.log(`  ${r.name.padEnd(40)} L${String(r.line).padEnd(4)} [${r.kinds.join(',')}] '${r.value}'`);
  r.usage.slice(0, 4).forEach((u) => console.log(`        L${u.line} ${u.kind}: ${u.text}`));
});
console.log('\n--- 保留(中文: 拼接/PERFORM) ---');
result.keep.filter((r) => r.hasCjk).forEach((r) => console.log(`  ${r.name.padEnd(40)} L${String(r.line).padEnd(4)} [${r.kinds.join(',')}] '${r.value}'`));

if (outFile) fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
