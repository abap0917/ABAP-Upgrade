#!/usr/bin/env node
/**
 * gen-patch.js — 修复补丁生成器（候选补丁，AI 审查确认后部署）
 * 目标：把"常见修复模式"脚本化生成候选源码，AI 只做审查（省代码生成 token）
 *
 * 用法:
 *   node gen-patch.js <source.abap> <worklistXml> <outPatched.abap> [--select=检查1,检查2] [--changes=<outChanges.md>]
 *
 * 自动修复器（仅当对应检查被选中且有告警时启用）:
 *   A 命名-FORM   : FORM 名 → FRM_ 前缀（含 PERFORM 调用点）
 *   B 命名-USING  : USING 参数 → U([VTOS])?_ 前缀（pv_→uv_、rt_→ut_、po_→uo_、ps_→us_，其余默认 uo_；
 *                   仅重命名独立标识符，保护组件访问 ls_x-field 与链式调用）
 *   C SELECT/ORDER: SELECT SINGLE ... ORDER BY PRIMARY KEY → SELECT ... UP TO 1 ROWS ... ENDSELECT.
 *   硬编码 / 文本元素: 不自动改（提示用 hardcode-migrate6.js / migrate-text.js）
 *
 * 输出: 候选源码 + 变更清单（每行变更注明修复器/行号/前后），AI 逐条审查后再部署。
 */
const fs = require('node:fs');
const path = require('node:path');

const sourceFile = path.resolve(process.argv[2] || '');
const worklistXml = path.resolve(process.argv[3] || '');
const outPatched = path.resolve(process.argv[4] || '');
const selectFlag = process.argv.find((a) => a.startsWith('--select='));
const selected = selectFlag ? selectFlag.slice('--select='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;
const changesFlag = process.argv.find((a) => a.startsWith('--changes='));
const outChanges = changesFlag ? path.resolve(changesFlag.slice('--changes='.length)) : outPatched.replace(/\.abap$/, '-patch-changes.md');
// 命名规则来源: --rules=<variant-rules.json>（本地拉取的变体规则快照）> 内置默认
const rulesFlag = process.argv.find((a) => a.startsWith('--rules='));
let RULES = {
  formPrefix: 'FRM_',
  usingOkPattern: /^u[vtos]_/i,
  usingMapping: { pv_: 'uv_', pt_: 'ut_', po_: 'uo_', ps_: 'us_', rt_: 'ut_', default: 'uo_' },
};
if (rulesFlag) {
  const rulesPath = path.resolve(rulesFlag.slice('--rules='.length));
  try {
    const snap = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    const nr = snap.namingRules || {};
    if (nr.FORM?.requiredPrefix) RULES.formPrefix = nr.FORM.requiredPrefix;
    if (nr.USING?.pattern) RULES.usingOkPattern = new RegExp(nr.USING.pattern, 'i');
    if (nr.USING?.mapping) RULES.usingMapping = { ...RULES.usingMapping, ...nr.USING.mapping };
    console.log(`命名规则来源: ${rulesPath}（变体 ${snap.variant || '?'}）`);
  } catch (e) {
    console.warn(`!! 读取规则文件失败，使用内置默认: ${e.message}`);
  }
}

if (!sourceFile || !worklistXml || !outPatched) { console.error('用法: node gen-patch.js <source.abap> <worklistXml> <outPatched.abap> [--select=] [--changes=]'); process.exit(2); }

// ---------- worklist: 被选中且有告警的检查 ----------
function parseChecks(xml) {
  const checks = new Set();
  for (const fm of xml.matchAll(/<atcfinding:finding\b[^>]*>/g)) {
    const m = fm[0].match(/atcfinding:checkTitle="([^"]*)"/);
    if (m) checks.add(m[1]);
  }
  return checks;
}
const xml = fs.readFileSync(worklistXml, 'utf8');
const allChecks = parseChecks(xml);
const active = selected
  ? selected.filter((s) => [...allChecks].some((c) => c.includes(s) || s.includes(c)))
  : [...allChecks];
const hasCheck = (sub) => active.some((s) => s.includes(sub) || sub.includes(s));

// ---------- 源码行处理 ----------
let lines = fs.readFileSync(sourceFile, 'utf8').replace(/\r\n/g, '\n').split('\n');
const changes = []; // {fixer, line, before, after, note}

// 独立标识符正则（保护组件访问 ls_x-field / 链式 .field）
const standalone = (name) => new RegExp(`(?<![\\-\\w.])${name}\\b`, 'gi');

// ---------- 修复器 A: FORM 名 → 前缀 ----------
if (hasCheck('程序的扩展命名规则')) {
  const formNames = new Set();
  lines.forEach((ln, i) => {
    const m = ln.match(/^\s*FORM\s+(\w+)\b/);
    if (m) formNames.add(m[1]);
  });
  for (const name of [...formNames]) {
    if (new RegExp('^' + RULES.formPrefix, 'i').test(name)) continue;
    const newName = RULES.formPrefix + name;
    if (formNames.has(newName)) { changes.push({ fixer: 'A', line: 0, before: name, after: newName, note: '跳过: 目标名已存在' }); continue; }
    // 声明
    for (let i = 0; i < lines.length; i++) {
      const before = lines[i];
      if (new RegExp(`^\\s*FORM\\s+${name}\\b`, 'i').test(before)) {
        lines[i] = before.replace(new RegExp(`^(\\s*FORM\\s+)${name}\\b`, 'i'), `$1${newName}`);
        changes.push({ fixer: 'A-FORM', line: i + 1, before: before.trim(), after: lines[i].trim() });
      }
      // 调用点
      else if (new RegExp(`\\bPERFORM\\s+${name}\\b`, 'i').test(before)) {
        lines[i] = before.replace(new RegExp(`(\\bPERFORM\\s+)${name}\\b`, 'i'), `$1${newName}`);
        changes.push({ fixer: 'A-PERFORM', line: i + 1, before: before.trim(), after: lines[i].trim() });
      }
    }
  }
}

// ---------- 修复器 B: USING 参数前缀（仅 USING 段，不含 CHANGING/局部变量） ----------
function prefixFor(param) {
  if (RULES.usingOkPattern.test(param)) return null; // 已合规
  const mapping = RULES.usingMapping;
  const m = param.match(/^[pr]([vtos])_/i);  // pv_/pt_/po_/ps_ 与 r*_ → u + 同类
  if (m) return 'u' + m[1].toLowerCase() + '_';
  return mapping.default || 'uo_'; // 兜底
}
if (hasCheck('程序的扩展命名规则')) {
  let i = 0;
  while (i < lines.length) {
    const fm = lines[i].match(/^\s*FORM\s+(\w+)\b/);
    if (fm) {
      // 1) 签名块: FORM 行到第一个以 . 结尾的行（含）
      const block = [];
      let j = i;
      while (j < lines.length) { block.push(j); if (/\.\s*$/.test(lines[j])) break; j++; }
      const sigText = block.map((k) => lines[k]).join(' ');
      // 2) 定位 USING 段（USING 之后、CHANGING 之前）
      const uStart = sigText.search(/\bUSING\b/i);
      let uEnd = sigText.length;
      const cIdx = sigText.search(/\bCHANGING\b/i);
      if (cIdx >= 0 && cIdx > uStart) uEnd = cIdx;
      if (uStart >= 0) {
        const usingSeg = sigText.slice(uStart, uEnd);
        // 3) USING 段内参数名（TYPE 前一个词）
        const params = new Set();
        for (const pm of usingSeg.matchAll(/\b(\w+)\s+TYPE\b/gi)) params.add(pm[1]);
        // 4) 逐参数重命名（声明 + 体内独立引用，到 ENDFORM）
        for (const param of params) {
          const prefix = prefixFor(param);
          if (!prefix) continue;
          const core = /^[pr][vtos]_/i.test(param) ? param.replace(/^[pr][vtos]_/i, '') : param;
          const finalName = prefix + core;
          if (finalName.toLowerCase() === param.toLowerCase()) continue;
          // 声明: 签名行里 `<param> TYPE`
          for (const k of block) {
            const before = lines[k];
            if (new RegExp(`\\b${param}\\s+TYPE\\b`, 'i').test(before)) {
              lines[k] = before.replace(new RegExp(`\\b${param}(\\s+TYPE)\\b`, 'i'), finalName + '$1');
              changes.push({ fixer: 'B-DECL', line: k + 1, before: before.trim(), after: lines[k].trim() });
            }
          }
          // 使用: FORM 行后到 ENDFORM 的独立引用
          for (let b = i + 1; b < lines.length; b++) {
            if (/^\s*ENDFORM\./.test(lines[b])) break;
            const before = lines[b];
            if (standalone(param).test(before)) {
              lines[b] = before.replace(standalone(param), finalName);
              changes.push({ fixer: 'B-USE', line: b + 1, before: before.trim(), after: lines[b].trim() });
            }
          }
        }
      }
      i = j + 1;
      continue;
    }
    i++;
  }
}

// ---------- 修复器 C: SELECT SINGLE → SELECT ... UP TO 1 ROWS ... ENDSELECT ----------
// 覆盖两种形态: ①含 ORDER BY PRIMARY KEY(EHP4 语法错) ②无 ORDER BY(AMB_SINGLE 可能不唯一)
// 安全保护: 语句结束行若含"同行后续代码"(`. 后还有代码)则跳过并提示人工。
if (hasCheck('ORDER BY') || hasCheck('SELECT')) {
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*SELECT\s+SINGLE/i.test(lines[i])) {
      // 收集语句（到以 . 结尾的行）
      let stmt = lines[i];
      let j = i;
      while (!/\.\s*$/.test(stmt) && j + 1 < lines.length) { j++; stmt += '\n' + lines[j]; }
      const lastLine = stmt.split('\n').pop();
      if (/\.\s+\S/.test(lastLine)) {
        changes.push({ fixer: 'C-SKIP', line: i + 1, before: lastLine.trim(), after: '', note: '跳过: 语句与后续代码同行，需人工改写' });
        i = j;
        continue;
      }
      const cleaned = stmt.replace(/SELECT\s+SINGLE/i, 'SELECT').trimEnd();
      let newStmt;
      if (/ORDER\s+BY\s+PRIMARY\s+KEY/i.test(cleaned)) {
        newStmt = cleaned.replace(/(ORDER\s+BY\s+PRIMARY\s+KEY)/i, 'UP TO 1 ROWS $1');
      } else {
        newStmt = cleaned.replace(/\.\s*$/, ' UP TO 1 ROWS.');
      }
      newStmt = newStmt.trimEnd() + ' ENDSELECT.';
      changes.push({ fixer: 'C', line: i + 1, before: stmt.trim().replace(/\s+/g, ' ').slice(0, 90), after: newStmt.replace(/\s+/g, ' ').slice(0, 90) });
      const stmtLines = stmt.split('\n');
      const newLines = newStmt.split('\n');
      lines.splice(i, stmtLines.length, ...newLines);
      i = i + newLines.length - 1;
    }
  }
}

// ---------- 输出 ----------
const patchedSrc = lines.join('\n');
fs.writeFileSync(outPatched, patchedSrc, 'utf8');

const md = [];
md.push(`# 修复补丁（候选，需 AI 审查）`);
md.push('');
md.push(`- 源文件: ${path.basename(sourceFile)}（${fs.readFileSync(sourceFile, 'utf8').split('\n').length} 行）`);
md.push(`- 候选文件: ${path.basename(outPatched)}（${lines.length} 行）`);
md.push(`- 选中检查: ${active.join(', ') || '（全部）'}`);
md.push(`- 自动变更: ${changes.length} 处（生成时间 ${new Date().toISOString()}）`);
md.push('');
if (changes.length) {
  md.push('## 变更清单（逐条审查）');
  md.push('');
  md.push('| 修复器 | 行号 | Before | After |');
  md.push('|---|---|---|---|');
  for (const c of changes) {
    md.push(`| ${c.fixer} | ${c.line} | \`${String(c.before).slice(0, 70)}\` | \`${String(c.after).slice(0, 70)}\`${c.note ? '（' + c.note + '）' : ''} |`);
  }
}
md.push('');
md.push('## 未自动处理（需人工/AI 编写）');
md.push('');
if (hasCheck('Check Program hardcode')) md.push('- **硬编码**：用 `hardcode-migrate6.js` 迁移常量，或 `migrate-text.js` 迁移文本元素（EHP4 类型兼容见 abap-atc-fix/abap-text-element）。');
if (hasCheck('程序的扩展命名规则')) md.push('- **TYPES/GLOB_TYPE**：变体正则缺陷，不可代码修复（gen-unfixed 记录）。');
if (hasCheck('扩展程序检查 (SLIN)')) md.push('- **SLIN**：按消息类型判断（GUI 状态/EXCEPTION/替换对象→跳过；缺少文本元素→migrate-text）。');
md.push('- 其他：SELECT*/FAE 按功能正确性判断（abap-atc-decision）。');
md.push('');
md.push('## 部署前检查');
md.push('- [ ] 逐一核对变更清单中的 Before/After 无语义误伤（尤其 B-USE 的组件访问保护）');
md.push('- [ ] `node scripts\\make-diff.js <对象>-before.abap <对象>-patched.abap <对象>.diff` 后展示给用户');
md.push('- [ ] EHP4 编译兼容（string 常量/精确长度/文本符号位置）');
fs.writeFileSync(outChanges, md.join('\n'), 'utf8');

console.log(`候选补丁: ${outPatched}（${changes.length} 处变更）`);
console.log(`变更清单: ${outChanges}`);
