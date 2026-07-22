import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'codexflow-remotes-smoke-'));
const home = path.join(fixture, 'codexflow-home');
const ssh = path.join(fixture, 'ssh');
const includes = path.join(fixture, 'config.d');
const config = path.join(fixture, 'config');
const remoteRoot = path.join(fixture, 'remote-project');
fs.mkdirSync(includes, { recursive: true });
fs.mkdirSync(path.join(remoteRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(remoteRoot, 'README.md'), '# Remote fixture\nneedle\n');
fs.writeFileSync(path.join(remoteRoot, '.env'), 'SECRET=never-read\n');
fs.writeFileSync(path.join(remoteRoot, 'src', 'index.js'), 'export const value = 1;\n');
fs.writeFileSync(config, [
  'Include config.d/*',
  'Host *.pattern-only',
  '  User ignored',
  'Host devbox backup',
  '  HostName devbox.example',
  ''
].join('\n'));
fs.writeFileSync(path.join(includes, 'work'), [
  'Host included-box',
  '  HostName included.example',
  ''
].join('\n'));
fs.writeFileSync(ssh, `#!/bin/sh
if [ "$1" = "-G" ]; then
  alias="$2"
  printf 'hostname %s\\n' "\${FAKE_SSH_HOSTNAME:-$alias.example}"
  printf 'user smoke\\nport 2222\\n'
  exit 0
fi
if [ "\${FAKE_SSH_FAIL:-0}" = "1" ]; then
  printf 'Host key verification failed.\\n' >&2
  exit 255
fi
last=''
for arg in "$@"; do last="$arg"; done
case "$last" in
  *codexflow_remote=1*)
    printf 'codexflow_remote=1\\nplatform=Linux\\nhome=/home/smoke\\nnode=1\\ngit=1\\n'
    ;;
  *)
    exec /bin/sh -c "$last"
    ;;
esac
`, { mode: 0o700 });

process.env.CODEXFLOW_HOME = home;
process.env.CODEXFLOW_SSH_CONFIG = config;
process.env.CODEXFLOW_SSH_BIN = ssh;

try {
  const {
    disconnectRemoteConnection,
    getApprovedRemoteProject,
    listRemoteConnections,
    removeRemoteProject,
    saveRemoteProject,
    verifyRemoteConnection
  } = await import('../dist/remoteConnections.js');
  const { runRemoteWorkspaceOperation } = await import('../dist/remoteWorkspace.js');
  const operationConfig = {
    blockedGlobs: ['.git', '.git/**', '**/.git/**', '.env', '.env.*', '**/.env', '**/.env.*'],
    maxOutputBytes: 120_000
  };

  const initial = listRemoteConnections();
  assert.deepEqual(initial.hosts.map((host) => host.alias), ['backup', 'devbox', 'included-box']);
  assert.equal(initial.approved, 0);
  assert.ok(initial.hosts.every((host) => host.status === 'available'));

  assert.throws(() => verifyRemoteConnection('unknown'), /not present as a concrete alias/);
  const verified = verifyRemoteConnection('devbox');
  assert.equal(verified.approved, 1);
  assert.equal(verified.hosts.find((host) => host.alias === 'devbox')?.hasNode, true);
  assert.equal(fs.statSync(path.join(home, 'remote-hosts.json')).mode & 0o777, 0o600);
  const stored = fs.readFileSync(path.join(home, 'remote-hosts.json'), 'utf8');
  assert.doesNotMatch(stored, /devbox\.example|IdentityFile|private.?key/i);

  const savedProject = saveRemoteProject('devbox', remoteRoot);
  assert.equal(savedProject.projects.length, 1);
  assert.equal(savedProject.projects[0].available, true);
  assert.equal(savedProject.projects[0].root, fs.realpathSync(remoteRoot));
  const project = getApprovedRemoteProject(savedProject.savedProjectId);
  const tree = await runRemoteWorkspaceOperation(project.hostAlias, operationConfig, {
    action: 'tree', root: project.root, path: '.', maxDepth: 3, maxEntries: 100, includeHidden: true
  });
  assert.match(tree.text, /README\.md/);
  assert.doesNotMatch(tree.text, /\.env/);
  const search = await runRemoteWorkspaceOperation(project.hostAlias, operationConfig, {
    action: 'search', root: project.root, path: '.', query: 'needle', regex: false, includeHidden: false, maxResults: 20, maxReadBytes: 120_000
  });
  assert.equal(search.matches[0].path, 'README.md');
  await assert.rejects(() => runRemoteWorkspaceOperation(project.hostAlias, operationConfig, {
    action: 'read', root: project.root, path: '.env', maxBytes: 120_000
  }), /blocked by CodexFlow policy/);
  const written = await runRemoteWorkspaceOperation(project.hostAlias, operationConfig, {
    action: 'write', root: project.root, path: 'src/remote.js', content: 'export const remote = true;\n', createDirs: true, overwrite: true, maxWriteBytes: 1_000_000
  });
  assert.equal(written.changed, true);
  const edited = await runRemoteWorkspaceOperation(project.hostAlias, operationConfig, {
    action: 'edit', root: project.root, path: 'src/remote.js', oldText: 'true', newText: 'false', replaceAll: false, expectedReplacements: 1, maxWriteBytes: 1_000_000
  });
  assert.equal(edited.replacements, 1);
  assert.match(fs.readFileSync(path.join(remoteRoot, 'src', 'remote.js'), 'utf8'), /false/);
  const singleStarted = Date.now();
  const single = await runRemoteWorkspaceOperation(project.hostAlias, operationConfig, { action: 'bash', root: project.root, command: 'sleep 1', timeoutMs: 5_000 });
  const singleElapsed = Date.now() - singleStarted;
  assert.equal(single.exitCode, 0);
  const concurrentStarted = Date.now();
  const concurrent = await Promise.all([
    runRemoteWorkspaceOperation(project.hostAlias, operationConfig, { action: 'bash', root: project.root, command: 'sleep 1', timeoutMs: 5_000 }),
    runRemoteWorkspaceOperation(project.hostAlias, operationConfig, { action: 'bash', root: project.root, command: 'sleep 1', timeoutMs: 5_000 })
  ]);
  assert.ok(concurrent.every((result) => result.exitCode === 0));
  const concurrentElapsed = Date.now() - concurrentStarted;
  assert.ok(concurrentElapsed < singleElapsed * 1.65, `remote operations ran serially (${singleElapsed}ms single, ${concurrentElapsed}ms concurrent)`);

  process.env.FAKE_SSH_HOSTNAME = 'rerouted.example';
  const changed = listRemoteConnections();
  assert.equal(changed.hosts.find((host) => host.alias === 'devbox')?.status, 'config_changed');
  assert.equal(changed.approved, 0);
  assert.equal(changed.projects[0].available, false);
  assert.throws(() => getApprovedRemoteProject(savedProject.savedProjectId), /not currently approved/);
  delete process.env.FAKE_SSH_HOSTNAME;

  process.env.FAKE_SSH_FAIL = '1';
  assert.throws(() => verifyRemoteConnection('backup'), /Host key verification failed/);
  assert.equal(listRemoteConnections().hosts.find((host) => host.alias === 'backup')?.approved, false);
  delete process.env.FAKE_SSH_FAIL;

  const removed = removeRemoteProject(savedProject.savedProjectId);
  assert.equal(removed.projects.length, 0);
  const disconnected = disconnectRemoteConnection('devbox');
  assert.equal(disconnected.approved, 0);
  assert.equal(disconnected.hosts.find((host) => host.alias === 'devbox')?.status, 'available');
  console.log('✓ SSH trust, saved remote projects, concurrent bounded operations, invalidation, and disconnect smoke passed');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
