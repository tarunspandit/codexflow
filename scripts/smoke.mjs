import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv from 'ajv';

const outputSchemaValidator = new Ajv({ allErrors: true, strict: false });

function assertToolOutputSchema(tool, result) {
  if (!tool?.outputSchema) throw new Error(`${tool?.name ?? 'tool'} did not advertise an output schema`);
  if (result?.isError) {
    throw new Error(`${tool.name} returned an error instead of schema-valid output: ${JSON.stringify(result.content)}`);
  }
  const validate = outputSchemaValidator.compile(tool.outputSchema);
  if (!validate(result?.structuredContent)) {
    throw new Error(`${tool.name} returned structured content that does not match its advertised output schema: ${JSON.stringify(validate.errors)}`);
  }
}

function encode(message) {
  return `${JSON.stringify(message)}\n`;
}

class McpStdioClient {
  constructor(command, args, options) {
    this.child = spawn(command, args, options);
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.child.stdout.on('data', (chunk) => this.onData(String(chunk)));
    this.child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    this.child.on('exit', (code) => {
      for (const { reject } of this.pending.values()) reject(new Error(`server exited ${code}`));
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    while (true) {
      const index = this.buffer.indexOf('\n');
      if (index < 0) return;
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    }
  }

  request(method, params) {
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };
    this.child.stdin.write(encode(msg));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 15000);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(encode({ jsonrpc: '2.0', method, params }));
  }

  close() {
    this.child.kill('SIGTERM');
  }
}

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));

function assertCommand(args, expected) {
  const result = spawnSync(process.execPath, args, { cwd: path.resolve('.'), encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  if (!result.stdout.includes(expected)) {
    throw new Error(`${args.join(' ')} did not print ${expected}: ${result.stdout}`);
  }
}

assertCommand(['dist/stdio.js', '--version'], pkg.version);
assertCommand(['dist/stdio.js', '--help'], 'CodexFlow MCP stdio server');
assertCommand(['dist/http.js', '--version'], pkg.version);
assertCommand(['dist/http.js', '--help'], 'CodexFlow MCP HTTP server');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-smoke-'));
await fs.writeFile(path.join(tmp, 'demo.txt'), 'alpha\nread\nread\nomega\n', 'utf8');
await fs.writeFile(path.join(tmp, 'other.txt'), 'keep\n', 'utf8');
await fs.writeFile(path.join(tmp, 'config.txt'), 'OPENAI_API_KEY=sk-realSecretValue123\n', 'utf8');
await fs.writeFile(path.join(tmp, 'AGENTS.md'), '# Smoke Agents\n\n- Preserve demo.txt.\n', 'utf8');
const secondProject = path.join(tmp, 'second-project');
await fs.mkdir(secondProject, { recursive: true });
await fs.writeFile(path.join(secondProject, 'package.json'), '{"name":"second-project"}\n', 'utf8');
await fs.writeFile(path.join(secondProject, 'project-only.txt'), 'routed-to-second-project\n', 'utf8');
const codexHistoryDir = path.join(tmp, 'codex-history');
const codexSessionDir = path.join(codexHistoryDir, 'sessions', '2026', '06', '20');
await fs.mkdir(codexSessionDir, { recursive: true });
const codexSessionPath = path.join(codexSessionDir, 'rollout-2026-06-20T01-02-03-019cc369-bd7c-7891-b371-7b20b4fe0b18.jsonl');
await fs.writeFile(codexSessionPath, [
  JSON.stringify({ timestamp: '2026-06-20T01:02:03Z', type: 'session_meta', payload: { id: '019cc369-bd7c-7891-b371-7b20b4fe0b18', cwd: tmp } }),
  JSON.stringify({ timestamp: '2026-06-20T01:02:04Z', type: 'response_item', payload: { type: 'message', role: 'user', content: 'Fix the smoke session browser' } }),
  JSON.stringify({ timestamp: '2026-06-20T01:02:05Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'Session browser plan.' } }),
  JSON.stringify({ timestamp: '2026-06-20T01:02:06Z', type: 'response_item', payload: { type: 'function_call', name: 'bash' } }),
  JSON.stringify({ timestamp: '2026-06-20T01:02:07Z', type: 'response_item', payload: { type: 'function_call_output', output: 'ok' } })
].join('\n') + '\n', 'utf8');
const olderCodexSessionId = '019cc368-1111-7222-8333-123456789abc';
await fs.writeFile(path.join(codexSessionDir, `rollout-2026-06-19T01-02-03-${olderCodexSessionId}.jsonl`), [
  JSON.stringify({ timestamp: '2026-06-19T01:02:03Z', type: 'session_meta', payload: { id: olderCodexSessionId, cwd: tmp } }),
  JSON.stringify({ timestamp: '2026-06-19T01:02:04Z', type: 'response_item', payload: { type: 'message', role: 'user', content: 'Older session still readable by id' } })
].join('\n') + '\n', 'utf8');
const largeCodexSessionId = '019cc367-aaaa-7333-8444-123456789def';
await fs.writeFile(path.join(codexSessionDir, `rollout-2026-06-18T01-02-03-${largeCodexSessionId}.jsonl`), [
  JSON.stringify({ timestamp: '2026-06-18T01:02:03Z', type: 'session_meta', payload: { id: largeCodexSessionId, cwd: tmp } }),
  JSON.stringify({ timestamp: '2026-06-18T01:02:04Z', type: 'response_item', payload: { type: 'message', role: 'user', content: 'Large metadata session' } }),
  JSON.stringify({ timestamp: '2026-06-18T01:02:05Z', type: 'response_item', payload: { type: 'function_call_output', output: 'x'.repeat(140000) } }),
  JSON.stringify({ timestamp: '2026-06-18T01:02:06Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'Large tail summary' } })
].join('\n') + '\n', 'utf8');
const unreadableCodexSessionPath = path.join(codexSessionDir, 'rollout-2026-06-17T01-02-03-019cc366-bbbb-7444-8555-123456789aaa.jsonl');
await fs.writeFile(unreadableCodexSessionPath, [
  JSON.stringify({ timestamp: '2026-06-17T01:02:03Z', type: 'session_meta', payload: { id: '019cc366-bbbb-7444-8555-123456789aaa', cwd: tmp } })
].join('\n') + '\n', 'utf8');
await fs.chmod(unreadableCodexSessionPath, 0o000);
await fs.mkdir(path.join(tmp, '.codex', 'skills', 'smoke-skill'), { recursive: true });
await fs.writeFile(path.join(tmp, '.codex', 'skills', 'smoke-skill', 'SKILL.md'), [
  '---',
  'name: smoke-skill',
  'description: Smoke test skill discovery.',
  '---',
  '',
  '# Smoke Skill',
  ''
].join('\n'), 'utf8');
await fs.mkdir(path.join(tmp, '.agents', 'skills', 'smoke-skill'), { recursive: true });
await fs.writeFile(path.join(tmp, '.agents', 'skills', 'smoke-skill', 'SKILL.md'), [
  '---',
  'name: smoke-skill',
  'description: Duplicate smoke test skill discovery.',
  '---',
  '',
  '# Duplicate Smoke Skill',
  ''
].join('\n'), 'utf8');
const outsideSkillRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-outside-skills-'));
await fs.mkdir(path.join(outsideSkillRoot, 'outside-skill'), { recursive: true });
await fs.writeFile(path.join(outsideSkillRoot, 'outside-skill', 'SKILL.md'), [
  '---',
  'name: outside-skill',
  'description: Outside workspace skill.',
  '---',
  '',
  '# Outside Skill',
  ''
].join('\n'), 'utf8');
try {
  await fs.symlink(outsideSkillRoot, path.join(tmp, 'skills'), 'dir');
} catch (error) {
  if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
}
await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
  scripts: {
    'test': "node --test",
    'build:clients': "node -e \"console.log('clients ok')\""
  }
}, null, 2), 'utf8');
await fs.mkdir(path.join(tmp, 'src'), { recursive: true });
await fs.writeFile(path.join(tmp, 'src', 'auth.ts'), 'export function authenticate(user) { return Boolean(user); }\n', 'utf8');
await fs.mkdir(path.join(tmp, 'test'), { recursive: true });
await fs.writeFile(path.join(tmp, 'test', 'auth.test.ts'), "import { authenticate } from '../src/auth.js';\nvoid authenticate('test');\n", 'utf8');
await fs.writeFile(path.join(tmp, 'é.ts'), 'export const accent = 1;\n', 'utf8');
await fs.writeFile(path.join(tmp, '旧名.ts'), 'export const renamed = true;\n', 'utf8');
await fs.mkdir(path.join(tmp, '.codex', 'environments'), { recursive: true });
await fs.writeFile(path.join(tmp, '.codex', 'environments', 'smoke.toml'), [
  'version = 1',
  'name = "Smoke local"',
  '',
  '[setup]',
  'script = ""',
  '',
  '[[actions]]',
  'name = "Echo"',
  'icon = "test"',
  'command = "printf local-environment-action"',
  ''
].join('\n'), 'utf8');
const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-outside-'));
await fs.writeFile(path.join(outside, 'secret.txt'), 'do-not-read', 'utf8');
const danglingSymlinks = [];
for (const [linkPath, targetPath] of [
  ['dangling-outside.txt', path.join(outside, 'created-outside.txt')],
  ['dangling-env.txt', path.join(tmp, '.env')]
]) {
  try {
    await fs.symlink(targetPath, path.join(tmp, linkPath));
    danglingSymlinks.push(linkPath);
  } catch (error) {
    if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
  }
}
let symlinkEscapePath = 'secret-link.txt';
try {
  await fs.symlink(path.join(outside, 'secret.txt'), path.join(tmp, symlinkEscapePath));
} catch (error) {
  if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
  symlinkEscapePath = 'secret-link-dir/secret.txt';
  await fs.symlink(outside, path.join(tmp, 'secret-link-dir'), 'junction');
}
for (const args of [['init'], ['config', 'core.quotePath', 'true'], ['add', 'demo.txt', 'other.txt', 'AGENTS.md', 'package.json', 'src/auth.ts', 'test/auth.test.ts', 'é.ts', '旧名.ts', '.codex/environments/smoke.toml']]) {
  const result = spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
}
const commitResult = spawnSync('git', ['-c', 'user.email=smoke@example.com', '-c', 'user.name=Smoke Test', 'commit', '-m', 'initial smoke fixture'], { cwd: tmp, encoding: 'utf8' });
if (commitResult.status !== 0) {
  throw new Error(`git commit failed: ${commitResult.stderr || commitResult.stdout}`);
}

const client = new McpStdioClient('node', ['dist/stdio.js', '--root', tmp, '--allow-root', tmp, '--bash', 'safe', '--tool-mode', 'full'], {
  cwd: path.resolve('.'),
  env: { ...process.env, CODEXFLOW_ROOT: tmp, CODEXFLOW_ALLOWED_ROOTS: tmp, CODEXFLOW_WIDGET_DOMAIN: 'https://widgets.codexflow.test', CODEXFLOW_TOOL_CARDS: '0' }
});

await client.request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'codexflow-smoke', version: '0.1.0' }
});
client.notify('notifications/initialized');
const tools = await client.request('tools/list', {});
const toolNames = tools.tools.map((tool) => tool.name);
for (const expected of ['server_config', 'codexflow_self_test', 'codexflow_inventory', 'list_projects', 'select_project', 'list_workspaces', 'open_current_workspace', 'open_workspace', 'workspace_snapshot', 'inspect_workspace', 'tree', 'search', 'load_skill', 'read', 'write', 'edit', 'apply_patch', 'bash', 'terminal', 'git_status', 'git_diff', 'git_workflow', 'local_environment', 'worktree', 'prepare_scheduled_task', 'show_changes', 'read_handoff', 'wait_for_handoff', 'codex_context', 'handoff_to_agent', 'handoff_to_codex', 'export_pro_context']) {
  if (!toolNames.includes(expected)) throw new Error(`missing tool: ${expected}`);
}
const toolCardUri = 'ui://widget/codexflow-tool-card-v12.html';
const projectPickerUri = 'ui://widget/codexflow-project-picker-v3.html';
const toolsByName = new Map(tools.tools.map((tool) => [tool.name, tool]));
for (const routeAwareTool of ['list_projects', 'select_project', 'open_current_workspace', 'open_workspace', 'read', 'tree', 'bash', 'local_environment', 'prepare_scheduled_task']) {
  if (!toolsByName.get(routeAwareTool)?.inputSchema?.properties?.route_id) {
    throw new Error(`${routeAwareTool} did not advertise private route_id input`);
  }
}
function hasWidgetMeta(name, uri = toolCardUri) {
  const meta = toolsByName.get(name)?._meta ?? {};
  return meta.ui?.resourceUri === uri && meta['openai/outputTemplate'] === uri;
}
function hasToolCardStatusMeta(name) {
  const meta = toolsByName.get(name)?._meta ?? {};
  return Boolean(meta['openai/toolInvocation/invoking'] || meta['openai/toolInvocation/invoked']);
}
async function expectToolError(name, args, pattern, targetClient = client) {
  const result = await targetClient.request('tools/call', { name, arguments: args });
  if (!result.isError) {
    throw new Error(`${name} unexpectedly succeeded`);
  }
  const text = result.content?.find?.((part) => part.type === 'text')?.text ?? JSON.stringify(result.structuredContent);
  if (pattern && !pattern.test(text)) {
    throw new Error(`${name} error did not match ${pattern}: ${text}`);
  }
}
for (const visualTool of toolNames) {
  if (visualTool === 'list_projects') {
    if (!hasWidgetMeta(visualTool, projectPickerUri)) throw new Error('list_projects did not expose the dedicated project picker widget');
    if (!toolsByName.get(visualTool)?.outputSchema) throw new Error('list_projects did not advertise structured output');
    continue;
  }
  if (visualTool === 'select_project') {
    const meta = toolsByName.get(visualTool)?._meta ?? {};
    if (hasWidgetMeta(visualTool) || meta['openai/outputTemplate']) throw new Error('select_project should not depend on a result template');
    if (meta['openai/widgetAccessible'] !== true || !meta.ui?.visibility?.includes?.('app')) throw new Error('select_project was not callable from the picker');
    if (!toolsByName.get(visualTool)?.outputSchema) throw new Error('select_project did not advertise structured output');
    continue;
  }
  if (hasWidgetMeta(visualTool) || hasToolCardStatusMeta(visualTool)) throw new Error(`${visualTool} exposed widget metadata while CODEXFLOW_TOOL_CARDS is off`);
}
const projectList = await client.request('tools/call', { name: 'list_projects', arguments: { refresh: true } });
assertToolOutputSchema(toolsByName.get('list_projects'), projectList);
const pickerRouteId = projectList.structuredContent.route_id;
if (!/^route_[a-f0-9]{32}$/.test(pickerRouteId) || projectList._meta?.['openai/widgetSessionId'] !== pickerRouteId) {
  throw new Error(`project picker did not create a stable private route: ${JSON.stringify(projectList)}`);
}
const secondProjectReal = await fs.realpath(secondProject);
const secondChoice = projectList.structuredContent.projects.find((project) => project.root === secondProjectReal);
if (!secondChoice) throw new Error(`project picker did not discover second project: ${JSON.stringify(projectList.structuredContent)}`);
const selectedProject = await client.request('tools/call', { name: 'select_project', arguments: { route_id: pickerRouteId, project_id: secondChoice.project_id, include_tree: false } });
assertToolOutputSchema(toolsByName.get('select_project'), selectedProject);
if (selectedProject.structuredContent.route_id !== pickerRouteId || selectedProject._meta?.['openai/widgetSessionId'] !== pickerRouteId || selectedProject.structuredContent.root !== secondProjectReal || !selectedProject.structuredContent.skills) {
  throw new Error(`project selection did not advertise routed capabilities: ${JSON.stringify(selectedProject.structuredContent)}`);
}
const routedRead = await client.request('tools/call', { name: 'read', arguments: { route_id: pickerRouteId, path: 'project-only.txt' } });
if (!routedRead.structuredContent.text?.includes('routed-to-second-project')) {
  throw new Error(`workspace-less read was not routed to the selected project: ${JSON.stringify(routedRead.structuredContent)}`);
}
const defaultProjectReal = await fs.realpath(tmp);
const defaultChoice = projectList.structuredContent.projects.find((project) => project.root === defaultProjectReal);
if (!defaultChoice) throw new Error('project picker did not include the default smoke project');
await client.request('tools/call', { name: 'select_project', arguments: { route_id: pickerRouteId, project_id: defaultChoice.project_id, include_tree: false } });
const environments = await client.request('tools/call', { name: 'local_environment', arguments: { route_id: pickerRouteId, action: 'list' } });
if (environments.isError || environments.structuredContent.count !== 1 || environments.structuredContent.environments?.[0]?.name !== 'Smoke local') {
  throw new Error(`local_environment did not discover Codex-compatible TOML: ${JSON.stringify(environments)}`);
}
const selectedEnvironment = await client.request('tools/call', {
  name: 'local_environment',
  arguments: { route_id: pickerRouteId, action: 'select', config_path: 'Smoke local' }
});
if (selectedEnvironment.isError || !selectedEnvironment.structuredContent.selected_config_path?.endsWith('/.codex/environments/smoke.toml')) {
  throw new Error(`local_environment selection was not persisted: ${JSON.stringify(selectedEnvironment)}`);
}
const environmentAction = await client.request('tools/call', {
  name: 'local_environment',
  arguments: { route_id: pickerRouteId, action: 'run', action_name: 'Echo', background: false }
});
if (environmentAction.isError || !environmentAction.structuredContent.output?.includes('local-environment-action')) {
  throw new Error(`local_environment action did not run in the route terminal: ${JSON.stringify(environmentAction)}`);
}
const scheduledTask = await client.request('tools/call', {
  name: 'prepare_scheduled_task',
  arguments: {
    route_id: pickerRouteId,
    task: 'Run the focused tests and summarize regressions.',
    run_location: 'worktree',
    chat_mode: 'same_chat'
  }
});
if (
  scheduledTask.isError ||
  scheduledTask.structuredContent.scheduler !== 'chatgpt_scheduled' ||
  scheduledTask.structuredContent.creates_schedule !== false ||
  !scheduledTask.structuredContent.prompt?.includes(defaultChoice.project_id) ||
  !scheduledTask.structuredContent.prompt?.includes('Smoke local') && !scheduledTask.structuredContent.environment_config_path
) {
  throw new Error(`prepare_scheduled_task did not produce durable project context: ${JSON.stringify(scheduledTask)}`);
}
await fs.chmod(unreadableCodexSessionPath, 0o600);
const parkedSymlinkNames = [...new Set([...danglingSymlinks, symlinkEscapePath.split('/')[0]])];
try {
  const skillLink = await fs.lstat(path.join(tmp, 'skills'));
  if (skillLink.isSymbolicLink()) parkedSymlinkNames.push('skills');
} catch {
  // Windows smoke may not have permission to create this fixture symlink.
}
for (const name of parkedSymlinkNames) {
  await fs.rename(path.join(tmp, name), path.join(outside, `.park-${name}`));
}
const createdEnvironmentWorktree = await client.request('tools/call', {
  name: 'worktree',
  arguments: { route_id: pickerRouteId, action: 'create', include_changes: false }
});
if (createdEnvironmentWorktree.isError || createdEnvironmentWorktree.structuredContent.worktree?.environmentName !== 'Smoke local') {
  throw new Error(`route-selected environment was not applied to a managed worktree: ${JSON.stringify(createdEnvironmentWorktree)}`);
}
const worktreeEnvironmentAction = await client.request('tools/call', {
  name: 'local_environment',
  arguments: { route_id: pickerRouteId, action: 'run', action_name: 'Echo', background: false }
});
if (worktreeEnvironmentAction.isError || !worktreeEnvironmentAction.structuredContent.output?.includes('local-environment-action')) {
  throw new Error(`source-project environment did not remain usable after routing into a worktree: ${JSON.stringify(worktreeEnvironmentAction)}`);
}
const removedEnvironmentWorktree = await client.request('tools/call', {
  name: 'worktree',
  arguments: { route_id: pickerRouteId, action: 'remove', worktree_id: createdEnvironmentWorktree.structuredContent.worktree.id }
});
if (removedEnvironmentWorktree.isError || !removedEnvironmentWorktree.structuredContent.removed) {
  throw new Error(`environment worktree was not removed: ${JSON.stringify(removedEnvironmentWorktree)}`);
}
await fs.chmod(unreadableCodexSessionPath, 0o000);
for (const name of parkedSymlinkNames) {
  await fs.rename(path.join(outside, `.park-${name}`), path.join(tmp, name));
}
await client.request('tools/call', { name: 'select_project', arguments: { route_id: pickerRouteId, project_id: secondChoice.project_id, include_tree: false } });
const switchedEnvironment = await client.request('tools/call', { name: 'local_environment', arguments: { route_id: pickerRouteId, action: 'list' } });
if (switchedEnvironment.isError || switchedEnvironment.structuredContent.selected_config_path !== null) {
  throw new Error(`explicit project switch retained a stale environment selection: ${JSON.stringify(switchedEnvironment)}`);
}
await client.request('tools/call', { name: 'select_project', arguments: { route_id: pickerRouteId, project_id: defaultChoice.project_id, include_tree: false } });
await client.request('tools/call', { name: 'open_workspace', arguments: { root: tmp, include_tree: false } });
const cardClient = new McpStdioClient('node', ['dist/stdio.js', '--root', tmp, '--allow-root', tmp, '--bash', 'safe', '--tool-mode', 'full'], {
  cwd: path.resolve('.'),
  env: { ...process.env, CODEXFLOW_ROOT: tmp, CODEXFLOW_ALLOWED_ROOTS: tmp, CODEXFLOW_TOOL_CARDS: '1', CODEXFLOW_WIDGET_DOMAIN: '' }
});
await cardClient.request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'codexflow-smoke-card-opt-in', version: '0.1.0' }
});
cardClient.notify('notifications/initialized');
const cardTools = await cardClient.request('tools/list', {});
const cardSearchMeta = cardTools.tools.find((tool) => tool.name === 'search')?._meta ?? {};
if (cardSearchMeta.ui?.resourceUri !== toolCardUri || cardSearchMeta['openai/outputTemplate'] !== toolCardUri) {
  throw new Error('CODEXFLOW_TOOL_CARDS=1 did not opt search into widget metadata');
}
const cardOpened = await cardClient.request('tools/call', { name: 'open_current_workspace', arguments: { include_tree: false } });
const cardSearch = await cardClient.request('tools/call', {
  name: 'search',
  arguments: { workspace_id: cardOpened.structuredContent.workspace_id, query: 'read', path: 'demo.txt', max_results: 5 }
});
if (!cardSearch.structuredContent.text?.includes('read')) {
  throw new Error(`CODEXFLOW_TOOL_CARDS=1 search did not include structured text: ${JSON.stringify(cardSearch.structuredContent)}`);
}
const cardInspect = await cardClient.request('tools/call', { name: 'inspect_workspace', arguments: { workspace_id: cardOpened.structuredContent.workspace_id } });
if (cardInspect.structuredContent.codexflow_tool !== 'inspect_workspace' || !cardInspect.structuredContent.coverage) {
  throw new Error(`inspect workspace card payload missing analysis: ${JSON.stringify(cardInspect.structuredContent)}`);
}
const cardStructuredSearch = await cardClient.request('tools/call', {
  name: 'search',
  arguments: { workspace_id: cardOpened.structuredContent.workspace_id, query: 'authenticate', path: 'src', intent: 'symbol', include_tests: true }
});
if (cardStructuredSearch.structuredContent.codexflow_tool !== 'search' || !cardStructuredSearch.structuredContent.analysis?.groups?.definitions?.length) {
  throw new Error(`structured search card payload missing grouped analysis: ${JSON.stringify(cardStructuredSearch.structuredContent)}`);
}
if (spawnSync(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32' ? ['rg'] : ['-lc', 'command -v rg >/dev/null 2>&1']).status === 0) {
  const cardRegexSearch = await cardClient.request('tools/call', {
    name: 'search',
    arguments: { workspace_id: cardOpened.structuredContent.workspace_id, query: '(?i)READ', path: 'demo.txt', regex: true, max_results: 5 }
  });
  if (!cardRegexSearch.structuredContent.matches?.length || cardRegexSearch.structuredContent.used !== 'ripgrep') {
    throw new Error(`ripgrep regex search did not accept rg syntax: ${JSON.stringify(cardRegexSearch.structuredContent)}`);
  }
}
const sandboxWidget = await cardClient.request('resources/read', { uri: projectPickerUri });
const sandboxWidgetMeta = sandboxWidget.contents?.[0]?._meta ?? {};
if (sandboxWidgetMeta.ui?.domain || sandboxWidgetMeta['openai/widgetDomain']) {
  throw new Error('zero-configuration project picker should use the host sandbox, not a shared widget origin');
}
await cardClient.close();
const resources = await client.request('resources/list', {});
const toolCard = resources.resources.find((resource) => resource.uri === toolCardUri);
if (!toolCard) throw new Error(`missing tool-card resource: ${toolCardUri}`);
if (toolCard.mimeType !== 'text/html;profile=mcp-app') throw new Error(`unexpected tool-card mime type: ${toolCard.mimeType}`);
const projectPicker = resources.resources.find((resource) => resource.uri === projectPickerUri);
if (!projectPicker || projectPicker.mimeType !== 'text/html;profile=mcp-app') throw new Error(`missing project-picker resource: ${projectPickerUri}`);
const legacyProjectPickerUri = 'ui://widget/codexflow-project-picker-v2.html';
const legacyProjectPicker = resources.resources.find((resource) => resource.uri === legacyProjectPickerUri);
if (!legacyProjectPicker || legacyProjectPicker.mimeType !== 'text/html;profile=mcp-app') throw new Error(`missing legacy project-picker resource: ${legacyProjectPickerUri}`);
const legacyToolCardUri = 'ui://widget/codexflow-tool-card-v8.html';
const legacyToolCard = resources.resources.find((resource) => resource.uri === legacyToolCardUri);
if (!legacyToolCard) throw new Error(`missing legacy tool-card resource: ${legacyToolCardUri}`);
const widget = await client.request('resources/read', { uri: toolCardUri });
const widgetText = widget.contents?.[0]?.text ?? '';
const widgetMeta = widget.contents?.[0]?._meta ?? {};
if (!widgetText.includes('<meta charset="utf-8">') || !widgetText.includes('Waiting for tool result') || !widgetText.includes('renderWorkspace') || !widgetText.includes('renderSelfTest') || !widgetText.includes('renderWorkspaceAnalysis') || !widgetText.includes('renderStructuredSearch') || !widgetText.includes('renderChangeAnalysis') || !widgetText.includes('details class="fold"') || !widgetText.includes('ui/notifications/tool-result')) {
  throw new Error('tool-card widget resource did not include expected Apps bridge code');
}
if (!widgetMeta.ui?.csp || !widgetMeta['openai/widgetCSP']) {
  throw new Error('tool-card widget resource did not expose standard and ChatGPT CSP metadata');
}
if (widgetMeta.ui?.domain !== 'https://widgets.codexflow.test' || widgetMeta['openai/widgetDomain'] !== 'https://widgets.codexflow.test') {
  throw new Error('tool-card widget resource did not expose standard and ChatGPT widget domain metadata');
}
const pickerWidget = await client.request('resources/read', { uri: projectPickerUri });
const pickerText = pickerWidget.contents?.[0]?.text ?? '';
if (!pickerText.includes('Choose this chat’s project') || !pickerText.includes('callTool("select_project"') || !pickerText.includes('route_id') || !pickerText.includes('ui/update-model-context') || !pickerText.includes('setWidgetState') || !pickerText.includes('reply in chat with an exact project name') || !pickerText.includes('openai:set_globals') || !pickerText.includes('MAX_HYDRATION_ATTEMPTS') || pickerText.includes('ui/notifications/tool-result')) {
  throw new Error('project-picker resource did not include the resilient Apps bridge and chat fallback');
}
const legacyPickerWidget = await client.request('resources/read', { uri: legacyProjectPickerUri });
if (legacyPickerWidget.contents?.[0]?.uri !== legacyProjectPickerUri || legacyPickerWidget.contents?.[0]?.text !== pickerText) {
  throw new Error('legacy project-picker URI did not serve the current route-safe picker');
}
const legacyWidget = await client.request('resources/read', { uri: legacyToolCardUri });
if (legacyWidget.contents?.[0]?.uri !== legacyToolCardUri) {
  throw new Error('legacy tool-card widget resource did not preserve requested URI');
}
if (!(legacyWidget.contents?.[0]?.text ?? '').includes('Waiting for tool result')) {
  throw new Error('legacy tool-card widget resource did not serve widget HTML');
}
const current = await client.request('tools/call', { name: 'open_current_workspace', arguments: { include_tree: false } });
const realTmp = await fs.realpath(tmp);
if (current.structuredContent.root !== realTmp) throw new Error(`open_current_workspace opened ${current.structuredContent.root}, expected ${realTmp}`);
if (current.structuredContent.codexflow_tool !== 'open_current_workspace') throw new Error('tool result was not tagged for widget rendering');
if (current.structuredContent.tool_mode !== 'full') throw new Error(`open_current_workspace did not expose tool_mode: ${current.structuredContent.tool_mode}`);
if (current.structuredContent.skill_inventory?.length) {
  throw new Error('open_current_workspace discovered skills by default');
}
const currentWithSkills = await client.request('tools/call', { name: 'open_current_workspace', arguments: { include_tree: false, include_skills: true } });
if (!currentWithSkills.structuredContent.skill_inventory?.some?.((skill) => skill.name === 'smoke-skill')) {
  throw new Error('open_current_workspace did not discover workspace skill inventory when requested');
}
if (currentWithSkills.structuredContent.skill_inventory?.some?.((skill) => skill.name === 'outside-skill')) {
  throw new Error('open_current_workspace followed a symlinked workspace skill root outside the workspace');
}
const selfTest = await client.request('tools/call', {
  name: 'codexflow_self_test',
  arguments: {
    workspace_id: current.structuredContent.workspace_id,
    max_skills: 12
  }
});
if (selfTest.structuredContent.status === 'fail' || !selfTest.structuredContent.expected_tools?.includes?.('codexflow_self_test')) {
  throw new Error(`codexflow_self_test failed: ${JSON.stringify(selfTest.structuredContent)}`);
}
if (JSON.stringify([...(selfTest.structuredContent.expected_tools ?? [])].sort()) !== JSON.stringify([...(selfTest.structuredContent.registered_tools ?? [])].sort())) {
  throw new Error(`codexflow_self_test expected/registered tools mismatch: ${JSON.stringify(selfTest.structuredContent)}`);
}
if (!selfTest.structuredContent.files_touched?.includes?.('.ai-bridge/codexflow-self-test.md')) {
  throw new Error('codexflow_self_test did not run the .ai-bridge write/edit probe');
}
const snapshotAlias = await client.request('tools/call', {
  name: 'workspace_snapshot',
  arguments: {
    workspace_id: current.structuredContent.workspace_id,
    max_depth: 1,
    max_files: 20,
    include_skills: false
  }
});
if (!snapshotAlias.structuredContent.tree) {
  throw new Error('workspace_snapshot did not accept max_files alias or return a tree');
}
await expectToolError('load_skill', { name: 'smoke-skill', source: 'workspace' }, /Multiple skills named smoke-skill/);
const loadedSkill = await client.request('tools/call', {
  name: 'load_skill',
  arguments: {
    name: 'smoke-skill',
    source: 'workspace',
    path: '$WORKSPACE/.codex/skills/smoke-skill/SKILL.md'
  }
});
if (loadedSkill.structuredContent.skill?.name !== 'smoke-skill' || !loadedSkill.structuredContent.text?.includes('# Smoke Skill')) {
  throw new Error('load_skill did not return bounded SKILL.md content for smoke-skill');
}
await expectToolError('load_skill', { name: 'missing-skill' }, /Skill not found/);
await expectToolError('load_skill', { name: 'outside-skill', source: 'workspace', include_global_skills: false }, /Skill not found/);
const inventory = await client.request('tools/call', { name: 'codexflow_inventory', arguments: { include_global_skills: false, include_mcp_servers: false } });
if (inventory.structuredContent.codexflow_tool !== 'codexflow_inventory') throw new Error('inventory result was not tagged for widget rendering');
const opened = await client.request('tools/call', { name: 'open_workspace', arguments: { root: tmp, include_tree: true } });
const ws = opened.structuredContent.workspace_id;
const workspaceAnalysis = await client.request('tools/call', { name: 'inspect_workspace', arguments: { workspace_id: ws } });
if (!workspaceAnalysis.structuredContent.languages?.includes('typescript') || !workspaceAnalysis.structuredContent.coverage) {
  throw new Error(`inspect_workspace omitted analysis: ${JSON.stringify(workspaceAnalysis.structuredContent)}`);
}
const legacySearch = await client.request('tools/call', { name: 'search', arguments: { workspace_id: ws, query: 'authenticate', path: 'src' } });
for (const key of ['matches', 'truncated', 'used']) {
  if (!(key in legacySearch.structuredContent)) throw new Error(`legacy search lost ${key}`);
}
if ('analysis' in legacySearch.structuredContent) throw new Error('legacy search unexpectedly paid the structured-analysis cost');
const structuredSearch = await client.request('tools/call', {
  name: 'search',
  arguments: { workspace_id: ws, query: 'authenticate', path: 'src', intent: 'symbol', include_tests: true }
});
if (!structuredSearch.structuredContent.analysis?.groups?.definitions?.length || !structuredSearch.structuredContent.analysis.groups.tests?.length) {
  throw new Error(`structured search omitted grouped analysis: ${JSON.stringify(structuredSearch.structuredContent)}`);
}
const openedByPath = await client.request('tools/call', { name: 'open_workspace', arguments: { path: tmp, include_tree: false } });
if (openedByPath.structuredContent.workspace_id !== ws) {
  throw new Error(`open_workspace path alias returned ${openedByPath.structuredContent.workspace_id}, expected ${ws}`);
}
await client.request('tools/call', { name: 'read', arguments: { workspace_id: ws, path: 'demo.txt' } });
await fs.writeFile(path.join(tmp, 'tokens.txt'), [
  'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456',
  'https://example.test/mcp?codexflow_token=verysecretcodexflowtoken123&x=1',
  'codexflow_token=secretsecret12345',
  '"codexflow_token": "shortcodextoken"',
  'ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwxyz123456',
  '"api_key": "jsonsecretvalueabcdefghijklmnop"',
  'service_token: yamlsecretvalueabcdefghijklmnop',
  'ngrok config add-authtoken 2abcDEFghiJKLmnopQRSTuvWXyz_1234567890',
  'cloudflared tunnel run --token eyJhbGciOiJIUzI1NiJ9.eyJ0dW5uZWwiOiJjb2RleHBybyJ9.signature1234567890',
  'cloudflared tunnel run --token-file /Users/rebel/.codexflow/cloudflare-tunnel-token'
].join('\n'), 'utf8');
const secretRead = await client.request('tools/call', { name: 'read', arguments: { workspace_id: ws, path: 'config.txt' } });
const secretPayload = JSON.stringify(secretRead);
if (secretPayload.includes('sk-realSecretValue123') || !secretPayload.includes('[REDACTED_SECRET]')) {
  throw new Error('read did not redact secret-looking content');
}
const tokenRead = await client.request('tools/call', { name: 'read', arguments: { workspace_id: ws, path: 'tokens.txt' } });
const tokenPayload = JSON.stringify(tokenRead);
for (const leaked of ['ghp_abcdefghijklmnopqrstuvwxyz123456', 'verysecretcodexflowtoken123', 'secretsecret12345', 'shortcodextoken', 'sk-ant-abcdefghijklmnopqrstuvwxyz123456', 'jsonsecretvalueabcdefghijklmnop', 'yamlsecretvalueabcdefghijklmnop', '2abcDEFghiJKLmnopQRSTuvWXyz_1234567890', 'eyJhbGciOiJIUzI1NiJ9.eyJ0dW5uZWwiOiJjb2RleHBybyJ9.signature1234567890']) {
  if (tokenPayload.includes(leaked)) throw new Error(`read leaked token-like content: ${leaked}`);
}
if (!tokenPayload.includes('/Users/rebel/.codexflow/cloudflare-tunnel-token')) {
  throw new Error('redaction hid a non-secret Cloudflare token-file path');
}
await expectToolError('write', { workspace_id: ws, path: 'notes.md', content: 'OPENAI_API_KEY=sk-realSecretValue123\n' }, /Secret-looking content is blocked/);
await expectToolError('write', { workspace_id: ws, path: 'token.txt', content: 'codexflow_token=shorttok\n' }, /Secret-looking content is blocked/);
await expectToolError('write', { workspace_id: ws, path: 'notes.yaml', content: 'api_key: yamlsecretvalueabcdefghijklmnop\n' }, /Secret-looking content is blocked/);
await client.request('tools/call', {
  name: 'write',
  arguments: {
    workspace_id: ws,
    path: 'env-ref.js',
    content: 'const TOKEN = process.env.TOKEN;\nconst OPENAI_API_KEY = process.env.OPENAI_API_KEY;\nconst apiToken = getToken();\n'
  }
});
const inspectAfterWrite = await client.request('tools/call', { name: 'inspect_workspace', arguments: { workspace_id: ws } });
if (inspectAfterWrite.structuredContent.cache?.hit !== false || !inspectAfterWrite.structuredContent.files?.some((file) => file.path === 'env-ref.js')) {
  throw new Error(`write did not invalidate workspace analysis: ${JSON.stringify(inspectAfterWrite.structuredContent.cache)}`);
}
const envRefRead = await client.request('tools/call', { name: 'read', arguments: { workspace_id: ws, path: 'env-ref.js' } });
const envRefPayload = JSON.stringify(envRefRead);
if (envRefPayload.includes('[REDACTED_SECRET]')) {
  throw new Error('env-var token references were incorrectly redacted as literal secrets');
}
const symlinkRead = await client.request('tools/call', { name: 'read', arguments: { workspace_id: ws, path: symlinkEscapePath } });
if (!symlinkRead.isError) throw new Error('symlink escape read was not blocked');
for (const linkPath of danglingSymlinks) {
  await expectToolError('write', { workspace_id: ws, path: linkPath, content: 'escaped write\n' }, /symlink/i);
}
await client.request('tools/call', { name: 'edit', arguments: { workspace_id: ws, path: 'demo.txt', old_text: 'read\nread', new_text: 'read\nwrite' } });
await client.request('tools/call', { name: 'edit', arguments: { workspace_id: ws, path: 'src/auth.ts', old_text: 'return Boolean(user);', new_text: 'return Boolean(user?.trim());' } });
const inspectAfterEdit = await client.request('tools/call', { name: 'inspect_workspace', arguments: { workspace_id: ws } });
if (inspectAfterEdit.structuredContent.cache?.hit !== false) {
  throw new Error(`edit did not invalidate workspace analysis: ${JSON.stringify(inspectAfterEdit.structuredContent.cache)}`);
}
const changes = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws } });
if (!changes.structuredContent.changed || !changes.structuredContent.diff.includes('demo.txt')) {
  throw new Error('show_changes did not report the edited demo.txt diff');
}
if (!changes.structuredContent.analysis?.risk_signals?.some((risk) => risk.id === 'authentication')) {
  throw new Error(`show_changes omitted authentication risk analysis: ${JSON.stringify(changes.structuredContent.analysis)}`);
}
if (!changes.structuredContent.analysis?.related_tests?.some((file) => file.path === 'test/auth.test.ts')) {
  throw new Error(`show_changes omitted related auth test: ${JSON.stringify(changes.structuredContent.analysis)}`);
}
if (!changes.structuredContent.analysis?.recommended_commands?.some((item) => item.command === 'npm test')) {
  throw new Error(`show_changes omitted existing npm test recommendation: ${JSON.stringify(changes.structuredContent.analysis)}`);
}
const repeatedChanges = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws } });
if (repeatedChanges.structuredContent.changed || repeatedChanges.structuredContent.diff || repeatedChanges.structuredContent.review_checkpoint_hit !== true || repeatedChanges.structuredContent.additions !== 0 || repeatedChanges.structuredContent.deletions !== 0) {
  throw new Error(`show_changes repeated the same review instead of using the last-shown checkpoint: ${JSON.stringify(repeatedChanges.structuredContent)}`);
}
if ('analysis' in repeatedChanges.structuredContent) {
  throw new Error(`show_changes recomputed analysis for an unchanged checkpoint: ${JSON.stringify(repeatedChanges.structuredContent.analysis)}`);
}
await client.request('tools/call', { name: 'edit', arguments: { workspace_id: ws, path: 'other.txt', old_text: 'keep', new_text: 'unrelated dirty file' } });
const patchResult = await client.request('tools/call', {
  name: 'apply_patch',
  arguments: {
    workspace_id: ws,
    patch: [
      'diff --git a/demo.txt b/demo.txt',
      'index f41f61c..be6d0ff 100644',
      '--- a/demo.txt',
      '+++ b/demo.txt',
      '@@ -1,4 +1,4 @@',
      ' alpha',
      ' read',
      ' write',
      '-omega',
      '+omega patched'
    ].join('\n') + '\n'
  }
});
if (!patchResult.structuredContent.changed || !patchResult.structuredContent.paths?.includes?.('demo.txt')) {
  throw new Error(`apply_patch did not report the patched file: ${JSON.stringify(patchResult.structuredContent)}`);
}
if (patchResult.structuredContent.diff?.includes?.('other.txt')) {
  throw new Error(`apply_patch leaked unrelated workspace diff: ${patchResult.structuredContent.diff}`);
}
const inspectAfterPatch = await client.request('tools/call', { name: 'inspect_workspace', arguments: { workspace_id: ws } });
if (inspectAfterPatch.structuredContent.cache?.hit !== false) {
  throw new Error(`apply_patch did not invalidate workspace analysis: ${JSON.stringify(inspectAfterPatch.structuredContent.cache)}`);
}
const patchedRead = await client.request('tools/call', { name: 'read', arguments: { workspace_id: ws, path: 'demo.txt' } });
if (!patchedRead.content?.[0]?.text?.includes('omega patched')) {
  throw new Error(`apply_patch did not update demo.txt: ${patchedRead.content?.[0]?.text}`);
}
await expectToolError('apply_patch', {
  workspace_id: ws,
  patch: [
    'diff --git a/.env b/.env',
    'new file mode 100644',
    'index 0000000..e69de29',
    '--- /dev/null',
    '+++ b/.env',
    '@@ -0,0 +1 @@',
    '+SAFE_PLACEHOLDER=1'
  ].join('\n') + '\n'
}, /blocked/i);
await expectToolError('apply_patch', {
  workspace_id: ws,
  patch: [
    'diff --git old/.env new/.env',
    'new file mode 100644',
    'index 0000000..e69de29',
    '--- /dev/null',
    '+++ new/.env',
    '@@ -0,0 +1 @@',
    '+SAFE_PLACEHOLDER=1'
  ].join('\n') + '\n'
}, /blocked/i);
await expectToolError('apply_patch', {
  workspace_id: ws,
  patch: [
    'diff --git "a/foo\\057.env" "b/foo\\057.env"',
    'new file mode 100644',
    'index 0000000..e69de29',
    '--- /dev/null',
    '+++ "b/foo\\057.env"',
    '@@ -0,0 +1 @@',
    '+SAFE_PLACEHOLDER=1'
  ].join('\n') + '\n'
}, /blocked/i);
await expectToolError('apply_patch', {
  workspace_id: ws,
  patch: [
    'diff --git a/demo.txt b/demo.txt',
    'index be6d0ff..f4aa735 100644',
    '--- a/demo.txt',
    '+++ b/demo.txt',
    '@@ -1,4 +1,4 @@',
    ' alpha',
    ' read',
    ' write',
    '-omega patched',
    '+omega copied',
    'diff --git a/demo.txt b/.env',
    'similarity index 100%',
    'copy from demo.txt',
    'copy to .env'
  ].join('\n') + '\n'
}, /blocked/i);
await expectToolError('apply_patch', {
  workspace_id: ws,
  patch: [
    'diff --git a/link-outside b/link-outside',
    'new file mode 120000 ',
    'index 0000000..2e65efe',
    '--- /dev/null',
    '+++ b/link-outside',
    '@@ -0,0 +1 @@',
    '+/tmp/outside-target'
  ].join('\n') + '\n'
}, /symlink/i);
const postPatchChanges = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws } });
if (!postPatchChanges.structuredContent.changed || !postPatchChanges.structuredContent.diff.includes('omega patched')) {
  throw new Error(`show_changes did not report new patch changes after checkpoint: ${JSON.stringify(postPatchChanges.structuredContent)}`);
}
const statsOnlyDiff = await client.request('tools/call', { name: 'git_diff', arguments: { workspace_id: ws, include_diff: false } });
if (statsOnlyDiff.structuredContent.include_diff !== false || statsOnlyDiff.structuredContent.diff !== '') {
  throw new Error(`git_diff include_diff=false returned raw diff: ${JSON.stringify(statsOnlyDiff.structuredContent)}`);
}
if (!statsOnlyDiff.content?.[0]?.text?.includes('Raw diff omitted by include_diff=false')) {
  throw new Error('git_diff include_diff=false did not report omitted diff in text output');
}
const statsOnlyChanges = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws, path: 'other.txt', include_diff: false } });
if (!statsOnlyChanges.structuredContent.changed || statsOnlyChanges.structuredContent.diff !== '') {
  throw new Error(`show_changes include_diff=false should keep stats and omit diff: ${JSON.stringify(statsOnlyChanges.structuredContent)}`);
}
const fullChangesAfterStatsOnly = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws, path: './other.txt' } });
if (!fullChangesAfterStatsOnly.structuredContent.changed || fullChangesAfterStatsOnly.structuredContent.review_checkpoint_hit || !fullChangesAfterStatsOnly.structuredContent.diff.includes('other.txt')) {
  throw new Error(`show_changes include_diff=false consumed the next full diff: ${JSON.stringify(fullChangesAfterStatsOnly.structuredContent)}`);
}
const statsOnlyAfterCheckpoint = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws, path: 'other.txt', include_diff: false } });
if (!statsOnlyAfterCheckpoint.structuredContent.changed || statsOnlyAfterCheckpoint.structuredContent.diff !== '' || statsOnlyAfterCheckpoint.structuredContent.additions !== 1) {
  throw new Error(`show_changes include_diff=false lost stats after checkpoint: ${JSON.stringify(statsOnlyAfterCheckpoint.structuredContent)}`);
}
if (statsOnlyAfterCheckpoint.structuredContent.review_marked) {
  throw new Error(`show_changes include_diff=false claimed it updated the review checkpoint: ${JSON.stringify(statsOnlyAfterCheckpoint.structuredContent)}`);
}
const demoChanges = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws, path: 'demo.txt' } });
if (!demoChanges.structuredContent.changed || !demoChanges.structuredContent.changed_files?.some?.((line) => line.includes('demo.txt'))) {
  throw new Error(`path-scoped show_changes did not report demo.txt: ${JSON.stringify(demoChanges.structuredContent.changed_files)}`);
}
if (demoChanges.structuredContent.changed_files?.some?.((line) => line.includes('env-ref.js'))) {
  throw new Error(`path-scoped show_changes leaked unrelated env-ref.js status: ${JSON.stringify(demoChanges.structuredContent.changed_files)}`);
}
if (JSON.stringify(demoChanges.structuredContent.analysis?.changed_paths) !== JSON.stringify(['demo.txt'])) {
  throw new Error(`path-scoped show_changes leaked unrelated analysis: ${JSON.stringify(demoChanges.structuredContent.analysis)}`);
}
await fs.writeFile(path.join(tmp, 'é.ts'), 'export const accent = 2;\n', 'utf8');
const utf8Changes = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws, path: 'é.ts', since: 'workspace' } });
if (JSON.stringify(utf8Changes.structuredContent.analysis?.changed_paths) !== JSON.stringify(['é.ts'])) {
  throw new Error(`show_changes did not decode a Git-quoted UTF-8 path: ${JSON.stringify(utf8Changes.structuredContent.analysis)}`);
}
const renameResult = spawnSync('git', ['mv', '旧名.ts', '新名.ts'], { cwd: tmp, encoding: 'utf8' });
if (renameResult.status !== 0) throw new Error(`git mv UTF-8 path failed: ${renameResult.stderr || renameResult.stdout}`);
const utf8RenameChanges = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws, staged: true, since: 'workspace' } });
if (!utf8RenameChanges.structuredContent.analysis?.changed_paths?.includes?.('新名.ts')) {
  throw new Error(`show_changes did not decode a Git-quoted UTF-8 rename: ${JSON.stringify(utf8RenameChanges.structuredContent.analysis)}`);
}
const restoreRenameResult = spawnSync('git', ['mv', '新名.ts', '旧名.ts'], { cwd: tmp, encoding: 'utf8' });
if (restoreRenameResult.status !== 0) throw new Error(`git mv UTF-8 fixture restore failed: ${restoreRenameResult.stderr || restoreRenameResult.stdout}`);
const cleanPathChanges = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws, path: 'package.json' } });
if (cleanPathChanges.structuredContent.changed || cleanPathChanges.structuredContent.changed_files?.length || cleanPathChanges.structuredContent.diff.includes('demo.txt')) {
  throw new Error(`path-scoped show_changes leaked unrelated changes: ${JSON.stringify(cleanPathChanges.structuredContent)}`);
}
await fs.writeFile(path.join(tmp, 'staged-only.txt'), 'ready\n', 'utf8');
const stageOnlyResult = spawnSync('git', ['add', 'staged-only.txt'], { cwd: tmp, encoding: 'utf8' });
if (stageOnlyResult.status !== 0) throw new Error(`git add staged-only.txt failed: ${stageOnlyResult.stderr || stageOnlyResult.stdout}`);
await fs.writeFile(path.join(tmp, 'unstaged-only.txt'), 'dirty\n', 'utf8');
const defaultStagedPathChanges = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws, path: 'staged-only.txt' } });
if (defaultStagedPathChanges.structuredContent.changed || defaultStagedPathChanges.structuredContent.diff || defaultStagedPathChanges.structuredContent.additions !== 0) {
  throw new Error(`default show_changes reported staged-only changes as unstaged: ${JSON.stringify(defaultStagedPathChanges.structuredContent)}`);
}
const stagedChanges = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws, staged: true } });
if (!stagedChanges.structuredContent.changed || !stagedChanges.structuredContent.diff.includes('staged-only.txt') || stagedChanges.structuredContent.diff.includes('unstaged-only.txt')) {
  throw new Error(`staged show_changes mixed staged and unstaged files: ${JSON.stringify(stagedChanges.structuredContent)}`);
}
if (JSON.stringify(stagedChanges.structuredContent.analysis?.changed_paths) !== JSON.stringify(['staged-only.txt'])) {
  throw new Error(`staged show_changes mixed analysis paths: ${JSON.stringify(stagedChanges.structuredContent.analysis)}`);
}
await client.request('tools/call', { name: 'write', arguments: { workspace_id: ws, path: 'new-review.txt', content: 'new file\n' } });
const untrackedChanges = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws, path: 'new-review.txt' } });
if (!untrackedChanges.structuredContent.changed || !untrackedChanges.structuredContent.changed_files?.some?.((line) => line.includes('new-review.txt'))) {
  throw new Error(`show_changes did not report untracked new file: ${JSON.stringify(untrackedChanges.structuredContent)}`);
}
await fs.writeFile(path.join(tmp, 'new-review.txt'), 'new file changed\n', 'utf8');
const changedUntrackedChanges = await client.request('tools/call', { name: 'show_changes', arguments: { workspace_id: ws, path: 'new-review.txt' } });
if (!changedUntrackedChanges.structuredContent.changed || changedUntrackedChanges.structuredContent.review_checkpoint_hit) {
  throw new Error(`show_changes checkpoint hid changed untracked file content: ${JSON.stringify(changedUntrackedChanges.structuredContent)}`);
}
const codexContext = await client.request('tools/call', { name: 'codex_context', arguments: { workspace_id: ws, target_path: 'demo.txt' } });
if (!codexContext.structuredContent.agents_files.includes('AGENTS.md')) throw new Error('codex_context did not include AGENTS.md');
if (codexContext.structuredContent.agents_files.length !== 1) throw new Error(`codex_context returned duplicate AGENTS files: ${codexContext.structuredContent.agents_files.join(', ')}`);
if (!codexContext.content?.[0]?.text?.includes('Smoke Agents')) throw new Error('codex_context did not include AGENTS.md content');
const pwdBash = await client.request('tools/call', { name: 'bash', arguments: { workspace_id: ws, command: 'pwd' } });
const pwdBashText = pwdBash.content?.[0]?.text ?? '';
if (!pwdBashText.includes('Exit: 0') || pwdBashText.includes('## stdout') || pwdBashText.includes('## stderr')) {
  throw new Error(`default bash transcript should be compact: ${pwdBashText}`);
}
if (!pwdBash.structuredContent.stdout?.includes(tmp)) {
  throw new Error(`compact bash transcript dropped structured stdout: ${JSON.stringify(pwdBash.structuredContent)}`);
}
await expectToolError('bash', { workspace_id: ws, command: 'find /tmp' }, /blocked/i);
await expectToolError('bash', { workspace_id: ws, command: 'find . -fprint leaked.txt' }, /blocked/i);
await expectToolError('bash', { workspace_id: ws, command: 'git show HEAD:.env' }, /blocked/i);
await expectToolError('bash', { workspace_id: ws, command: 'ls $HOME' }, /blocked/i);
const clientBuild = await client.request('tools/call', { name: 'bash', arguments: { workspace_id: ws, command: 'npm run build:clients', timeout_ms: 60000 } });
if (!clientBuild.structuredContent.stdout?.includes('clients ok')) {
  throw new Error('safe bash did not run npm run build:clients');
}
const exported = await client.request('tools/call', { name: 'export_pro_context', arguments: { workspace_id: ws, selected_paths: ['demo.txt'], max_files: 4, max_total_bytes: 80000 } });
if (exported.structuredContent.path !== '.ai-bridge/pro-context.md') throw new Error('export_pro_context wrote an unexpected path');
if (!exported.structuredContent.files_included?.includes('demo.txt')) {
  throw new Error(`export_pro_context dropped an explicit selected path: ${JSON.stringify(exported.structuredContent.files_included)}`);
}
await fs.stat(path.join(tmp, '.ai-bridge', 'pro-context.md'));
const oneFileExport = await client.request('tools/call', {
  name: 'export_pro_context',
  arguments: {
    workspace_id: ws,
    selected_paths: ['demo.txt'],
    max_files: 1,
    max_total_bytes: 80000
  }
});
if (JSON.stringify(oneFileExport.structuredContent.files_included) !== JSON.stringify(['demo.txt'])) {
  throw new Error(`export_pro_context did not prioritize selected path with max_files=1: ${JSON.stringify(oneFileExport.structuredContent.files_included)}`);
}
const exactExport = await client.request('tools/call', {
  name: 'export_pro_context',
  arguments: {
    workspace_id: ws,
    selected_paths: ['demo.txt'],
    include_important_files: false,
    include_changed_files: false,
    include_diff: false,
    include_ai_bridge: false,
    max_files: 4,
    max_total_bytes: 80000
  }
});
if (!exactExport.structuredContent.files_included?.includes('demo.txt')) {
  throw new Error(`selected-only export did not include demo.txt: ${JSON.stringify(exactExport.structuredContent.files_included)}`);
}
if (exactExport.structuredContent.files_included?.some?.((file) => file !== 'demo.txt')) {
  throw new Error(`selected-only export included unexpected files: ${JSON.stringify(exactExport.structuredContent.files_included)}`);
}
const exactProContext = await fs.readFile(path.join(tmp, '.ai-bridge', 'pro-context.md'), 'utf8');
if (!exactProContext.includes('Auto-include important root files: no') || !exactProContext.includes('Auto-include changed files: no')) {
  throw new Error('selected-only export did not record disabled auto-inclusion settings');
}
if (exactProContext.includes('### AGENTS.md') || exactProContext.includes('### package.json') || exactProContext.includes('### env-ref.js')) {
  throw new Error('selected-only export leaked auto-included important or changed files');
}
const agentHandoff = await client.request('tools/call', {
  name: 'handoff_to_agent',
  arguments: {
    workspace_id: ws,
    agent: 'opencode',
    model: 'provider/cheap-model',
    title: 'Smoke agent plan',
    plan: '- Verify demo.txt contains write.'
  }
});
if (agentHandoff.structuredContent.agent !== 'opencode') throw new Error('handoff_to_agent did not preserve target agent');
const escapedHandoff = await client.request('tools/call', {
  name: 'handoff_to_agent',
  arguments: {
    workspace_id: ws,
    agent: 'opencode',
    model: 'foo; touch /tmp/pwned',
    title: 'Escaped model plan',
    plan: '- Verify shell hints quote model names.'
  }
});
const escapedPrompt = escapedHandoff.content?.find?.((part) => part.type === 'text')?.text ?? '';
if (!escapedPrompt.includes("--model 'foo; touch /tmp/pwned'")) {
  throw new Error(`handoff_to_agent did not shell-quote the model hint: ${escapedPrompt}`);
}
if (escapedPrompt.includes('--model foo; touch')) {
  throw new Error(`handoff_to_agent exposed an unquoted model hint: ${escapedPrompt}`);
}
for (const bridgeFile of ['agent-status.md', 'implementation-diff.patch', 'execution-log.jsonl']) {
  await fs.stat(path.join(tmp, '.ai-bridge', bridgeFile));
}
const handoffContext = await client.request('tools/call', { name: 'read_handoff', arguments: { workspace_id: ws } });
for (const expectedFile of ['.ai-bridge/agent-status.md', '.ai-bridge/implementation-diff.patch', '.ai-bridge/execution-log.jsonl']) {
  if (!handoffContext.structuredContent.files.includes(expectedFile)) {
    throw new Error(`read_handoff did not include ${expectedFile}`);
  }
}
const runStatePayload = {
  version: 1,
  state: 'completed',
  iteration: 1,
  plan_hash: 'smoke-plan-hash',
  executor: 'opencode',
  model: 'provider/cheap-model',
  exit_code: 0,
  timed_out: false,
  started_at: new Date(Date.now() - 1000).toISOString(),
  finished_at: new Date().toISOString(),
  status_file: '.ai-bridge/agent-status.md',
  diff_file: '.ai-bridge/implementation-diff.patch',
  log_file: '.ai-bridge/execution-log.jsonl'
};
await fs.writeFile(path.join(tmp, '.ai-bridge', 'handoff-run-state.json'), `${JSON.stringify(runStatePayload, null, 2)}\n`, 'utf8');
const waitCompleted = await client.request('tools/call', {
  name: 'wait_for_handoff',
  arguments: { workspace_id: ws, max_wait_seconds: 1, poll_ms: 250, plan_hash: 'smoke-plan-hash' }
});
if (waitCompleted.structuredContent.awaited_completed !== true || waitCompleted.structuredContent.state !== 'completed') {
  throw new Error(`wait_for_handoff did not report completion: ${JSON.stringify(waitCompleted.structuredContent)}`);
}
if (waitCompleted.structuredContent.awaited_terminal !== true || waitCompleted.structuredContent.succeeded !== true) {
  throw new Error(`wait_for_handoff did not report terminal success fields: ${JSON.stringify(waitCompleted.structuredContent)}`);
}
if (waitCompleted.structuredContent.exit_code !== 0 || waitCompleted.structuredContent.status_file !== '.ai-bridge/agent-status.md') {
  throw new Error(`wait_for_handoff missing completion fields: ${JSON.stringify(waitCompleted.structuredContent)}`);
}
const waitMismatch = await client.request('tools/call', {
  name: 'wait_for_handoff',
  arguments: { workspace_id: ws, max_wait_seconds: 1, poll_ms: 250, plan_hash: 'a-different-hash' }
});
if (waitMismatch.structuredContent.awaited_completed !== false || waitMismatch.structuredContent.state !== 'running' || waitMismatch.structuredContent.plan_hash_mismatch !== true) {
  throw new Error(`wait_for_handoff did not keep waiting on plan-hash mismatch: ${JSON.stringify(waitMismatch.structuredContent)}`);
}
await fs.writeFile(path.join(tmp, '.ai-bridge', 'handoff-run-state.json'), `${JSON.stringify({
  ...runStatePayload,
  state: 'failed',
  plan_hash: 'failed-plan',
  exit_code: 2,
  status_file: 'demo.txt',
  diff_file: '../demo.txt',
  log_file: '.ai-bridge/execution-log.jsonl'
}, null, 2)}\n`, 'utf8');
const waitFailed = await client.request('tools/call', {
  name: 'wait_for_handoff',
  arguments: { workspace_id: ws, max_wait_seconds: 1, poll_ms: 250, plan_hash: 'failed-plan' }
});
if (waitFailed.structuredContent.awaited_terminal !== true || waitFailed.structuredContent.awaited_completed !== false || waitFailed.structuredContent.succeeded !== false || waitFailed.structuredContent.state !== 'failed') {
  throw new Error(`wait_for_handoff did not report failed terminal state: ${JSON.stringify(waitFailed.structuredContent)}`);
}
if (waitFailed.structuredContent.status_file !== '.ai-bridge/agent-status.md' || waitFailed.structuredContent.diff_file !== '.ai-bridge/implementation-diff.patch') {
  throw new Error(`wait_for_handoff trusted forged artifact paths: ${JSON.stringify(waitFailed.structuredContent)}`);
}
await fs.writeFile(path.join(tmp, '.ai-bridge', 'handoff-run-state.json'), `${JSON.stringify({
  ...runStatePayload,
  state: 'timed_out',
  plan_hash: 'timed-out-plan',
  exit_code: null,
  timed_out: true
}, null, 2)}\n`, 'utf8');
const waitTimedOut = await client.request('tools/call', {
  name: 'wait_for_handoff',
  arguments: { workspace_id: ws, max_wait_seconds: 1, poll_ms: 250, plan_hash: 'timed-out-plan' }
});
if (waitTimedOut.structuredContent.awaited_terminal !== true || waitTimedOut.structuredContent.awaited_completed !== false || waitTimedOut.structuredContent.succeeded !== false || waitTimedOut.structuredContent.state !== 'timed_out') {
  throw new Error(`wait_for_handoff did not report timed-out terminal state: ${JSON.stringify(waitTimedOut.structuredContent)}`);
}
await fs.rm(path.join(tmp, '.ai-bridge', 'handoff-run-state.json'), { force: true });
await client.request('tools/call', { name: 'handoff_to_codex', arguments: { workspace_id: ws, title: 'Smoke Codex plan', plan: '- Verify demo.txt contains write.', append: true } });
await fs.writeFile(path.join(tmp, '.ai-bridge', 'current-plan.md'), 'x'.repeat(190000), 'utf8');
await expectToolError('handoff_to_agent', {
  workspace_id: ws,
  agent: 'opencode',
  title: 'Oversized append plan',
  plan: '- This append should fail before loading the existing plan.',
  append: true
}, /File is too large/);
client.close();
async function assertToolMode(mode, expected, hidden, extraEnv = {}) {
  const args = ['dist/stdio.js', '--root', tmp, '--allow-root', tmp, '--bash', 'safe'];
  if (mode) args.push('--tool-mode', mode);
  const modeClient = new McpStdioClient('node', args, {
    cwd: path.resolve('.'),
    env: { ...process.env, CODEXFLOW_ROOT: tmp, CODEXFLOW_ALLOWED_ROOTS: tmp, CODEXFLOW_TOOL_MODE: '', ...extraEnv }
  });
  await modeClient.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: `codexflow-${mode || 'default'}-smoke`, version: '0.1.0' }
  });
  modeClient.notify('notifications/initialized');
  const modeTools = await modeClient.request('tools/list', {});
  const names = modeTools.tools.map((tool) => tool.name);
  for (const expectedName of expected) {
    if (!names.includes(expectedName)) throw new Error(`${mode || 'default'} mode missing ${expectedName}; got ${names.join(', ')}`);
  }
  for (const hiddenName of hidden) {
    if (names.includes(hiddenName)) throw new Error(`${mode || 'default'} mode should hide ${hiddenName}; got ${names.join(', ')}`);
  }
  const superActions = await modeClient.request('tools/call', { name: 'codexflow', arguments: { action: 'list_actions' } });
  const expectedActions = names.filter((name) => name !== 'codexflow').sort();
  const actualActions = [...superActions.structuredContent.actions].sort();
  if (JSON.stringify(actualActions) !== JSON.stringify(expectedActions)) {
    throw new Error(`${mode || 'default'} supertool actions did not match registered tools: expected ${expectedActions.join(', ')} got ${actualActions.join(', ')}`);
  }
  modeClient.close();
}

await assertToolMode('', ['codexflow', 'server_config', 'codexflow_self_test', 'list_projects', 'select_project', 'open_current_workspace', 'open_workspace', 'inspect_workspace', 'tree', 'search', 'load_skill', 'read', 'write', 'edit', 'apply_patch', 'bash', 'show_changes', 'prepare_scheduled_task', 'read_handoff', 'wait_for_handoff', 'export_pro_context', 'handoff_to_agent'], ['codexflow_inventory', 'workspace_snapshot', 'git_status', 'git_diff', 'codex_context', 'handoff_to_codex']);
await assertToolMode('minimal', ['codexflow', 'server_config', 'codexflow_self_test', 'list_projects', 'select_project', 'open_current_workspace', 'open_workspace', 'load_skill', 'read', 'write', 'edit', 'apply_patch', 'bash', 'show_changes'], ['inspect_workspace', 'tree', 'search', 'prepare_scheduled_task', 'read_handoff', 'wait_for_handoff', 'export_pro_context', 'handoff_to_agent', 'codex_context']);
await assertToolMode('', ['codexflow', 'server_config', 'show_changes', 'search'], ['inspect_workspace'], { CODEXFLOW_ANALYSIS: '0' });

const handoffWriteClient = new McpStdioClient('node', ['dist/stdio.js', '--root', tmp, '--allow-root', tmp, '--write', 'handoff'], {
  cwd: path.resolve('.'),
  env: { ...process.env, CODEXFLOW_ROOT: tmp, CODEXFLOW_ALLOWED_ROOTS: tmp, CODEXFLOW_TOOL_MODE: '' }
});
await handoffWriteClient.request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'codexflow-write-handoff-smoke', version: '0.1.0' }
});
handoffWriteClient.notify('notifications/initialized');
const handoffWriteTools = await handoffWriteClient.request('tools/list', {});
const handoffWriteToolNames = handoffWriteTools.tools.map((tool) => tool.name);
for (const hiddenWriteTool of ['write', 'edit', 'apply_patch', 'git_workflow', 'local_environment', 'worktree']) {
  if (handoffWriteToolNames.includes(hiddenWriteTool)) {
    throw new Error(`--write handoff should not advertise ${hiddenWriteTool} tool; got ${handoffWriteToolNames.join(', ')}`);
  }
}
const handoffWriteConfig = await handoffWriteClient.request('tools/call', { name: 'server_config', arguments: {} });
if (handoffWriteConfig.structuredContent.writeMode !== 'handoff' || handoffWriteConfig.structuredContent.registeredTools?.includes?.('write') || handoffWriteConfig.structuredContent.registeredTools?.includes?.('edit') || handoffWriteConfig.structuredContent.registeredTools?.includes?.('apply_patch')) {
  throw new Error(`server_config did not report write handoff with hidden edit tools: ${JSON.stringify(handoffWriteConfig.structuredContent)}`);
}
const handoffSelfTest = await handoffWriteClient.request('tools/call', { name: 'codexflow_self_test', arguments: { write_probe: false, bash_probe: false, pro_context_probe: false } });
if (handoffSelfTest.structuredContent.status === 'fail') {
  throw new Error(`codexflow_self_test failed under --write handoff: ${JSON.stringify(handoffSelfTest.structuredContent)}`);
}
for (const hiddenWriteTool of ['write', 'edit', 'apply_patch', 'git_workflow', 'local_environment', 'worktree']) {
  if (handoffSelfTest.structuredContent.expected_tools?.includes?.(hiddenWriteTool) || handoffSelfTest.structuredContent.registered_tools?.includes?.(hiddenWriteTool)) {
    throw new Error(`codexflow_self_test exposed ${hiddenWriteTool} under --write handoff: ${JSON.stringify(handoffSelfTest.structuredContent)}`);
  }
}
handoffWriteClient.close();

const noBashClient = new McpStdioClient('node', ['dist/stdio.js', '--root', tmp, '--allow-root', tmp, '--bash', 'off'], {
  cwd: path.resolve('.'),
  env: { ...process.env, CODEXFLOW_ROOT: tmp, CODEXFLOW_ALLOWED_ROOTS: tmp, CODEXFLOW_TOOL_MODE: '' }
});
await noBashClient.request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'codexflow-no-bash-smoke', version: '0.1.0' }
});
noBashClient.notify('notifications/initialized');
const noBashTools = await noBashClient.request('tools/list', {});
const noBashToolNames = noBashTools.tools.map((tool) => tool.name);
for (const hidden of ['bash', 'terminal', 'local_environment']) {
  if (noBashToolNames.includes(hidden)) {
    throw new Error(`--bash off should not advertise ${hidden} tool; got ${noBashToolNames.join(', ')}`);
  }
}
const noBashConfig = await noBashClient.request('tools/call', { name: 'server_config', arguments: {} });
if (noBashConfig.structuredContent.bashMode !== 'off') {
  throw new Error(`server_config did not report bash off: ${JSON.stringify(noBashConfig.structuredContent)}`);
}
noBashClient.close();

const disabledWriteClient = new McpStdioClient('node', ['dist/stdio.js', '--root', tmp, '--allow-root', tmp, '--write', 'off'], {
  cwd: path.resolve('.'),
  env: { ...process.env, CODEXFLOW_ROOT: tmp, CODEXFLOW_ALLOWED_ROOTS: tmp, CODEXFLOW_TOOL_MODE: '' }
});
await disabledWriteClient.request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'codexflow-write-off-smoke', version: '0.1.0' }
});
disabledWriteClient.notify('notifications/initialized');
const disabledWriteTools = await disabledWriteClient.request('tools/list', {});
const disabledWriteToolNames = disabledWriteTools.tools.map((tool) => tool.name);
for (const hiddenWriteTool of ['write', 'edit', 'apply_patch', 'git_workflow', 'local_environment', 'worktree']) {
  if (disabledWriteToolNames.includes(hiddenWriteTool)) {
    throw new Error(`--write off should not advertise ${hiddenWriteTool} tool; got ${disabledWriteToolNames.join(', ')}`);
  }
}
const disabledWriteConfig = await disabledWriteClient.request('tools/call', { name: 'server_config', arguments: {} });
if (disabledWriteConfig.structuredContent.writeMode !== 'off') {
  throw new Error(`server_config did not report write off: ${JSON.stringify(disabledWriteConfig.structuredContent)}`);
}
const disabledSelfTest = await disabledWriteClient.request('tools/call', { name: 'codexflow_self_test', arguments: { write_probe: false, bash_probe: false, pro_context_probe: false } });
if (disabledSelfTest.structuredContent.status === 'fail') {
  throw new Error(`codexflow_self_test failed under --write off: ${JSON.stringify(disabledSelfTest.structuredContent)}`);
}
for (const hiddenWriteTool of ['write', 'edit', 'apply_patch', 'git_workflow', 'local_environment', 'worktree']) {
  if (disabledSelfTest.structuredContent.expected_tools?.includes?.(hiddenWriteTool) || disabledSelfTest.structuredContent.registered_tools?.includes?.(hiddenWriteTool)) {
    throw new Error(`codexflow_self_test exposed ${hiddenWriteTool} under --write off: ${JSON.stringify(disabledSelfTest.structuredContent)}`);
  }
}
disabledWriteClient.close();

const standardCodexSessionsClient = new McpStdioClient('node', ['dist/stdio.js', '--root', tmp, '--allow-root', tmp], {
  cwd: path.resolve('.'),
  env: {
    ...process.env,
    CODEXFLOW_ROOT: tmp,
    CODEXFLOW_ALLOWED_ROOTS: tmp,
    CODEXFLOW_CODEX_SESSIONS: 'metadata',
    CODEXFLOW_CODEX_DIR: codexHistoryDir
  }
});
await standardCodexSessionsClient.request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'codexflow-standard-codex-sessions-smoke', version: '0.1.0' }
});
standardCodexSessionsClient.notify('notifications/initialized');
const standardCodexSessionTools = await standardCodexSessionsClient.request('tools/list', {});
const standardCodexSessionToolNames = standardCodexSessionTools.tools.map((tool) => tool.name);
if (!standardCodexSessionToolNames.includes('codex_sessions')) {
  throw new Error(`standard mode with Codex sessions enabled missed codex_sessions: ${standardCodexSessionToolNames.join(', ')}`);
}
if (standardCodexSessionToolNames.includes('read_codex_session')) {
  throw new Error(`metadata mode should not expose read_codex_session: ${standardCodexSessionToolNames.join(', ')}`);
}
const metadataSessions = await standardCodexSessionsClient.request('tools/call', { name: 'codex_sessions', arguments: { query: 'Large tail summary', max_sessions: 5 } });
if (metadataSessions.structuredContent.total_found !== 0 || JSON.stringify(metadataSessions.structuredContent).includes('Large tail summary')) {
  throw new Error(`metadata mode exposed transcript tail content: ${JSON.stringify(metadataSessions.structuredContent)}`);
}
standardCodexSessionsClient.close();

const fullTranscriptClient = new McpStdioClient('node', ['dist/stdio.js', '--root', tmp, '--allow-root', tmp, '--bash', 'safe'], {
  cwd: path.resolve('.'),
  env: { ...process.env, CODEXFLOW_ROOT: tmp, CODEXFLOW_ALLOWED_ROOTS: tmp, CODEXFLOW_BASH_TRANSCRIPT: 'full' }
});
await fullTranscriptClient.request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'codexflow-full-bash-transcript-smoke', version: '0.1.0' }
});
fullTranscriptClient.notify('notifications/initialized');
const fullTranscriptBash = await fullTranscriptClient.request('tools/call', { name: 'bash', arguments: { command: 'pwd' } });
const fullTranscriptText = fullTranscriptBash.content?.[0]?.text ?? '';
if (!fullTranscriptText.includes('## stdout') || !fullTranscriptText.includes(tmp)) {
  throw new Error(`full bash transcript mode did not preserve raw stdout in chat text: ${fullTranscriptText}`);
}
fullTranscriptClient.close();

const emptyCodexDirClient = new McpStdioClient('node', ['dist/stdio.js', '--root', tmp, '--allow-root', tmp], {
  cwd: path.resolve('.'),
  env: {
    ...process.env,
    CODEXFLOW_ROOT: tmp,
    CODEXFLOW_ALLOWED_ROOTS: tmp,
    CODEXFLOW_CODEX_DIR: ''
  }
});
await emptyCodexDirClient.request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'codexflow-empty-codex-dir-smoke', version: '0.1.0' }
});
emptyCodexDirClient.notify('notifications/initialized');
const emptyCodexDirConfig = await emptyCodexDirClient.request('tools/call', { name: 'server_config', arguments: {} });
const expectedDefaultCodexDir = path.join(os.homedir(), '.codex');
if (emptyCodexDirConfig.structuredContent.codexDir !== expectedDefaultCodexDir) {
  throw new Error(`empty CODEXFLOW_CODEX_DIR resolved to ${emptyCodexDirConfig.structuredContent.codexDir}, expected ${expectedDefaultCodexDir}`);
}
emptyCodexDirClient.close();

const invalidContextDir = spawnSync('node', ['dist/stdio.js', '--root', tmp, '--allow-root', tmp], {
  cwd: path.resolve('.'),
  env: { ...process.env, CODEXFLOW_ROOT: tmp, CODEXFLOW_ALLOWED_ROOTS: tmp, CODEXFLOW_CONTEXT_DIR: 'src' },
  encoding: 'utf8',
  timeout: 5000
});
if (invalidContextDir.status === 0 || !String(invalidContextDir.stderr || invalidContextDir.stdout).includes('CODEXFLOW_CONTEXT_DIR')) {
  throw new Error(`invalid CODEXFLOW_CONTEXT_DIR=src was not rejected: status=${invalidContextDir.status} stdout=${invalidContextDir.stdout} stderr=${invalidContextDir.stderr}`);
}

const codexSessionsClient = new McpStdioClient('node', ['dist/stdio.js', '--root', tmp, '--allow-root', tmp, '--tool-mode', 'full'], {
  cwd: path.resolve('.'),
  env: {
    ...process.env,
    CODEXFLOW_ROOT: tmp,
    CODEXFLOW_ALLOWED_ROOTS: tmp,
    CODEXFLOW_CODEX_SESSIONS: 'read',
    CODEXFLOW_CODEX_DIR: codexHistoryDir
  }
});
await codexSessionsClient.request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'codexflow-codex-sessions-smoke', version: '0.1.0' }
});
codexSessionsClient.notify('notifications/initialized');
const codexSessionTools = await codexSessionsClient.request('tools/list', {});
const codexSessionToolNames = codexSessionTools.tools.map((tool) => tool.name);
for (const expectedName of ['codex_sessions', 'read_codex_session']) {
  if (!codexSessionToolNames.includes(expectedName)) {
    throw new Error(`codex session opt-in mode missing ${expectedName}: ${codexSessionToolNames.join(', ')}`);
  }
}
const codexSessions = await codexSessionsClient.request('tools/call', { name: 'codex_sessions', arguments: { max_sessions: 5 } });
const session = codexSessions.structuredContent.sessions?.[0];
if (!session || session.session_id !== '019cc369-bd7c-7891-b371-7b20b4fe0b18' || session.title !== 'Fix the smoke session browser' || session.project_dir !== tmp) {
  throw new Error(`codex_sessions did not return parsed Codex metadata: ${JSON.stringify(codexSessions.structuredContent)}`);
}
if (session.resume_command !== 'codex resume 019cc369-bd7c-7891-b371-7b20b4fe0b18') {
  throw new Error(`codex_sessions returned wrong resume command: ${JSON.stringify(session)}`);
}
const codexTranscript = await codexSessionsClient.request('tools/call', {
  name: 'read_codex_session',
  arguments: { session_id: '019cc369-bd7c-7891-b371-7b20b4fe0b18', max_messages: 10 }
});
if (!codexTranscript.content?.[0]?.text?.includes('Fix the smoke session browser') || !codexTranscript.content?.[0]?.text?.includes('[Tool: bash]')) {
  throw new Error(`read_codex_session did not return bounded transcript text: ${codexTranscript.content?.[0]?.text}`);
}
const topOneSessions = await codexSessionsClient.request('tools/call', { name: 'codex_sessions', arguments: { max_sessions: 1 } });
if (topOneSessions.structuredContent.sessions?.some?.((item) => item.session_id === olderCodexSessionId)) {
  throw new Error(`codex_sessions max_sessions did not limit visible results: ${JSON.stringify(topOneSessions.structuredContent)}`);
}
const olderCodexTranscript = await codexSessionsClient.request('tools/call', {
  name: 'read_codex_session',
  arguments: { session_id: olderCodexSessionId, max_messages: 10 }
});
if (!olderCodexTranscript.content?.[0]?.text?.includes('Older session still readable by id')) {
  throw new Error(`read_codex_session only searched visible list window: ${olderCodexTranscript.content?.[0]?.text}`);
}
const sourcePathTranscript = await codexSessionsClient.request('tools/call', {
  name: 'read_codex_session',
  arguments: { source_path: session.source_path, max_messages: 10 }
});
if (!sourcePathTranscript.content?.[0]?.text?.includes('Fix the smoke session browser')) {
  throw new Error(`read_codex_session rejected source_path returned by codex_sessions: ${sourcePathTranscript.content?.[0]?.text}`);
}
const largeTailSessions = await codexSessionsClient.request('tools/call', { name: 'codex_sessions', arguments: { query: 'Large tail summary', max_sessions: 5 } });
if (largeTailSessions.structuredContent.total_found !== 0 || JSON.stringify(largeTailSessions.structuredContent).includes('Large tail summary')) {
  throw new Error(`read mode codex_sessions exposed transcript tail summary: ${JSON.stringify(largeTailSessions.structuredContent)}`);
}
codexSessionsClient.close();

const sessionGuardClient = new McpStdioClient('node', [
  'dist/stdio.js',
  '--root',
  tmp,
  '--allow-root',
  tmp,
  '--bash',
  'safe',
  '--bash-session',
  'codex-main',
  '--require-bash-session'
], {
  cwd: path.resolve('.'),
  env: {
    ...process.env,
    CODEXFLOW_ROOT: tmp,
    CODEXFLOW_ALLOWED_ROOTS: tmp,
    CODEXFLOW_BASH_SESSION_ID: '',
    CODEXFLOW_REQUIRE_BASH_SESSION: ''
  }
});
await sessionGuardClient.request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'codexflow-bash-session-smoke', version: '0.1.0' }
});
sessionGuardClient.notify('notifications/initialized');
const guardedConfig = await sessionGuardClient.request('tools/call', { name: 'server_config', arguments: {} });
if (guardedConfig.structuredContent.bashSessionId !== 'codex-main' || guardedConfig.structuredContent.requireBashSession !== true) {
  throw new Error(`server_config did not expose bash session guard: ${JSON.stringify(guardedConfig.structuredContent)}`);
}
await expectToolError('bash', { command: 'pwd' }, /bash session/i, sessionGuardClient);
await expectToolError('bash', { command: 'pwd', session_id: 'other-session' }, /codex-main/i, sessionGuardClient);
const guardedBash = await sessionGuardClient.request('tools/call', { name: 'bash', arguments: { command: 'pwd', session_id: 'codex-main' } });
if (guardedBash.structuredContent.bash_session_id !== 'codex-main' || !guardedBash.content?.[0]?.text?.includes('Exit: 0')) {
  throw new Error(`bash session guard did not allow matching session id: ${JSON.stringify(guardedBash.structuredContent)}`);
}
const guardedSelfTest = await sessionGuardClient.request('tools/call', {
  name: 'codexflow_self_test',
  arguments: { write_probe: false, pro_context_probe: false }
});
if (guardedSelfTest.structuredContent.status === 'fail') {
  throw new Error(`codexflow_self_test failed under bash session guard: ${JSON.stringify(guardedSelfTest.structuredContent.checks)}`);
}
sessionGuardClient.close();

const nonGitRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-non-git-'));
await fs.writeFile(path.join(nonGitRoot, 'README.md'), '# Non-git fixture\n', 'utf8');
const nonGitClient = new McpStdioClient('node', ['dist/stdio.js', '--root', nonGitRoot, '--allow-root', nonGitRoot, '--tool-mode', 'full'], {
  cwd: path.resolve('.'),
  env: { ...process.env, CODEXFLOW_ROOT: nonGitRoot, CODEXFLOW_ALLOWED_ROOTS: nonGitRoot }
});
await nonGitClient.request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'codexflow-non-git-smoke', version: '0.1.0' }
});
nonGitClient.notify('notifications/initialized');
const nonGitDiff = await nonGitClient.request('tools/call', { name: 'git_diff', arguments: { include_diff: false } });
const nonGitPayload = JSON.stringify(nonGitDiff);
if (!nonGitDiff.structuredContent.diff_error || !nonGitDiff.structuredContent.diff || nonGitDiff.structuredContent.changed) {
  throw new Error(`git_diff include_diff=false hid non-git diagnostics: ${nonGitPayload}`);
}
if (!/not a git repository|git unavailable|fatal:/i.test(nonGitPayload)) {
  throw new Error(`git_diff include_diff=false did not preserve the git diagnostic text: ${nonGitPayload}`);
}
nonGitClient.close();

const lowerAgentsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-lower-agents-'));
await fs.writeFile(path.join(lowerAgentsRoot, 'agents.md'), '# Lowercase agents\n\n- Lowercase instruction file loaded.\n', 'utf8');
await fs.mkdir(path.join(lowerAgentsRoot, 'src'));
await fs.writeFile(path.join(lowerAgentsRoot, 'src', 'demo.ts'), 'export const demo = true;\n', 'utf8');
const lowerClient = new McpStdioClient('node', ['dist/stdio.js', '--root', lowerAgentsRoot, '--allow-root', lowerAgentsRoot, '--tool-mode', 'full'], {
  cwd: path.resolve('.'),
  env: { ...process.env, CODEXFLOW_ROOT: lowerAgentsRoot, CODEXFLOW_ALLOWED_ROOTS: lowerAgentsRoot }
});
await lowerClient.request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'codexflow-lower-agents-smoke', version: '0.1.0' }
});
lowerClient.notify('notifications/initialized');
const lowerOpened = await lowerClient.request('tools/call', { name: 'open_current_workspace', arguments: { include_tree: false } });
if (lowerOpened.structuredContent.agents_path !== 'agents.md') {
  throw new Error(`lowercase agents.md was reported as ${lowerOpened.structuredContent.agents_path}`);
}
const lowerContext = await lowerClient.request('tools/call', { name: 'codex_context', arguments: { target_path: 'src/demo.ts', include_ai_bridge: false, include_git: false } });
if (!lowerContext.structuredContent.agents_files.includes('agents.md')) {
  throw new Error(`codex_context did not preserve lowercase agents.md: ${lowerContext.structuredContent.agents_files.join(', ')}`);
}
if (!lowerContext.content?.[0]?.text?.includes('Lowercase instruction file loaded.')) {
  throw new Error('codex_context did not include lowercase agents.md content');
}
lowerClient.close();
console.log('✓ smoke test passed');
