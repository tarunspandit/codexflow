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
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for CodexFlow HTTP server.');
}

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
  return result.structuredContent;
}

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-remote-routing-'));
const localRoot = path.join(fixture, 'local');
const remoteRoot = path.join(fixture, 'remote');
const codexflowHome = path.join(fixture, 'home');
const sshConfig = path.join(fixture, 'ssh-config');
const fakeSsh = path.join(fixture, 'ssh');
await fs.mkdir(localRoot, { recursive: true });
await fs.mkdir(path.join(remoteRoot, 'src'), { recursive: true });
await fs.mkdir(path.join(remoteRoot, '.codex', 'environments'), { recursive: true });
await fs.mkdir(path.join(remoteRoot, '.codex', 'skills', 'remote-smoke'), { recursive: true });
await fs.writeFile(path.join(remoteRoot, 'README.md'), '# Routed remote project\nroute-needle\n');
await fs.writeFile(path.join(remoteRoot, 'src', 'value.js'), 'export const value = 1;\n');
await fs.writeFile(path.join(remoteRoot, '.codex', 'environments', 'remote.toml'), [
  'version = 1',
  'name = "Remote smoke"',
  '',
  '[setup]',
  'script = "printf remote-environment-setup"',
  '',
  '[cleanup]',
  'script = "printf remote-environment-cleanup"',
  '',
  '[[actions]]',
  'name = "Echo remote"',
  'icon = "test"',
  'command = "printf remote-environment-action"',
  ''
].join('\n'));
await fs.writeFile(path.join(remoteRoot, '.codex', 'skills', 'remote-smoke', 'SKILL.md'), [
  '---',
  'name: remote-smoke',
  'description: Remote workspace instructions for smoke coverage.',
  '---',
  '',
  '# Remote smoke skill',
  '',
  'Use the remote-route-needle workflow.',
  ''
].join('\n'));
await fs.writeFile(sshConfig, 'Host devbox\n  HostName devbox.example\n  User smoke\n');
await fs.writeFile(fakeSsh, `#!/bin/sh
if [ "$1" = "-G" ]; then
  printf 'hostname devbox.example\\nuser smoke\\nport 22\\n'
  exit 0
fi
last=''
for arg in "$@"; do last="$arg"; done
case "$last" in
  *codexflow_remote=1*) printf 'codexflow_remote=1\\nplatform=Linux\\nhome=/home/smoke\\nnode=1\\ngit=1\\n' ;;
  *) exec /bin/sh -c "$last" ;;
esac
`, { mode: 0o700 });
for (const args of [['init'], ['add', '.']]) {
  const result = spawnSync('git', args, { cwd: remoteRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
const commit = spawnSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.com', 'commit', '-m', 'initial'], { cwd: remoteRoot, encoding: 'utf8' });
if (commit.status !== 0) throw new Error(commit.stderr || commit.stdout);

const port = await freePort();
const token = 'remote-routing-smoke-token';
const env = {
  ...process.env,
  CODEXFLOW_ROOT: localRoot,
  CODEXFLOW_ALLOWED_ROOTS: localRoot,
  CODEXFLOW_HOME: codexflowHome,
  CODEXFLOW_SSH_CONFIG: sshConfig,
  CODEXFLOW_SSH_BIN: fakeSsh,
  CODEXFLOW_HOST: '127.0.0.1',
  CODEXFLOW_PORT: String(port),
  CODEXFLOW_HTTP_TOKEN: token,
  CODEXFLOW_WRITE_MODE: 'workspace',
  CODEXFLOW_BASH_MODE: 'full',
  CODEXFLOW_TOOL_MODE: 'standard',
  CODEXFLOW_TOOL_CARDS: '0'
};
const child = spawn(process.execPath, ['dist/http.js'], { cwd: path.resolve('.'), env, stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += String(chunk); });

try {
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(`${base}/healthz?codexflow_token=${encodeURIComponent(token)}`, child);
  const admin = async (body) => {
    const response = await fetch(`${base}/admin/remotes?codexflow_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(json));
    return json;
  };
  await admin({ action: 'verify', alias: 'devbox' });
  const saved = await admin({ action: 'save_project', alias: 'devbox', root: remoteRoot });
  assert.equal(saved.projects[0].available, true);

  const client = new Client({ name: 'remote-routing-smoke', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp?codexflow_token=${encodeURIComponent(token)}`));
  await client.connect(transport);
  try {
    const listed = await call(client, 'list_projects', { refresh: true });
    const remote = listed.projects.find((project) => project.location === 'remote');
    assert.ok(remote, 'saved remote project was absent from list_projects');
    assert.equal(remote.host_alias, 'devbox');
    const selected = await call(client, 'select_project', { route_id: listed.route_id, project_id: remote.project_id, include_tree: true });
    assert.equal(selected.location, 'remote');
    assert.equal(selected.workspace_id, remote.project_id);
    assert.match(selected.tree, /README\.md/);
    assert.ok(selected.skills.some((skill) => skill.name === 'remote-smoke' && skill.source === 'workspace'));
    const loadedSkill = await call(client, 'load_skill', {
      route_id: listed.route_id,
      workspace_id: remote.project_id,
      name: 'remote-smoke',
      source: 'workspace'
    });
    assert.equal(loadedSkill.location, 'remote');
    assert.equal(loadedSkill.skill.path, '$WORKSPACE/.codex/skills/remote-smoke/SKILL.md');
    assert.match(loadedSkill.text, /remote-route-needle/);
    const analysis = await call(client, 'inspect_workspace', {
      route_id: listed.route_id,
      workspace_id: remote.project_id,
      max_files: 100,
      max_symbols: 100,
      max_relationships: 100
    });
    assert.equal(analysis.location, 'remote');
    assert.ok(analysis.languages.includes('javascript'));
    assert.ok(analysis.files.some((file) => file.path === 'src/value.js'));
    assert.ok(analysis.symbols.some((symbol) => symbol.name === 'value' && symbol.path === 'src/value.js'));

    const read = await call(client, 'read', { route_id: listed.route_id, workspace_id: remote.project_id, path: 'README.md' });
    assert.match(read.text, /route-needle/);
    const search = await call(client, 'search', { route_id: listed.route_id, workspace_id: remote.project_id, query: 'route-needle' });
    assert.equal(search.used, 'remote-node');
    assert.equal(search.matches[0].path, 'README.md');
    await call(client, 'write', { route_id: listed.route_id, workspace_id: remote.project_id, path: 'src/routed.js', content: 'export const routed = true;\n' });
    await call(client, 'edit', { route_id: listed.route_id, workspace_id: remote.project_id, path: 'src/routed.js', old_text: 'true', new_text: 'false' });
    const bash = await call(client, 'bash', { route_id: listed.route_id, workspace_id: remote.project_id, command: 'pwd' });
    assert.equal(bash.exitCode, 0);

    const changedDirectory = await call(client, 'terminal', {
      route_id: listed.route_id,
      workspace_id: remote.project_id,
      action: 'run',
      command: 'cd src'
    });
    assert.equal(changedDirectory.completed, true);
    assert.equal(changedDirectory.exitCode, 0);
    assert.equal(changedDirectory.location, 'remote');
    assert.equal(changedDirectory.host_alias, 'devbox');
    const terminalPwd = await call(client, 'terminal', {
      route_id: listed.route_id,
      workspace_id: remote.project_id,
      action: 'run',
      command: 'pwd'
    });
    assert.equal(terminalPwd.output.trim(), path.posix.join(remote.root, 'src'));
    await call(client, 'terminal', {
      route_id: listed.route_id,
      workspace_id: remote.project_id,
      action: 'run',
      command: 'export CODEXFLOW_REMOTE_TERMINAL=persisted'
    });

    const secondListed = await call(client, 'list_projects', { refresh: false });
    assert.notEqual(secondListed.route_id, listed.route_id);
    await call(client, 'select_project', {
      route_id: secondListed.route_id,
      project_id: remote.project_id,
      include_tree: false
    });
    const isolated = await call(client, 'terminal', {
      route_id: secondListed.route_id,
      workspace_id: remote.project_id,
      action: 'run',
      command: `printf '%s' "$CODEXFLOW_REMOTE_TERMINAL"`
    });
    assert.equal(isolated.output.trim(), '');

    const started = await call(client, 'terminal', {
      route_id: listed.route_id,
      workspace_id: remote.project_id,
      action: 'start',
      command: `node -e "process.stdin.once('data', value => { console.log('remote-input:' + value.toString().trim()); process.exit(0); })"`,
      timeout_ms: 5000
    });
    assert.equal(started.completed, false);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await call(client, 'terminal', {
      route_id: listed.route_id,
      workspace_id: remote.project_id,
      action: 'write',
      data: 'hello remote terminal\n'
    });
    let transcript;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      transcript = await call(client, 'terminal', {
        route_id: listed.route_id,
        workspace_id: remote.project_id,
        action: 'read',
        after_cursor: started.cursor
      });
      if (!transcript.running) break;
    }
    assert.match(transcript?.output ?? '', /remote-input:hello remote terminal/);
    assert.equal(transcript?.running, false);
    assert.doesNotMatch(transcript?.output ?? '', /__CODEXFLOW_/);

    const concurrentStart = Date.now();
    const [firstParallel, secondParallel] = await Promise.all([
      call(client, 'terminal', {
        route_id: listed.route_id,
        workspace_id: remote.project_id,
        action: 'run',
        command: `node -e "setTimeout(() => console.log('one'), 350)"`
      }),
      call(client, 'terminal', {
        route_id: secondListed.route_id,
        workspace_id: remote.project_id,
        action: 'run',
        command: `node -e "setTimeout(() => console.log('two'), 350)"`
      })
    ]);
    assert.match(firstParallel.output, /one/);
    assert.match(secondParallel.output, /two/);
    assert.ok(Date.now() - concurrentStart < 650, 'remote route terminals did not run concurrently');

    await assert.rejects(
      call(client, 'terminal', {
        route_id: listed.route_id,
        workspace_id: remote.project_id,
        action: 'run',
        command: 'pwd',
        cwd: '/'
      }),
      /must be relative to the remote project/
    );
    await call(client, 'terminal', { route_id: listed.route_id, workspace_id: remote.project_id, action: 'stop' });
    await call(client, 'terminal', { route_id: secondListed.route_id, workspace_id: remote.project_id, action: 'stop' });

    const environments = await call(client, 'local_environment', {
      route_id: listed.route_id,
      workspace_id: remote.project_id,
      action: 'list'
    });
    assert.equal(environments.location, 'remote');
    assert.equal(environments.count, 1);
    assert.equal(environments.environments[0].name, 'Remote smoke');
    assert.ok(['darwin', 'linux', 'win32'].includes(environments.platform));
    const selectedEnvironment = await call(client, 'local_environment', {
      route_id: listed.route_id,
      workspace_id: remote.project_id,
      action: 'select',
      config_path: 'Remote smoke'
    });
    assert.match(selectedEnvironment.selected_config_path, /\/\.codex\/environments\/remote\.toml$/);
    const environmentAction = await call(client, 'local_environment', {
      route_id: listed.route_id,
      workspace_id: remote.project_id,
      action: 'run',
      action_name: 'Echo remote'
    });
    assert.match(environmentAction.output, /remote-environment-action/);
    const environmentSetup = await call(client, 'local_environment', {
      route_id: listed.route_id,
      workspace_id: remote.project_id,
      action: 'setup'
    });
    assert.match(environmentSetup.output, /remote-environment-setup/);
    const environmentCleanup = await call(client, 'local_environment', {
      route_id: listed.route_id,
      workspace_id: remote.project_id,
      action: 'cleanup'
    });
    assert.match(environmentCleanup.output, /remote-environment-cleanup/);
    await call(client, 'terminal', { route_id: listed.route_id, workspace_id: remote.project_id, action: 'stop' });

    const status = await call(client, 'show_changes', { route_id: listed.route_id, workspace_id: remote.project_id, include_diff: true, since: 'workspace' });
    assert.match(status.status, /src\/routed\.js/);
    assert.match(await fs.readFile(path.join(remoteRoot, 'src', 'routed.js'), 'utf8'), /false/);
  } finally {
    await client.close();
  }
  console.log('✓ saved remote project routes files, Bash, Git, isolated terminals, Codex environments, skills, and analysis over SSH');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await fs.rm(fixture, { recursive: true, force: true });
  if (child.exitCode && child.exitCode !== 0 && !stderr.includes('SIGTERM')) process.stderr.write(stderr);
}
