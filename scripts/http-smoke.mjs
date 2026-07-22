import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
    server.on('error', reject);
  });
}

function waitForListening(child) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`timeout waiting for HTTP server\n${stderr}`)), 15000);
    timer.unref();
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.includes('HTTP MCP listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`HTTP server exited before listening: ${code}\n${stderr}`));
    });
  });
}

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`timeout waiting for process exit\n${stderr}`));
    }, timeoutMs);
    timer.unref();
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr });
    });
  });
}

async function waitForHealthJson(url, timeoutMs = 15000) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = `${response.status} ${await response.text()}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timeout waiting for ${url}\n${lastError}`);
}

async function expectHttpTokenRequired(name, overrides = {}, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `codexflow-http-no-token-${name}-`));
  const port = await getFreePort();
  const env = {
    ...process.env,
    CODEXFLOW_ROOT: root,
    CODEXFLOW_ALLOWED_ROOTS: root,
    CODEXFLOW_HOST: '127.0.0.1',
    CODEXFLOW_PORT: String(port),
    CODEXFLOW_BASH_MODE: 'safe',
    CODEXFLOW_WRITE_MODE: 'handoff',
    ...overrides
  };
  delete env.CODEXFLOW_HTTP_TOKEN;
  delete env.CODEBASE_BRIDGE_HTTP_TOKEN;
  if (!options.keepAllowNoToken) delete env.CODEXFLOW_ALLOW_NO_HTTP_TOKEN;

  const child = spawn('node', ['dist/http.js'], {
    cwd: path.resolve('.'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const result = await waitForExit(child);
  if (result.code === 0) {
    throw new Error(`expected ${name} HTTP server without token to fail closed`);
  }
  if (!result.stderr.includes('CODEXFLOW_HTTP_TOKEN is required')) {
    throw new Error(`expected ${name} missing-token failure, got:\n${result.stderr}`);
  }
}

async function listTools(url, token) {
  const client = new Client({ name: 'codexflow-http-smoke', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
  });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    return result.tools;
  } finally {
    await client.close();
  }
}

function toolNames(tools) {
  return tools.map((tool) => tool.name);
}

function hasWidgetMeta(tools, name, uri) {
  const tool = tools.find((item) => item.name === name);
  const meta = tool?._meta ?? {};
  return meta.ui?.resourceUri === uri && meta['openai/outputTemplate'] === uri;
}

function hasToolCardStatusMeta(tools, name) {
  const tool = tools.find((item) => item.name === name);
  const meta = tool?._meta ?? {};
  return Boolean(meta['openai/toolInvocation/invoking'] || meta['openai/toolInvocation/invoked']);
}

await expectHttpTokenRequired('loopback-default');
await expectHttpTokenRequired('non-loopback', { CODEXFLOW_HOST: '0.0.0.0' });
await expectHttpTokenRequired('non-loopback-allow-no-token', { CODEXFLOW_HOST: '0.0.0.0', CODEXFLOW_ALLOW_NO_HTTP_TOKEN: '1' }, { keepAllowNoToken: true });
await expectHttpTokenRequired('tunnel-mode', { CODEXFLOW_TUNNEL_MODE: '1' });

async function withClient(url, fn) {
  const client = new Client({ name: 'codexflow-http-smoke', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  try {
    await client.connect(transport);
    return await fn(client, transport);
  } finally {
    await client.close();
  }
}

async function callTool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const text = result.content?.find?.((part) => part.type === 'text')?.text ?? JSON.stringify(result.structuredContent);
    throw new Error(`${name} failed: ${text}`);
  }
  return result;
}

async function expectSessionNotFound(response, label) {
  const body = await response.json();
  if (
    response.status !== 404 ||
    !response.headers.get('content-type')?.includes('application/json') ||
    body.error?.code !== -32001 ||
    body.error?.message !== 'Session not found'
  ) {
    throw new Error(`expected ${label} to return JSON-RPC session-not-found 404, got ${response.status} ${JSON.stringify(body)}`);
  }
}

function postToolsListWithSession(baseUrl, token, sessionId) {
  return fetch(`${baseUrl}/mcp?codexflow_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-session-id': sessionId
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 404, method: 'tools/list', params: {} })
  });
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-http-smoke-'));
const alternateProject = path.join(root, 'alternate-project');
await fs.mkdir(alternateProject, { recursive: true });
await fs.writeFile(path.join(alternateProject, 'package.json'), '{"name":"alternate-project"}\n', 'utf8');
await fs.writeFile(path.join(alternateProject, 'routing.txt'), 'alternate-chat-binding\n', 'utf8');
await fs.writeFile(path.join(root, 'routing.txt'), 'default-chat-binding\n', 'utf8');
await fs.mkdir(path.join(root, '.codex', 'environments'), { recursive: true });
await fs.writeFile(path.join(root, '.codex', 'environments', 'http.toml'), [
  'version = 1',
  'name = "HTTP environment"',
  '',
  '[setup]',
  'script = ""',
  '',
  '[[actions]]',
  'name = "Verify"',
  'icon = "test"',
  'command = "printf http-environment"',
  ''
].join('\n'), 'utf8');
const profileHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-http-profile-home-'));
const sshConfig = path.join(profileHome, 'ssh-config');
const fakeSsh = path.join(profileHome, 'ssh');
await fs.writeFile(sshConfig, 'Host http-remote\n  HostName remote.example\n  User smoke\n', 'utf8');
await fs.writeFile(fakeSsh, `#!/bin/sh
if [ "$1" = "-G" ]; then
  printf 'hostname remote.example\\nuser smoke\\nport 22\\n'
  exit 0
fi
printf 'codexflow_remote=1\\nplatform=Linux\\nhome=/home/smoke\\nnode=1\\ngit=1\\n'
`, { mode: 0o700 });
await fs.mkdir(path.join(root, '.codex', 'skills', 'http-smoke-skill'), { recursive: true });
await fs.writeFile(path.join(root, '.codex', 'skills', 'http-smoke-skill', 'SKILL.md'), [
  '---',
  'name: http-smoke-skill',
  'description: HTTP smoke test skill discovery.',
  '---',
  '',
  '# HTTP Smoke Skill',
  ''
].join('\n'), 'utf8');
for (const args of [
  ['init'],
  ['add', '.'],
  ['-c', 'user.name=CodexFlow Smoke', '-c', 'user.email=smoke@codexflow.local', 'commit', '-m', 'fixture']
]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
}
await fs.appendFile(path.join(root, 'routing.txt'), 'desktop-change-review\n', 'utf8');
await fs.writeFile(path.join(root, 'untracked-review.txt'), 'new review file\n', 'utf8');
const port = await getFreePort();
const genericPort = await getFreePort();
const token = 'codexflow-http-smoke-token';
const runtimeQuerySecret = 'runtimequerysecret1234567890';
const runtimeAccessSecret = 'runtimeaccesssecret1234567890';
const runtimeLocalAuthSecret = 'runtimelocalauthsecret1234567890';
const runtimeCloudflareSecret = 'eyJhbGciOiJIUzI1NiJ9.eyJ0dW5uZWwiOiJodHRwLXNtb2tlIn0.signature1234567890';
const staleCloudflareToken = 'eyJhbGciOiJIUzI1NiJ9.eyJ0dW5uZWwiOiJzdGFsZS1odHRwLXNtb2tlIn0.signature1234567890';
const runtimeId = createHash('sha256').update(root).digest('hex').slice(0, 24);
await fs.mkdir(path.join(profileHome, 'runtime'), { recursive: true });
await fs.writeFile(path.join(profileHome, 'runtime', `${runtimeId}.json`), JSON.stringify({
  version: 1,
  root,
  endpoint: `https://runtime.example/mcp?token=${runtimeQuerySecret}`,
  localStatusUrl: `http://127.0.0.1:${port}/?codexflow_token=${token}&access_token=${runtimeAccessSecret}`,
  localAuthToken: runtimeLocalAuthSecret,
  note: `cloudflared tunnel run --token ${runtimeCloudflareSecret}`
}, null, 2), 'utf8');
const child = spawn('node', ['dist/http.js'], {
  cwd: path.resolve('.'),
  env: {
    ...process.env,
    HOST: '0.0.0.0',
    PORT: String(genericPort),
    CODEXFLOW_ROOT: root,
    CODEXFLOW_ALLOWED_ROOTS: root,
    CODEXFLOW_HOST: '127.0.0.1',
    CODEXFLOW_PORT: String(port),
    CODEXFLOW_HTTP_TOKEN: token,
    CODEXFLOW_BASH_MODE: 'safe',
    CODEXFLOW_WRITE_MODE: 'handoff',
    CODEXFLOW_TOOL_MODE: 'full',
    CODEXFLOW_TOOL_CARDS: '0',
    CODEXFLOW_WIDGET_DOMAIN: 'https://widgets.codexflow.test',
    CODEXFLOW_HOME: profileHome,
    CODEXFLOW_SSH_CONFIG: sshConfig,
    CODEXFLOW_SSH_BIN: fakeSsh
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  await waitForListening(child);
  const baseUrl = `http://127.0.0.1:${port}`;

  const unauthorized = await fetch(`${baseUrl}/healthz`);
  if (unauthorized.status !== 401) {
    throw new Error(`expected unauthenticated healthz to return 401, got ${unauthorized.status}`);
  }

  const authorized = await fetch(`${baseUrl}/healthz`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (authorized.status !== 200) {
    throw new Error(`expected authenticated healthz to return 200, got ${authorized.status}`);
  }
  const authorizedJson = await authorized.json();
  if (authorizedJson.authRequired !== true) {
    throw new Error(`expected authenticated healthz to report authRequired=true, got ${JSON.stringify(authorizedJson)}`);
  }

  for (const header of [`bearer ${token}`, `Bearer    ${token}`]) {
    const variant = await fetch(`${baseUrl}/healthz`, {
      headers: { Authorization: header }
    });
    if (variant.status !== 200) {
      throw new Error(`expected authorization header variant ${JSON.stringify(header)} to return 200, got ${variant.status}`);
    }
  }

  const queryAuthorized = await fetch(`${baseUrl}/healthz?codexflow_token=${encodeURIComponent(token)}`);
  if (queryAuthorized.status !== 200) {
    throw new Error(`expected URL-token healthz to return 200, got ${queryAuthorized.status}`);
  }

  const badAdminJson = await fetch(`${baseUrl}/admin/profile?codexflow_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"tunnel":'
  });
  const badAdminBody = await badAdminJson.json();
  if (badAdminJson.status !== 400 || badAdminBody.error?.code !== 'invalid_json') {
    throw new Error(`expected invalid admin JSON to return structured 400, got ${badAdminJson.status} ${JSON.stringify(badAdminBody)}`);
  }

  const badMcpJson = await fetch(`${baseUrl}/mcp?codexflow_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"jsonrpc":'
  });
  const badMcpBody = await badMcpJson.json();
  if (badMcpJson.status !== 400 || badMcpBody.error?.code !== -32700) {
    throw new Error(`expected invalid MCP JSON to return JSON-RPC parse error, got ${badMcpJson.status} ${JSON.stringify(badMcpBody)}`);
  }

  const hugeMcpJson = await fetch(`${baseUrl}/mcp?codexflow_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { filler: 'x'.repeat(21 * 1024 * 1024) } })
  });
  const hugeMcpBody = await hugeMcpJson.json();
  if (hugeMcpJson.status !== 413 || hugeMcpBody.error?.code !== -32000) {
    throw new Error(`expected oversized MCP body to return JSON-RPC payload error, got ${hugeMcpJson.status} ${JSON.stringify(hugeMcpBody)}`);
  }

  const favicon = await fetch(`${baseUrl}/favicon.ico`);
  if (favicon.status !== 200 || !favicon.headers.get('content-type')?.includes('image/svg+xml')) {
    throw new Error(`expected unauthenticated favicon to return SVG 200, got ${favicon.status} ${favicon.headers.get('content-type')}`);
  }
  for (const [assetPath, contentType] of [
    ['/brand/control.css', 'text/css'],
    ['/brand/control.js', 'text/javascript'],
    ['/brand/geologica.woff2', 'font/woff2'],
    ['/brand/flow7-tech-dark.webp', 'image/webp']
  ]) {
    const asset = await fetch(`${baseUrl}${assetPath}`);
    if (asset.status !== 200 || !asset.headers.get('content-type')?.includes(contentType)) {
      throw new Error(`expected ${assetPath} to return ${contentType} 200, got ${asset.status} ${asset.headers.get('content-type')}`);
    }
  }

  const home = await fetch(`${baseUrl}/?codexflow_token=${encodeURIComponent(token)}`);
  const homeText = await home.text();
  if (home.status !== 200 || !home.headers.get('content-type')?.includes('text/html')) {
    throw new Error(`expected authenticated onboarding page to return HTML 200, got ${home.status}`);
  }
  const contentSecurityPolicy = home.headers.get('content-security-policy') || '';
  if (
    !contentSecurityPolicy.includes("script-src 'self'") ||
    !contentSecurityPolicy.includes("style-src 'self'") ||
    !contentSecurityPolicy.includes("frame-ancestors 'none'") ||
    contentSecurityPolicy.includes("'unsafe-inline'") ||
    home.headers.get('x-content-type-options') !== 'nosniff' ||
    home.headers.get('x-frame-options') !== 'DENY' ||
    home.headers.get('referrer-policy') !== 'no-referrer' ||
    home.headers.get('cache-control') !== 'no-store' ||
    home.headers.has('x-powered-by')
  ) {
    throw new Error(`local companion security headers were incomplete: ${JSON.stringify(Object.fromEntries(home.headers))}`);
  }
  if (
    !homeText.includes('CodexFlow — Browser fallback') ||
    !homeText.includes('CodexFlow lives') ||
    !homeText.includes('Native app is primary') ||
    !homeText.includes('Use Extra High or another non-Pro model') ||
    !homeText.includes('Pro model variants do not expose Apps') ||
    !homeText.includes('Fallback diagnostics') ||
    !homeText.includes('data-desktop-deep-link') ||
    !homeText.includes('codexflow://open?root=')
  ) {
    throw new Error('browser fallback did not identify and deep-link to the native CodexFlow app');
  }
  if (homeText.includes('data-view-group=') || homeText.includes('data-profile-form') || homeText.includes('Next-launch profile')) {
    throw new Error('browser fallback still duplicated native application navigation or settings');
  }
  if (homeText.includes(token)) {
    throw new Error('onboarding page leaked the raw auth token');
  }
  const controlSource = await (await fetch(`${baseUrl}/brand/control.js`)).text();
  if (!controlSource.includes('window.sessionStorage') || !controlSource.includes('window.history.replaceState')) {
    throw new Error('local companion did not move URL authentication into tab-scoped memory');
  }
  for (const leaked of [runtimeQuerySecret, runtimeAccessSecret, runtimeLocalAuthSecret, runtimeCloudflareSecret]) {
    if (homeText.includes(leaked)) throw new Error(`onboarding page leaked runtime secret: ${leaked}`);
  }

  const overviewBefore = await fetch(`${baseUrl}/api/overview?codexflow_token=${encodeURIComponent(token)}`);
  const overviewBeforeJson = await overviewBefore.json();
  if (
    overviewBefore.status !== 200 ||
    overviewBeforeJson.ok !== true ||
    !overviewBeforeJson.projects?.some?.((project) => project.name === 'alternate-project') ||
    overviewBeforeJson.summary?.active_sessions !== 0 ||
    overviewBeforeJson.summary?.pending_sessions !== 0 ||
    overviewBeforeJson.summary?.open_connections !== 0 ||
    overviewBeforeJson.summary?.local_environments !== 1 ||
    overviewBeforeJson.environments?.[0]?.name !== 'HTTP environment' ||
    overviewBeforeJson.broker?.auth_enabled !== true
  ) {
    throw new Error(`local companion overview was incomplete: ${overviewBefore.status} ${JSON.stringify(overviewBeforeJson)}`);
  }

  const environmentsBefore = await fetch(`${baseUrl}/admin/environments?codexflow_token=${encodeURIComponent(token)}`);
  const environmentsBeforeJson = await environmentsBefore.json();
  if (environmentsBefore.status !== 200 || environmentsBeforeJson.environments?.[0]?.name !== 'HTTP environment') {
    throw new Error(`admin environments did not expose the shared Codex config: ${environmentsBefore.status} ${JSON.stringify(environmentsBeforeJson)}`);
  }
  const remotesBefore = await fetch(`${baseUrl}/admin/remotes?codexflow_token=${encodeURIComponent(token)}`);
  const remotesBeforeJson = await remotesBefore.json();
  if (remotesBefore.status !== 200 || remotesBeforeJson.hosts?.[0]?.alias !== 'http-remote' || remotesBeforeJson.approved !== 0) {
    throw new Error(`admin remotes did not expose concrete SSH aliases: ${remotesBefore.status} ${JSON.stringify(remotesBeforeJson)}`);
  }
  const verifiedRemote = await fetch(`${baseUrl}/admin/remotes?codexflow_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'verify', alias: 'http-remote' })
  });
  const verifiedRemoteJson = await verifiedRemote.json();
  if (verifiedRemote.status !== 200 || verifiedRemoteJson.approved !== 1 || verifiedRemoteJson.hosts?.[0]?.hasNode !== true) {
    throw new Error(`admin remotes did not verify the selected SSH alias: ${verifiedRemote.status} ${JSON.stringify(verifiedRemoteJson)}`);
  }
  const unknownRemote = await fetch(`${baseUrl}/admin/remotes?codexflow_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'verify', alias: 'not-configured' })
  });
  const unknownRemoteJson = await unknownRemote.json();
  if (unknownRemote.status !== 400 || unknownRemoteJson.error?.code !== 'remote_action_failed') {
    throw new Error(`admin remotes accepted an unknown SSH alias: ${unknownRemote.status} ${JSON.stringify(unknownRemoteJson)}`);
  }
  const disabledEnvironmentAction = await fetch(`${baseUrl}/admin/environments?codexflow_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'run', configPath: 'HTTP environment', actionName: 'Verify' })
  });
  const disabledEnvironmentActionJson = await disabledEnvironmentAction.json();
  if (disabledEnvironmentAction.status !== 403 || disabledEnvironmentActionJson.error?.code !== 'environments_disabled') {
    throw new Error(`handoff mode did not reject local environment execution: ${disabledEnvironmentAction.status} ${JSON.stringify(disabledEnvironmentActionJson)}`);
  }
  const changesBefore = await fetch(`${baseUrl}/admin/changes?codexflow_token=${encodeURIComponent(token)}`);
  const changesBeforeJson = await changesBefore.json();
  if (
    changesBefore.status !== 200 ||
    changesBeforeJson.ok !== true ||
    changesBeforeJson.is_git !== true ||
    changesBeforeJson.can_write !== false ||
    !changesBeforeJson.unstaged?.some?.((file) => file.path === 'routing.txt' && file.status === 'modified') ||
    !changesBeforeJson.unstaged?.some?.((file) => file.path === 'untracked-review.txt' && file.status === 'untracked')
  ) {
    throw new Error(`admin changes did not expose project-scoped Git state: ${changesBefore.status} ${JSON.stringify(changesBeforeJson)}`);
  }
  const selectedUntracked = await fetch(`${baseUrl}/admin/changes?codexflow_token=${encodeURIComponent(token)}&path=untracked-review.txt&staged=false`);
  const selectedUntrackedJson = await selectedUntracked.json();
  if (
    selectedUntracked.status !== 200 ||
    selectedUntrackedJson.selected?.path !== 'untracked-review.txt' ||
    !selectedUntrackedJson.selected?.diff?.includes('+new review file') ||
    selectedUntrackedJson.selected?.additions !== 1
  ) {
    throw new Error(`admin changes did not render an untracked preview: ${selectedUntracked.status} ${JSON.stringify(selectedUntrackedJson)}`);
  }
  const disabledChangesAction = await fetch(`${baseUrl}/admin/changes?codexflow_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'stage', paths: ['routing.txt'] })
  });
  const disabledChangesActionJson = await disabledChangesAction.json();
  if (disabledChangesAction.status !== 403 || disabledChangesActionJson.error?.code !== 'changes_read_only') {
    throw new Error(`handoff mode did not reject native Git mutation: ${disabledChangesAction.status} ${JSON.stringify(disabledChangesActionJson)}`);
  }
  const overviewText = JSON.stringify(overviewBeforeJson);
  for (const leaked of [token, runtimeQuerySecret, runtimeAccessSecret, runtimeLocalAuthSecret, runtimeCloudflareSecret]) {
    if (overviewText.includes(leaked)) throw new Error(`local companion overview leaked a runtime secret: ${leaked}`);
  }

  const eventController = new AbortController();
  const events = await fetch(`${baseUrl}/api/events?codexflow_token=${encodeURIComponent(token)}`, { signal: eventController.signal });
  if (events.status !== 200 || !events.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error(`expected runtime event stream, got ${events.status} ${events.headers.get('content-type')}`);
  }
  const firstEvent = await events.body.getReader().read();
  eventController.abort();
  if (!new TextDecoder().decode(firstEvent.value).includes('event: update')) {
    throw new Error('runtime event stream did not emit an initial content-free update');
  }

  const profileBefore = await fetch(`${baseUrl}/admin/profile?codexflow_token=${encodeURIComponent(token)}`);
  const profileBeforeJson = await profileBefore.json();
  if (profileBefore.status !== 200 || profileBeforeJson.exists !== false) {
    throw new Error(`expected empty admin profile response, got ${profileBefore.status} ${JSON.stringify(profileBeforeJson)}`);
  }
  if (JSON.stringify(profileBeforeJson).includes(token)) {
    throw new Error('admin profile GET leaked the raw auth token');
  }
  for (const leaked of [runtimeQuerySecret, runtimeAccessSecret, runtimeLocalAuthSecret, runtimeCloudflareSecret]) {
    if (JSON.stringify(profileBeforeJson).includes(leaked)) throw new Error(`admin profile GET leaked runtime secret: ${leaked}`);
  }

  const invalidProfile = await fetch(`${baseUrl}/admin/profile?codexflow_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tunnel: 'ngrok',
      hostname: 'codexflow-http-smoke.ngrok-free.app',
      requireBashSession: true,
      bashSession: ''
    })
  });
  if (invalidProfile.status !== 400) {
    throw new Error(`expected invalid guarded profile to return 400, got ${invalidProfile.status}`);
  }
  await fs.mkdir(path.join(profileHome, 'profiles'), { recursive: true });
  await fs.writeFile(path.join(profileHome, 'profiles', `${runtimeId}.json`), JSON.stringify({
    version: 1,
    root,
    tunnel: 'cloudflare-named',
    hostname: 'stale.example.com',
    cloudflareToken: staleCloudflareToken,
    cloudflareTokenFile: path.join(root, 'stale-cloudflare-token')
  }, null, 2), 'utf8');

  const profileSave = await fetch(`${baseUrl}/admin/profile?codexflow_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tunnel: 'ngrok',
      hostname: 'https://codexflow-http-smoke.ngrok-free.app/mcp',
      port,
      mode: 'agent',
      bash: 'safe',
      bashTranscript: 'full',
      codexSessions: 'metadata',
      codexDir: path.join(root, '.codex'),
      bashSession: 'http-main',
      requireBashSession: true,
      write: 'workspace',
      toolMode: 'full',
      toolCards: true,
      widgetDomain: 'https://widgets.codexflow.test',
      ngrokConfig: path.join(root, 'ngrok.yml'),
      cloudflareTokenFile: 'cloudflare-token',
      noInstallCloudflared: true
    })
  });
  const profileSaveJson = await profileSave.json();
  if (profileSave.status !== 200 || profileSaveJson.saved !== true) {
    throw new Error(`expected admin profile save to pass, got ${profileSave.status} ${JSON.stringify(profileSaveJson)}`);
  }
  if (JSON.stringify(profileSaveJson).includes(token)) {
    throw new Error('admin profile save response leaked the raw auth token');
  }
  const savedProfile = JSON.parse(await fs.readFile(profileSaveJson.profile_path, 'utf8'));
  if (
    savedProfile.tunnel !== 'ngrok' ||
    savedProfile.hostname !== 'codexflow-http-smoke.ngrok-free.app' ||
    savedProfile.bashTranscript !== 'full' ||
    savedProfile.codexSessions !== 'metadata' ||
    savedProfile.bashSession !== 'http-main' ||
    savedProfile.requireBashSession !== true ||
    savedProfile.toolCards !== true ||
    savedProfile.ngrokConfig !== path.join(root, 'ngrok.yml') ||
    savedProfile.noInstallCloudflared !== true ||
    savedProfile.token !== token
  ) {
    throw new Error(`admin profile save wrote unexpected profile: ${JSON.stringify(savedProfile)}`);
  }
  if (savedProfile.cloudflareToken || savedProfile.cloudflareTokenFile) {
    throw new Error(`admin profile save kept cloudflare token config on ngrok profile: ${JSON.stringify(savedProfile)}`);
  }

  const localProfile = await fetch(`${baseUrl}/admin/profile?codexflow_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tunnel: 'none' })
  });
  const localProfileJson = await localProfile.json();
  const localSavedProfile = JSON.parse(await fs.readFile(localProfileJson.profile_path, 'utf8'));
  if (
    localProfile.status !== 200 ||
    localSavedProfile.hostname ||
    localSavedProfile.ngrokConfig ||
    localSavedProfile.tunnelName ||
    localSavedProfile.cloudflareConfig ||
    localSavedProfile.cloudflareToken ||
    localSavedProfile.cloudflareTokenFile ||
    localProfileJson.profile?.hostname ||
    localProfileJson.profile?.ngrokConfig ||
    localProfileJson.profile?.cloudflareToken ||
    localProfileJson.profile?.cloudflareTokenFile ||
    localProfileJson.effective?.hostname ||
    localProfileJson.effective?.ngrokConfig ||
    localProfileJson.effective?.cloudflareToken ||
    localProfileJson.effective?.cloudflareTokenFile
  ) {
    throw new Error(`admin profile local-only save kept stale tunnel config: ${JSON.stringify(localProfileJson)} ${JSON.stringify(localSavedProfile)}`);
  }

  const queryTools = await listTools(`${baseUrl}/mcp?codexflow_token=${encodeURIComponent(token)}`);
  const queryToolNames = toolNames(queryTools);
  for (const expected of ['server_config', 'codexflow_self_test', 'codexflow_inventory', 'list_projects', 'select_project', 'open_current_workspace', 'open_workspace', 'workspace_snapshot', 'tree', 'search', 'load_skill', 'git_status', 'git_diff', 'show_changes', 'read_handoff', 'wait_for_handoff', 'codex_context', 'handoff_to_agent', 'handoff_to_codex', 'export_pro_context']) {
    if (!queryToolNames.includes(expected)) {
      throw new Error(`URL-token MCP tools/list missing ${expected}; got ${queryToolNames.join(', ')}`);
    }
  }
  for (const hidden of ['write', 'edit']) {
    if (queryToolNames.includes(hidden)) {
      throw new Error(`HTTP handoff mode should not advertise ${hidden}; got ${queryToolNames.join(', ')}`);
    }
  }
  const toolCardUri = 'ui://widget/codexflow-tool-card-v12.html';
  const projectPickerUri = 'ui://widget/codexflow-project-picker-v3.html';
  for (const visualTool of queryToolNames) {
    if (visualTool === 'list_projects') {
      if (!hasWidgetMeta(queryTools, visualTool, projectPickerUri)) throw new Error('list_projects did not expose the dedicated project picker widget');
      if (!queryTools.find((tool) => tool.name === visualTool)?.outputSchema) throw new Error('list_projects did not advertise structured output');
      continue;
    }
    if (visualTool === 'select_project') {
      const selectTool = queryTools.find((tool) => tool.name === visualTool);
      const meta = selectTool?._meta ?? {};
      if (hasWidgetMeta(queryTools, visualTool, toolCardUri) || meta['openai/outputTemplate']) throw new Error('select_project should not depend on a result template');
      if (meta['openai/widgetAccessible'] !== true || !meta.ui?.visibility?.includes?.('app')) throw new Error('select_project was not callable from the picker');
      if (!selectTool?.outputSchema) throw new Error('select_project did not advertise structured output');
      continue;
    }
    if (hasWidgetMeta(queryTools, visualTool, toolCardUri) || hasToolCardStatusMeta(queryTools, visualTool)) {
      throw new Error(`${visualTool} exposed widget metadata while CODEXFLOW_TOOL_CARDS is off`);
    }
  }

  const headerTools = await listTools(`${baseUrl}/mcp`, token);
  const headerToolNames = toolNames(headerTools);
  if (!headerToolNames.includes('server_config')) {
    throw new Error(`bearer MCP tools/list missing server_config; got ${headerToolNames.join(', ')}`);
  }

  const mcpUrl = `${baseUrl}/mcp?codexflow_token=${encodeURIComponent(token)}`;
  const unknownSession = '00000000-0000-4000-8000-000000000000';
  await expectSessionNotFound(await postToolsListWithSession(baseUrl, token, unknownSession), 'unknown POST session');
  await expectSessionNotFound(await fetch(`${baseUrl}/mcp?codexflow_token=${encodeURIComponent(token)}`, {
    headers: {
      accept: 'text/event-stream',
      'mcp-session-id': unknownSession
    }
  }), 'unknown GET session');
  await withClient(mcpUrl, async (client, transport) => {
    await client.listTools();
    const staleSession = transport.sessionId;
    if (!staleSession) throw new Error('HTTP MCP client did not receive a session id');
    await transport.terminateSession();
    await expectSessionNotFound(await postToolsListWithSession(baseUrl, token, staleSession), 'stale POST session');
  });

  await withClient(mcpUrl, async (client) => {
    const resources = await client.listResources();
    const toolCard = resources.resources.find((resource) => resource.uri === toolCardUri);
    if (!toolCard) throw new Error(`HTTP MCP resources/list missing ${toolCardUri}`);
    if (toolCard.mimeType !== 'text/html;profile=mcp-app') {
      throw new Error(`unexpected HTTP tool-card mime type: ${toolCard.mimeType}`);
    }
    const projectPicker = resources.resources.find((resource) => resource.uri === projectPickerUri);
    if (!projectPicker || projectPicker.mimeType !== 'text/html;profile=mcp-app') {
      throw new Error(`HTTP MCP resources/list missing ${projectPickerUri}`);
    }
    const legacyProjectPickerUri = 'ui://widget/codexflow-project-picker-v2.html';
    const legacyProjectPicker = resources.resources.find((resource) => resource.uri === legacyProjectPickerUri);
    if (!legacyProjectPicker || legacyProjectPicker.mimeType !== 'text/html;profile=mcp-app') {
      throw new Error(`HTTP MCP resources/list missing legacy ${legacyProjectPickerUri}`);
    }
    const legacyToolCardUri = 'ui://widget/codexflow-tool-card-v8.html';
    const legacyToolCard = resources.resources.find((resource) => resource.uri === legacyToolCardUri);
    if (!legacyToolCard) throw new Error(`HTTP MCP resources/list missing legacy ${legacyToolCardUri}`);
    const widget = await client.readResource({ uri: toolCardUri });
    const widgetText = widget.contents?.[0]?.text ?? '';
    const widgetMeta = widget.contents?.[0]?._meta ?? {};
    if (!widgetText.includes('Waiting for tool result') || !widgetText.includes('renderWorkspace') || !widgetText.includes('renderProjects') || !widgetText.includes('callTool("select_project"') || !widgetText.includes('renderSelfTest') || !widgetText.includes('details class="fold"') || !widgetText.includes('ui/notifications/tool-result')) {
      throw new Error('HTTP tool-card widget resource did not include expected Apps bridge code');
    }
    if (!widgetMeta.ui?.csp || !widgetMeta['openai/widgetCSP']) {
      throw new Error('HTTP tool-card widget resource did not expose standard and ChatGPT CSP metadata');
    }
    if (widgetMeta.ui?.domain !== 'https://widgets.codexflow.test' || widgetMeta['openai/widgetDomain'] !== 'https://widgets.codexflow.test') {
      throw new Error('HTTP tool-card widget resource did not expose standard and ChatGPT widget domain metadata');
    }
    const pickerWidget = await client.readResource({ uri: projectPickerUri });
    const pickerText = pickerWidget.contents?.[0]?.text ?? '';
    if (!pickerText.includes('Choose this chat’s project') || !pickerText.includes('callTool("select_project"') || !pickerText.includes('route_id') || !pickerText.includes('ui/update-model-context') || !pickerText.includes('setWidgetState') || !pickerText.includes('reply in chat with an exact project name') || !pickerText.includes('openai:set_globals') || !pickerText.includes('MAX_HYDRATION_ATTEMPTS') || pickerText.includes('ui/notifications/tool-result')) {
      throw new Error('HTTP project-picker resource did not include the resilient Apps bridge and chat fallback');
    }
    const legacyPickerWidget = await client.readResource({ uri: legacyProjectPickerUri });
    if (legacyPickerWidget.contents?.[0]?.uri !== legacyProjectPickerUri || legacyPickerWidget.contents?.[0]?.text !== pickerText) {
      throw new Error('HTTP legacy project-picker URI did not serve the current route-safe picker');
    }
    const legacyWidget = await client.readResource({ uri: legacyToolCardUri });
    if (legacyWidget.contents?.[0]?.uri !== legacyToolCardUri) {
      throw new Error('HTTP legacy tool-card widget resource did not preserve requested URI');
    }
    if (!(legacyWidget.contents?.[0]?.text ?? '').includes('Waiting for tool result')) {
      throw new Error('HTTP legacy tool-card widget resource did not serve widget HTML');
    }
  });

  const currentOpened = await withClient(mcpUrl, async (client) => {
    const result = await callTool(client, 'open_current_workspace', { include_tree: false });
    if (result.structuredContent.codexflow_tool !== 'open_current_workspace') {
      throw new Error('HTTP tool result was not tagged for widget rendering');
    }
    if (result.structuredContent.tool_mode !== 'full') {
      throw new Error(`open_current_workspace did not expose tool_mode: ${result.structuredContent.tool_mode}`);
    }
    if (result.structuredContent.skill_inventory?.length) {
      throw new Error('HTTP open_current_workspace discovered skills by default');
    }
    const withSkills = await callTool(client, 'open_current_workspace', {
      include_tree: false,
      include_skills: true
    });
    if (!withSkills.structuredContent.skill_inventory?.some?.((skill) => skill.name === 'http-smoke-skill')) {
      throw new Error('HTTP open_current_workspace did not discover workspace skill inventory when requested');
    }
    return result.structuredContent.workspace_id;
  });

  const routeTelemetryBaselineResponse = await fetch(`${baseUrl}/api/overview?codexflow_token=${encodeURIComponent(token)}`);
  const routeTelemetryBaseline = await routeTelemetryBaselineResponse.json();
  if (routeTelemetryBaselineResponse.status !== 200) {
    throw new Error(`could not read route telemetry baseline: ${routeTelemetryBaselineResponse.status}`);
  }
  const baselineSessionIds = new Set(routeTelemetryBaseline.sessions?.map?.((session) => session.id) ?? []);
  const baselineActiveSessions = routeTelemetryBaseline.summary?.active_sessions ?? 0;

  const bindingClients = Array.from({ length: 6 }, (_, index) => new Client({ name: `codexflow-binding-${index + 1}`, version: '0.0.0' }));
  const bindingTransports = bindingClients.map(() => new StreamableHTTPClientTransport(new URL(mcpUrl)));
  try {
    await Promise.all(bindingClients.map((client, index) => client.connect(bindingTransports[index])));
    const [catalogA, catalogB] = await Promise.all([
      callTool(bindingClients[0], 'list_projects', { refresh: true }),
      callTool(bindingClients[1], 'list_projects')
    ]);
    assertToolOutputSchema(queryTools.find((tool) => tool.name === 'list_projects'), catalogA);
    assertToolOutputSchema(queryTools.find((tool) => tool.name === 'list_projects'), catalogB);
    const routeA = catalogA.structuredContent.route_id;
    const routeB = catalogB.structuredContent.route_id;
    if (!/^route_[a-f0-9]{32}$/.test(routeA) || !/^route_[a-f0-9]{32}$/.test(routeB) || routeA === routeB) {
      throw new Error(`list_projects did not create independent private route ids: ${routeA} ${routeB}`);
    }
    if (catalogA._meta?.['openai/widgetSessionId'] !== routeA || catalogB._meta?.['openai/widgetSessionId'] !== routeB) {
      throw new Error('list_projects did not bind its widget session to the private route id');
    }
    const catalogOnlyOverviewResponse = await fetch(`${baseUrl}/api/overview?codexflow_token=${encodeURIComponent(token)}`);
    const catalogOnlyOverview = await catalogOnlyOverviewResponse.json();
    const prematureRouteSessions = catalogOnlyOverview.sessions?.filter?.((session) => !baselineSessionIds.has(session.id)) ?? [];
    if (
      catalogOnlyOverviewResponse.status !== 200 ||
      catalogOnlyOverview.summary?.active_sessions !== baselineActiveSessions ||
      catalogOnlyOverview.summary?.pending_sessions !== 0 ||
      prematureRouteSessions.length !== 0
    ) {
      throw new Error(`unbound project discovery appeared as a GUI chat: ${JSON.stringify(catalogOnlyOverview)}`);
    }
    const alternate = catalogA.structuredContent.projects.find((project) => project.name === 'alternate-project');
    const primary = catalogB.structuredContent.projects.find((project) => project.sources?.includes?.('default'));
    if (!alternate || !primary) throw new Error(`project catalogs did not contain both routing targets: ${JSON.stringify(catalogA.structuredContent)}`);
    const [selectedA, selectedB] = await Promise.all([
      callTool(bindingClients[2], 'select_project', { route_id: routeA, project_id: alternate.project_id, include_tree: false }),
      callTool(bindingClients[3], 'select_project', { route_id: routeB, project_id: primary.project_id, include_tree: false })
    ]);
    assertToolOutputSchema(queryTools.find((tool) => tool.name === 'select_project'), selectedA);
    assertToolOutputSchema(queryTools.find((tool) => tool.name === 'select_project'), selectedB);
    if (selectedA.structuredContent.route_id !== routeA || selectedA._meta?.['openai/widgetSessionId'] !== routeA) {
      throw new Error('select_project did not preserve route A across a separate picker transport');
    }
    if (selectedB.structuredContent.route_id !== routeB || selectedB._meta?.['openai/widgetSessionId'] !== routeB) {
      throw new Error('select_project did not preserve route B across a separate picker transport');
    }
    const [readA, readB] = await Promise.all([
      callTool(bindingClients[4], 'read', { route_id: routeA, path: 'routing.txt' }),
      callTool(bindingClients[5], 'read', { route_id: routeB, path: 'routing.txt' })
    ]);
    if (!readA.structuredContent.text?.includes('alternate-chat-binding')) throw new Error('chat A did not retain its selected project route across a third transport');
    if (!readB.structuredContent.text?.includes('default-chat-binding')) throw new Error('chat B did not retain an independent project route across a third transport');
    const crossed = await bindingClients[4].callTool({
      name: 'read',
      arguments: { route_id: routeA, workspace_id: primary.project_id, path: 'routing.txt' }
    });
    if (!crossed.isError || !JSON.stringify(crossed.content).includes('does not belong to this private chat route')) {
      throw new Error(`route A accepted route B's workspace id: ${JSON.stringify(crossed)}`);
    }

    const routeProfileId = createHash('sha256').update(await fs.realpath(root)).digest('hex').slice(0, 24);
    const routeFile = JSON.parse(await fs.readFile(path.join(profileHome, 'routes', `${routeProfileId}.json`), 'utf8'));
    const persistedRoutes = new Map(routeFile.routes?.map?.((route) => [route.routeId, route]));
    if (persistedRoutes.get(routeA)?.workspaceId !== alternate.project_id || persistedRoutes.get(routeB)?.workspaceId !== primary.project_id) {
      throw new Error(`private chat routes were not durably persisted: ${JSON.stringify(routeFile)}`);
    }

    const liveOverviewResponse = await fetch(`${baseUrl}/api/overview?codexflow_token=${encodeURIComponent(token)}`);
    const liveOverview = await liveOverviewResponse.json();
    const newRouteSessions = liveOverview.sessions?.filter?.((session) => !baselineSessionIds.has(session.id)) ?? [];
    const routedRoots = new Set(newRouteSessions.map((session) => session.project?.root).filter(Boolean));
    const alternateRoot = await fs.realpath(alternateProject);
    const primaryRoot = await fs.realpath(root);
    const alternateRouteSession = newRouteSessions.find((session) => session.project?.root === alternateRoot);
    const primaryRouteSession = newRouteSessions.find((session) => session.project?.root === primaryRoot);
    if (
      liveOverviewResponse.status !== 200 ||
      liveOverview.summary?.active_sessions !== baselineActiveSessions + 2 ||
      newRouteSessions.length !== 2 ||
      !routedRoots.has(alternateRoot) ||
      !routedRoots.has(primaryRoot) ||
      alternateRouteSession?.tool_calls !== 4 ||
      alternateRouteSession?.errors !== 1 ||
      primaryRouteSession?.tool_calls !== 3 ||
      !liveOverview.activity?.some?.((event) => event.tool === 'read') ||
      !liveOverview.sessions?.every?.((session) => /^chat-[0-9a-f]{8}$/.test(session.id))
    ) {
      throw new Error(`live companion telemetry did not aggregate independent route chats: ${JSON.stringify(liveOverview)}`);
    }
    const liveOverviewText = JSON.stringify(liveOverview);
    for (const forbidden of [token, 'alternate-chat-binding', 'default-chat-binding', ...bindingTransports.map((transport) => transport.sessionId)]) {
      if (forbidden && liveOverviewText.includes(forbidden)) {
        throw new Error(`live companion telemetry retained forbidden content: ${forbidden}`);
      }
    }
    for (const command of [
      { action: 'rename', chatId: alternateRouteSession.id, title: 'Alternate release work' },
      { action: 'pin', chatId: alternateRouteSession.id, value: true },
      { action: 'archive', chatId: alternateRouteSession.id, value: true }
    ]) {
      const lifecycleResponse = await fetch(`${baseUrl}/admin/chats?codexflow_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command)
      });
      const lifecycleBody = await lifecycleResponse.json();
      if (lifecycleResponse.status !== 200 || lifecycleBody.ok !== true) {
        throw new Error(`chat lifecycle action failed: ${lifecycleResponse.status} ${JSON.stringify(lifecycleBody)}`);
      }
    }
    const lifecycleOverview = await (await fetch(`${baseUrl}/api/overview?codexflow_token=${encodeURIComponent(token)}`)).json();
    const updatedChat = lifecycleOverview.sessions?.find?.((session) => session.id === alternateRouteSession.id);
    if (updatedChat?.title !== 'Alternate release work' || updatedChat?.pinned !== true || updatedChat?.archived !== true) {
      throw new Error(`chat lifecycle state was not reflected in overview: ${JSON.stringify(updatedChat)}`);
    }
  } finally {
    await Promise.allSettled(bindingClients.map((client) => client.close()));
  }

  await withClient(mcpUrl, async (client) => {
    const result = await callTool(client, 'open_workspace', {
      root,
      include_tree: false
    });
    if (result.structuredContent.skill_inventory?.length) {
      throw new Error('HTTP open_workspace discovered skills by default');
    }
    const withSkills = await callTool(client, 'open_workspace', {
      root,
      include_tree: false,
      include_skills: true
    });
    if (!withSkills.structuredContent.skill_inventory?.some?.((skill) => skill.name === 'http-smoke-skill')) {
      throw new Error('HTTP open_workspace did not discover workspace skill inventory when requested');
    }
  });

  await withClient(mcpUrl, async (client) => {
    const inventory = await callTool(client, 'codexflow_inventory', {
      include_global_skills: false,
      include_mcp_servers: false
    });
    if (inventory.structuredContent.codexflow_tool !== 'codexflow_inventory') {
      throw new Error('HTTP inventory result was not tagged for widget rendering');
    }
    const loadedSkill = await callTool(client, 'load_skill', {
      name: 'http-smoke-skill',
      source: 'workspace'
    });
    if (loadedSkill.structuredContent.skill?.name !== 'http-smoke-skill' || !loadedSkill.structuredContent.text?.includes('# HTTP Smoke Skill')) {
      throw new Error('HTTP load_skill did not return bounded SKILL.md content');
    }
  });

  const opened = await withClient(mcpUrl, async (client) => {
    const result = await callTool(client, 'open_workspace', { include_tree: false });
    return result.structuredContent.workspace_id;
  });
  if (opened !== currentOpened) {
    throw new Error(`open_current_workspace returned ${currentOpened}, open_workspace default returned ${opened}`);
  }

  await withClient(mcpUrl, async (client) => {
    const list = await callTool(client, 'list_workspaces');
    const ids = list.structuredContent.workspaces.map((workspace) => workspace.id);
    if (!ids.includes(opened)) {
      throw new Error(`cross-session list_workspaces missing ${opened}; got ${ids.join(', ')}`);
    }

    const snapshot = await callTool(client, 'workspace_snapshot', { workspace_id: opened, max_depth: 1 });
    if (snapshot.structuredContent.workspace_id !== opened) {
      throw new Error(`workspace_snapshot returned ${snapshot.structuredContent.workspace_id}, expected ${opened}`);
    }

    const tree = await callTool(client, 'tree', { workspace_id: opened, max_depth: 1, max_entries: 10 });
    if (tree.structuredContent.workspace_id !== opened) {
      throw new Error(`tree returned ${tree.structuredContent.workspace_id}, expected ${opened}`);
    }

    const codexContext = await callTool(client, 'codex_context', { workspace_id: opened });
    if (codexContext.structuredContent.workspace_id !== opened) {
      throw new Error(`codex_context returned ${codexContext.structuredContent.workspace_id}, expected ${opened}`);
    }
  });

  try {
    await fs.stat(path.join(root, '.ai-bridge'));
    throw new Error('read-only HTTP smoke path created .ai-bridge unexpectedly');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await withClient(mcpUrl, async (client) => {
    const exported = await callTool(client, 'export_pro_context', {
      workspace_id: opened,
      max_files: 4,
      max_total_bytes: 80000
    });
    if (exported.structuredContent.path !== '.ai-bridge/pro-context.md') {
      throw new Error(`unexpected pro context path: ${exported.structuredContent.path}`);
    }
  });
  await fs.stat(path.join(root, '.ai-bridge', 'pro-context.md'));
} finally {
  child.kill('SIGTERM');
  await waitForExit(child).catch(() => {});
}

const disabledRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-http-disabled-tools-'));
const disabledPort = await getFreePort();
const disabledToken = 'codexflow-http-disabled-token';
const disabledChild = spawn('node', ['dist/http.js'], {
  cwd: path.resolve('.'),
  env: {
    ...process.env,
    CODEXFLOW_ROOT: disabledRoot,
    CODEXFLOW_ALLOWED_ROOTS: disabledRoot,
    CODEXFLOW_PORT: String(disabledPort),
    CODEXFLOW_HTTP_TOKEN: disabledToken,
    CODEXFLOW_BASH_MODE: 'off',
    CODEXFLOW_WRITE_MODE: 'off',
    CODEXFLOW_TOOL_MODE: 'full'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
try {
  await waitForListening(disabledChild);
  const disabledBase = `http://127.0.0.1:${disabledPort}`;
  const disabledTools = await listTools(`${disabledBase}/mcp?codexflow_token=${encodeURIComponent(disabledToken)}`);
  const disabledToolNames = toolNames(disabledTools);
  for (const hiddenTool of ['bash', 'write', 'edit']) {
    if (disabledToolNames.includes(hiddenTool)) {
      throw new Error(`HTTP disabled mode should not advertise ${hiddenTool}; got ${disabledToolNames.join(', ')}`);
    }
  }
  await withClient(`${disabledBase}/mcp?codexflow_token=${encodeURIComponent(disabledToken)}`, async (client) => {
    const config = await callTool(client, 'server_config');
    if (config.structuredContent.bashMode !== 'off' || config.structuredContent.writeMode !== 'off') {
      throw new Error(`HTTP disabled mode server_config mismatch: ${JSON.stringify(config.structuredContent)}`);
    }
  });
} finally {
  disabledChild.kill('SIGTERM');
  await waitForExit(disabledChild).catch(() => {});
}

const cliRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-cli-http-smoke-'));
await fs.mkdir(path.join(cliRoot, '.codex'), { recursive: true });
const cliPort = await getFreePort();
const badNoAuth = spawn(process.execPath, [
  'scripts/codexflow.mjs',
  'start',
  '--root',
  cliRoot,
  '--tunnel',
  'none',
  '--no-auth',
  '--host',
  '0.0.0.0',
  '--port',
  String(cliPort)
], {
  cwd: path.resolve('.'),
  env: {
    ...process.env,
    CODEXFLOW_HOME: await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-cli-http-bad-home-'))
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
const badNoAuthExit = await waitForExit(badNoAuth);
if (badNoAuthExit.code === 0 || !badNoAuthExit.stderr.includes('--no-auth is only allowed')) {
  throw new Error(`non-loopback --no-auth was not rejected\n${badNoAuthExit.stderr}`);
}
const cliChild = spawn(process.execPath, [
  'scripts/codexflow.mjs',
  'start',
  '--root',
  cliRoot,
  '--tunnel',
  'none',
  '--no-auth',
  '--port',
  String(cliPort),
  '--codex-sessions',
  'metadata',
  '--codex-dir',
  '.codex'
], {
  cwd: path.resolve('.'),
  env: {
    ...process.env,
    CODEXFLOW_HOME: await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-cli-http-home-'))
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
try {
  await waitForHealthJson(`http://127.0.0.1:${cliPort}/healthz`);
  const expectedCliCodexDir = path.join(await fs.realpath(cliRoot), '.codex');
  await withClient(`http://127.0.0.1:${cliPort}/mcp`, async (client) => {
    const config = await callTool(client, 'server_config');
    if (config.structuredContent.codexDir !== expectedCliCodexDir) {
      throw new Error(`relative --codex-dir resolved to ${config.structuredContent.codexDir}, expected ${expectedCliCodexDir}`);
    }
  });
} finally {
  cliChild.kill('SIGTERM');
  await waitForExit(cliChild).catch(() => {});
}

const connectionTestPort = await getFreePort();
let connectionTestStderr = '';
const connectionTestChild = spawn(process.execPath, [
  'scripts/codexflow.mjs',
  'connection-test',
  '--root',
  cliRoot,
  '--tunnel',
  'none',
  '--no-auth',
  '--no-profile',
  '--port',
  String(connectionTestPort)
], {
  cwd: path.resolve('.'),
  env: {
    ...process.env,
    CODEXFLOW_HOME: await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-connection-test-home-'))
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
connectionTestChild.stderr.on('data', (chunk) => {
  connectionTestStderr += String(chunk);
});
try {
  await waitForHealthJson(`http://127.0.0.1:${connectionTestPort}/healthz`);
  const tools = await listTools(`http://127.0.0.1:${connectionTestPort}/mcp`);
  const names = toolNames(tools);
  for (const expected of ['read', 'tree', 'search', 'load_skill']) {
    if (!names.includes(expected)) throw new Error(`connection-test missing ${expected}; got ${names.join(', ')}`);
  }
  for (const hidden of ['codexflow', 'codexflow_self_test', 'write', 'edit', 'apply_patch', 'bash', 'export_pro_context', 'handoff_to_agent', 'handoff_to_codex']) {
    if (names.includes(hidden)) throw new Error(`connection-test exposed ${hidden}; got ${names.join(', ')}`);
  }
  for (const tool of tools) {
    const annotations = tool.annotations ?? {};
    if (annotations.readOnlyHint !== true || annotations.openWorldHint !== false || annotations.destructiveHint !== false) {
      throw new Error(`connection-test exposed non-read-only annotations for ${tool.name}: ${JSON.stringify(annotations)}`);
    }
  }
  await withClient(`http://127.0.0.1:${connectionTestPort}/mcp`, async (client) => {
    const config = await callTool(client, 'server_config');
    if (config.structuredContent.connectionTest !== true || config.structuredContent.toolCards !== false) {
      throw new Error(`unexpected connection-test config: ${JSON.stringify(config.structuredContent)}`);
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (!connectionTestStderr.includes('[CodexFlow] POST /mcp received')) {
    throw new Error(`connection-test did not print request-arrival logs\n${connectionTestStderr}`);
  }
} finally {
  connectionTestChild.kill('SIGTERM');
  await waitForExit(connectionTestChild).catch(() => {});
}

console.log('✓ http smoke test passed');
