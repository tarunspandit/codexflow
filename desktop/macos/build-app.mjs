#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const buildRoot = path.join(root, 'desktop', '.build');
const outputRoot = path.join(root, 'desktop', 'prebuilt');
const appRoot = path.join(outputRoot, 'CodexFlow.app');
const contents = path.join(appRoot, 'Contents');
const macos = path.join(contents, 'MacOS');
const resources = path.join(contents, 'Resources');
const helpers = path.join(contents, 'Helpers');
const sourcesRoot = path.join(here, 'Sources', 'CodexFlowApp');
const computerSourcesRoot = path.join(here, 'Sources', 'CodexFlowComputer');
const fontRoot = path.join(here, 'Resources', 'Fonts');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function output(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}: ${result.stderr || ''}`);
  return result.stdout.trim();
}

function plistString(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function buildFonts() {
  const required = ['Regular', 'Medium', 'SemiBold', 'Bold'].map((name) => path.join(fontRoot, `Geologica-${name}.ttf`));
  if (required.every((file) => fs.existsSync(file))) return;
  run('python3', [path.join(here, 'prepare-fonts.py')]);
}

function buildIcon() {
  const iconset = path.join(buildRoot, 'CodexFlow.iconset');
  const source = path.join(here, 'Resources', 'AppIcon.svg');
  const base = path.join(buildRoot, 'AppIcon-1024.png');
  fs.mkdirSync(iconset, { recursive: true });
  const magick = spawnSync('sh', ['-c', 'command -v magick || command -v convert'], { encoding: 'utf8' }).stdout.trim();
  if (magick) {
    run(magick, ['-background', 'none', source, '-resize', '1024x1024', base]);
  } else {
    run('sips', ['-s', 'format', 'png', path.join(root, 'docs', 'assets', 'brand', 'favicon-180.png'), '--out', base]);
  }
  const sizes = [16, 32, 128, 256, 512];
  for (const size of sizes) {
    run('sips', ['-z', String(size), String(size), base, '--out', path.join(iconset, `icon_${size}x${size}.png`)]);
    run('sips', ['-z', String(size * 2), String(size * 2), base, '--out', path.join(iconset, `icon_${size}x${size}@2x.png`)]);
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', path.join(resources, 'CodexFlow.icns')]);
}

fs.rmSync(buildRoot, { recursive: true, force: true });
fs.rmSync(appRoot, { recursive: true, force: true });
fs.mkdirSync(buildRoot, { recursive: true });
fs.mkdirSync(macos, { recursive: true });
fs.mkdirSync(resources, { recursive: true });
fs.mkdirSync(helpers, { recursive: true });

buildFonts();

const sdk = output('xcrun', ['--sdk', 'macosx', '--show-sdk-path']);
const sourceFiles = fs.readdirSync(sourcesRoot).filter((name) => name.endsWith('.swift')).sort().map((name) => path.join(sourcesRoot, name));
const binaries = [];
for (const arch of ['arm64', 'x86_64']) {
  const binary = path.join(buildRoot, `CodexFlow-${arch}`);
  run('xcrun', [
    'swiftc',
    '-swift-version', '5',
    '-parse-as-library',
    '-O',
    '-whole-module-optimization',
    '-target', `${arch}-apple-macosx14.0`,
    '-sdk', sdk,
    '-framework', 'SwiftUI',
    '-framework', 'AppKit',
    '-framework', 'Foundation',
    '-framework', 'WebKit',
    '-o', binary,
    ...sourceFiles
  ]);
  binaries.push(binary);
}
run('lipo', ['-create', ...binaries, '-output', path.join(macos, 'CodexFlow')]);
fs.chmodSync(path.join(macos, 'CodexFlow'), 0o755);

const computerSourceFiles = fs.readdirSync(computerSourcesRoot).filter((name) => name.endsWith('.swift')).sort().map((name) => path.join(computerSourcesRoot, name));
const computerBinaries = [];
for (const arch of ['arm64', 'x86_64']) {
  const binary = path.join(buildRoot, `CodexFlowComputer-${arch}`);
  run('xcrun', [
    'swiftc',
    '-swift-version', '5',
    '-parse-as-library',
    '-O',
    '-whole-module-optimization',
    '-target', `${arch}-apple-macosx14.0`,
    '-sdk', sdk,
    '-framework', 'AppKit',
    '-framework', 'ApplicationServices',
    '-framework', 'CoreGraphics',
    '-framework', 'Foundation',
    '-framework', 'ScreenCaptureKit',
    '-framework', 'Security',
    '-o', binary,
    ...computerSourceFiles
  ]);
  computerBinaries.push(binary);
}
run('lipo', ['-create', ...computerBinaries, '-output', path.join(helpers, 'CodexFlowComputer')]);
fs.chmodSync(path.join(helpers, 'CodexFlowComputer'), 0o755);

for (const name of ['Regular', 'Medium', 'SemiBold', 'Bold']) {
  copy(path.join(fontRoot, `Geologica-${name}.ttf`), path.join(resources, `Geologica-${name}.ttf`));
}
copy(path.join(root, 'docs', 'assets', 'fonts', 'Geologica-OFL.txt'), path.join(resources, 'Geologica-OFL.txt'));
copy(path.join(root, 'LICENSE'), path.join(resources, 'CodexFlow-LICENSE.txt'));
copy(path.join(root, 'NOTICE'), path.join(resources, 'CodexFlow-NOTICE.txt'));

const markSource = path.join(root, 'docs', 'assets', 'brand', 'flow7-tech-dark.webp');
run('sips', ['-s', 'format', 'png', markSource, '--out', path.join(resources, 'Flow7Tech.png')]);
buildIcon();

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>CodexFlow</string>
  <key>CFBundleExecutable</key><string>CodexFlow</string>
  <key>CFBundleIconFile</key><string>CodexFlow</string>
  <key>CFBundleIdentifier</key><string>com.flow7.codexflow</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>CodexFlow</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${plistString(packageJson.version)}</string>
  <key>CFBundleVersion</key><string>${plistString(packageJson.version.replace(/\D/g, '') || '1')}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSLocalNetworkUsageDescription</key><string>CodexFlow connects to its authenticated broker running on this Mac.</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>ATSApplicationFontsPath</key><string>.</string>
  <key>UIAppFonts</key>
  <array>
    <string>Geologica-Regular.ttf</string>
    <string>Geologica-Medium.ttf</string>
    <string>Geologica-SemiBold.ttf</string>
    <string>Geologica-Bold.ttf</string>
  </array>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>CodexFlow Workspace</string>
      <key>CFBundleURLSchemes</key><array><string>codexflow</string></array>
    </dict>
  </array>
  <key>NSHumanReadableCopyright</key><string>CodexFlow contributors. MIT licensed.</string>
</dict>
</plist>
`;
fs.writeFileSync(path.join(contents, 'Info.plist'), plist);
fs.writeFileSync(path.join(contents, 'PkgInfo'), 'APPL????');
fs.writeFileSync(path.join(resources, 'Build.txt'), `CodexFlow ${packageJson.version}\n`);

run('plutil', ['-lint', path.join(contents, 'Info.plist')]);
run('codesign', ['--force', '--deep', '--sign', '-', '--identifier', 'com.flow7.codexflow', appRoot]);
run('codesign', ['--verify', '--deep', '--strict', appRoot]);
console.log(`Built ${appRoot}`);
console.log(output('lipo', ['-archs', path.join(macos, 'CodexFlow')]));
