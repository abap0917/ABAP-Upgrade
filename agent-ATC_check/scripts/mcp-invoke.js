#!/usr/bin/env node
/**
 * mcp-invoke.js — 通用 MCP JSON-RPC 调用器 (stdio 模式)
 * 用法: node mcp-invoke.js <launcher.js> <env-path> <toolName> [jsonArgs] [exposition]
 * 示例: node mcp-invoke.js ../adt-dev/dist/server/launcher.js .env GetSession {}
 *       node mcp-invoke.js ../adt-dev/dist/server/launcher.js .env SearchObject {"query":"Z*"}
 * 输出: 工具返回的完整 JSON (stdout), 日志走 stderr
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const launcher = path.resolve(process.argv[2]);
const envPath = path.resolve(process.argv[3]);
const toolName = process.argv[4];
const rawArgs = process.argv[5] || '{}';
// --out=<file>: write the JSON result to a file (UTF-8) instead of stdout
const outIdx = process.argv.findIndex((a) => a.startsWith('--out='));
const outFile = outIdx >= 0 ? process.argv[outIdx].slice(6) : null;
// exposition: first positional arg after args that does NOT start with '--'
const positional = process.argv.slice(6).filter((a) => !a.startsWith('--'));
const exposition = positional[0] || 'readonly,high,customizing,debug';

let args;
try {
  if (rawArgs.startsWith('@')) {
    // 从文件读取 JSON 参数 (避免 Windows 引号转义问题)
    const fs = require('node:fs');
    args = JSON.parse(fs.readFileSync(path.resolve(rawArgs.slice(1)), 'utf8'));
  } else {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  }
} catch (e) {
  console.error(`Invalid JSON args: ${rawArgs} (${e.message})`);
  process.exit(2);
}

const child = spawn(process.execPath, [launcher, `--env-path=${envPath}`, `--exposition=${exposition}`], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
});

let buffer = '';
const pending = new Map();
let nextId = 1;

function send(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 180000);
  });
}

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`));
      else p.resolve(msg.result);
    }
  }
});

child.on('exit', (code) => {
  if (code !== 0 && pending.size > 0) {
    for (const p of pending.values()) p.reject(new Error(`server exited with code ${code}`));
    pending.clear();
  }
});

(async () => {
  try {
    const init = await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-invoke', version: '1.0.0' },
    });
    process.stderr.write(`[OK] initialize -> ${init.serverInfo.name} v${init.serverInfo.version}\n`);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    if (toolName === '__list__') {
      const tools = await send('tools/list', {});
      const list = Array.isArray(tools.tools) ? tools.tools : [];
      process.stderr.write(`[OK] tools/list -> ${list.length} tools\n`);
      console.log(JSON.stringify(list.map((t) => t.name).sort(), null, 2));
      child.kill();
      process.exit(0);
    }

    process.stderr.write(`[CALL] ${toolName} ${JSON.stringify(args)}\n`);
    const result = await send('tools/call', { name: toolName, arguments: args });
    const out = JSON.stringify(result, null, 2);
    if (outFile) {
      require('node:fs').writeFileSync(path.resolve(outFile), out, 'utf8');
      process.stderr.write(`[OK] result written to ${outFile}\n`);
    } else {
      console.log(out);
    }
    child.kill();
    process.exit(0);
  } catch (err) {
    console.error('\nFAILED:', err.message);
    child.kill();
    process.exit(1);
  }
})();
