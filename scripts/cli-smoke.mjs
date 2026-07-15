import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve('.');

function run(args, env) {
  return spawnSync(process.execPath, ['scripts/codexflow.mjs', ...args], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024
  });
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

async function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for launcher exit')), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-cli-smoke-root-'));
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-cli-smoke-home-'));
const env = {
  ...process.env,
  CODEXFLOW_HOME: home
};

const codexDir = path.join(home, 'codex');
const sessionDir = path.join(codexDir, 'sessions', '2026', '07', '12');
const autoProjectA = path.join(home, 'project-a');
const autoProjectB = path.join(home, 'project-b');
await Promise.all([
  fs.mkdir(sessionDir, { recursive: true }),
  fs.mkdir(autoProjectA, { recursive: true }),
  fs.mkdir(autoProjectB, { recursive: true })
]);
await fs.writeFile(path.join(sessionDir, 'rollout-2026-07-12T01-00-00-11111111-1111-4111-8111-111111111111.jsonl'),
  `${JSON.stringify({ timestamp: '2026-07-12T01:00:00Z', type: 'session_meta', payload: { id: '11111111-1111-4111-8111-111111111111', cwd: autoProjectA } })}\n`);
await fs.writeFile(path.join(sessionDir, 'rollout-2026-07-12T02-00-00-22222222-2222-4222-8222-222222222222.jsonl'),
  `${JSON.stringify({ timestamp: '2026-07-12T02:00:00Z', type: 'session_meta', payload: { id: '22222222-2222-4222-8222-222222222222', cwd: autoProjectB } })}\n`);
env.CODEXFLOW_CODEX_DIR = codexDir;

const autoPort = await getFreePort();
const autoChild = spawn(process.execPath, [
  'scripts/codexflow.mjs',
  '--port', String(autoPort),
  '--tunnel', 'none',
  '--no-auth',
  '--no-copy-url',
  '--non-interactive'
], { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
let autoOutput = '';
autoChild.stdout.on('data', (chunk) => { autoOutput += String(chunk); });
autoChild.stderr.on('data', (chunk) => { autoOutput += String(chunk); });
let autoHealth;
const autoDeadline = Date.now() + 15000;
while (Date.now() < autoDeadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${autoPort}/healthz`);
    if (response.ok) {
      autoHealth = await response.json();
      break;
    }
  } catch {
    // The zero-setup launcher may still be starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
try {
  assert.equal(autoHealth?.defaultRoot, await fs.realpath(autoProjectB), `${autoOutput}\nzero-setup launch did not choose the most recent Codex project`);
  assert.ok(autoHealth.allowedRoots.includes(await fs.realpath(autoProjectA)), 'zero-setup launch did not include project A');
  assert.ok(autoHealth.allowedRoots.includes(await fs.realpath(autoProjectB)), 'zero-setup launch did not include project B');
  assert.match(autoOutput, /Projects found\s+2/);
  assert.doesNotMatch(autoOutput, /Where is your project located|First run setup|Save this setup/);
} finally {
  if (autoChild.exitCode === null) autoChild.kill('SIGTERM');
  await waitForExit(autoChild);
}

const statusBefore = run(['status', '--root', root, '--json'], env);
assert.equal(statusBefore.status, 1, statusBefore.stderr || statusBefore.stdout);
const beforePayload = JSON.parse(statusBefore.stdout);
assert.equal(beforePayload.state, 'not_running');
assert.equal(beforePayload.active, false);
const appBefore = run(['app', '--root', root], env);
assert.equal(appBefore.status, 1, appBefore.stderr || appBefore.stdout);
assert.match(appBefore.stderr, /CodexFlow is not running/);

const port = await getFreePort();
const appToken = 'codexflow-cli-companion-token';
const browserOutput = path.join(home, 'opened-companion-url.txt');
const fakeBrowser = path.join(home, 'fake-browser.mjs');
await fs.writeFile(fakeBrowser, [
  '#!/usr/bin/env node',
  "import fs from 'node:fs';",
  "fs.writeFileSync(process.env.CODEXFLOW_BROWSER_OUTPUT, process.argv[2] || '');",
  ''
].join('\n'), { mode: 0o700 });
const child = spawn(process.execPath, [
  'scripts/codexflow.mjs',
  'start',
  '--root', root,
  '--port', String(port),
  '--tunnel', 'none',
  '--token', appToken,
  '--no-copy-url',
  '--non-interactive'
], {
  cwd: projectRoot,
  env,
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', (chunk) => { output += String(chunk); });
child.stderr.on('data', (chunk) => { output += String(chunk); });

const runtimePath = path.join(home, 'runtime');
let runtimeFile = '';
const runtimeDeadline = Date.now() + 15000;
let runtime;
while (Date.now() < runtimeDeadline) {
  try {
    const files = (await fs.readdir(runtimePath)).filter((name) => name.endsWith('.json'));
    if (files.length) {
      runtimeFile = path.join(runtimePath, files[0]);
      runtime = JSON.parse(await fs.readFile(runtimeFile, 'utf8'));
      if (runtime.pid === child.pid) break;
    }
  } catch {
    // The launcher may not have created its runtime directory yet.
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

try {
  assert.equal(runtime?.pid, child.pid, `${output}\nlauncher did not write an active runtime record`);
  assert.equal(runtime?.localAuthToken, appToken, 'launcher did not retain the private local companion credential');
  assert.match(output, /Non-interactive mode/);

  const statusDuring = run(['status', '--root', root, '--json'], env);
  assert.equal(statusDuring.status, 0, statusDuring.stderr || statusDuring.stdout);
  const duringPayload = JSON.parse(statusDuring.stdout);
  assert.equal(duringPayload.state, 'active');
  assert.equal(duringPayload.active, true);
  assert.equal(duringPayload.health.status, 'ok');
  assert.equal(duringPayload.runtime.pid, child.pid);
  assert.match(duringPayload.runtime.local_base, /^http:\/\/127\.0\.0\.1:/);
  assert.doesNotMatch(JSON.stringify(duringPayload), new RegExp(appToken));

  const appDuring = run(['app', '--root', root], {
    ...env,
    CODEXFLOW_BROWSER: fakeBrowser,
    CODEXFLOW_BROWSER_OUTPUT: browserOutput
  });
  assert.equal(appDuring.status, 0, appDuring.stderr || appDuring.stdout);
  assert.doesNotMatch(`${appDuring.stdout}${appDuring.stderr}`, new RegExp(appToken));
  const openedUrl = new URL(await fs.readFile(browserOutput, 'utf8'));
  assert.equal(openedUrl.origin, `http://127.0.0.1:${port}`);
  assert.equal(openedUrl.pathname, '/');
  assert.equal(openedUrl.searchParams.get('codexflow_token'), appToken);
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  try {
    await waitForExit(child);
  } catch {
    child.kill('SIGKILL');
  }
  if (runtimeFile) await fs.rm(runtimeFile, { force: true });
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(home, { recursive: true, force: true });
}

console.log('✓ CLI status and non-interactive smoke test passed');
