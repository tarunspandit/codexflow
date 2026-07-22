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
  throw new Error('Timed out waiting for browser smoke server.');
}

function resultText(result) { return result.content?.find((item) => item.type === 'text')?.text ?? ''; }

async function selectedClient(base, auth, name) {
  const client = new Client({ name, version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp?${auth}`)));
  const listed = await client.callTool({ name: 'list_projects', arguments: { refresh: false } });
  const project = listed.structuredContent.projects.find((item) => item.is_default === true) ?? listed.structuredContent.projects[0];
  const selected = await client.callTool({ name: 'select_project', arguments: { route_id: listed.structuredContent.route_id, project_id: project.project_id, include_tree: false } });
  return { client, common: { route_id: listed.structuredContent.route_id, workspace_id: selected.structuredContent.workspace_id } };
}

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-browser-use-'));
const root = path.join(fixture, 'repo');
const home = path.join(fixture, 'home');
await fs.mkdir(root, { recursive: true });
await fs.mkdir(home, { recursive: true });
await fs.writeFile(path.join(root, 'README.md'), '# browser fixture\n');
spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });

const port = await freePort();
const token = 'browser-use-smoke-token';
const base = `http://127.0.0.1:${port}`;
const auth = `codexflow_token=${encodeURIComponent(token)}`;
const child = spawn(process.execPath, ['dist/http.js'], {
  cwd: path.resolve('.'),
  env: {
    ...process.env, CODEXFLOW_HOME: home, CODEXFLOW_ROOT: root, CODEXFLOW_ALLOWED_ROOTS: root,
    CODEXFLOW_HOST: '127.0.0.1', CODEXFLOW_PORT: String(port), CODEXFLOW_HTTP_TOKEN: token,
    CODEXFLOW_WRITE_MODE: 'workspace', CODEXFLOW_BASH_MODE: 'off', CODEXFLOW_TOOL_CARDS: '0'
  },
  stdio: ['ignore', 'ignore', 'pipe']
});
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += String(chunk); });
let pumping = true;
const tabs = new Map();
const actions = [];

async function nativePump() {
  while (pumping) {
    try {
      const overview = await (await fetch(`${base}/admin/browser?take=1&${auth}`)).json();
      for (const command of overview.commands ?? []) {
        let result = {};
        if (command.action === 'open') {
          tabs.set(command.session_id, { url: command.url, title: 'Example fixture' });
          result = tabs.get(command.session_id);
        } else if (command.action === 'observe') {
          const tab = tabs.get(command.session_id);
          result = {
            ...tab,
            native_snapshot_id: 'nav_aaaaaaaaaaaaaaaa',
            screenshot_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            elements: [
              { id: 'dom_1111111111111111', role: 'button', name: 'Continue', text: 'Continue', href: 'https://example.com/?token=secret-value', disabled: false },
              { id: 'dom_2222222222222222', role: 'textbox', name: 'Search', type: 'text', disabled: false },
              { id: 'dom_3333333333333333', role: 'textbox', name: 'Password', type: 'password', disabled: false }
            ]
          };
        } else if (command.action === 'act') {
          actions.push(command);
          result = { operation: command.operation };
        } else if (command.action === 'close') {
          tabs.delete(command.session_id);
          result = { closed: true };
        }
        await fetch(`${base}/admin/browser/complete?${auth}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ commandId: command.id, ok: true, result })
        });
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
}

try {
  await waitForHealth(`${base}/healthz?${auth}`, child);
  assert.equal((await fetch(`${base}/admin/browser`)).status, 401);
  const beforeNative = await (await fetch(`${base}/admin/browser?${auth}`)).json();
  assert.equal(beforeNative.status.native_connected, false);
  const pumpPromise = nativePump();

  const { client, common } = await selectedClient(base, auth, 'browser-use-smoke');
  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'browser_use'));

    const credentialUrl = await client.callTool({ name: 'browser_use', arguments: { ...common, action: 'request_host', url: 'https://user:secret@example.com/', reason: 'test' } });
    assert.equal(credentialUrl.isError, true);
    const accountPage = await client.callTool({ name: 'browser_use', arguments: { ...common, action: 'request_host', url: 'https://accounts.google.com/', reason: 'test' } });
    assert.equal(accountPage.isError, true);

    const requested = await client.callTool({ name: 'browser_use', arguments: {
      ...common, action: 'request_host', url: 'https://example.com/docs', reason: 'Verify the documentation flow'
    } });
    assert.equal(requested.structuredContent.status, 'pending');
    const requestId = requested.structuredContent.request_id;
    let overview = await (await fetch(`${base}/admin/browser?${auth}`)).json();
    assert.equal(overview.host_requests[0].origin, 'https://example.com');
    assert.equal(overview.host_requests[0].reason, 'Verify the documentation flow');
    const approved = await fetch(`${base}/admin/browser?${auth}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'decide_host', requestId, decision: 'allow_once' })
    });
    assert.equal(approved.status, 200);

    const opened = await client.callTool({ name: 'browser_use', arguments: { ...common, action: 'open', url: 'https://example.com/docs' } });
    assert.equal(opened.structuredContent.status, 'opened');
    const browserSessionId = opened.structuredContent.session_id;
    const observed = await client.callTool({ name: 'browser_use', arguments: { ...common, action: 'observe', browser_session_id: browserSessionId } });
    assert.ok(observed.content.some((item) => item.type === 'image' && item.mimeType === 'image/png'));
    assert.equal(observed.structuredContent.elements.length, 3);
    assert.deepEqual(observed.structuredContent.comments, []);
    assert.equal(observed.structuredContent.elements[0].href, undefined, 'secret-bearing hrefs must not cross the broker boundary');

    const secretComment = await fetch(`${base}/admin/browser?${auth}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'add_comment', sessionId: browserSessionId, selector: 'body > button',
        target: 'button · Continue', note: 'Never save ghp_abcdefghijklmnopqrstuvwxyz'
      })
    });
    assert.equal(secretComment.status, 400, 'secret-looking browser comments must fail closed');

    const secretTargetComment = await fetch(`${base}/admin/browser?${auth}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'add_comment', sessionId: browserSessionId, selector: 'body > button',
        target: 'button · sk-abcdefghijklmnopqrstuvwxyz123456', note: 'Replace this visible token.'
      })
    });
    assert.equal(secretTargetComment.status, 400, 'secret-looking target text must fail before redaction');

    const addedComment = await fetch(`${base}/admin/browser?${auth}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'add_comment', sessionId: browserSessionId, selector: 'html > body > main > button:nth-of-type(1)',
        target: 'button · Continue', note: 'Keep this action aligned with the section heading on narrow screens.'
      })
    });
    assert.equal(addedComment.status, 200);
    const addedOverview = await addedComment.json();
    assert.equal(addedOverview.comments.length, 1);
    assert.equal(addedOverview.comments[0].route_id, undefined, 'native comment overview must not expose a route credential');
    const commentId = addedOverview.comments[0].id;

    const routedComments = await client.callTool({ name: 'browser_use', arguments: {
      ...common, action: 'comments', browser_session_id: browserSessionId
    } });
    assert.equal(routedComments.structuredContent.comments.length, 1);
    assert.match(routedComments.structuredContent.comments[0].note, /aligned with the section heading/);
    assert.equal(routedComments.structuredContent.comments[0].route_display, undefined);
    const { client: crossedCommentClient, common: crossedCommentRoute } = await selectedClient(base, auth, 'browser-comment-isolation');
    try {
      const crossedComments = await crossedCommentClient.callTool({ name: 'browser_use', arguments: {
        ...crossedCommentRoute, action: 'comments', browser_session_id: browserSessionId
      } });
      assert.equal(crossedComments.isError, true, 'a different chat route must not inspect another route browser session');
    } finally { await crossedCommentClient.close(); }

    const actionArgs = {
      ...common, action: 'act', browser_session_id: browserSessionId, snapshot_id: observed.structuredContent.snapshot_id,
      element_id: 'dom_1111111111111111', operation: 'click'
    };
    const pending = await client.callTool({ name: 'browser_use', arguments: actionArgs });
    assert.equal(pending.structuredContent.status, 'confirmation_required');
    assert.equal(actions.length, 0);
    const pendingAgain = await client.callTool({ name: 'browser_use', arguments: actionArgs });
    assert.equal(pendingAgain.structuredContent.action_request_id, pending.structuredContent.action_request_id, 'identical pending actions must reuse one native confirmation');
    await fetch(`${base}/admin/browser?${auth}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'decide_action', requestId: pending.structuredContent.action_request_id, approve: true })
    });
    const clicked = await client.callTool({ name: 'browser_use', arguments: { ...actionArgs, action_request_id: pending.structuredContent.action_request_id } });
    assert.equal(clicked.structuredContent.status, 'completed');
    assert.equal(actions.length, 1);

    const stale = await client.callTool({ name: 'browser_use', arguments: actionArgs });
    assert.equal(stale.isError, true);
    assert.match(resultText(stale), /snapshot is missing, expired/i);

    const observedAgain = await client.callTool({ name: 'browser_use', arguments: { ...common, action: 'observe', browser_session_id: browserSessionId } });
    assert.equal(observedAgain.structuredContent.comments.length, 1, 'fresh observations must carry route-private user comments');
    const secret = await client.callTool({ name: 'browser_use', arguments: {
      ...common, action: 'act', browser_session_id: browserSessionId, snapshot_id: observedAgain.structuredContent.snapshot_id,
      element_id: 'dom_3333333333333333', operation: 'set_value', value: 'sk-abcdefghijklmnopqrstuvwxyz123456'
    } });
    assert.equal(secret.isError, true);
    assert.match(resultText(secret), /credential or secret/i);

    const removedComment = await fetch(`${base}/admin/browser?${auth}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'remove_comment', commentId })
    });
    assert.equal(removedComment.status, 200);
    assert.equal((await removedComment.json()).comments.length, 0);

    const closed = await client.callTool({ name: 'browser_use', arguments: { ...common, action: 'close', browser_session_id: browserSessionId } });
    assert.equal(closed.structuredContent.status, 'closed');
  } finally { await client.close(); }

  const { client: isolatedClient, common: isolated } = await selectedClient(base, auth, 'browser-use-isolation');
  try {
    const refused = await isolatedClient.callTool({ name: 'browser_use', arguments: { ...isolated, action: 'open', url: 'https://example.com/' } });
    assert.equal(refused.isError, true, 'allow-once browser access must stay on one private route');

    const requested = await isolatedClient.callTool({ name: 'browser_use', arguments: {
      ...isolated, action: 'request_host', url: 'https://developer.mozilla.org/', reason: 'Persist MDN access'
    } });
    await fetch(`${base}/admin/browser?${auth}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'decide_host', requestId: requested.structuredContent.request_id, decision: 'always_allow' })
    });
    const storePath = path.join(home, 'browser-use.json');
    assert.equal((await fs.stat(storePath)).mode & 0o777, 0o600);
    assert.match(await fs.readFile(storePath, 'utf8'), /developer\.mozilla\.org/);
    const revoke = await fetch(`${base}/admin/browser?${auth}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'revoke', origin: 'https://developer.mozilla.org/' })
    });
    assert.equal(revoke.status, 200);
    assert.doesNotMatch(await fs.readFile(storePath, 'utf8'), /developer\.mozilla\.org/);
  } finally { await isolatedClient.close(); }

  pumping = false;
  await pumpPromise;
  console.log('✓ browser host approval, route isolation, ephemeral sessions, DOM snapshots, visual comments, confirmations, secret refusal, persistence, and revocation pass');
} finally {
  pumping = false;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await fs.rm(fixture, { recursive: true, force: true });
  if (child.exitCode && child.exitCode !== 0 && !stderr.includes('SIGTERM')) process.stderr.write(stderr);
}
