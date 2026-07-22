import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

if (process.platform !== 'darwin') {
  console.log('✓ native browser smoke skipped outside macOS');
  process.exit(0);
}

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

async function waitFor(url, child, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (child?.exitCode !== null) throw new Error(`Process exited with ${child.exitCode}`);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-native-browser-'));
const root = path.join(fixture, 'repo');
const home = path.join(fixture, 'home');
await fs.mkdir(root, { recursive: true });
await fs.mkdir(home, { recursive: true });
await fs.writeFile(path.join(root, 'README.md'), '# native browser fixture\n');
spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });

const pagePort = await freePort();
const brokerPort = await freePort();
const pageOrigin = `http://127.0.0.1:${pagePort}`;
const token = 'native-browser-smoke-token';
const brokerBase = `http://127.0.0.1:${brokerPort}`;
const authHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const manualAnnotationWaitMs = Math.max(0, Math.min(180_000, Number(process.env.CODEXFLOW_NATIVE_ANNOTATION_WAIT_MS ?? 0) || 0));
const manualDiagnosticsWaitMs = Math.max(0, Math.min(180_000, Number(process.env.CODEXFLOW_NATIVE_DIAGNOSTICS_WAIT_MS ?? 0) || 0));
const pageServer = http.createServer((request, response) => {
  if (request.url?.startsWith('/fixture.js')) {
    response.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    response.end("console.info('fixture source loaded')");
    return;
  }
  if (request.url?.startsWith('/api')) {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end('{"ok":true}');
    return;
  }
  if (request.url === '/download') {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="blocked.bin"' });
    response.end('blocked');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><meta charset="utf-8"><title>Browser parity fixture</title>
    <script src="/fixture.js?token=never-expose-this"></script>
    <script>console.warn('fixture warning'); fetch('/api?token=never-expose-this')</script>
    <main><h1 id="state">Ready</h1>
    <button id="run" onclick="document.querySelector('#state').textContent='Ran once'; this.textContent='Ran once'">Run example</button>
    <input id="note" aria-label="Project note" value="">
    <input id="password" aria-label="Password" type="password" value="never-expose-this">
    <a href="/download" download>Download artifact</a></main>`);
});
await new Promise((resolve, reject) => pageServer.listen(pagePort, '127.0.0.1', (error) => error ? reject(error) : resolve()));

const cli = spawn(process.execPath, [
  'scripts/codexflow.mjs', 'start', '--root', root, '--host', '127.0.0.1', '--port', String(brokerPort),
  '--token', token, '--tunnel', 'none', '--non-interactive', '--no-open-app', '--no-copy-url', '--no-profile',
  '--bash', 'off', '--tool-mode', 'standard', '--log-requests'
], {
  cwd: path.resolve('.'), env: { ...process.env, CODEXFLOW_HOME: home }, stdio: ['ignore', 'pipe', 'pipe']
});
let cliStdout = '';
let cliStderr = '';
cli.stdout.on('data', (chunk) => { cliStdout += String(chunk); });
cli.stderr.on('data', (chunk) => { cliStderr += String(chunk); });

const executable = path.resolve('desktop/prebuilt/CodexFlow.app/Contents/MacOS/CodexFlow');
let appPid;
let client;
let failure;

try {
  await waitFor(`${brokerBase}/healthz?codexflow_token=${encodeURIComponent(token)}`, cli);
  const openedApp = spawnSync('/usr/bin/open', ['-n', path.resolve('desktop/prebuilt/CodexFlow.app'), '--args', '--home', home], { encoding: 'utf8' });
  assert.equal(openedApp.status, 0, openedApp.stderr || 'failed to launch native app');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const processList = spawnSync('/bin/ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' }).stdout;
  const appLine = processList.split('\n').find((line) => line.includes(executable) && line.includes(`--home ${home}`));
  appPid = Number(appLine?.trim().split(/\s+/, 1)[0]);
  assert.ok(Number.isInteger(appPid) && appPid > 1, 'native app must stay open while servicing browser commands');

  client = new Client({ name: 'native-browser-smoke', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${brokerBase}/mcp?codexflow_token=${encodeURIComponent(token)}`)));
  const listed = await client.callTool({ name: 'list_projects', arguments: { refresh: false } });
  const project = listed.structuredContent.projects.find((item) => item.is_default) ?? listed.structuredContent.projects[0];
  const selected = await client.callTool({
    name: 'select_project',
    arguments: { route_id: listed.structuredContent.route_id, project_id: project.project_id, include_tree: false }
  });
  const common = { route_id: listed.structuredContent.route_id, workspace_id: selected.structuredContent.workspace_id };

  const requested = await client.callTool({
    name: 'browser_use', arguments: { ...common, action: 'request_host', url: `${pageOrigin}/`, reason: 'Run the native WebKit integration test' }
  });
  assert.equal(requested.structuredContent.status, 'pending');
  const approved = await fetch(`${brokerBase}/admin/browser`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ action: 'decide_host', requestId: requested.structuredContent.request_id, decision: 'allow_once' })
  });
  assert.equal(approved.status, 200);

  const opened = await client.callTool({ name: 'browser_use', arguments: { ...common, action: 'open', url: `${pageOrigin}/` } });
  assert.notEqual(opened.isError, true, opened.content?.find((item) => item.type === 'text')?.text ?? 'native browser open failed');
  assert.equal(opened.structuredContent.status, 'opened');
  const browserSessionId = opened.structuredContent.session_id;
  assert.equal(opened.structuredContent.title, 'Browser parity fixture');

  let observed = await client.callTool({ name: 'browser_use', arguments: { ...common, action: 'observe', browser_session_id: browserSessionId } });
  assert.ok(observed.content.some((item) => item.type === 'image' && item.mimeType === 'image/png' && item.data.length > 100));
  let button = observed.structuredContent.elements.find((element) => element.name === 'Run example');
  const note = observed.structuredContent.elements.find((element) => element.name === 'Project note');
  const password = observed.structuredContent.elements.find((element) => element.type === 'password');
  assert.ok(button && note && password, 'native DOM snapshot must expose stable semantic targets');
  assert.equal(password.text, '', 'native DOM snapshots must redact password values');

  await new Promise((resolve) => setTimeout(resolve, 150));
  const diagnostics = await client.callTool({
    name: 'browser_use', arguments: { ...common, action: 'diagnostics', browser_session_id: browserSessionId }
  });
  assert.notEqual(diagnostics.isError, true, diagnostics.content?.find((item) => item.type === 'text')?.text ?? 'native diagnostics failed');
  assert.ok(diagnostics.structuredContent.console.some((entry) => /fixture warning/.test(entry.message)), 'native console capture must include page warnings');
  assert.ok(diagnostics.structuredContent.network.some((entry) => entry.url.endsWith('/api')), 'native resource timing must include fetches');
  assert.ok(diagnostics.structuredContent.sources.some((entry) => entry.kind === 'script' && entry.url.endsWith('/fixture.js')), 'native source inventory must include scripts');
  assert.doesNotMatch(JSON.stringify(diagnostics.structuredContent), /never-expose-this|\?token=/, 'diagnostics must strip queries and secrets');
  if (manualDiagnosticsWaitMs > 0) {
    console.log(`MANUAL_DIAGNOSTICS_READY ${browserSessionId}`);
    await new Promise((resolve) => setTimeout(resolve, manualDiagnosticsWaitMs));
  }

  let commentId;
  if (manualAnnotationWaitMs > 0) {
    console.log(`MANUAL_ANNOTATION_READY ${browserSessionId}`);
    const deadline = Date.now() + manualAnnotationWaitMs;
    while (Date.now() < deadline) {
      const manualOverview = await (await fetch(`${brokerBase}/admin/browser`, { headers: authHeaders })).json();
      if (manualOverview.comments.some((comment) => comment.sessionId === browserSessionId)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } else {
    const addedComment = await fetch(`${brokerBase}/admin/browser`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({
        action: 'add_comment', sessionId: browserSessionId, selector: 'html > body > main > button:nth-of-type(1)',
        target: 'button · Run example', note: 'Keep this action aligned with the page heading at narrow widths.'
      })
    });
    assert.equal(addedComment.status, 200);
    const commentOverview = await addedComment.json();
    assert.equal(commentOverview.comments.length, 1);
    commentId = commentOverview.comments[0].id;
  }
  const routedComments = await client.callTool({
    name: 'browser_use', arguments: { ...common, action: 'comments', browser_session_id: browserSessionId }
  });
  assert.equal(routedComments.structuredContent.comments.length, 1);
  if (manualAnnotationWaitMs > 0) {
    assert.match(routedComments.structuredContent.comments[0].note, /manual annotation/i);
    commentId = routedComments.structuredContent.comments[0].id;
    observed = await client.callTool({
      name: 'browser_use', arguments: { ...common, action: 'observe', browser_session_id: browserSessionId }
    });
    assert.equal(observed.structuredContent.comments.length, 1, 'manual UI comment must survive a fresh observation');
    button = observed.structuredContent.elements.find((element) => element.name === 'Run example');
    assert.ok(button, 'manual UI acceptance must reacquire the target from the fresh snapshot');
  } else {
    assert.match(routedComments.structuredContent.comments[0].note, /aligned with the page heading/);
  }

  const clickArgs = {
    ...common, action: 'act', browser_session_id: browserSessionId, snapshot_id: observed.structuredContent.snapshot_id,
    element_id: button.id, operation: 'click'
  };
  const pendingClick = await client.callTool({ name: 'browser_use', arguments: clickArgs });
  assert.equal(pendingClick.structuredContent.status, 'confirmation_required');
  await fetch(`${brokerBase}/admin/browser`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ action: 'decide_action', requestId: pendingClick.structuredContent.action_request_id, approve: true })
  });
  const clicked = await client.callTool({
    name: 'browser_use', arguments: { ...clickArgs, action_request_id: pendingClick.structuredContent.action_request_id }
  });
  assert.equal(clicked.structuredContent.status, 'completed');

  observed = await client.callTool({ name: 'browser_use', arguments: { ...common, action: 'observe', browser_session_id: browserSessionId } });
  assert.ok(observed.structuredContent.elements.some((element) => element.text === 'Ran once'));
  const noteAgain = observed.structuredContent.elements.find((element) => element.name === 'Project note');
  const typeArgs = {
    ...common, action: 'act', browser_session_id: browserSessionId, snapshot_id: observed.structuredContent.snapshot_id,
    element_id: noteAgain.id, operation: 'set_value', value: 'native bridge works'
  };
  const pendingType = await client.callTool({ name: 'browser_use', arguments: typeArgs });
  await fetch(`${brokerBase}/admin/browser`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ action: 'decide_action', requestId: pendingType.structuredContent.action_request_id, approve: true })
  });
  const typed = await client.callTool({
    name: 'browser_use', arguments: { ...typeArgs, action_request_id: pendingType.structuredContent.action_request_id }
  });
  assert.equal(typed.structuredContent.status, 'completed');

  observed = await client.callTool({ name: 'browser_use', arguments: { ...common, action: 'observe', browser_session_id: browserSessionId } });
  assert.equal(observed.structuredContent.elements.find((element) => element.name === 'Project note').text, 'native bridge works');
  assert.equal(observed.structuredContent.comments.length, 1);
  const removedComment = await fetch(`${brokerBase}/admin/browser`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ action: 'remove_comment', commentId })
  });
  assert.equal(removedComment.status, 200);
  const closed = await client.callTool({ name: 'browser_use', arguments: { ...common, action: 'close', browser_session_id: browserSessionId } });
  assert.equal(closed.structuredContent.status, 'closed');

  console.log('✓ real native WebKit open, screenshot, semantic DOM, route-private comments and diagnostics, confirmation, action, input, redaction, and close pass');
} catch (error) {
  failure = error;
  throw error;
} finally {
  try { await client?.close(); } catch {}
  if (appPid) {
    try { process.kill(appPid, 'SIGTERM'); } catch {}
  }
  await stop(cli);
  await new Promise((resolve) => pageServer.close(resolve));
  await fs.rm(fixture, { recursive: true, force: true });
  if (failure && cliStdout) process.stderr.write(`\n--- broker log ---\n${cliStdout}`);
  if (failure && cliStderr) process.stderr.write(`\n--- broker stderr ---\n${cliStderr}`);
}
