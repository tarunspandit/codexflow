import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (value) => fs.readFileSync(path.join(root, value), 'utf8');

for (const file of [
  'desktop/windows/CodexFlow.Windows/CodexFlow.Windows.csproj',
  'desktop/windows/CodexFlow.Windows/MainWindow.xaml',
  'desktop/windows/CodexFlow.Windows/MainWindow.xaml.cs',
  'desktop/windows/CodexFlow.Windows/BrowserCoordinator.cs',
  'desktop/windows/CodexFlowComputer/CodexFlowComputer.csproj',
  'desktop/windows/CodexFlowComputer/Program.cs',
  'desktop/windows/build.ps1',
  'desktop/windows/README.md'
]) assert.ok(fs.statSync(path.join(root, file)).isFile(), `${file} is missing`);

const project = read('desktop/windows/CodexFlow.Windows/CodexFlow.Windows.csproj');
assert.match(project, /<UseWPF>true<\/UseWPF>/);
assert.match(project, /Microsoft\.Web\.WebView2/);
assert.match(project, /<SelfContained>true<\/SelfContained>/);

const window = read('desktop/windows/CodexFlow.Windows/MainWindow.xaml.cs');
for (const surface of ['RenderProjects', 'RenderEnvironments', 'RenderWorktrees', 'RenderChanges', 'RenderTasks', 'RenderHosts', 'RenderComputer', 'RenderBrowser', 'RenderConnection', 'RenderPolicy']) {
  assert.match(window, new RegExp(`private void ${surface}\\(`), `${surface} is not implemented`);
}
for (const route of ['/api/overview', '/admin/profile', '/admin/remotes', '/admin/computer', '/admin/browser', '/admin/changes', '/admin/environments', '/admin/worktrees', '/admin/chats']) {
  assert.ok(window.includes(route), `${route} is not wired into the Windows client`);
}

const browser = read('desktop/windows/CodexFlow.Windows/BrowserCoordinator.cs');
for (const boundary of ['ClearBrowsingDataAsync', 'PermissionRequested', 'DownloadStarting', 'allowed_origins', 'CapturePreviewAsync', 'DiagnosticsScript']) {
  assert.ok(browser.includes(boundary), `Windows browser boundary ${boundary} is missing`);
}

const helper = read('desktop/windows/CodexFlowComputer/Program.cs');
for (const behavior of ['list_apps', 'snapshot', 'perform', 'expectedIdentity', 'AutomationElement', 'ProhibitedReason']) {
  assert.ok(helper.includes(behavior), `Windows Computer helper behavior ${behavior} is missing`);
}

const launcher = read('scripts/codexflow.mjs');
assert.match(launcher, /CodexFlow-Windows-\$\{architecture\}\.zip/);
assert.match(launcher, /integrity check/);
assert.match(launcher, /LOCALAPPDATA/);

const workflow = read('.github/workflows/ci.yml');
assert.match(workflow, /windows-desktop:/);
assert.match(workflow, /architecture: \[x64, arm64\]/);
assert.match(workflow, /CodexFlowComputer\.exe/);

console.log('✓ Windows native management, WebView2, Computer Use, packaging, and CI contracts pass');
