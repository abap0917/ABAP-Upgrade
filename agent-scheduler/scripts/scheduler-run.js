#!/usr/bin/env node
/**
 * scheduler-run.js — 调度执行前的一键初始化（项目级 .env + 参数默认值）
 * 用法: node scheduler-run.js [projectDir] [--name=] [--variant=] [--creator=] [--transport=]
 * 默认值:
 *   projectDir = 当前目录（或命令行第 1 个位置参数）
 *   name       = 未填时用 projectDir 的【根目录文件夹名】
 *   path       = projectDir（当前项目目录）
 *   variant    = ZABAP_CLOUD_DEV_CHECK
 *   creator    = 123456
 * 步骤:
 *   1) 确保项目 .env 存在（缺失则生成模板，填真实连接后再继续）
 *   2) registry.js plan <name> --name= --path= --variant= --creator= --transport=
 *   3) 提示下一步（按 agent-scheduler\AGENT.md 执行 ②→⑤，或交给 @agent-scheduler）
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectDir = path.resolve(process.argv[2] || '.');
const getFlag = (n) => {
  const a = process.argv.find((x) => x.startsWith(n + '='));
  return a ? a.slice(n.length + 1) : null;
};
const name = getFlag('--name') || path.basename(projectDir); // 默认根目录文件夹名
const variant = getFlag('--variant') || 'ZABAP_CLOUD_DEV_CHECK';
const creator = getFlag('--creator') || '123456';
const transport = getFlag('--transport') || '';

const ENV_TEMPLATE = `# 本项目 SAP 连接配置（项目级，勿提交 git）
SAP_URL=https://<host>:<port>
SAP_CLIENT=100
SAP_LANGUAGE=ZH
SAP_SYSTEM_TYPE=onprem
SAP_AUTH_TYPE=basic
SAP_USERNAME=<用户>
SAP_PASSWORD=<密码>
SAP_MASTER_SYSTEM=<SID>
SAP_RESPONSIBLE=<用户>
`;

// 1) 项目 .env
const envFile = path.join(projectDir, '.env');
if (!fs.existsSync(envFile)) {
  fs.writeFileSync(envFile, ENV_TEMPLATE, 'utf8');
  console.log(`✓ 已创建项目 .env: ${envFile}（请填写真实 SAP 连接后再继续调度）`);
} else {
  console.log(`✓ 项目 .env 已存在: ${envFile}`);
}

// 2) registry plan（含默认值）
const reg = path.resolve(__dirname, 'registry.js');
const args = [
  'plan', name,
  `--name=${name}`,
  `--path=${projectDir}`,
  `--variant=${variant}`,
  `--creator=${creator}`,
  `--transport=${transport}`,
];
const r = spawnSync(process.execPath, [reg, ...args], { encoding: 'utf8', timeout: 30000 });
console.log((r.stdout || r.stderr || '').trim());

// 3) 下一步提示
console.log('');
console.log(`调度参数: 项目=${name}  路径=${projectDir}  变体=${variant}  创建人=${creator}  传输=${transport || '(未填，执行时确认)'}`);
console.log(`下一步: 按 agent-scheduler\\AGENT.md 执行 ②断点判断 → ③初始化(每项目一次) → ④ATC 检查 → ⑤收尾`);
console.log(`（或直接对 @agent-scheduler 说"对项目 ${name} 执行一轮调度"）`);
