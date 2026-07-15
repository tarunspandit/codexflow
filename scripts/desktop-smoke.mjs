import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve('.');
const app = path.join(root, 'desktop', 'prebuilt', 'CodexFlow.app');
const contents = path.join(app, 'Contents');
const executable = path.join(contents, 'MacOS', 'CodexFlow');
const resources = path.join(contents, 'Resources');
const plist = path.join(contents, 'Info.plist');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}`);
  return result.stdout.trim();
}

function fingerprintDirectory(directory) {
  const hash = createHash('sha256');
  function visit(current, relative = '') {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const child = relative ? path.join(relative, entry.name) : entry.name;
      hash.update(child);
      hash.update('\0');
      if (entry.isDirectory()) visit(absolute, child);
      else if (entry.isSymbolicLink()) hash.update(`link:${fs.readlinkSync(absolute)}`);
      else if (entry.isFile()) hash.update(fs.readFileSync(absolute));
      hash.update('\0');
    }
  }
  visit(directory);
  return hash.digest('hex');
}

assert.ok(fs.statSync(app).isDirectory(), 'native app bundle is missing');
assert.ok(fs.statSync(executable).isFile(), 'native app executable is missing');
assert.ok((fs.statSync(executable).mode & 0o111) !== 0, 'native app executable is not executable');

for (const file of [
  'CodexFlow.icns',
  'Flow7Tech.png',
  'Geologica-Regular.ttf',
  'Geologica-Medium.ttf',
  'Geologica-SemiBold.ttf',
  'Geologica-Bold.ttf',
  'Geologica-OFL.txt',
  'CodexFlow-LICENSE.txt',
  'CodexFlow-NOTICE.txt',
  'Build.txt'
]) {
  assert.ok(fs.existsSync(path.join(resources, file)), `missing native resource: ${file}`);
}

const buildText = fs.readFileSync(path.join(resources, 'Build.txt'), 'utf8');
assert.match(buildText, /^CodexFlow \d+\.\d+\.\d+\n$/);
assert.doesNotMatch(buildText, /Built|Users|tarun|hostname/i, 'build metadata must not expose the build machine');

if (process.platform === 'darwin') {
  run('/usr/bin/plutil', ['-lint', plist]);
  const plistJson = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist]));
  assert.equal(plistJson.CFBundleIdentifier, 'com.flow7.codexflow');
  assert.equal(plistJson.LSMinimumSystemVersion, '14.0');
  assert.equal(plistJson.NSAppTransportSecurity.NSAllowsLocalNetworking, true);
  assert.equal(plistJson.CFBundleURLTypes[0].CFBundleURLSchemes[0], 'codexflow');
  assert.deepEqual(plistJson.UIAppFonts, [
    'Geologica-Regular.ttf',
    'Geologica-Medium.ttf',
    'Geologica-SemiBold.ttf',
    'Geologica-Bold.ttf'
  ]);

  const archs = run('/usr/bin/lipo', ['-archs', executable]).split(/\s+/).sort();
  assert.deepEqual(archs, ['arm64', 'x86_64']);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const signature = run('/usr/bin/codesign', ['-dv', '--verbose=2', app], { stdio: ['ignore', 'pipe', 'pipe'] });
  assert.doesNotMatch(signature, /TeamIdentifier=[A-Z0-9]+/, 'release bundle is expected to be ad-hoc signed unless notarization is configured');

  const fixture = path.join(root, 'desktop', 'macos', 'Fixtures', 'overview.json');
  const child = spawn(executable, ['--fixture', fixture], { stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 1800));
  assert.equal(child.exitCode, null, 'native app exited during fixture launch');
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codexflow-desktop-install-'));
  try {
    const applications = path.join(temporary, 'Applications');
    const home = path.join(temporary, 'home');
    const environment = {
      ...process.env,
      CODEXFLOW_HOME: home,
      CODEXFLOW_DESKTOP_INSTALL_DIR: applications,
      CODEXFLOW_DESKTOP_LAUNCHER: '/usr/bin/true'
    };
    const launcher = path.join(root, 'scripts', 'codexflow.mjs');
    run(process.execPath, [launcher, 'app', '--root', root], { env: environment });
    const installedApp = path.join(applications, 'CodexFlow.app');
    assert.equal(fingerprintDirectory(installedApp), fingerprintDirectory(app), 'installed app must match the bundled app');

    fs.appendFileSync(path.join(installedApp, 'Contents', 'Resources', 'Build.txt'), 'stale\n');
    run(process.execPath, [launcher, 'app', '--root', root], { env: environment });
    assert.equal(fingerprintDirectory(installedApp), fingerprintDirectory(app), 'same-version stale app must be refreshed');
    assert.equal(fs.statSync(path.join(home, 'desktop.json')).mode & 0o777, 0o600, 'desktop launch metadata must be private');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

const appBytes = Number(run('/usr/bin/du', ['-sk', app]).split(/\s+/)[0]) * 1024;
assert.ok(appBytes < 50 * 1024 * 1024, `native app bundle is unexpectedly large: ${appBytes} bytes`);

console.log('✓ native CodexFlow app bundle, resources, signature, architecture, and launch smoke passed');
