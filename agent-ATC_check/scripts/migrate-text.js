#!/usr/bin/env node
/* migrate-text.js — 把 ZZZPROG001 中文 UI 常量迁移为文本元素 (TEXT-001..)
 * 1. 迁移集: 所有含中文的常量 + 2 个 SLIN UI 文本常量 (CUSTOM_BUTTONS / LT_GT_CUC_DN)
 * 2. 用法替换: 大小写不敏感 \bcns_X\b -> TEXT-xxx (声明行除外)
 * 3. 移除已迁移常量的声明行, 修复 CONSTANTS 块逗号/句号
 * 4. 重写 SALV 弹窗段: get_column('VBELN') -> cns_VBELN; set_*_text('交货单') -> TEXT-xxx
 * 5. 输出: 新源码 / 映射 / 文本池条目 / unified diff
 * 用法: node migrate-text.js zzzprog001-active-lf.abap
 */
const fs = require('node:fs');

const srcFile = process.argv[2];
const lines = fs.readFileSync(srcFile, 'utf8').split(/\r?\n/);
const cjk = /[\u4e00-\u9fff]/;

// 1) 常量定义
const consts = []; // {name, lower, line, value, hasCjk, migrate}
lines.forEach((ln, i) => {
  const m = ln.match(/^\s*(cns_\w+)\s+TYPE\s+\S+\s+VALUE\s+'([^']*)'[,.]?\s*$/i);
  if (m) {
    const name = m[1];
    const lower = name.toLowerCase();
    const value = m[2];
    const slinUi = /^(cns_zzzprog001_custom_buttons|cns_lt_gt_cuc_dn)$/i.test(name);
    consts.push({ name, lower, line: i + 1, value, hasCjk: cjk.test(value), migrate: cjk.test(value) || slinUi, isSlin: slinUi });
  }
});
const migrated = consts.filter((c) => c.migrate).sort((a, b) => a.line - b.line);

// 2) TEXT 映射 (声明顺序 TEXT-001..)
const keyOf = {}; // lower -> TEXT key
migrated.forEach((c, idx) => {
  const key = String(idx + 1).padStart(3, '0');
  c.key = `TEXT-${key}`;
  keyOf[c.lower] = c.key;
});
console.log(`常量总数 ${consts.length}, 迁移 ${migrated.length} 个 -> TEXT-001..TEXT-${String(migrated.length).padStart(3, '0')}`);

// 3) 生成新源码
const out = [];
const declLine = new Set(migrated.map((c) => c.line));
// 排序: 名称长->短, 避免前缀误替换 (实际 \b 已防, 双保险)
const sortedMigrated = [...migrated].sort((a, b) => b.name.length - a.name.length);

let i = 0;
while (i < lines.length) {
  const lineNo = i + 1;
  const ln = lines[i];

  // CONSTANTS 块处理
  if (/^\s*CONSTANTS:\s*$/i.test(ln)) {
    const block = [{ lineNo, text: ln }];
    let j = i + 1;
    while (j < lines.length && !/\.\s*$/.test(lines[j])) { block.push({ lineNo: j + 1, text: lines[j] }); j++; }
    if (j < lines.length) block.push({ lineNo: j + 1, text: lines[j] }); // 最后一行以 . 结尾
    // 保留未迁移的声明行
    const kept = block.filter((b) => !declLine.has(b.lineNo));
    if (kept.length > 1) {
      out.push(kept[0].text); // CONSTANTS:
      for (let k = 1; k < kept.length; k++) {
        const last = k === kept.length - 1;
        let t = kept[k].text;
        // 去掉行尾的 , 或 . 再按位置补
        t = t.replace(/[.,]\s*$/, '');
        out.push(last ? `${t}.` : `${t},`);
      }
    } else if (kept.length === 1 && !/^\s*CONSTANTS:\s*$/i.test(kept[0].text)) {
      out.push(kept[0].text); // 仅剩非头行 (不应发生, 保守保留)
    }
    // kept.length === 0 或仅剩 CONSTANTS: 头 -> 整块删除
    i = j + 1;
    continue;
  }

  // 声明行: 已迁移 -> 删除
  if (declLine.has(lineNo)) { i++; continue; }

  // 用法替换 (大小写不敏感)
  let t = ln;
  for (const c of sortedMigrated) {
    t = t.replace(new RegExp(`\\b${c.name}\\b`, 'gi'), c.key);
  }
  out.push(t);
  i++;
}

let newSrc = out.join('\n');

// 4) SALV 段重写 (精确替换)
const salvRepl = [
  ["lo_cols->get_column( 'VBELN' )", 'lo_cols->get_column( cns_VBELN )'],
  ["lo_cols->get_column( 'POSNR' )", 'lo_cols->get_column( cns_POSNR )'],
  ["lo_cols->get_column( 'SERNR' )", 'lo_cols->get_column( cns_SERNR )'],
];
// 3 个列文本映射 (死常量 cns_VAL_6/3/4 -> 交货单/交货项目/序列号)
const salvTexts = [
  { lit: '交货单', const: 'cns_VAL_6' },
  { lit: '交货项目', const: 'cns_VAL_3' },
  { lit: '序列号', const: 'cns_VAL_4' },
];
for (const s of salvTexts) {
  const key = keyOf[s.const.toLowerCase()];
  if (!key) { console.error(`!! 缺少映射: ${s.const}`); process.exit(1); }
  for (const m of ['long_text', 'medium_text', 'short_text']) {
    salvRepl.push([`set_${m}( '${s.lit}' )`, `set_${m}( ${key} )`]);
  }
}
let replaced = 0;
for (const [from, to] of salvRepl) {
  const before = newSrc;
  newSrc = newSrc.split(from).join(to);
  if (newSrc !== before) replaced++;
  else console.warn(`!! SALV 替换未命中: ${from}`);
}
console.log(`SALV 段替换 ${replaced}/${salvRepl.length} 处`);

// 4b) SALV get_column: 用 char30 局部变量 (lvc_fname=char30 按引用; string 常量不兼容, 而列名常量还被 frm_add_field 用作 string 形参, 不能改类型)
newSrc = newSrc.replace(
  /      lo_col = lo_cols->get_column\( cns_VBELN \)./,
  "      lv_colname = cns_VBELN.\n      lo_col = lo_cols->get_column( lv_colname )."
);
newSrc = newSrc.replace(
  /      lo_col = lo_cols->get_column\( cns_POSNR \)./,
  "      lv_colname = cns_POSNR.\n      lo_col = lo_cols->get_column( lv_colname )."
);
newSrc = newSrc.replace(
  /      lo_col = lo_cols->get_column\( cns_SERNR \)./,
  "      lv_colname = cns_SERNR.\n      lo_col = lo_cols->get_column( lv_colname )."
);
// 声明 lv_colname (frm_show_serial_popup 的 DATA 块, lo_col 行改为逗号续行)
newSrc = newSrc.replace(
  '        lo_col  TYPE REF TO cl_salv_column.',
  '        lo_col  TYPE REF TO cl_salv_column,\n        lv_colname TYPE c LENGTH 30.'
);

// 校验: 迁移后不应再出现已迁移常量名 (除注释)
const leftover = [];
for (const c of migrated) {
  const re = new RegExp(`\\b${c.name}\\b`, 'gi');
  newSrc.split('\n').forEach((ln2, k) => {
    if (re.test(ln2) && !/^\s*\*/.test(ln2)) leftover.push(`L${k + 1}: ${ln2.trim()}`);
  });
}
if (leftover.length) {
  console.error('!! 仍有已迁移常量引用:');
  leftover.slice(0, 15).forEach((l) => console.error('   ' + l));
  process.exit(1);
}

// 5) 文本池条目
const poolEntries = migrated.map((c) => ({ type: 'I', key: c.key.slice(5), text: c.value }));

// 6) 输出
const base = srcFile.replace(/\.abap$/, '');
const newFile = `${base}-text.abap`;
fs.writeFileSync(newFile, newSrc + '\n', 'utf8');
fs.writeFileSync(`${base}-text-map.json`, JSON.stringify(migrated.map((c) => ({ const: c.name, line: c.line, key: c.key, value: c.value, isSlin: c.isSlin })), null, 2), 'utf8');
fs.writeFileSync(`${base}-text-pool.json`, JSON.stringify(poolEntries, null, 2), 'utf8');

// 7) unified diff
const oldLines = lines;
const newLines = newSrc.split('\n');
const diff = [];
let oi = 0, ni = 0;
while (oi < oldLines.length || ni < newLines.length) {
  if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) { oi++; ni++; continue; }
  // 找最小匹配窗口
  let matchO = -1, matchN = -1;
  for (let w = 1; w <= 20 && matchO < 0; w++) {
    for (let o = oi; o <= Math.min(oi + w, oldLines.length - 1); o++) {
      for (let n = ni; n <= Math.min(ni + w, newLines.length - 1); n++) {
        if (oldLines[o] === newLines[n]) { matchO = o; matchN = n; break; }
      }
      if (matchO >= 0) break;
    }
  }
  if (matchO < 0) { matchO = oldLines.length; matchN = newLines.length; }
  diff.push(`@@ -${oi + 1},${matchO - oi} +${ni + 1},${matchN - ni} @@`);
  for (let o = oi; o < matchO; o++) diff.push(`-${oldLines[o]}`);
  for (let n = ni; n < matchN; n++) diff.push(`+${newLines[n]}`);
  oi = matchO; ni = matchN;
}
const diffFile = `${base}-text.diff`;
fs.writeFileSync(diffFile, diff.join('\n'), 'utf8');

console.log(`新源码: ${newFile} (${newLines.length} 行)`);
console.log(`映射:   ${base}-text-map.json (${migrated.length} 条)`);
console.log(`文本池: ${base}-text-pool.json (${poolEntries.length} 条)`);
console.log(`diff:   ${diffFile} (${diff.length} 行)`);
