import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";
import type { CodexFlowConfig } from "./config.js";
import { CodexFlowError, isSubpath, type Workspace } from "./guard.js";
import { profileIdForRoot } from "./profileStore.js";
import { redactSensitiveText } from "./redact.js";
import {
  resolveLocalEnvironment,
  runLocalEnvironmentCommand,
  type LocalEnvironment,
  type LocalEnvironmentCommandResult
} from "./localEnvironmentOps.js";

export interface ManagedWorktree {
  id: string;
  localRoot: string;
  repositoryRoot: string;
  checkoutRoot: string;
  projectRoot: string;
  projectRelativePath: string;
  baseRef: string;
  createdAt: string;
  updatedAt: string;
  exists: boolean;
  branch?: string;
  dirty: boolean;
  environmentConfigPath?: string;
  environmentName?: string;
  setupCompletedAt?: string;
}

interface WorktreeManifest extends Omit<ManagedWorktree, "exists" | "branch" | "dirty"> {
  version: 1;
  localState?: string;
  worktreeState?: string;
}

interface RepoContext {
  repositoryRoot: string;
  projectRelativePath: string;
}

export interface ManagedWorktreePaths {
  sourceWorkspacePath: string;
  worktreePath: string;
  worktreeId?: string;
}

function run(
  config: CodexFlowConfig,
  cwd: string,
  args: string[],
  options: { input?: string; allowFailure?: boolean } = {}
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync("git", args, {
    cwd,
    input: options.input,
    encoding: "utf8",
    maxBuffer: Math.max(config.maxOutputBytes, config.maxWriteBytes * 4),
    env: { ...process.env, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" }
  });
  if (result.error) throw new CodexFlowError(`git failed: ${result.error.message}`);
  const output = {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status ?? 1
  };
  if (!options.allowFailure && output.status !== 0) {
    throw new CodexFlowError(redactSensitiveText(output.stderr || output.stdout || `git ${args[0]} exited with status ${output.status}`));
  }
  return output;
}

function repoContext(config: CodexFlowConfig, workspace: Workspace): RepoContext {
  const repositoryRoot = fs.realpathSync(run(config, workspace.root, ["rev-parse", "--show-toplevel"]).stdout.trim());
  const projectRelativePath = path.relative(repositoryRoot, workspace.root).split(path.sep).join("/") || ".";
  if (projectRelativePath.startsWith("../") || path.isAbsolute(projectRelativePath)) {
    throw new CodexFlowError("Workspace is outside its Git repository root.");
  }
  return { repositoryRoot, projectRelativePath };
}

function repositoryStorageRoot(config: CodexFlowConfig, repositoryRoot: string): string {
  return path.join(config.managedWorktreeRoot, profileIdForRoot(repositoryRoot));
}

function manifestDir(config: CodexFlowConfig, repositoryRoot: string): string {
  return path.join(repositoryStorageRoot(config, repositoryRoot), "manifests");
}

function checkoutDir(config: CodexFlowConfig, repositoryRoot: string, id: string): string {
  return path.join(repositoryStorageRoot(config, repositoryRoot), "checkouts", id);
}

function manifestPath(config: CodexFlowConfig, repositoryRoot: string, id: string): string {
  return path.join(manifestDir(config, repositoryRoot), `${id}.json`);
}

function safeId(value: string): boolean {
  return /^wt_[a-f0-9]{16}$/.test(value);
}

function writeManifest(config: CodexFlowConfig, manifest: WorktreeManifest): void {
  const dir = manifestDir(config, manifest.repositoryRoot);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = manifestPath(config, manifest.repositoryRoot, manifest.id);
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
}

function readManifest(file: string): WorktreeManifest | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<WorktreeManifest>;
    if (
      value.version !== 1 ||
      !value.id || !safeId(value.id) ||
      !value.localRoot || !path.isAbsolute(value.localRoot) ||
      !value.repositoryRoot || !path.isAbsolute(value.repositoryRoot) ||
      !value.checkoutRoot || !path.isAbsolute(value.checkoutRoot) ||
      !value.projectRoot || !path.isAbsolute(value.projectRoot) ||
      !value.projectRelativePath ||
      !value.baseRef || !value.createdAt || !value.updatedAt
    ) return undefined;
    return value as WorktreeManifest;
  } catch {
    return undefined;
  }
}

function statusFor(config: CodexFlowConfig, manifest: WorktreeManifest): ManagedWorktree {
  const exists = fs.existsSync(manifest.checkoutRoot) && fs.existsSync(manifest.projectRoot);
  if (!exists) return { ...manifest, exists: false, dirty: false };
  const branch = run(config, manifest.checkoutRoot, ["branch", "--show-current"], { allowFailure: true }).stdout.trim() || undefined;
  const dirty = Boolean(run(config, manifest.checkoutRoot, ["status", "--porcelain"], { allowFailure: true }).stdout.trim());
  return { ...manifest, exists: true, branch, dirty };
}

function listManifestFiles(config: CodexFlowConfig, repositoryRoot: string): string[] {
  const dir = manifestDir(config, repositoryRoot);
  try {
    return fs.readdirSync(dir).filter((name) => /^wt_[a-f0-9]{16}\.json$/.test(name)).map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function loadManifest(config: CodexFlowConfig, repositoryRoot: string, id: string): WorktreeManifest {
  if (!safeId(id)) throw new CodexFlowError("Invalid worktree_id.");
  const manifest = readManifest(manifestPath(config, repositoryRoot, id));
  if (!manifest) throw new CodexFlowError(`Managed worktree not found: ${id}`);
  if (!isSubpath(manifest.checkoutRoot, config.managedWorktreeRoot)) {
    throw new CodexFlowError("Managed worktree metadata points outside the configured worktree root.");
  }
  return manifest;
}

function findManifest(config: CodexFlowConfig, id: string): WorktreeManifest {
  if (!safeId(id)) throw new CodexFlowError("Invalid worktree_id.");
  let repositoryDirs: string[] = [];
  try {
    repositoryDirs = fs.readdirSync(config.managedWorktreeRoot)
      .filter((name) => /^[a-f0-9]{24}$/.test(name));
  } catch {
    // Fall through to the standard not-found error.
  }
  for (const repositoryDir of repositoryDirs) {
    const manifest = readManifest(path.join(config.managedWorktreeRoot, repositoryDir, "manifests", `${id}.json`));
    if (manifest) return manifest;
  }
  throw new CodexFlowError(`Managed worktree not found: ${id}`);
}

function manifestForWorkspace(config: CodexFlowConfig, workspaceRoot: string): WorktreeManifest | undefined {
  let repositoryDirs: string[] = [];
  try {
    repositoryDirs = fs.readdirSync(config.managedWorktreeRoot).filter((name) => /^[a-f0-9]{24}$/.test(name));
  } catch {
    return undefined;
  }
  for (const repositoryDir of repositoryDirs) {
    const dir = path.join(config.managedWorktreeRoot, repositoryDir, "manifests");
    let files: string[] = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const file of files) {
      const manifest = readManifest(path.join(dir, file));
      if (manifest?.projectRoot === workspaceRoot) return manifest;
    }
  }
  return undefined;
}

export function managedWorktreePaths(config: CodexFlowConfig, workspace: Workspace): ManagedWorktreePaths {
  const manifest = manifestForWorkspace(config, workspace.root);
  if (!manifest) {
    return { sourceWorkspacePath: workspace.root, worktreePath: workspace.root };
  }
  return {
    sourceWorkspacePath: manifest.localRoot,
    worktreePath: manifest.projectRoot,
    worktreeId: manifest.id
  };
}

function pathspec(relativeProject: string): string[] {
  return relativeProject === "." ? ["."] : [relativeProject];
}

function untrackedFiles(config: CodexFlowConfig, repository: string, relativeProject: string): string[] {
  const listed = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspec(relativeProject)], {
    cwd: repository,
    encoding: "buffer",
    maxBuffer: Math.max(config.maxOutputBytes, config.maxWriteBytes * 4),
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  });
  if (listed.error || listed.status !== 0) return [];
  return Buffer.from(listed.stdout ?? []).toString("utf8").split("\0").filter(Boolean).sort();
}

function workspaceState(config: CodexFlowConfig, repository: string, relativeProject: string): string {
  const hash = createHash("sha256");
  const patch = run(config, repository, ["diff", "--binary", "HEAD", "--", ...pathspec(relativeProject)]).stdout;
  hash.update(patch);
  hash.update("\0untracked\0");
  for (const name of untrackedFiles(config, repository, relativeProject)) {
    const file = path.resolve(repository, name);
    if (!isSubpath(file, repository)) throw new CodexFlowError(`Unsafe untracked path: ${name}`);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new CodexFlowError(`Managed worktree handoff does not copy symlinks or non-files: ${name}`);
    }
    hash.update(name);
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function cleanWorkspaceState(): string {
  return createHash("sha256").update("\0untracked\0").digest("hex");
}

function copyUntracked(
  config: CodexFlowConfig,
  sourceRepository: string,
  destinationRepository: string,
  relativeProject: string
): number {
  let copied = 0;
  for (const name of untrackedFiles(config, sourceRepository, relativeProject)) {
    const source = path.resolve(sourceRepository, name);
    const destination = path.resolve(destinationRepository, name);
    if (!isSubpath(source, sourceRepository) || !isSubpath(destination, destinationRepository)) continue;
    let stat: fs.Stats;
    try { stat = fs.lstatSync(source); } catch { continue; }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    if (fs.existsSync(destination)) {
      const sourceBuffer = fs.readFileSync(source);
      const destinationBuffer = fs.readFileSync(destination);
      if (!sourceBuffer.equals(destinationBuffer)) {
        throw new CodexFlowError(`Untracked file would overwrite a different destination file: ${name}`);
      }
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    copied += 1;
  }
  return copied;
}

function worktreeIncludePatterns(repositoryRoot: string): string[] {
  const includeFile = path.join(repositoryRoot, ".worktreeinclude");
  let raw = "";
  try {
    const stat = fs.lstatSync(includeFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) return ["**/AGENTS.override.md"];
    raw = fs.readFileSync(includeFile, "utf8");
  } catch {
    // AGENTS.override.md is copied even when .worktreeinclude is absent.
  }
  return [
    ...raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")),
    "**/AGENTS.override.md"
  ];
}

function includePatternMatches(name: string, pattern: string): boolean {
  const negated = pattern.startsWith("!");
  let normalized = negated ? pattern.slice(1) : pattern;
  normalized = normalized.replace(/^\//, "");
  if (normalized.endsWith("/")) normalized += "**";
  if (!normalized) return false;
  return minimatch(name, normalized, {
    dot: true,
    matchBase: !normalized.includes("/"),
    nocase: process.platform === "win32"
  });
}

function shouldCopyIncluded(name: string, patterns: string[]): boolean {
  let included = false;
  for (const pattern of patterns) {
    if (!includePatternMatches(name, pattern)) continue;
    included = !pattern.startsWith("!");
  }
  return included;
}

function gitPathspecForInclude(pattern: string): string | undefined {
  if (pattern.startsWith("!")) return undefined;
  let normalized = pattern.replace(/^\//, "");
  if (normalized.endsWith("/")) normalized += "**";
  if (!normalized) return undefined;
  if (!normalized.includes("/")) normalized = `**/${normalized}`;
  return `:(top,glob)${normalized}`;
}

function copyIncludedIgnoredFiles(
  config: CodexFlowConfig,
  sourceRepository: string,
  destinationRepository: string
): number {
  const patterns = worktreeIncludePatterns(sourceRepository);
  const pathspecs = patterns.map(gitPathspecForInclude).filter((value): value is string => Boolean(value));
  if (!pathspecs.length) return 0;
  const listed = spawnSync(
    "git",
    ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ...pathspecs],
    {
      cwd: sourceRepository,
      encoding: "buffer",
      maxBuffer: Math.max(config.maxOutputBytes, config.maxWriteBytes * 4),
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
    }
  );
  if (listed.error || listed.status !== 0) return 0;
  const names = Buffer.from(listed.stdout ?? []).toString("utf8").split("\0").filter(Boolean).sort();
  let copied = 0;
  for (const name of names) {
    if (!shouldCopyIncluded(name, patterns)) continue;
    const source = path.resolve(sourceRepository, name);
    const destination = path.resolve(destinationRepository, name);
    if (!isSubpath(source, sourceRepository) || !isSubpath(destination, destinationRepository)) continue;
    let stat: fs.Stats;
    try { stat = fs.lstatSync(source); } catch { continue; }
    if (!stat.isFile() || stat.isSymbolicLink() || fs.existsSync(destination)) continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, destination);
    copied += 1;
  }
  return copied;
}

function clearProjectChanges(config: CodexFlowConfig, repository: string, relativeProject: string): void {
  run(config, repository, ["restore", "--staged", "--worktree", "--", ...pathspec(relativeProject)]);
  for (const name of untrackedFiles(config, repository, relativeProject)) {
    const target = path.resolve(repository, name);
    if (!isSubpath(target, repository)) throw new CodexFlowError(`Unsafe untracked path: ${name}`);
    fs.rmSync(target, { force: true });
  }
}

function transferChanges(
  config: CodexFlowConfig,
  sourceRepository: string,
  destinationRepository: string,
  relativeProject: string,
  expectedDestinationState?: string
): { patchApplied: boolean; untrackedCopied: number; state: string } {
  const sourceHead = run(config, sourceRepository, ["rev-parse", "HEAD"]).stdout.trim();
  const destinationHead = run(config, destinationRepository, ["rev-parse", "HEAD"]).stdout.trim();
  if (!sourceHead || sourceHead !== destinationHead) {
    throw new CodexFlowError("The local project and managed worktree no longer share the same HEAD. Commit or reconcile the branch history, then hand off without transferring workspace changes.");
  }
  const sourceState = workspaceState(config, sourceRepository, relativeProject);
  const destinationState = workspaceState(config, destinationRepository, relativeProject);
  if (sourceState === destinationState) {
    return { patchApplied: false, untrackedCopied: 0, state: sourceState };
  }
  if (expectedDestinationState ? destinationState !== expectedDestinationState : destinationState !== cleanWorkspaceState()) {
    throw new CodexFlowError("The handoff destination changed independently. Switch without transferring changes or reconcile it before retrying.");
  }
  const patch = run(config, sourceRepository, ["diff", "--binary", "HEAD", "--", ...pathspec(relativeProject)]).stdout;
  clearProjectChanges(config, destinationRepository, relativeProject);
  if (patch) {
    const checked = run(config, destinationRepository, ["apply", "--check", "--whitespace=nowarn", "-"], { input: patch, allowFailure: true });
    if (checked.status !== 0) {
      throw new CodexFlowError(`Changes cannot be handed off cleanly: ${checked.stderr || checked.stdout}`);
    }
    run(config, destinationRepository, ["apply", "--whitespace=nowarn", "-"], { input: patch });
  }
  const untrackedCopied = copyUntracked(config, sourceRepository, destinationRepository, relativeProject);
  const transferredState = workspaceState(config, destinationRepository, relativeProject);
  if (transferredState !== sourceState) {
    throw new CodexFlowError("Worktree handoff verification failed; the destination does not match the source state.");
  }
  return { patchApplied: Boolean(patch), untrackedCopied, state: transferredState };
}

export function listManagedWorktrees(config: CodexFlowConfig, workspace: Workspace): ManagedWorktree[] {
  const currentManifest = manifestForWorkspace(config, workspace.root);
  const repositoryRoot = currentManifest?.repositoryRoot ?? repoContext(config, workspace).repositoryRoot;
  return listManifestFiles(config, repositoryRoot)
    .map(readManifest)
    .filter((value): value is WorktreeManifest => Boolean(value))
    .map((manifest) => statusFor(config, manifest))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createManagedWorktree(
  config: CodexFlowConfig,
  workspace: Workspace,
  options: { baseRef?: string; includeChanges?: boolean; environment?: LocalEnvironment; setupTimeoutMs?: number } = {}
): Promise<{
  worktree: ManagedWorktree;
  patchApplied: boolean;
  untrackedCopied: number;
  ignoredFilesCopied: number;
  setup?: LocalEnvironmentCommandResult;
}> {
  if (isSubpath(workspace.root, config.managedWorktreeRoot)) {
    throw new CodexFlowError("Create a new managed worktree from the local project, not from another managed worktree.");
  }
  const context = repoContext(config, workspace);
  const baseRef = options.baseRef?.trim() || "HEAD";
  const verified = run(config, context.repositoryRoot, ["rev-parse", "--verify", `${baseRef}^{commit}`], { allowFailure: true });
  if (verified.status !== 0) throw new CodexFlowError(`Base ref does not resolve to a commit: ${baseRef}`);
  const id = `wt_${randomBytes(8).toString("hex")}`;
  const checkoutRoot = checkoutDir(config, context.repositoryRoot, id);
  fs.mkdirSync(path.dirname(checkoutRoot), { recursive: true, mode: 0o700 });
  run(config, context.repositoryRoot, ["worktree", "add", "--detach", checkoutRoot, verified.stdout.trim()]);

  let transfer: { patchApplied: boolean; untrackedCopied: number; state?: string } = {
    patchApplied: false,
    untrackedCopied: 0
  };
  try {
    if (options.includeChanges !== false) {
      transfer = transferChanges(config, context.repositoryRoot, checkoutRoot, context.projectRelativePath);
    }
    const now = new Date().toISOString();
    const projectRoot = context.projectRelativePath === "." ? checkoutRoot : path.join(checkoutRoot, context.projectRelativePath);
    if (!fs.existsSync(projectRoot)) throw new CodexFlowError("The selected project path does not exist in the new worktree.");
    const ignoredFilesCopied = copyIncludedIgnoredFiles(config, context.repositoryRoot, checkoutRoot);
    let setup: LocalEnvironmentCommandResult | undefined;
    if (options.environment) {
      setup = await runLocalEnvironmentCommand(config, options.environment, {
        kind: "setup",
        cwd: projectRoot,
        sourceWorkspacePath: workspace.root,
        worktreePath: projectRoot,
        timeoutMs: options.setupTimeoutMs
      });
      if (setup.timedOut || setup.exitCode !== 0) {
        const detail = setup.stderr.trim() || setup.stdout.trim() || (setup.timedOut ? "Setup timed out." : `Setup exited with ${setup.exitCode}.`);
        throw new CodexFlowError(`Local environment setup failed: ${detail}`);
      }
    }
    const manifest: WorktreeManifest = {
      version: 1,
      id,
      localRoot: workspace.root,
      repositoryRoot: context.repositoryRoot,
      checkoutRoot,
      projectRoot,
      projectRelativePath: context.projectRelativePath,
      baseRef,
      createdAt: now,
      updatedAt: now,
      ...(options.environment ? {
        environmentConfigPath: options.environment.configPath,
        environmentName: options.environment.name,
        setupCompletedAt: new Date().toISOString()
      } : {}),
      localState: transfer.state ?? workspaceState(config, context.repositoryRoot, context.projectRelativePath),
      worktreeState: transfer.state ?? workspaceState(config, checkoutRoot, context.projectRelativePath)
    };
    writeManifest(config, manifest);
    return {
      worktree: statusFor(config, manifest),
      patchApplied: transfer.patchApplied,
      untrackedCopied: transfer.untrackedCopied,
      ignoredFilesCopied,
      ...(setup ? { setup } : {})
    };
  } catch (error) {
    run(config, context.repositoryRoot, ["worktree", "remove", "--force", checkoutRoot], { allowFailure: true });
    fs.rmSync(checkoutRoot, { recursive: true, force: true });
    throw error;
  }
}

export function handoffManagedWorktree(
  config: CodexFlowConfig,
  currentWorkspace: Workspace,
  options: { worktreeId: string; destination: "worktree" | "local"; transferChanges?: boolean }
): { worktree: ManagedWorktree; destinationRoot: string; patchApplied: boolean; untrackedCopied: number } {
  const manifest = findManifest(config, options.worktreeId);
  if (currentWorkspace.root !== manifest.localRoot && currentWorkspace.root !== manifest.projectRoot) {
    throw new CodexFlowError("This managed worktree belongs to a different local project.");
  }
  if (!fs.existsSync(manifest.checkoutRoot)) throw new CodexFlowError("Managed worktree checkout no longer exists.");
  const toWorktree = options.destination === "worktree";
  const sourceRepository = toWorktree ? manifest.repositoryRoot : manifest.checkoutRoot;
  const destinationRepository = toWorktree ? manifest.checkoutRoot : manifest.repositoryRoot;
  let transfer: { patchApplied: boolean; untrackedCopied: number; state?: string } = {
    patchApplied: false,
    untrackedCopied: 0
  };
  if (options.transferChanges !== false) {
    transfer = transferChanges(
      config,
      sourceRepository,
      destinationRepository,
      manifest.projectRelativePath,
      toWorktree ? manifest.worktreeState : manifest.localState
    );
    manifest.localState = transfer.state;
    manifest.worktreeState = transfer.state;
  }
  manifest.updatedAt = new Date().toISOString();
  writeManifest(config, manifest);
  return {
    worktree: statusFor(config, manifest),
    destinationRoot: toWorktree ? manifest.projectRoot : manifest.localRoot,
    patchApplied: transfer.patchApplied,
    untrackedCopied: transfer.untrackedCopied
  };
}

export async function removeManagedWorktree(
  config: CodexFlowConfig,
  workspace: Workspace,
  worktreeId: string
): Promise<{
  worktreeId: string;
  localRoot: string;
  snapshotPath?: string;
  cleanup?: LocalEnvironmentCommandResult;
  removed: boolean;
}> {
  const manifest = findManifest(config, worktreeId);
  if (workspace.root !== manifest.localRoot && workspace.root !== manifest.projectRoot) {
    throw new CodexFlowError("This managed worktree belongs to a different local project.");
  }
  let snapshotPath: string | undefined;
  let cleanup: LocalEnvironmentCommandResult | undefined;
  if (fs.existsSync(manifest.checkoutRoot)) {
    if (manifest.environmentConfigPath) {
      const localWorkspace: Workspace = {
        id: `local_${manifest.id}`,
        root: manifest.localRoot,
        openedAt: manifest.createdAt
      };
      const environment = resolveLocalEnvironment(config, localWorkspace, manifest.environmentConfigPath);
      cleanup = await runLocalEnvironmentCommand(config, environment, {
        kind: "cleanup",
        cwd: manifest.projectRoot,
        sourceWorkspacePath: manifest.localRoot,
        worktreePath: manifest.projectRoot
      });
    }
    const patch = run(config, manifest.checkoutRoot, ["diff", "--binary", "HEAD", "--", ...pathspec(manifest.projectRelativePath)], { allowFailure: true }).stdout;
    if (patch) {
      const snapshotDir = path.join(repositoryStorageRoot(config, manifest.repositoryRoot), "snapshots", manifest.id);
      fs.mkdirSync(snapshotDir, { recursive: true, mode: 0o700 });
      snapshotPath = path.join(snapshotDir, `${Date.now()}.patch`);
      fs.writeFileSync(snapshotPath, `${patch}\n`, { mode: 0o600 });
    }
    run(config, manifest.repositoryRoot, ["worktree", "remove", "--force", manifest.checkoutRoot]);
  }
  fs.rmSync(manifestPath(config, manifest.repositoryRoot, manifest.id), { force: true });
  return { worktreeId, localRoot: manifest.localRoot, snapshotPath, ...(cleanup ? { cleanup } : {}), removed: true };
}
