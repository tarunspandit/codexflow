import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No free port')));
    });
    server.on('error', reject);
  });
}

async function waitForHealth(url, child) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (child.exitCode !== null) throw new Error(`HTTP server exited with ${child.exitCode}`);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for Computer Use smoke server.');
}

function text(result) {
  return result.content?.find((item) => item.type === 'text')?.text ?? '';
}

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-computer-use-'));
const root = path.join(fixture, 'repo');
const home = path.join(fixture, 'home');
const helper = path.join(fixture, 'computer-helper.mjs');
const actionLog = path.join(fixture, 'actions.jsonl');
const identityFile = path.join(fixture, 'notes-identity.txt');
await fs.mkdir(root, { recursive: true });
await fs.mkdir(home, { recursive: true });
await fs.writeFile(path.join(root, 'README.md'), '# fixture\n');
await fs.writeFile(identityFile, 'com.apple.Notes|APPLE|notes-cdhash');
spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
await fs.writeFile(helper, `#!/usr/bin/env node
import fs from 'node:fs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const noteIdentity = fs.readFileSync(${JSON.stringify(identityFile)}, 'utf8').trim();
const apps = [
  { bundle_id: 'com.apple.Notes', name: 'Notes', pid: 101, active: true, identity: noteIdentity },
  { bundle_id: 'com.apple.Terminal', name: 'Terminal', pid: 102, active: false, identity: 'com.apple.Terminal|APPLE|terminal-cdhash' },
  { bundle_id: 'com.google.Chrome', name: 'Google Chrome', pid: 103, active: false, identity: 'com.google.Chrome|GOOGLE|chrome-cdhash' }
];
let result;
if (request.action === 'status' || request.action === 'request_permissions') {
  result = { ok: true, platform: 'macos', screen_recording: true, accessibility: true };
} else if (request.action === 'list_apps') {
  result = { ok: true, apps };
} else if (request.action === 'snapshot') {
  result = {
    ok: true, bundle_id: request.bundleId, app_name: 'Notes', pid: 101, identity: noteIdentity,
    screenshot_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    elements: [
      { path: [], role: 'AXWindow', title: 'Smoke note', actions: [] },
      { path: [0], role: 'AXButton', title: 'New Note', x: 10, y: 20, width: 80, height: 30, actions: ['AXPress'] },
      { path: [1], role: 'AXTextArea', title: 'Body', value: 'Visible text', actions: ['AXSetValue'] }
    ]
  };
} else if (request.action === 'perform') {
  fs.appendFileSync(${JSON.stringify(actionLog)}, JSON.stringify(request) + '\\n');
  result = { ok: true, bundle_id: request.bundleId, role: request.expectedRole, title: request.expectedTitle, operation: request.operation };
} else {
  process.stdout.write(JSON.stringify({ ok: false, error: 'unknown action' }) + '\\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify(result) + '\\n');
`);
await fs.chmod(helper, 0o755);

const port = await freePort();
const token = 'computer-use-smoke-token';
const child = spawn(process.execPath, ['dist/http.js'], {
  cwd: path.resolve('.'),
  env: {
    ...process.env,
    CODEXFLOW_HOME: home,
    CODEXFLOW_ROOT: root,
    CODEXFLOW_ALLOWED_ROOTS: root,
    CODEXFLOW_HOST: '127.0.0.1',
    CODEXFLOW_PORT: String(port),
    CODEXFLOW_HTTP_TOKEN: token,
    CODEXFLOW_COMPUTER_HELPER: helper,
    CODEXFLOW_WRITE_MODE: 'workspace',
    CODEXFLOW_BASH_MODE: 'off',
    CODEXFLOW_TOOL_CARDS: '0'
  },
  stdio: ['ignore', 'ignore', 'pipe']
});
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += String(chunk); });

try {
  const base = `http://127.0.0.1:${port}`;
  const auth = `codexflow_token=${encodeURIComponent(token)}`;
  await waitForHealth(`${base}/healthz?${auth}`, child);
  assert.equal((await fetch(`${base}/admin/computer`)).status, 401);
  const permissionResponse = await fetch(`${base}/admin/computer?${auth}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'request_permissions' })
  });
  assert.equal(permissionResponse.status, 200);
  assert.equal((await permissionResponse.json()).screen_recording, true);

  const client = new Client({ name: 'computer-use-smoke', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp?${auth}`));
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'computer_use'));
    const listed = await client.callTool({ name: 'list_projects', arguments: { refresh: false } });
    assert.notEqual(listed.isError, true);
    const canonicalRoot = await fs.realpath(root);
    const project = listed.structuredContent.projects.find((item) => item.root === canonicalRoot || item.is_default === true);
    const selected = await client.callTool({
      name: 'select_project', arguments: { route_id: listed.structuredContent.route_id, project_id: project.project_id, include_tree: false }
    });
    assert.notEqual(selected.isError, true);
    const common = { route_id: listed.structuredContent.route_id, workspace_id: selected.structuredContent.workspace_id };

    const status = await client.callTool({ name: 'computer_use', arguments: { ...common, action: 'status' } });
    assert.notEqual(status.isError, true);
    assert.equal(status.structuredContent.status.accessibility, true);

    const terminal = await client.callTool({
      name: 'computer_use', arguments: { ...common, action: 'request_app', app_query: 'Terminal', reason: 'Run a command' }
    });
    assert.equal(terminal.isError, true);
    assert.match(text(terminal), /cannot be automated/i);

    const chrome = await client.callTool({
      name: 'computer_use', arguments: { ...common, action: 'request_app', app_query: 'Google Chrome', reason: 'Open a page' }
    });
    assert.equal(chrome.isError, true);
    assert.match(text(chrome), /website-host permission boundary/i);

    const requested = await client.callTool({
      name: 'computer_use', arguments: { ...common, action: 'request_app', app_query: 'Notes', reason: 'Verify the native notes editor' }
    });
    assert.notEqual(requested.isError, true);
    assert.equal(requested.structuredContent.status, 'pending');
    const accessRequestId = requested.structuredContent.request_id;

    const refused = await client.callTool({
      name: 'computer_use', arguments: { ...common, action: 'observe', app_id: 'com.apple.Notes' }
    });
    assert.equal(refused.isError, true);
    assert.match(text(refused), /not approved/i);

    let overview = await (await fetch(`${base}/admin/computer?${auth}`)).json();
    assert.equal(overview.access_requests[0].id, accessRequestId);
    assert.equal(overview.access_requests[0].reason, 'Verify the native notes editor');
    const approvedAccess = await fetch(`${base}/admin/computer?${auth}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'decide_access', requestId: accessRequestId, decision: 'allow_once' })
    });
    assert.equal(approvedAccess.status, 200);

    const observed = await client.callTool({
      name: 'computer_use', arguments: { ...common, action: 'observe', app_id: 'com.apple.Notes' }
    });
    assert.notEqual(observed.isError, true);
    assert.ok(observed.content.some((item) => item.type === 'image' && item.mimeType === 'image/png'));
    assert.equal(observed.structuredContent.elements.length, 3);
    const snapshotId = observed.structuredContent.snapshot_id;
    const buttonId = observed.structuredContent.elements.find((element) => element.role === 'AXButton').id;

    const actionArgs = {
      ...common, action: 'act', app_id: 'com.apple.Notes', snapshot_id: snapshotId,
      element_id: buttonId, operation: 'press'
    };
    const pendingAction = await client.callTool({ name: 'computer_use', arguments: actionArgs });
    assert.equal(pendingAction.structuredContent.status, 'confirmation_required');
    const actionRequestId = pendingAction.structuredContent.action_request_id;
    await assert.rejects(fs.readFile(actionLog, 'utf8'));

    const mismatched = await client.callTool({
      name: 'computer_use', arguments: { ...actionArgs, operation: 'key', key: 'space', action_request_id: actionRequestId }
    });
    assert.equal(mismatched.structuredContent.status, 'confirmation_required');
    assert.notEqual(mismatched.structuredContent.action_request_id, actionRequestId);

    const approvedAction = await fetch(`${base}/admin/computer?${auth}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'decide_action', requestId: actionRequestId, approve: true })
    });
    assert.equal(approvedAction.status, 200);
    const completed = await client.callTool({
      name: 'computer_use', arguments: { ...actionArgs, action_request_id: actionRequestId }
    });
    assert.equal(completed.structuredContent.status, 'completed');
    assert.match(await fs.readFile(actionLog, 'utf8'), /"operation":"press"/);

    const stale = await client.callTool({ name: 'computer_use', arguments: actionArgs });
    assert.equal(stale.isError, true);
    assert.match(text(stale), /snapshot is missing, expired/i);

    const again = await client.callTool({
      name: 'computer_use', arguments: { ...common, action: 'request_app', app_query: 'Notes', reason: 'Persist trusted access' }
    });
    assert.equal(again.structuredContent.status, 'allowed');

    const secretObserve = await client.callTool({
      name: 'computer_use', arguments: { ...common, action: 'observe', app_id: 'com.apple.Notes' }
    });
    const textElement = secretObserve.structuredContent.elements.find((element) => element.role === 'AXTextArea');
    const secret = await client.callTool({
      name: 'computer_use', arguments: {
        ...common, action: 'act', app_id: 'com.apple.Notes', snapshot_id: secretObserve.structuredContent.snapshot_id,
        element_id: textElement.id, operation: 'set_value', value: 'sk-abcdefghijklmnopqrstuvwxyz123456'
      }
    });
    assert.equal(secret.isError, true);
    assert.match(text(secret), /credential or secret/i);
  } finally {
    await client.close();
  }

  const secondClient = new Client({ name: 'computer-use-route-isolation', version: '0.0.0' });
  const secondTransport = new StreamableHTTPClientTransport(new URL(`${base}/mcp?${auth}`));
  await secondClient.connect(secondTransport);
  try {
    const listed = await secondClient.callTool({ name: 'list_projects', arguments: { refresh: false } });
    const project = listed.structuredContent.projects.find((item) => item.is_default === true) ?? listed.structuredContent.projects[0];
    const selected = await secondClient.callTool({ name: 'select_project', arguments: { route_id: listed.structuredContent.route_id, project_id: project.project_id, include_tree: false } });
    const observed = await secondClient.callTool({
      name: 'computer_use', arguments: {
        route_id: listed.structuredContent.route_id, workspace_id: selected.structuredContent.workspace_id,
        action: 'observe', app_id: 'com.apple.Notes'
      }
    });
    assert.equal(observed.isError, true, 'allow-once access must stay on the approving route');
  } finally {
    await secondClient.close();
  }

  const accessFile = path.join(home, 'computer-use.json');
  const requestClient = new Client({ name: 'computer-use-persistent', version: '0.0.0' });
  const requestTransport = new StreamableHTTPClientTransport(new URL(`${base}/mcp?${auth}`));
  await requestClient.connect(requestTransport);
  try {
    const listed = await requestClient.callTool({ name: 'list_projects', arguments: { refresh: false } });
    const project = listed.structuredContent.projects.find((item) => item.is_default === true) ?? listed.structuredContent.projects[0];
    const selected = await requestClient.callTool({ name: 'select_project', arguments: { route_id: listed.structuredContent.route_id, project_id: project.project_id, include_tree: false } });
    const common = { route_id: listed.structuredContent.route_id, workspace_id: selected.structuredContent.workspace_id };
    const requested = await requestClient.callTool({ name: 'computer_use', arguments: {
      ...common, action: 'request_app', app_query: 'Notes', reason: 'Always trust Notes'
    } });
    const requestId = requested.structuredContent.request_id;
    const response = await fetch(`${base}/admin/computer?${auth}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'decide_access', requestId, decision: 'always_allow' })
    });
    assert.equal(response.status, 200);
    assert.equal((await fs.stat(accessFile)).mode & 0o777, 0o600);
    assert.match(await fs.readFile(accessFile, 'utf8'), /com\.apple\.Notes/);
    await fs.writeFile(identityFile, 'com.apple.Notes|IMPOSTOR|replaced-cdhash');
    const replacedApp = await requestClient.callTool({ name: 'computer_use', arguments: {
      ...common, action: 'observe', app_id: 'com.apple.Notes'
    } });
    assert.equal(replacedApp.isError, true, 'a replaced app must not inherit a persistent approval');
    assert.match(text(replacedApp), /identity changed/i);
    const revoke = await fetch(`${base}/admin/computer?${auth}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'revoke', bundleId: 'com.apple.Notes' })
    });
    assert.equal(revoke.status, 200);
    assert.doesNotMatch(await fs.readFile(accessFile, 'utf8'), /com\.apple\.Notes/);
  } finally {
    await requestClient.close();
  }

  console.log('✓ native Computer Use permissions, route isolation, snapshots, confirmations, blocks, and revocation pass');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await fs.rm(fixture, { recursive: true, force: true });
  if (child.exitCode && child.exitCode !== 0 && !stderr.includes('SIGTERM')) process.stderr.write(stderr);
}
