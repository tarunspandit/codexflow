import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { CodexFlowConfig } from "./config.js";
import { CodexFlowError } from "./guard.js";
import { codexFlowHome } from "./profileStore.js";
import {
  getApprovedRemoteProject,
  removeRemoteProject,
  saveRemoteProject,
  type SavedRemoteProject
} from "./remoteConnections.js";
import { runRemoteWorkspaceOperation } from "./remoteWorkspace.js";

export interface RemoteManagedWorktree {
  id: string;
  sourceProjectId: string;
  worktreeProjectId: string;
  hostAlias: string;
  hostFingerprint: string;
  repositoryRoot: string;
  checkoutRoot: string;
  projectRoot: string;
  projectRelativePath: string;
  baseRef: string;
  sourceState: string;
  worktreeState: string;
  createdAt: string;
  updatedAt: string;
  available?: boolean;
  statusError?: string;
  dirty?: boolean;
  branch?: string;
  head?: string;
}

interface Store { version: 1; worktrees: RemoteManagedWorktree[] }
const ID = /^rwt_[a-f0-9]{16}$/;
const HASH = /^[a-f0-9]{64}$/;

function storePath(): string { return path.join(codexFlowHome(), "remote-worktrees.json"); }
function valid(item: Partial<RemoteManagedWorktree>): item is RemoteManagedWorktree {
  return Boolean(item.id && ID.test(item.id) && item.sourceProjectId && item.worktreeProjectId &&
    item.hostAlias && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(item.hostAlias) &&
    item.hostFingerprint && HASH.test(item.hostFingerprint) && item.repositoryRoot && path.posix.isAbsolute(item.repositoryRoot) &&
    item.checkoutRoot && path.posix.isAbsolute(item.checkoutRoot) && item.projectRoot && path.posix.isAbsolute(item.projectRoot) &&
    item.projectRelativePath && item.projectRelativePath !== ".." && !item.projectRelativePath.startsWith("../") &&
    !path.posix.isAbsolute(item.projectRelativePath) && item.baseRef && item.sourceState && HASH.test(item.sourceState) &&
    item.worktreeState && HASH.test(item.worktreeState) && item.createdAt && item.updatedAt);
}
function readStore(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8")) as Partial<Store>;
    return { version: 1, worktrees: Array.isArray(parsed.worktrees) ? parsed.worktrees.filter(valid).slice(-500) : [] };
  } catch { return { version: 1, worktrees: [] }; }
}
function writeStore(store: Store): void {
  const target = storePath();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, worktrees: store.worktrees.slice(-500) }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  try { fs.chmodSync(target, 0o600); } catch { /* best effort */ }
}

function family(projectId: string, item: RemoteManagedWorktree): boolean {
  return item.sourceProjectId === projectId || item.worktreeProjectId === projectId;
}

export async function listRemoteManagedWorktrees(config: CodexFlowConfig, project: SavedRemoteProject): Promise<RemoteManagedWorktree[]> {
  const items = readStore().worktrees.filter((item) => family(project.id, item) && item.hostAlias === project.hostAlias && item.hostFingerprint === project.hostFingerprint);
  return Promise.all(items.map(async (item) => {
    try {
      const worktree = getApprovedRemoteProject(item.worktreeProjectId);
      const status = await runRemoteWorkspaceOperation<{ state: string; dirty: boolean; branch?: string; head: string }>(worktree.hostAlias, config, { action: "worktree_status", root: worktree.root });
      return { ...item, available: true, dirty: status.dirty, branch: status.branch, head: status.head };
    } catch (error) {
      return { ...item, available: false, statusError: error instanceof Error ? error.message : String(error) };
    }
  }));
}

export async function createRemoteManagedWorktree(
  config: CodexFlowConfig,
  project: SavedRemoteProject,
  options: { baseRef?: string; includeChanges?: boolean }
): Promise<{ worktree: RemoteManagedWorktree; project: SavedRemoteProject; patchApplied: boolean; untrackedCopied: number }> {
  if (readStore().worktrees.some((item) => item.worktreeProjectId === project.id)) throw new CodexFlowError("Create a remote managed worktree from its source project, not another managed worktree.");
  const id = `rwt_${randomBytes(8).toString("hex")}`;
  const result = await runRemoteWorkspaceOperation<{
    repositoryRoot: string; checkoutRoot: string; projectRoot: string; projectRelativePath: string; baseRef: string;
    sourceState: string; worktreeState: string; patchApplied: boolean; untrackedCopied: number;
  }>(project.hostAlias, config, {
    action: "worktree_create", root: project.root, worktreeId: id, baseRef: options.baseRef?.trim() || "HEAD",
    includeChanges: options.includeChanges !== false, maxCopyBytes: Math.max(config.maxWriteBytes * 8, 8_000_000)
  }, 180_000);
  let worktreeProject: SavedRemoteProject | undefined;
  try {
    const saved = saveRemoteProject(project.hostAlias, result.projectRoot);
    worktreeProject = getApprovedRemoteProject(saved.savedProjectId);
    const now = new Date().toISOString();
    const worktree: RemoteManagedWorktree = {
      id, sourceProjectId: project.id, worktreeProjectId: worktreeProject.id, hostAlias: project.hostAlias,
      hostFingerprint: project.hostFingerprint, repositoryRoot: result.repositoryRoot, checkoutRoot: result.checkoutRoot,
      projectRoot: result.projectRoot, projectRelativePath: result.projectRelativePath, baseRef: result.baseRef,
      sourceState: result.sourceState, worktreeState: result.worktreeState, createdAt: now, updatedAt: now
    };
    const store = readStore();
    store.worktrees.push(worktree);
    writeStore(store);
    return { worktree, project: worktreeProject, patchApplied: result.patchApplied, untrackedCopied: result.untrackedCopied };
  } catch (error) {
    if (worktreeProject) {
      try { removeRemoteProject(worktreeProject.id); } catch { /* preserve the original registration error */ }
    }
    try {
      await runRemoteWorkspaceOperation(project.hostAlias, config, {
        action: "worktree_remove", sourceRoot: project.root, checkoutRoot: result.checkoutRoot,
        projectRoot: result.projectRoot, worktreeId: id,
        maxSnapshotBytes: Math.max(config.maxWriteBytes * 8, 8_000_000)
      }, 180_000);
    } catch { /* preserve the original registration error */ }
    throw error;
  }
}

export async function handoffRemoteManagedWorktree(
  config: CodexFlowConfig,
  current: SavedRemoteProject,
  options: { worktreeId: string; destination: "worktree" | "local"; transferChanges?: boolean }
): Promise<{ worktree: RemoteManagedWorktree; project: SavedRemoteProject; patchApplied: boolean; untrackedCopied: number }> {
  const store = readStore();
  const index = store.worktrees.findIndex((item) => item.id === options.worktreeId && family(current.id, item));
  if (index < 0) throw new CodexFlowError("Remote managed worktree not found for this project.");
  const item = store.worktrees[index]!;
  const sourceProject = getApprovedRemoteProject(item.sourceProjectId);
  const worktreeProject = getApprovedRemoteProject(item.worktreeProjectId);
  const destination = options.destination === "worktree" ? worktreeProject : sourceProject;
  let transfer = { patchApplied: false, untrackedCopied: 0, state: options.destination === "worktree" ? item.worktreeState : item.sourceState };
  if (options.transferChanges !== false) {
    const from = options.destination === "worktree" ? sourceProject : worktreeProject;
    transfer = await runRemoteWorkspaceOperation<{ patchApplied: boolean; untrackedCopied: number; state: string }>(from.hostAlias, config, {
      action: "worktree_transfer", sourceRoot: from.root, destinationRoot: destination.root,
      expectedDestinationState: options.destination === "worktree" ? item.worktreeState : item.sourceState,
      maxCopyBytes: Math.max(config.maxWriteBytes * 8, 8_000_000)
    }, 180_000);
    item.sourceState = transfer.state; item.worktreeState = transfer.state;
  }
  item.updatedAt = new Date().toISOString(); store.worktrees[index] = item; writeStore(store);
  return { worktree: item, project: destination, patchApplied: transfer.patchApplied, untrackedCopied: transfer.untrackedCopied };
}

export async function removeRemoteManagedWorktree(
  config: CodexFlowConfig,
  current: SavedRemoteProject,
  worktreeId: string
): Promise<{ worktreeId: string; project: SavedRemoteProject; snapshotPath?: string }> {
  const store = readStore();
  const index = store.worktrees.findIndex((item) => item.id === worktreeId && family(current.id, item));
  if (index < 0) throw new CodexFlowError("Remote managed worktree not found for this project.");
  const item = store.worktrees[index]!;
  const source = getApprovedRemoteProject(item.sourceProjectId);
  const result = await runRemoteWorkspaceOperation<{ snapshotPath?: string }>(source.hostAlias, config, {
    action: "worktree_remove", sourceRoot: source.root, checkoutRoot: item.checkoutRoot, projectRoot: item.projectRoot,
    worktreeId: item.id, maxSnapshotBytes: Math.max(config.maxWriteBytes * 8, 8_000_000)
  }, 180_000);
  try { removeRemoteProject(item.worktreeProjectId); } catch { /* worktree is already gone */ }
  store.worktrees.splice(index, 1); writeStore(store);
  return { worktreeId, project: source, ...(result.snapshotPath ? { snapshotPath: result.snapshotPath } : {}) };
}
