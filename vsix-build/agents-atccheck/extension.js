const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const WS_FILE = 'XXX升级项目.code-workspace';
const USER_AGENTS_DIR = path.join(process.env.USERPROFILE || process.env.HOME || '.', 'xxx-upgrade-agents');
const LAUNCHER = 'C:/path/to/your-abap-mcp/adt-dev/dist/server/launcher.js';

// ---------- 工具 ----------
function assetsDir(context) { return path.join(context.extensionUri.fsPath, 'assets'); }

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function currentRoot() {
  return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]
    ? vscode.workspace.workspaceFolders[0].uri.fsPath : null;
}

// 从项目目录（含常见 ATC-work 子目录）找最新 worklist 并返回其第一个对象 URL
function findLastObjectUrl(root) {
  if (!root) return null;
  const candidates = [root, path.join(root, 'ATC-work'), path.join(root, 'atc-work')];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => /^atc-worklist-.*\.xml$/i.test(f)).sort();
    for (const f of files.reverse()) {
      try {
        const xml = fs.readFileSync(path.join(dir, f), 'utf8');
        const m = xml.match(/<atcobject:object\b[^>]*adtcore:uri="([^"]+)"/);
        if (m) return m[1];
      } catch { /* 跳过损坏文件 */ }
    }
  }
  return null;
}

// ---------- 用户级 Copilot 自定义 Agent（~/.copilot/agents/*.agent.md，Chat 里 @name 可见） ----------
function ensureCopilotAgents() {
  // 官方位置: 用户级 = ~/.copilot/agents；文件扩展名 = .agent.md
  const agentsDir = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.copilot', 'agents');
  const defs = [
    {
      name: 'agent-scheduler',
      description: 'ATC 调度 Agent：先初始化（每项目一次）再执行 ATC 检查（断点续跑）',
      entry: path.join(USER_AGENTS_DIR, 'agent-scheduler', 'AGENT.md'),
    },
    {
      name: 'agent-system-initialization',
      description: '系统初始化 Agent：探测/配置 SAP MCP 连接与 ZMCP_ADT 桥接',
      entry: path.join(USER_AGENTS_DIR, 'agent-system_initialization', 'docs', 'SYSTEM_INIT_AGENT.md'),
    },
    {
      name: 'agent-ATC-check',
      description: 'ATC 检查 Agent：8 步流程（拉取→对象→勾选→归档→候选补丁→部署验证→回归断言→报告）',
      entry: path.join(USER_AGENTS_DIR, 'agent-ATC_check', 'AGENT.md'),
    },
  ];
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const a of defs) {
    const file = path.join(agentsDir, a.name + '.agent.md');
    if (fs.existsSync(file)) continue; // 已存在不覆盖（保留用户可能的手改）
    const md = '---\ndescription: ' + a.description + "\ntools: ['read', 'edit', 'command', 'search']\n---\n\n请读取并严格按指令文档执行：\n\n`" + a.entry + '`\n\n如遇到连接(.env)/变体/创建人/传输/勾选检查项/修改前 diff 等确认点，先暂停向用户询问。\n';
    fs.writeFileSync(file, md, 'utf8');
    console.log('[agents-atccheck] 已注册 Copilot agent:', a.name, '->', file);
  }
  return agentsDir;
}

// ---------- 项目级 MCP + .env（每个项目独立） ----------
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

function initProjectMcp(root) {
  const vscodeDir = path.join(root, '.vscode');
  const envFile = path.join(root, '.env');
  const mcpFile = path.join(vscodeDir, 'mcp.json');
  const created = [];

  if (!fs.existsSync(envFile)) {
    fs.writeFileSync(envFile, ENV_TEMPLATE, 'utf8');
    created.push('.env（模板，请填真实连接）');
  }
  const mcp = {
    $schema: 'https://json.schemastore.org/mcp.json',
    servers: {
      'mcp-abap-adt': {
        type: 'stdio',
        command: 'node',
        args: [LAUNCHER, `--env-path=${envFile.replace(/\\/g, '/')}`],
        env: { NODE_TLS_REJECT_UNAUTHORIZED: '0', SAP_RFC_BACKEND: 'soap' },
      },
    },
  };
  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(mcpFile, JSON.stringify(mcp, null, 2), 'utf8');
  created.push('.vscode\\mcp.json（指向本项目 .env）');

  vscode.window.showInformationMessage(
    '已为本项目初始化 MCP 配置：' + created.join('；') + '。填好 .env 后允许 MCP 服务器即可。',
  );
}

// ---------- 用户级任务（运行在【当前项目】上，用项目 .env） ----------
function registerAgentTasks(context) {
  const provider = {
    provideTasks() {
      const root = currentRoot();
      if (!root) return [];
      const scripts = path.join(USER_AGENTS_DIR, 'agent-ATC_check', 'scripts');
      const sched = path.join(USER_AGENTS_DIR, 'agent-scheduler', 'scripts');
      const envDef = path.join(root, '.env').replace(/\\/g, '/');
      const make = (label, cwd, command) =>
        new vscode.Task(
          { type: 'shell', task: label },
          vscode.TaskScope.Workspace,
          label,
          'Agents-ATCcheck',
          new vscode.ShellExecution(command, { cwd }),
        );
      return [
        make('ATC: 重跑检查（自动取当前项目对象）', scripts, `node atc-rerun.js "${root}"`),
        make('ATC: 拉取历史最新', scripts, `node fetch-atc-latest.js "${envDef}" 123456 ZABAP_CLOUD_DEV_CHECK .`),
        make('ATC: 部署后校验', scripts, `node verify-deployed.js . --env="${envDef}"`),
        make('ATC: 回归断言', scripts, `node assert-regression.js before.xml after.xml`),
        make('ATC: 候选补丁', scripts, `node gen-patch.js source.abap worklist.xml out.abap`),
        make('ATC: 变体规则快照', scripts, `node fetch-variant-rules.js . ZABAP_CLOUD_DEV_CHECK "${envDef}"`),
        make('调度: 初始化并执行一轮', sched, `node scheduler-run.js "${root}"`),
        make('调度: 前置自检', sched, `node scheduler-check.js .`),
        make('调度: 注册表清单', sched, `node registry.js list`),
      ];
    },
    resolveTask(task) { return task; },
  };
  context.subscriptions.push(vscode.tasks.registerTaskProvider('agentsAtcCheck', provider));
}

function activate(context) {
  // 1) 用户级：agents 模板安装到用户目录（已存在则跳过，可命令刷新）
  if (!fs.existsSync(USER_AGENTS_DIR)) {
    const assets = assetsDir(context);
    if (fs.existsSync(assets)) {
      copyDir(assets, USER_AGENTS_DIR);
      console.log('[agents-atccheck] 已安装 agents 模板到用户目录:', USER_AGENTS_DIR);
    }
  }

  // 2) 用户级 Copilot 自定义 Agent（@agent-scheduler / @agent-system-initialization / @agent-ATC-check）
  ensureCopilotAgents();

  // 3) 用户级任务（作用于当前项目的 .env）
  registerAgentTasks(context);

  // 4) 命令
  context.subscriptions.push(
    // 供 tasks.json 使用: 返回上次 ATC 检查的对象 URL（无则 null）
    vscode.commands.registerCommand('agentsAtcCheck.getLastObjectUrl', async () => findLastObjectUrl(currentRoot())),
    // 项目级：为当前项目生成 .vscode\mcp.json + .env（MCP 配置/环境变量都是项目级）
    vscode.commands.registerCommand('agentsAtcCheck.initProject', async () => {
      const root = currentRoot();
      if (!root) { vscode.window.showWarningMessage('请先打开一个项目/工作区再执行'); return; }
      initProjectMcp(root);
    }),
    // 用户级：刷新用户目录模板
    vscode.commands.registerCommand('agentsAtcCheck.refreshUser', async () => {
      copyDir(assetsDir(context), USER_AGENTS_DIR);
      vscode.window.showInformationMessage('已刷新用户目录 agents 模板: ' + USER_AGENTS_DIR);
    }),
    // 用户级：打开用户目录模板
    vscode.commands.registerCommand('agentsAtcCheck.openUserDir', async () => {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(USER_AGENTS_DIR), { forceNewWindow: true });
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
