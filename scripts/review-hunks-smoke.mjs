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
  throw new Error('Timed out waiting for review smoke server.');
}

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-review-hunks-'));
const root = path.join(fixture, 'repo');
const home = path.join(fixture, 'home');
await fs.mkdir(root, { recursive: true });
await fs.mkdir(home, { recursive: true });
const original = Array.from({ length: 24 }, (_, index) => `line ${index + 1}`);
await fs.writeFile(path.join(root, 'sample.txt'), `${original.join('\n')}\n`);
for (const args of [['init'], ['add', '.']]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
const committed = spawnSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.com', 'commit', '-m', 'initial'], { cwd: root, encoding: 'utf8' });
if (committed.status !== 0) throw new Error(committed.stderr || committed.stdout);
const changed = [...original];
changed[1] = 'line 2 changed';
changed[21] = 'line 22 changed';
await fs.writeFile(path.join(root, 'sample.txt'), `${changed.join('\n')}\n`);
await fs.writeFile(path.join(root, 'untracked.txt'), 'first\nsecond\n');

const port = await freePort();
const token = 'review-hunks-smoke-token';
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
  const url = (suffix = '') => `${base}/admin/changes?codexflow_token=${encodeURIComponent(token)}${suffix}`;
  await waitForHealth(`${base}/healthz?codexflow_token=${encodeURIComponent(token)}`, child);
  const getChange = async (file, staged) => {
    const response = await fetch(url(`&path=${encodeURIComponent(file)}&staged=${staged}`));
    const json = await response.json();
    assert.equal(response.status, 200, JSON.stringify(json));
    return json;
  };
  const command = async (body, expected = 200) => {
    const response = await fetch(url(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = await response.json();
    assert.equal(response.status, expected, JSON.stringify(json));
    return json;
  };

  let unstaged = await getChange('sample.txt', false);
  assert.equal(unstaged.selected.hunks.length, 2);
  const firstHunk = unstaged.selected.hunks[0];
  const secondHunk = unstaged.selected.hunks[1];
  const commented = await command({
    action: 'comment', path: 'sample.txt', staged: false, hunkId: firstHunk.id,
    line: firstHunk.startLine + 1, body: 'Confirm this behavior at the boundary.'
  });
  assert.equal(commented.selected.comments.length, 1);
  const commentId = commented.selected.comments[0].id;
  assert.equal((await fs.stat(path.join(home, 'review-comments.json'))).mode & 0o777, 0o600);
  const client = new Client({ name: 'review-hunks-smoke', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp?codexflow_token=${encodeURIComponent(token)}`));
  await client.connect(transport);
  try {
    const listed = await client.callTool({ name: 'list_projects', arguments: { refresh: false } });
    assert.notEqual(listed.isError, true);
    const canonicalRoot = await fs.realpath(root);
    const project = listed.structuredContent.projects.find((item) => item.root === canonicalRoot || item.is_default === true);
    assert.ok(project);
    const selectedProject = await client.callTool({
      name: 'select_project',
      arguments: { route_id: listed.structuredContent.route_id, project_id: project.project_id, include_tree: false }
    });
    assert.notEqual(selectedProject.isError, true);
    const shown = await client.callTool({
      name: 'show_changes',
      arguments: {
        route_id: listed.structuredContent.route_id,
        workspace_id: selectedProject.structuredContent.workspace_id,
        path: 'sample.txt',
        since: 'workspace'
      }
    });
    assert.notEqual(shown.isError, true);
    assert.equal(shown.structuredContent.review_comments[0].body, 'Confirm this behavior at the boundary.');
    assert.match(shown.content[0].text, /Native review notes/);
  } finally {
    await client.close();
  }

  await command({ action: 'stage_hunk', path: 'sample.txt', staged: false, hunkId: firstHunk.id });
  unstaged = await getChange('sample.txt', false);
  assert.equal(unstaged.selected.hunks.length, 1);
  assert.equal(unstaged.selected.comments[0].outdated, true);
  let staged = await getChange('sample.txt', true);
  assert.equal(staged.selected.hunks.length, 1);
  await command({ action: 'unstage_hunk', path: 'sample.txt', staged: true, hunkId: staged.selected.hunks[0].id });

  unstaged = await getChange('sample.txt', false);
  assert.equal(unstaged.selected.hunks.length, 2);
  await command({ action: 'stage_hunk', path: 'sample.txt', staged: false, hunkId: unstaged.selected.hunks[0].id });
  unstaged = await getChange('sample.txt', false);
  assert.equal(unstaged.selected.hunks.length, 1);
  await command({ action: 'discard_hunk', path: 'sample.txt', staged: false, hunkId: unstaged.selected.hunks[0].id });

  staged = await getChange('sample.txt', true);
  const stagedHunk = staged.selected.hunks[0];
  const stagedComment = await command({
    action: 'comment', path: 'sample.txt', staged: true, hunkId: stagedHunk.id,
    line: stagedHunk.startLine + 1, body: 'Ready to commit after verification.'
  });
  const stagedCommentId = stagedComment.selected.comments.find((item) => !item.outdated).id;
  await command({ action: 'delete_comment', commentId: stagedCommentId, path: 'sample.txt', staged: true });
  await command({ action: 'delete_comment', commentId, path: 'sample.txt', staged: false });

  const cachedDiff = spawnSync('git', ['diff', '--cached'], { cwd: root, encoding: 'utf8' });
  const workingDiff = spawnSync('git', ['diff'], { cwd: root, encoding: 'utf8' });
  assert.match(cachedDiff.stdout, /line 2 changed/);
  assert.doesNotMatch(cachedDiff.stdout, /line 22 changed/);
  assert.equal(workingDiff.stdout, '');
  assert.equal((await fs.readFile(path.join(root, 'sample.txt'), 'utf8')).includes('line 22 changed'), false);

  const untracked = await getChange('untracked.txt', false);
  assert.equal(untracked.selected.hunks.length, 1);
  assert.equal(untracked.selected.hunks[0].actionable, false);
  const rejected = await command({
    action: 'stage_hunk', path: 'untracked.txt', staged: false, hunkId: untracked.selected.hunks[0].id
  }, 400);
  assert.match(rejected.error.message, /unavailable for untracked files/);
  await command({ action: 'stage_hunk', path: 'sample.txt', staged: false, hunkId: secondHunk.id }, 400);

  console.log('✓ native review API stages, unstages, reverts, comments, and rejects stale or untracked hunks');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await fs.rm(fixture, { recursive: true, force: true });
  if (child.exitCode && child.exitCode !== 0 && !stderr.includes('SIGTERM')) process.stderr.write(stderr);
}
