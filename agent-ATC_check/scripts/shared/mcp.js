#!/usr/bin/env node
/**
 * shared/mcp.js — agent-ATC_check 脚本公共库
 *
 * 功能：
 *  - loadEnv(file)          读取 .env（跳过注释）
 *  - resolveEnvPath(argv, fallback)   统一 CLI 约定：优先 `--env=<path>`，否则用 fallback
 *  - resolveFlag(argv, name) 取命名参数（如 `--launcher=<path>`）
 *  - parseResultText(text)   解析 MCP 工具返回文本（可能是嵌套 JSON）
 *  - mcpCall({launcher, envPath, tool, args, retries})   调用 mcp-invoke.js 并解析结果（带重试）
 *
 * CLI 约定（所有需要连接的脚本统一）：
 *   --env=<path>      连接配置路径（.env）
 *   --launcher=<path> MCP 服务器 launcher（需要时）
 *   旧的位置参数作为 fallback 保留，向后兼容。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function loadEnv(file) {
  const out = {};
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
    }
  } catch { /* 文件不存在则返回空 */ }
  return out;
}

/** 统一 env 路径约定：优先 --env=，否则 fallback（fallback 可为旧位置参数或默认值） */
function resolveEnvPath(argv, fallback) {
  const flag = resolveFlag(argv, '--env=');
  return flag ? path.resolve(flag) : (fallback ? path.resolve(fallback) : null);
}

/** 取命名参数值，如 resolveFlag(argv, '--launcher=') */
function resolveFlag(argv, name) {
  const a = argv.find((x) => x.startsWith(name));
  return a ? a.slice(name.length) : null;
}

/** 解析工具返回文本：可能是嵌套 JSON 字符串 */
function parseResultText(text) {
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function mcpInvokePath() {
  return path.resolve(__dirname, '..', 'mcp-invoke.js');
}

/**
 * 调用 mcp-invoke.js 并解析结果
 * @returns {Promise<{data:any, error:string|null}>}
 *   data: 工具结果（嵌套 JSON 已解包到 inner；inner.success===false 视为 error）
 */
function mcpCall({ launcher, envPath, tool, args = {}, retries = 2, timeoutMs = 180000 }) {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `mcp-${tool}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    const out = tmp + '.out';
    fs.writeFileSync(tmp, JSON.stringify(args), 'utf8');
    let lastErr = null;
    const attempt = (n) => {
      const res = spawnSync(process.execPath, [mcpInvokePath(), launcher, envPath, tool, `@${tmp}`, `--out=${out}`], {
        encoding: 'utf8',
        timeout: timeoutMs,
        env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      });
      if (fs.existsSync(out)) {
        const raw = fs.readFileSync(out, 'utf8');
        const parsed = parseResultText(raw);
        const text = parsed?.content?.[0]?.text;
        if (parsed?.isError) {
          lastErr = String(text || 'tool error').slice(0, 600);
        } else if (text != null) {
          const inner = parseResultText(text);
          if (inner && inner.success === false) {
            lastErr = String(inner.message || inner.error || 'call failed').slice(0, 600);
          } else {
            fs.rmSync(tmp, { force: true });
            fs.rmSync(out, { force: true });
            return resolve({ data: inner ?? text, error: null });
          }
        } else {
          lastErr = 'empty result';
        }
      } else {
        lastErr = String(res?.stderr || `no output (exit ${res?.status ?? '?'})`).slice(0, 600);
      }
      if (n < retries) {
        setTimeout(() => attempt(n + 1), 800 * (n + 1));
      } else {
        fs.rmSync(tmp, { force: true });
        fs.rmSync(out, { force: true });
        resolve({ data: null, error: lastErr || 'unknown error' });
      }
    };
    attempt(0);
  });
}

module.exports = { loadEnv, resolveEnvPath, resolveFlag, parseResultText, mcpCall, mcpInvokePath };
