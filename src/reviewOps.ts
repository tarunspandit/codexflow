import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CodexFlowConfig } from "./config.js";
import { CodexFlowError, PathGuard, type Workspace } from "./guard.js";
import { codexFlowHome } from "./profileStore.js";
import { hasSecretValue, redactSensitiveText } from "./redact.js";

export interface ReviewHunk {
  id: string;
  header: string;
  startLine: number;
  endLine: number;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  additions: number;
  deletions: number;
  actionable: boolean;
}

export interface ReviewComment {
  id: string;
  path: string;
  staged: boolean;
  hunkId: string;
  line: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  outdated?: boolean;
}

interface StoredReviewComment extends ReviewComment { workspaceKey: string }
interface ReviewStore { version: 1; comments: StoredReviewComment[] }
interface ParsedHunk extends ReviewHunk { patch: string }

const COMMENT_ID = /^rc_[a-f0-9]{16}$/;
const HUNK_ID = /^hunk_[a-f0-9]{16}$/;

function storePath(): string { return path.join(codexFlowHome(), "review-comments.json"); }
function workspaceKey(workspace: Workspace): string {
  return createHash("sha256").update(fs.realpathSync(workspace.root)).digest("hex");
}
function validComment(value: Partial<StoredReviewComment>): value is StoredReviewComment {
  return Boolean(value.id && COMMENT_ID.test(value.id) && value.workspaceKey && /^[a-f0-9]{64}$/.test(value.workspaceKey) &&
    value.path && !path.isAbsolute(value.path) && value.path !== ".." && !value.path.startsWith(`..${path.sep}`) &&
    typeof value.staged === "boolean" && value.hunkId && HUNK_ID.test(value.hunkId) && Number.isInteger(value.line) &&
    Number(value.line) >= 0 && value.body && value.body.length <= 2000 && value.createdAt && value.updatedAt);
}
function readStore(): ReviewStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8")) as Partial<ReviewStore>;
    return { version: 1, comments: Array.isArray(parsed.comments) ? parsed.comments.filter(validComment).slice(-2000) : [] };
  } catch { return { version: 1, comments: [] }; }
}
function writeStore(store: ReviewStore): void {
  const target = storePath();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, comments: store.comments.slice(-2000) }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  try { fs.chmodSync(target, 0o600); } catch { /* best effort */ }
}

function runGit(config: CodexFlowConfig, workspace: Workspace, args: string[], input?: string, allowFailure = false): string {
  const result = spawnSync("git", args, {
    cwd: workspace.root,
    input,
    encoding: "utf8",
    maxBuffer: Math.max(config.maxOutputBytes, config.maxWriteBytes * 4),
    env: { ...process.env, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" }
  });
  if (result.error) throw new CodexFlowError(`git failed: ${result.error.message}`);
  if ((result.status ?? 1) !== 0 && !allowFailure) {
    throw new CodexFlowError(redactSensitiveText(result.stderr?.trim() || result.stdout?.trim() || `git exited with ${result.status}`));
  }
  return result.stdout ?? "";
}

function syntheticUntrackedDiff(filePath: string, content: string): string {
  const lines = content.replace(/\n$/, "").split("\n");
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`)
  ].join("\n");
}

export async function rawReviewDiff(
  config: CodexFlowConfig,
  guard: PathGuard,
  workspace: Workspace,
  requestedPath: string,
  staged: boolean
): Promise<{ path: string; diff: string; untracked: boolean; truncated: boolean }> {
  const resolved = guard.resolve(workspace, requestedPath);
  if (/[\0\r\n]/.test(resolved.relPath)) throw new CodexFlowError("Review paths cannot contain control characters.");
  const untracked = !staged && runGit(config, workspace, ["ls-files", "--others", "--exclude-standard", "--", resolved.relPath])
    .split("\n").includes(resolved.relPath);
  if (untracked) {
    await guard.assertTextFile(resolved.absPath, config.maxReadBytes);
    const raw = await fs.promises.readFile(resolved.absPath, "utf8");
    const maxBytes = Math.min(config.maxReadBytes, config.maxOutputBytes);
    let content = raw;
    let truncated = false;
    while (Buffer.byteLength(content, "utf8") > maxBytes && content.length > 0) {
      content = content.slice(0, Math.max(0, Math.floor(content.length * 0.8)));
      truncated = true;
    }
    return { path: resolved.relPath, diff: syntheticUntrackedDiff(resolved.relPath, content), untracked: true, truncated };
  }
  const args = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", ...(staged ? ["--cached"] : []), "--", resolved.relPath];
  return { path: resolved.relPath, diff: runGit(config, workspace, args).trim(), untracked: false, truncated: false };
}

function hunkRange(header: string): { oldStart: number; oldCount: number; newStart: number; newCount: number } {
  const match = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!match) throw new CodexFlowError("Git returned an invalid unified-diff hunk header.");
  return {
    oldStart: Number(match[1]), oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]), newCount: match[4] === undefined ? 1 : Number(match[4])
  };
}

function parsedHunks(diff: string, filePath: string, staged: boolean, actionable: boolean): ParsedHunk[] {
  if (!diff.trim()) return [];
  const lines = diff.split("\n");
  const starts = lines.flatMap((line, index) => line.startsWith("@@ ") ? [index] : []);
  if (!starts.length) return [];
  const fileHeader = lines.slice(0, starts[0]).join("\n");
  return starts.map((startLine, offset) => {
    const endLine = offset + 1 < starts.length ? starts[offset + 1]! - 1 : lines.length - 1;
    const hunkLines = lines.slice(startLine, endLine + 1);
    const patch = `${fileHeader}\n${hunkLines.join("\n")}\n`;
    const range = hunkRange(hunkLines[0]!);
    const additions = hunkLines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const deletions = hunkLines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    const id = `hunk_${createHash("sha256").update(`${staged ? "staged" : "unstaged"}\0${filePath}\0${patch}`).digest("hex").slice(0, 16)}`;
    return { id, header: hunkLines[0]!, startLine, endLine, ...range, additions, deletions, actionable, patch };
  });
}

export function reviewHunks(diff: string, filePath: string, staged: boolean, untracked = false): ReviewHunk[] {
  return parsedHunks(diff, filePath, staged, !untracked).map(({ patch: _patch, ...hunk }) => hunk);
}

export async function runReviewHunkAction(
  config: CodexFlowConfig,
  guard: PathGuard,
  workspace: Workspace,
  options: { action: "stage_hunk" | "unstage_hunk" | "discard_hunk"; path: string; staged: boolean; hunkId: string }
): Promise<void> {
  if (!HUNK_ID.test(options.hunkId)) throw new CodexFlowError("Invalid review hunk id.");
  if (options.action === "stage_hunk" && options.staged) throw new CodexFlowError("A staged hunk cannot be staged again.");
  if (options.action === "unstage_hunk" && !options.staged) throw new CodexFlowError("Choose a staged hunk to unstage.");
  if (options.action === "discard_hunk" && options.staged) throw new CodexFlowError("Unstage this hunk before reverting it from the working tree.");
  const current = await rawReviewDiff(config, guard, workspace, options.path, options.staged);
  if (current.untracked) throw new CodexFlowError("Per-hunk mutations are unavailable for untracked files. Stage or discard the file explicitly.");
  const hunk = parsedHunks(current.diff, current.path, options.staged, true).find((item) => item.id === options.hunkId);
  if (!hunk) throw new CodexFlowError("This hunk changed since it was loaded. Refresh Changes before retrying.");
  const flags = options.action === "stage_hunk"
    ? ["--cached"]
    : options.action === "unstage_hunk"
      ? ["--cached", "--reverse"]
      : ["--reverse"];
  runGit(config, workspace, ["apply", "--check", "--whitespace=nowarn", ...flags, "-"], hunk.patch);
  runGit(config, workspace, ["apply", "--whitespace=nowarn", ...flags, "-"], hunk.patch);
}

export function listReviewComments(workspace: Workspace, filePath: string, staged: boolean, hunks: ReviewHunk[]): ReviewComment[] {
  const key = workspaceKey(workspace);
  const current = new Set(hunks.map((hunk) => hunk.id));
  return readStore().comments
    .filter((comment) => comment.workspaceKey === key && comment.path === filePath && comment.staged === staged)
    .map(({ workspaceKey: _workspaceKey, ...comment }) => ({ ...comment, outdated: !current.has(comment.hunkId) }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function listWorkspaceReviewComments(workspace: Workspace, filePath?: string, staged?: boolean): ReviewComment[] {
  const key = workspaceKey(workspace);
  return readStore().comments
    .filter((comment) => comment.workspaceKey === key && (filePath === undefined || comment.path === filePath) && (staged === undefined || comment.staged === staged))
    .map(({ workspaceKey: _workspaceKey, ...comment }) => comment)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-100);
}

export function addReviewComment(
  guard: PathGuard,
  workspace: Workspace,
  options: { path: string; staged: boolean; hunkId: string; line: number; body: string; hunks: ReviewHunk[] }
): ReviewComment {
  const resolved = guard.resolve(workspace, options.path);
  const hunk = options.hunks.find((item) => item.id === options.hunkId);
  if (!hunk || options.line < hunk.startLine || options.line > hunk.endLine) throw new CodexFlowError("The selected diff line is no longer part of this hunk.");
  const body = options.body.trim();
  if (!body || body.length > 2000) throw new CodexFlowError("Review comments must contain 1 to 2000 characters.");
  if (hasSecretValue(body)) throw new CodexFlowError("Review comment appears to contain a credential or secret.");
  const now = new Date().toISOString();
  const stored: StoredReviewComment = {
    id: `rc_${randomBytes(8).toString("hex")}`, workspaceKey: workspaceKey(workspace), path: resolved.relPath,
    staged: options.staged, hunkId: hunk.id, line: options.line, body, createdAt: now, updatedAt: now
  };
  const store = readStore();
  store.comments.push(stored);
  writeStore(store);
  const { workspaceKey: _workspaceKey, ...comment } = stored;
  return comment;
}

export function deleteReviewComment(workspace: Workspace, commentId: string): void {
  if (!COMMENT_ID.test(commentId)) throw new CodexFlowError("Invalid review comment id.");
  const store = readStore();
  const index = store.comments.findIndex((comment) => comment.id === commentId && comment.workspaceKey === workspaceKey(workspace));
  if (index < 0) throw new CodexFlowError("Review comment not found for this project.");
  store.comments.splice(index, 1);
  writeStore(store);
}
