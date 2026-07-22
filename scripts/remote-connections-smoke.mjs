import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'codexflow-remotes-smoke-'));
const home = path.join(fixture, 'codexflow-home');
const ssh = path.join(fixture, 'ssh');
const includes = path.join(fixture, 'config.d');
const config = path.join(fixture, 'config');
fs.mkdirSync(includes, { recursive: true });
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
printf 'codexflow_remote=1\\nplatform=Linux\\nhome=/home/smoke\\nnode=1\\ngit=1\\n'
`, { mode: 0o700 });

process.env.CODEXFLOW_HOME = home;
process.env.CODEXFLOW_SSH_CONFIG = config;
process.env.CODEXFLOW_SSH_BIN = ssh;

try {
  const { disconnectRemoteConnection, listRemoteConnections, verifyRemoteConnection } = await import('../dist/remoteConnections.js');

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

  process.env.FAKE_SSH_HOSTNAME = 'rerouted.example';
  const changed = listRemoteConnections();
  assert.equal(changed.hosts.find((host) => host.alias === 'devbox')?.status, 'config_changed');
  assert.equal(changed.approved, 0);
  delete process.env.FAKE_SSH_HOSTNAME;

  process.env.FAKE_SSH_FAIL = '1';
  assert.throws(() => verifyRemoteConnection('backup'), /Host key verification failed/);
  assert.equal(listRemoteConnections().hosts.find((host) => host.alias === 'backup')?.approved, false);
  delete process.env.FAKE_SSH_FAIL;

  const disconnected = disconnectRemoteConnection('devbox');
  assert.equal(disconnected.approved, 0);
  assert.equal(disconnected.hosts.find((host) => host.alias === 'devbox')?.status, 'available');
  console.log('✓ SSH host discovery, explicit verification, trust invalidation, and disconnect smoke passed');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
