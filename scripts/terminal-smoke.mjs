import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../dist/config.js';
import { PathGuard, WorkspaceManager } from '../dist/guard.js';
import { persistentTerminals } from '../dist/terminalOps.js';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-terminal-smoke-')));
await fs.mkdir(path.join(root, 'nested'));
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codexflow-terminal-home-'));
process.env.CODEXFLOW_HOME = home;
process.env.CODEXFLOW_WORKTREE_ROOT = path.join(home, 'worktrees');

const config = loadConfig(['--root', root, '--bash', 'full', '--write', 'workspace', '--tool-mode', 'full']);
const workspace = new WorkspaceManager(config).defaultWorkspace();
const guard = new PathGuard(config);
const route = 'route_terminal_smoke_one';
const secondRoute = 'route_terminal_smoke_two';

const changedDirectory = await persistentTerminals.run(config, guard, route, workspace, 'cd nested');
if (!changedDirectory.completed || changedDirectory.exitCode !== 0) throw new Error('persistent terminal could not change directory');
const pwd = await persistentTerminals.run(config, guard, route, workspace, 'pwd');
if (pwd.output.trim() !== path.join(root, 'nested')) throw new Error(`terminal cwd did not persist: ${JSON.stringify(pwd.output)}`);

await persistentTerminals.run(config, guard, route, workspace, 'export CODEXFLOW_SMOKE_VALUE=persisted');
const environment = await persistentTerminals.run(config, guard, route, workspace, `printf '%s\\n' "$CODEXFLOW_SMOKE_VALUE"`);
if (environment.output.trim() !== 'persisted') throw new Error(`terminal environment did not persist: ${JSON.stringify(environment.output)}`);

const isolated = await persistentTerminals.run(config, guard, secondRoute, workspace, `printf '%s\\n' "$CODEXFLOW_SMOKE_VALUE"`);
if (isolated.output.trim() !== '') throw new Error('terminal environment leaked across private routes');

const started = await persistentTerminals.run(
  config,
  guard,
  route,
  workspace,
  `node -e "process.stdin.once('data', value => { console.log('input:' + value.toString().trim()); process.exit(0); })"`,
  { wait: false, timeoutMs: 5000 }
);
if (started.completed) throw new Error('start-style terminal command completed synchronously');
await new Promise((resolve) => setTimeout(resolve, 150));
persistentTerminals.write(config, route, workspace, 'hello terminal\n');
await new Promise((resolve) => setTimeout(resolve, 250));
let transcript = persistentTerminals.read(config, route, workspace, started.cursor);
for (let attempt = 0; transcript.running && attempt < 20; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  transcript = persistentTerminals.read(config, route, workspace, started.cursor);
}
if (!transcript.output.includes('input:hello terminal') || transcript.running) {
  throw new Error(`interactive terminal did not receive input or finish: ${JSON.stringify(transcript)}`);
}
if (transcript.output.includes('__CODEXFLOW_')) throw new Error('terminal protocol markers leaked into the user transcript');

const cursor = transcript.cursor;
const noRepeat = persistentTerminals.read(config, route, workspace, cursor);
if (noRepeat.output) throw new Error('terminal cursor repeated already-read transcript output');

if (!persistentTerminals.stop(route)) throw new Error('terminal stop did not close the primary route');
if (!persistentTerminals.stop(secondRoute)) throw new Error('terminal stop did not close the second route');

console.log('persistent terminal smoke passed');
