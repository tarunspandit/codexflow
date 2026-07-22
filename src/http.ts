#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { expandHome, loadConfig, type CodexFlowConfig } from "./config.js";
import {
  profilePathForRoot,
  readRuntimeConnection,
  readWorkspaceProfile,
  sanitizeWorkspaceProfile,
  saveWorkspaceProfile,
  type ConnectorMode,
  type TunnelMode,
  type WorkspaceProfile
} from "./profileStore.js";
import { redactSensitiveText, redactStructured } from "./redact.js";
import { createCodexFlowServer } from "./server.js";
import { discoverProjects } from "./projectCatalog.js";
import { PathGuard, WorkspaceManager, workspaceIdForRoot, type Workspace } from "./guard.js";
import { RuntimeMonitor, type RuntimeSessionHandle } from "./runtimeMonitor.js";
import { CODEXFLOW_VERSION } from "./version.js";
import { renderLocalAppPage } from "./localAppPage.js";
import { createManagedWorktree, listManagedWorktrees, removeManagedWorktree } from "./worktreeOps.js";
import {
  environmentAction,
  environmentTerminalCommand,
  listLocalEnvironments,
  localEnvironmentSummary,
  resolveLocalEnvironment,
  runLocalEnvironmentCommand
} from "./localEnvironmentOps.js";
import { persistentTerminals } from "./terminalOps.js";
import { computerUse } from "./computerUseOps.js";
import { browserUse } from "./browserUseOps.js";
import { gitDiffStatus, gitStatus } from "./gitOps.js";
import { runGitWorkflow } from "./gitWorkflow.js";
import {
  addReviewComment,
  deleteReviewComment,
  listReviewComments,
  rawReviewDiff,
  reviewHunks,
  runReviewHunkAction
} from "./reviewOps.js";
import {
  disconnectRemoteConnection,
  listRemoteConnections,
  removeRemoteProject,
  saveRemoteProject,
  verifyRemoteConnection
} from "./remoteConnections.js";

const TUNNELS = ["cloudflare", "ngrok", "cloudflare-named", "tailscale", "none"] as const;
const MODES = ["agent", "handoff", "pro"] as const;
const BASH_MODES = ["safe", "off", "full"] as const;
const BASH_TRANSCRIPTS = ["compact", "full"] as const;
const CODEX_SESSIONS = ["off", "metadata", "read"] as const;
const WRITE_MODES = ["workspace", "handoff", "off"] as const;
const TOOL_MODES = ["standard", "minimal", "full"] as const;

const textField = (max: number) =>
  z.preprocess((value) => (typeof value === "string" ? value.trim() : value), z.string().max(max).optional());

const AdminProfilePatch = z.object({
  tunnel: z.enum(TUNNELS).optional(),
  hostname: textField(253),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  mode: z.enum(MODES).optional(),
  bash: z.enum(BASH_MODES).optional(),
  bashTranscript: z.enum(BASH_TRANSCRIPTS).optional(),
  codexSessions: z.enum(CODEX_SESSIONS).optional(),
  codexDir: textField(4096),
  bashSession: textField(64).refine(
    (value) => !value || /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value),
    "bashSession must be 1-64 characters using letters, numbers, dot, underscore, or dash, and must start with a letter or number."
  ),
  requireBashSession: z.boolean().optional(),
  write: z.enum(WRITE_MODES).optional(),
  toolMode: z.enum(TOOL_MODES).optional(),
  toolCards: z.boolean().optional(),
  widgetDomain: textField(2048),
  tunnelName: textField(128),
  ngrokConfig: textField(4096),
  cloudflareConfig: textField(4096),
  cloudflareTokenFile: textField(4096),
  noInstallCloudflared: z.boolean().optional()
}).strict();

type AdminProfilePatch = z.infer<typeof AdminProfilePatch>;

const AdminWorktreeCommand = z.object({
  action: z.enum(["create", "remove"]),
  worktreeId: z.string().regex(/^wt_[a-f0-9]{16}$/).optional(),
  baseRef: z.string().trim().max(256).optional(),
  includeChanges: z.boolean().optional(),
  environmentConfigPath: z.string().trim().max(4096).optional(),
  setupTimeoutMs: z.number().int().min(1000).max(600000).optional()
}).strict();

const AdminEnvironmentCommand = z.object({
  action: z.enum(["run", "setup", "cleanup", "stop"]),
  configPath: z.string().trim().max(4096).optional(),
  actionName: z.string().trim().max(120).optional(),
  background: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(600000).optional()
}).strict();

const AdminChatCommand = z.object({
  action: z.enum(["rename", "pin", "archive"]),
  chatId: z.string().regex(/^chat-[0-9a-f]{8}$/),
  title: z.string().trim().max(80).optional(),
  value: z.boolean().optional()
}).strict();

const AdminChangesQuery = z.object({
  path: z.string().trim().max(4096).optional(),
  staged: z.enum(["true", "false", "1", "0"]).optional()
});

const AdminChangesCommand = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["stage", "unstage", "discard"]),
    paths: z.array(z.string().trim().min(1).max(4096)).min(1).max(200),
    includeStaged: z.boolean().optional()
  }).strict(),
  z.object({
    action: z.enum(["stage_hunk", "unstage_hunk", "discard_hunk"]),
    path: z.string().trim().min(1).max(4096),
    staged: z.boolean(),
    hunkId: z.string().regex(/^hunk_[a-f0-9]{16}$/)
  }).strict(),
  z.object({
    action: z.literal("comment"),
    path: z.string().trim().min(1).max(4096),
    staged: z.boolean(),
    hunkId: z.string().regex(/^hunk_[a-f0-9]{16}$/),
    line: z.number().int().min(0).max(1_000_000),
    body: z.string().trim().min(1).max(2000)
  }).strict(),
  z.object({
    action: z.literal("delete_comment"),
    commentId: z.string().regex(/^rc_[a-f0-9]{16}$/),
    path: z.string().trim().min(1).max(4096),
    staged: z.boolean()
  }).strict()
]);

const AdminRemoteCommand = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["verify", "disconnect"]),
    alias: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
  }).strict(),
  z.object({
    action: z.literal("save_project"),
    alias: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    root: z.string().trim().min(1).max(4096)
  }).strict(),
  z.object({
    action: z.literal("remove_project"),
    projectId: z.string().regex(/^rws_[a-f0-9]{24}$/)
  }).strict()
]);

const AdminComputerCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request_permissions") }).strict(),
  z.object({
    action: z.literal("decide_access"),
    requestId: z.string().regex(/^cua_[a-f0-9]{16}$/),
    decision: z.enum(["allow_once", "always_allow", "deny"])
  }).strict(),
  z.object({
    action: z.literal("decide_action"),
    requestId: z.string().regex(/^cux_[a-f0-9]{16}$/),
    approve: z.boolean()
  }).strict(),
  z.object({
    action: z.literal("revoke"),
    bundleId: z.string().trim().min(1).max(300)
  }).strict()
]);

const AdminBrowserCommand = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("decide_host"),
    requestId: z.string().regex(/^buh_[a-f0-9]{16}$/),
    decision: z.enum(["allow_once", "always_allow", "deny"])
  }).strict(),
  z.object({
    action: z.literal("decide_action"),
    requestId: z.string().regex(/^bux_[a-f0-9]{16}$/),
    approve: z.boolean()
  }).strict(),
  z.object({
    action: z.literal("revoke"),
    origin: z.string().trim().min(1).max(500)
  }).strict(),
  z.object({
    action: z.literal("add_comment"),
    sessionId: z.string().regex(/^but_[a-f0-9]{16}$/),
    selector: z.string().trim().min(1).max(1000),
    target: z.string().trim().min(1).max(300),
    note: z.string().trim().min(1).max(1000)
  }).strict(),
  z.object({
    action: z.literal("remove_comment"),
    commentId: z.string().regex(/^bua_[a-f0-9]{16}$/)
  }).strict()
]);

const AdminBrowserCompletion = z.object({
  commandId: z.string().regex(/^buc_[a-f0-9]{16}$/),
  ok: z.boolean(),
  result: z.record(z.unknown()).optional(),
  error: z.string().max(2000).optional()
}).strict();

interface DesktopChangedFile {
  path: string;
  status: string;
  staged: boolean;
  previousPath?: string;
}

interface ProfileFormValues {
  port: string;
  mode: ConnectorMode;
  tunnel: TunnelMode;
  hostname: string;
  tunnelName: string;
  ngrokConfig: string;
  cloudflareConfig: string;
  cloudflareTokenFile: string;
  bash: "off" | "safe" | "full";
  bashTranscript: "compact" | "full";
  codexSessions: "off" | "metadata" | "read";
  codexDir: string;
  bashSession: string;
  requireBashSession: boolean;
  write: "off" | "handoff" | "workspace";
  toolMode: "minimal" | "standard" | "full";
  toolCards: boolean;
  widgetDomain: string;
  noInstallCloudflared: boolean;
}

function oneOf<T extends readonly string[]>(value: unknown, values: T, fallback: T[number]): T[number] {
  return typeof value === "string" && values.includes(value) ? value : fallback;
}

function runtimeTunnelFallback(): TunnelMode {
  if (process.env.CODEXFLOW_TUNNEL && TUNNELS.includes(process.env.CODEXFLOW_TUNNEL as TunnelMode)) {
    return process.env.CODEXFLOW_TUNNEL as TunnelMode;
  }
  return process.env.CODEXFLOW_TUNNEL_MODE === "0" ? "none" : "cloudflare";
}

function normalizePublicHostname(value: string | undefined): string {
  const raw = value?.trim().replace(/\/+$/, "") ?? "";
  if (!raw) return "";
  const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  if (url.protocol !== "https:") throw new Error("hostname must use https when a scheme is provided.");
  if (url.search || url.hash) throw new Error("hostname must not include query strings or fragments.");
  if (url.pathname !== "/" && url.pathname !== "/mcp") throw new Error("hostname must be a host, URL root, or /mcp URL.");
  return url.host;
}

function normalizeWidgetDomain(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw || raw === "https://tarunspandit.github.io") return "";
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("widgetDomain must use https.");
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("widgetDomain must be an origin only, for example https://widgets.example.com.");
  }
  return url.origin;
}

function effectiveWriteMode(mode: ConnectorMode, write: ProfileFormValues["write"]): ProfileFormValues["write"] {
  if (mode === "agent") return write;
  return write === "off" ? "off" : "handoff";
}

function normalizeProfilePath(root: string, value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  const expanded = expandHome(raw);
  return path.isAbsolute(expanded) || path.win32.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(root, expanded);
}

function profileValues(config: CodexFlowConfig, profile = readWorkspaceProfile(config.defaultRoot)): ProfileFormValues {
  const hostname =
    profile.hostname ??
    process.env.CODEXFLOW_PUBLIC_HOSTNAME ??
    process.env.CODEXFLOW_HOSTNAME ??
    process.env.NGROK_DOMAIN ??
    "";
  const mode = oneOf(profile.mode ?? process.env.CODEXFLOW_MODE, MODES, "agent");
  const write = effectiveWriteMode(mode, oneOf(profile.write ?? config.writeMode, WRITE_MODES, config.writeMode));
  return {
    port: String(profile.port ?? config.port),
    mode,
    tunnel: oneOf(profile.tunnel, TUNNELS, runtimeTunnelFallback()),
    hostname: String(hostname),
    tunnelName: String(profile.tunnelName ?? ""),
    ngrokConfig: String(profile.ngrokConfig ?? ""),
    cloudflareConfig: String(profile.cloudflareConfig ?? ""),
    cloudflareTokenFile: String(profile.cloudflareTokenFile ?? ""),
    bash: oneOf(profile.bash ?? config.bashMode, BASH_MODES, config.bashMode),
    bashTranscript: oneOf(profile.bashTranscript ?? config.bashTranscript, BASH_TRANSCRIPTS, config.bashTranscript),
    codexSessions: oneOf(profile.codexSessions ?? config.codexSessions, CODEX_SESSIONS, config.codexSessions),
    codexDir: String(profile.codexDir ?? config.codexDir),
    bashSession: String(profile.bashSession ?? config.bashSessionId ?? ""),
    requireBashSession: Boolean(profile.requireBashSession ?? config.requireBashSession),
    write,
    toolMode: oneOf(profile.toolMode ?? config.toolMode, TOOL_MODES, config.toolMode),
    toolCards: Boolean(profile.toolCards ?? config.toolCards),
    widgetDomain: normalizeWidgetDomain(String(profile.widgetDomain ?? config.widgetDomain)),
    noInstallCloudflared: Boolean(profile.noInstallCloudflared)
  };
}

function serverUrlDisplay(endpoint: string | undefined, authEnabled: boolean): string {
  if (!endpoint) return "";
  const safeEndpoint = redactSensitiveText(endpoint);
  if (!authEnabled) return safeEndpoint;
  const glue = safeEndpoint.includes("?") ? "&" : "?";
  return `${safeEndpoint}${glue}codexflow_token=<redacted>`;
}

function buildProfilePayload(config: CodexFlowConfig, existing: WorkspaceProfile, input: AdminProfilePatch): WorkspaceProfile {
  const current = profileValues(config, existing);
  const next: ProfileFormValues = {
    ...current,
    ...input,
    port: input.port ? String(input.port) : current.port,
    requireBashSession: input.requireBashSession ?? current.requireBashSession,
    noInstallCloudflared: input.noInstallCloudflared ?? current.noInstallCloudflared
  };
  next.hostname = normalizePublicHostname(next.hostname);
  if (next.tunnel !== "ngrok" && next.tunnel !== "cloudflare-named" && next.tunnel !== "tailscale") next.hostname = "";
  next.widgetDomain = normalizeWidgetDomain(next.widgetDomain);
  if ((next.tunnel === "ngrok" || next.tunnel === "cloudflare-named" || next.tunnel === "tailscale") && !next.hostname) {
    throw new Error("hostname is required for ngrok, cloudflare-named, and tailscale profiles.");
  }
  if (next.requireBashSession && !next.bashSession) {
    throw new Error("requireBashSession requires a bashSession value.");
  }

  const token = typeof existing.token === "string" && existing.token ? existing.token : config.authToken ?? "";
  const cloudflareToken = next.tunnel === "cloudflare-named" && typeof existing.cloudflareToken === "string" && existing.cloudflareToken ? existing.cloudflareToken : "";
  const write = effectiveWriteMode(next.mode, next.write);
  const tunnelName = next.tunnel === "cloudflare-named" ? next.tunnelName : "";
  const ngrokConfig = next.tunnel === "ngrok" ? normalizeProfilePath(config.defaultRoot, next.ngrokConfig) : "";
  const cloudflareConfig = next.tunnel === "cloudflare-named" ? normalizeProfilePath(config.defaultRoot, next.cloudflareConfig) : "";
  const cloudflareTokenFile = next.tunnel === "cloudflare-named" ? normalizeProfilePath(config.defaultRoot, next.cloudflareTokenFile) : "";
  return {
    ...((existing.allowRoots?.length || config.allowedRoots.length > 1)
      ? { allowRoots: existing.allowRoots?.length ? existing.allowRoots : config.allowedRoots.filter((root) => root !== config.defaultRoot) }
      : {}),
    port: next.port,
    mode: next.mode,
    tunnel: next.tunnel,
    ...(next.hostname ? { hostname: next.hostname } : {}),
    ...(tunnelName ? { tunnelName } : {}),
    ...(ngrokConfig ? { ngrokConfig } : {}),
    ...(cloudflareConfig ? { cloudflareConfig } : {}),
    ...(cloudflareTokenFile ? { cloudflareTokenFile } : {}),
    ...(token ? { token } : {}),
    ...(cloudflareToken ? { cloudflareToken } : {}),
    bash: next.bash,
    ...(next.bashTranscript !== "compact" ? { bashTranscript: next.bashTranscript } : {}),
    ...(next.codexSessions !== "off" ? { codexSessions: next.codexSessions } : {}),
    ...(next.codexDir ? { codexDir: next.codexDir } : {}),
    ...(next.bashSession ? { bashSession: next.bashSession } : {}),
    ...(next.requireBashSession ? { requireBashSession: true } : {}),
    write,
    toolMode: next.toolMode,
    toolCards: next.toolCards,
    ...(next.widgetDomain ? { widgetDomain: next.widgetDomain } : {}),
    ...(next.noInstallCloudflared ? { noInstallCloudflared: true } : {})
  };
}

function profileResponse(config: CodexFlowConfig): Record<string, unknown> {
  const profile = readWorkspaceProfile(config.defaultRoot);
  const runtime = readRuntimeConnection(config.defaultRoot);
  return redactStructured({
    ok: true,
    profile_path: profile.profilePath ?? profilePathForRoot(config.defaultRoot),
    exists: Boolean(profile.profilePath),
    profile: sanitizeWorkspaceProfile(profile),
    effective: profileValues(config, profile),
    runtime_connection: runtime,
    runtime: {
      defaultRoot: config.defaultRoot,
      port: config.port,
      bashMode: config.bashMode,
      bashTranscript: config.bashTranscript,
      codexSessions: config.codexSessions,
      writeMode: config.writeMode,
      toolMode: config.toolMode,
      toolCards: config.toolCards,
      widgetDomain: config.widgetDomain,
      authEnabled: Boolean(config.authToken)
    }
  });
}

function endpointBase(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return redactSensitiveText(value).split(/[?#]/, 1)[0] ?? "";
  }
}

function runtimeProject(workspace: Workspace): { id: string; name: string; root: string } {
  return {
    id: workspace.id,
    name: path.basename(workspace.root) || workspace.root,
    root: workspace.root
  };
}

async function applicationOverview(
  config: CodexFlowConfig,
  workspaces: WorkspaceManager,
  monitor: RuntimeMonitor,
  startedAt: number,
  refreshProjects = false
): Promise<Record<string, unknown>> {
  const [projects, profile] = await Promise.all([
    discoverProjects(config, { refresh: refreshProjects, maxProjects: 250 }),
    Promise.resolve(readWorkspaceProfile(config.defaultRoot))
  ]);
  const runtime = readRuntimeConnection(config.defaultRoot);
  const monitored = monitor.snapshot();
  let worktrees: ReturnType<typeof listManagedWorktrees> = [];
  try {
    worktrees = listManagedWorktrees(config, workspaces.defaultWorkspace());
  } catch {
    // A non-Git project simply has no managed worktrees.
  }
  let environments: ReturnType<typeof localEnvironmentSummary>[] = [];
  try {
    environments = listLocalEnvironments(config, workspaces.defaultWorkspace()).map((environment) => localEnvironmentSummary(environment));
  } catch {
    // Invalid environment files are surfaced by the dedicated endpoint.
  }
  const runtimeEndpoint = endpointBase(runtime.endpoint);
  const localBase = endpointBase(runtime.localBase) || `http://${config.host}:${config.port}`;
  const endpoint = runtimeEndpoint || `${localBase}/mcp`;
  return redactStructured({
    ok: true,
    generated_at: new Date().toISOString(),
    broker: {
      state: "ready",
      version: CODEXFLOW_VERSION,
      started_at: new Date(startedAt).toISOString(),
      uptime_ms: Date.now() - startedAt,
      default_root: config.defaultRoot,
      allowed_roots: config.allowedRoots,
      local_base: localBase,
      endpoint,
      public_endpoint: endpoint.startsWith("https://") ? endpoint : null,
      tunnel: runtime.tunnel ?? null,
      mode: runtime.mode ?? process.env.CODEXFLOW_MODE ?? "agent",
      auth_enabled: Boolean(config.authToken),
      write_mode: config.writeMode,
      bash_mode: config.bashMode,
      bash_transcript: config.bashTranscript,
      tool_mode: config.toolMode,
      tool_cards: config.toolCards,
      codex_sessions: config.codexSessions,
      analysis_enabled: config.analysisEnabled,
      max_sessions: config.maxHttpSessions,
      session_ttl_ms: config.httpSessionTtlMs
    },
    projects: projects.map((project) => ({
      id: workspaceIdForRoot(project.root),
      name: project.name,
      root: project.root,
      sources: project.sources,
      last_active_at: project.lastActiveAt ? new Date(project.lastActiveAt).toISOString() : null,
      is_default: project.root === config.defaultRoot
    })),
    sessions: monitored.sessions,
    activity: monitored.activity,
    worktrees,
    environments,
    summary: {
      projects: projects.length,
      active_sessions: monitored.active_sessions,
      pending_sessions: monitored.pending_sessions,
      open_connections: monitored.open_connections,
      recent_sessions: monitored.recent_sessions,
      activity_events: monitored.activity.length,
      managed_worktrees: worktrees.length,
      local_environments: environments.length
    },
    saved_profile: {
      exists: Boolean(profile.profilePath),
      tunnel: profile.tunnel ?? null,
      hostname: profile.hostname ?? null,
      mode: profile.mode ?? null,
      updated_at: profile.updatedAt ?? null
    }
  });
}

function changedFilesFromStatus(output: string, staged: boolean): DesktopChangedFile[] {
  if (!output.trim() || output.trim() === "(no output)" || /not a git repository/i.test(output)) return [];
  return output.split("\n").flatMap((line) => {
    const normalized = line.replace(/\r$/, "");
    if (!normalized) return [];
    if (normalized.startsWith("?? ")) {
      return [{ path: normalized.slice(3), status: "untracked", staged: false }];
    }
    const parts = normalized.split("\t");
    if (parts.length < 2) return [];
    const code = parts[0]?.trim() || "M";
    const renamed = code.startsWith("R") || code.startsWith("C");
    const file = renamed ? parts[2] : parts[1];
    if (!file) return [];
    const status = code.startsWith("A")
      ? "added"
      : code.startsWith("D")
        ? "deleted"
        : code.startsWith("R")
          ? "renamed"
          : code.startsWith("C")
            ? "copied"
            : code.startsWith("T")
              ? "type changed"
              : "modified";
    return [{ path: file, status, staged, ...(renamed && parts[1] ? { previousPath: parts[1] } : {}) }];
  });
}

function desktopDiffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function desktopGitUnavailable(output: string): boolean {
  const value = output.trim().toLowerCase();
  return value.startsWith("fatal:") || value.startsWith("git unavailable or failed:") || value.includes("not a git repository");
}

async function desktopChangesResponse(
  config: CodexFlowConfig,
  guard: PathGuard,
  workspace: Workspace,
  selectedPath?: string,
  selectedStaged = false
): Promise<Record<string, unknown>> {
  const status = gitStatus(config, workspace);
  if (desktopGitUnavailable(status)) {
    return {
      ok: true,
      root: workspace.root,
      is_git: false,
      branch: "",
      can_write: false,
      staged: [],
      unstaged: [],
      summary: { staged: 0, unstaged: 0, files: 0 },
      selected: null
    };
  }
  const stagedFiles = changedFilesFromStatus(gitDiffStatus(config, guard, workspace, undefined, true), true);
  const unstagedFiles = changedFilesFromStatus(gitDiffStatus(config, guard, workspace, undefined, false), false);
  let diff = "";
  let truncated = false;
  let hunks: ReturnType<typeof reviewHunks> = [];
  let comments: ReturnType<typeof listReviewComments> = [];
  if (selectedPath) {
    const selected = selectedStaged ? stagedFiles : unstagedFiles;
    const file = selected.find((item) => item.path === selectedPath);
    if (!file) throw new Error(`The selected ${selectedStaged ? "staged" : "unstaged"} change no longer exists.`);
    const raw = await rawReviewDiff(config, guard, workspace, selectedPath, selectedStaged);
    diff = redactSensitiveText(raw.diff);
    truncated = raw.truncated;
    hunks = reviewHunks(raw.diff, raw.path, selectedStaged, raw.untracked);
    comments = listReviewComments(workspace, raw.path, selectedStaged, hunks);
  }
  const stats = desktopDiffStats(diff);
  const branchLine = status.split("\n")[0]?.replace(/^##\s*/, "") ?? "";
  return redactStructured({
    ok: true,
    root: workspace.root,
    is_git: true,
    branch: branchLine,
    can_write: config.writeMode === "workspace",
    staged: stagedFiles,
    unstaged: unstagedFiles,
    summary: {
      staged: stagedFiles.length,
      unstaged: unstagedFiles.length,
      files: new Set([...stagedFiles, ...unstagedFiles].map((item) => item.path)).size
    },
    selected: selectedPath
      ? {
          path: selectedPath,
          staged: selectedStaged,
          diff,
          additions: stats.additions,
          deletions: stats.deletions,
          truncated,
          hunks,
          comments
        }
      : null
  });
}

async function desktopChangesAfterMutation(
  config: CodexFlowConfig,
  guard: PathGuard,
  workspace: Workspace,
  selectedPath: string,
  selectedStaged: boolean
): Promise<Record<string, unknown>> {
  try { return await desktopChangesResponse(config, guard, workspace, selectedPath, selectedStaged); }
  catch { return desktopChangesResponse(config, guard, workspace); }
}

function jsonError(res: Response, status: number, code: string, message: string, issues?: unknown): void {
  res.status(status).json({
    ok: false,
    error: {
      code,
      message: redactSensitiveText(message),
      ...(issues ? { issues: redactStructured(issues) } : {})
    }
  });
}

const LOCAL_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" fill="none">
  <rect width="160" height="160" rx="35" fill="#08090b"/>
  <g stroke-linecap="round" stroke-linejoin="round">
    <path d="M128.7 39.6C141 52.8 146.5 70.8 143.4 88.4C140.2 106.7 129 122.4 112.7 132.3C96.8 142 77.3 144 59.6 137.2C41.3 130.1 27.5 115.6 21.8 97.2C16.6 80 19.4 61.5 30.5 46.9C41.2 32.8 57.8 23.6 75.4 21.6C95.2 19.3 115.7 26.1 128.7 39.6Z" stroke="#f4eae0" stroke-width="2.6" stroke-dasharray="367.154 17.3" stroke-dashoffset="-8.65"/>
    <circle cx="132.4" cy="43.3" r="2.8" fill="#7db5da"/>
    <g stroke="#7db5da" stroke-width="2">
      <path d="M54 84L72 58L99 64L108 88L86 106L59 99Z"/>
      <path d="M72 58L78 83L108 88M78 83L59 99M78 83L99 64M78 83L86 106"/>
      <circle cx="78" cy="83" r="3.2" fill="#7db5da" stroke="none"/>
    </g>
  </g>
</svg>`;
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAND_ASSET_ROOT = path.join(PACKAGE_ROOT, "docs", "assets");

function printHelp(): void {
  console.log(`CodexFlow MCP HTTP server

Usage:
  codexflow-mcp-http --root /path/to/repo --port 8787
  codexflow-mcp-http --version
  codexflow-mcp-http --help

Set CODEXFLOW_HTTP_TOKEN for public/tunnel use.
For trusted local-only testing, set CODEXFLOW_ALLOW_NO_HTTP_TOKEN=1.
Most users should run: codexflow`);
}

function onboardingPage(config: CodexFlowConfig): string {
  const localMcp = `http://${config.host}:${config.port}/mcp`;
  const localMcpDisplay = config.authToken ? `${localMcp}?codexflow_token=<redacted>` : localMcp;
  const authLabel = config.authToken ? "Token protected" : "Disabled";
  const githubUrl = "https://github.com/tarunspandit/codexflow";
  const npmUrl = "https://www.npmjs.com/package/@tarunspandit/codexflow";
  const docsUrl = "https://tarunspandit.github.io/codexflow/";
  const chatgptUrl = "https://chatgpt.com/#settings/Connectors";
  const runtime = readRuntimeConnection(config.defaultRoot);
  const currentEndpoint = endpointBase(runtime.endpoint) || localMcp;
  const currentEndpointDisplay =
    serverUrlDisplay(currentEndpoint, Boolean(config.authToken)) || localMcpDisplay;
  return renderLocalAppPage({
    version: CODEXFLOW_VERSION,
    defaultRoot: config.defaultRoot,
    localMcp,
    endpointBase: currentEndpoint,
    endpointDisplay: currentEndpointDisplay,
    authLabel,
    mode: String(runtime.mode ?? process.env.CODEXFLOW_MODE ?? "agent"),
    writeMode: config.writeMode,
    bashMode: config.bashMode,
    bashTranscript: config.bashTranscript,
    toolMode: config.toolMode,
    codexSessions: config.codexSessions,
    widgetDomain: config.widgetDomain,
    allowedRoots: config.allowedRoots,
    chatgptUrl,
    githubUrl,
    npmUrl,
    docsUrl
  });
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv.includes("-v") || argv[0] === "version") {
    console.log(CODEXFLOW_VERSION);
    return;
  }
  if (argv.includes("--help") || argv[0] === "help") {
    printHelp();
    return;
  }

  const config = loadConfig();
  if (config.requireHttpToken && !config.authToken) {
    throw new Error(
      "CODEXFLOW_HTTP_TOKEN is required for this HTTP binding. " +
        "Set CODEXFLOW_HTTP_TOKEN, use `codexflow` to generate one, " +
        "or set CODEXFLOW_ALLOW_NO_HTTP_TOKEN=1 only for a trusted local-only setup."
    );
  }

  const app = express();
  const runtimeMonitor = new RuntimeMonitor(
    120,
    5 * 60_000,
    config.maxHttpSessions,
    path.join(path.dirname(config.managedWorktreeRoot), "chat-metadata.json")
  );
  const workspaces = new WorkspaceManager(config);
  const guard = new PathGuard(config);
  const logRequests = process.env.CODEXFLOW_LOG_REQUESTS === "1";

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'"
    );
    res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  function tokenMatches(value: unknown): boolean {
    if (!config.authToken || typeof value !== "string") return false;
    const expected = Buffer.from(config.authToken);
    const actual = Buffer.from(value);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  const adminRateWindow = new Map<string, { count: number; resetAt: number }>();

  function adminRateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "local";
    const current = adminRateWindow.get(key);
    if (!current || current.resetAt <= now) {
      adminRateWindow.set(key, { count: 1, resetAt: now + 60_000 });
      next();
      return;
    }
    current.count += 1;
    if (current.count > 30) {
      jsonError(res, 429, "rate_limited", "Too many profile save attempts. Try again in a minute.");
      return;
    }
    next();
  }

  function adminBodyLimit(req: Request, res: Response, next: NextFunction): void {
    const length = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(length) && length > 32_768) {
      jsonError(res, 413, "payload_too_large", "Profile request body is too large.");
      return;
    }
    next();
  }

  app.use((req, res, next) => {
    if (!logRequests) {
      next();
      return;
    }
    const started = Date.now();
    console.error(`[CodexFlow] ${req.method} ${req.path} received`);
    res.on("finish", () => {
      console.error(`[CodexFlow] ${req.method} ${req.path} -> ${res.statusCode} ${Date.now() - started}ms`);
    });
    next();
  });
  app.use(cors({ exposedHeaders: ["Mcp-Session-Id"] }));
  app.get("/favicon.ico", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.type("image/svg+xml").send(LOCAL_FAVICON);
  });
  const brandAssets: Record<string, { file: string; type: string }> = {
    "/brand/geologica.woff2": { file: "fonts/Geologica-Variable.woff2", type: "font/woff2" },
    "/brand/control.css": { file: "brand/control.css", type: "text/css" },
    "/brand/control.js": { file: "brand/control.js", type: "text/javascript" },
    "/brand/flow7-tech-dark.webp": { file: "brand/flow7-tech-dark.webp", type: "image/webp" },
    "/brand/flow7-tech-light.webp": { file: "brand/flow7-tech-light.webp", type: "image/webp" },
    "/brand/flow7-parent-dark.webp": { file: "brand/flow7-parent-dark.webp", type: "image/webp" },
    "/brand/flow7-parent-light.webp": { file: "brand/flow7-parent-light.webp", type: "image/webp" }
  };
  for (const [route, asset] of Object.entries(brandAssets)) {
    app.get(route, (_req, res) => {
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.type(asset.type).sendFile(path.join(BRAND_ASSET_ROOT, asset.file));
    });
  }
  app.use((req, res, next) => {
    if (!config.authToken) {
      next();
      return;
    }
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const queryToken = typeof req.query.codexflow_token === "string"
      ? req.query.codexflow_token
      : typeof req.query.token === "string"
        ? req.query.token
        : undefined;
    if (!tokenMatches(bearer) && !tokenMatches(queryToken)) {
      res.status(401).send("Unauthorized");
      return;
    }
    next();
  });

  type TransportRecord = {
    transport: StreamableHTTPServerTransport;
    monitorSession: RuntimeSessionHandle;
    createdAt: number;
    lastSeenAt: number;
  };

  const transports = new Map<string, TransportRecord>();
  const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function requestSessionId(req: Request): string | undefined {
    const value = req.headers["mcp-session-id"];
    return Array.isArray(value) ? value[0] : value;
  }

  function sendSessionError(res: Response, sessionId: string | undefined): void {
    const missing = !sessionId;
    const malformed = Boolean(sessionId && !sessionIdPattern.test(sessionId));
    res.status(missing || malformed ? 400 : 404).json({
      jsonrpc: "2.0",
      error: missing
        ? { code: -32000, message: "Bad Request: Mcp-Session-Id header is required" }
        : malformed
          ? { code: -32000, message: "Bad Request: invalid MCP session id" }
          : { code: -32001, message: "Session not found" },
      id: null
    });
  }

  function closeTransport(record: TransportRecord): void {
    record.monitorSession.close();
    void record.transport.close?.();
  }

  function pruneTransports(): void {
    const now = Date.now();
    for (const [sessionId, record] of transports) {
      if (now - record.lastSeenAt > config.httpSessionTtlMs) {
        transports.delete(sessionId);
        closeTransport(record);
      }
    }
    while (transports.size > config.maxHttpSessions) {
      const oldest = [...transports.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)[0];
      if (!oldest) break;
      transports.delete(oldest[0]);
      closeTransport(oldest[1]);
    }
  }

  function getTransport(sessionId: string | undefined): StreamableHTTPServerTransport | undefined {
    if (!sessionId || !sessionIdPattern.test(sessionId)) return undefined;
    pruneTransports();
    const record = transports.get(sessionId);
    if (!record) return undefined;
    record.lastSeenAt = Date.now();
    record.monitorSession.touch();
    return record.transport;
  }

  const pruneTimer = setInterval(pruneTransports, Math.min(config.httpSessionTtlMs, 60_000));
  pruneTimer.unref();

  app.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(onboardingPage(config));
  });

  app.get("/setup", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(onboardingPage(config));
  });

  app.get("/api/overview", async (req, res) => {
    try {
      const refresh = req.query.refresh === "1" || req.query.refresh === "true";
      res.setHeader("Cache-Control", "no-store");
      res.json(await applicationOverview(config, workspaces, runtimeMonitor, startedAt, refresh));
    } catch (error) {
      jsonError(res, 500, "overview_unavailable", error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/api/events", (req, res) => {
    let unsubscribe: (() => void) | undefined;
    const sendUpdate = () => {
      if (!res.writableEnded) res.write(`event: update\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    };
    try {
      unsubscribe = runtimeMonitor.subscribe(sendUpdate);
    } catch (error) {
      jsonError(res, 503, "events_unavailable", error instanceof Error ? error.message : String(error));
      return;
    }
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    sendUpdate();
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`);
    }, 20_000);
    heartbeat.unref();
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe?.();
    });
  });

  app.get("/healthz", (_req, res) => {
    const monitor = runtimeMonitor.snapshot();
    res.json({
      ok: true,
      name: "CodexFlow",
      defaultRoot: config.defaultRoot,
      allowedRoots: config.allowedRoots,
      bashMode: config.bashMode,
      bashTranscript: config.bashTranscript,
      bashSessionId: config.bashSessionId ?? null,
      requireBashSession: config.requireBashSession,
      codexSessions: config.codexSessions,
      writeMode: config.writeMode,
      toolMode: config.toolMode,
      widgetDomain: config.widgetDomain,
      contextDir: config.contextDir,
      authEnabled: Boolean(config.authToken),
      authRequired: Boolean(config.authToken),
      activeSessions: monitor.active_sessions,
      pendingSessions: monitor.pending_sessions,
      openConnections: monitor.open_connections,
      recentSessions: monitor.recent_sessions,
      version: CODEXFLOW_VERSION
    });
  });

  app.get("/admin/profile", (_req, res) => {
    res.json(profileResponse(config));
  });

  app.post("/admin/profile", adminRateLimit, adminBodyLimit, express.json({ limit: "32kb" }), (req, res) => {
    const parsed = AdminProfilePatch.safeParse(req.body ?? {});
    if (!parsed.success) {
      jsonError(res, 400, "invalid_profile", "Invalid profile settings.", parsed.error.flatten());
      return;
    }
    try {
      const existing = readWorkspaceProfile(config.defaultRoot);
      const payload = buildProfilePayload(config, existing, parsed.data);
      const profilePath = saveWorkspaceProfile(config.defaultRoot, payload);
      res.json({
        ...profileResponse(config),
        saved: true,
        profile_path: profilePath,
        message: "Saved. Restart CodexFlow for these profile settings to apply."
      });
    } catch (error) {
      jsonError(res, 400, "invalid_profile", error instanceof Error ? error.message : String(error));
    }
  });

  app.all("/admin/profile", (_req, res) => {
    jsonError(res, 405, "method_not_allowed", "Use GET or POST for /admin/profile.");
  });

  app.get("/admin/remotes", (_req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(redactStructured(listRemoteConnections()));
    } catch (error) {
      jsonError(res, 400, "remote_hosts_unavailable", error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/admin/remotes", adminRateLimit, adminBodyLimit, express.json({ limit: "32kb" }), (req, res) => {
    const parsed = AdminRemoteCommand.safeParse(req.body ?? {});
    if (!parsed.success) {
      jsonError(res, 400, "invalid_remote_command", "Choose a discovered SSH alias and a supported action.", parsed.error.flatten());
      return;
    }
    try {
      let result;
      switch (parsed.data.action) {
        case "verify":
          result = verifyRemoteConnection(parsed.data.alias);
          break;
        case "disconnect":
          result = disconnectRemoteConnection(parsed.data.alias);
          break;
        case "save_project":
          result = saveRemoteProject(parsed.data.alias, parsed.data.root);
          break;
        case "remove_project":
          result = removeRemoteProject(parsed.data.projectId);
          break;
      }
      res.json(redactStructured(result));
    } catch (error) {
      jsonError(res, 400, "remote_action_failed", error instanceof Error ? error.message : String(error));
    }
  });

  app.all("/admin/remotes", (_req, res) => {
    jsonError(res, 405, "method_not_allowed", "Use GET or POST for /admin/remotes.");
  });

  app.get("/admin/computer", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(redactStructured(await computerUse.overview()));
    } catch (error) {
      jsonError(res, 400, "computer_use_unavailable", error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/admin/computer", adminRateLimit, adminBodyLimit, express.json({ limit: "16kb" }), async (req, res) => {
    const parsed = AdminComputerCommand.safeParse(req.body ?? {});
    if (!parsed.success) {
      jsonError(res, 400, "invalid_computer_command", "Choose a supported native Computer Use action.", parsed.error.flatten());
      return;
    }
    try {
      switch (parsed.data.action) {
        case "request_permissions":
          res.json({ ...(await computerUse.requestSystemPermissions()), message: "macOS permission request opened. Review it on this computer." });
          return;
        case "decide_access":
          computerUse.decideAccess(parsed.data.requestId, parsed.data.decision);
          break;
        case "decide_action":
          computerUse.decideAction(parsed.data.requestId, parsed.data.approve);
          break;
        case "revoke":
          computerUse.revoke(parsed.data.bundleId);
          break;
      }
      res.json({ ...(await computerUse.overview()), message: "Computer Use policy updated." });
    } catch (error) {
      jsonError(res, 400, "computer_action_failed", error instanceof Error ? error.message : String(error));
    }
  });

  app.all("/admin/computer", (_req, res) => {
    jsonError(res, 405, "method_not_allowed", "Use GET or POST for /admin/computer.");
  });

  app.get("/admin/browser", (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(redactStructured(browserUse.overview(req.query.take === "1" || req.query.take === "true")));
    } catch (error) {
      jsonError(res, 400, "browser_unavailable", error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/admin/browser", adminRateLimit, adminBodyLimit, express.json({ limit: "16kb" }), (req, res) => {
    const parsed = AdminBrowserCommand.safeParse(req.body ?? {});
    if (!parsed.success) {
      jsonError(res, 400, "invalid_browser_command", "Choose a supported native Browser approval action.", parsed.error.flatten());
      return;
    }
    try {
      switch (parsed.data.action) {
        case "decide_host": browserUse.decideHost(parsed.data.requestId, parsed.data.decision); break;
        case "decide_action": browserUse.decideAction(parsed.data.requestId, parsed.data.approve); break;
        case "revoke": browserUse.revoke(parsed.data.origin); break;
        case "add_comment": browserUse.addComment(parsed.data.sessionId, parsed.data.selector, parsed.data.target, parsed.data.note); break;
        case "remove_comment": browserUse.removeComment(parsed.data.commentId); break;
      }
      res.json({ ...browserUse.overview(false), message: "Browser policy updated." });
    } catch (error) {
      jsonError(res, 400, "browser_action_failed", error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/admin/browser/complete", adminRateLimit, express.json({ limit: "12mb" }), (req, res) => {
    const parsed = AdminBrowserCompletion.safeParse(req.body ?? {});
    if (!parsed.success) {
      jsonError(res, 400, "invalid_browser_completion", "The native browser result was invalid.", parsed.error.flatten());
      return;
    }
    try {
      browserUse.completeCommand(parsed.data.commandId, parsed.data.ok, parsed.data.result, parsed.data.error);
      res.json({ ok: true });
    } catch (error) {
      jsonError(res, 400, "browser_completion_failed", error instanceof Error ? error.message : String(error));
    }
  });

  app.all(["/admin/browser", "/admin/browser/complete"], (_req, res) => {
    jsonError(res, 405, "method_not_allowed", "Use GET or POST for the browser administration API.");
  });

  app.get("/admin/changes", async (req, res) => {
    const parsed = AdminChangesQuery.safeParse(req.query);
    if (!parsed.success) {
      jsonError(res, 400, "invalid_changes_query", "Invalid changes query.", parsed.error.flatten());
      return;
    }
    try {
      const workspace = workspaces.defaultWorkspace();
      const staged = parsed.data.staged === "true" || parsed.data.staged === "1";
      res.setHeader("Cache-Control", "no-store");
      res.json(await desktopChangesResponse(config, guard, workspace, parsed.data.path, staged));
    } catch (error) {
      jsonError(res, 400, "changes_unavailable", error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/admin/changes", adminRateLimit, adminBodyLimit, express.json({ limit: "32kb" }), async (req, res) => {
    const parsed = AdminChangesCommand.safeParse(req.body ?? {});
    if (!parsed.success) {
      jsonError(res, 400, "invalid_changes_command", "Invalid changes command.", parsed.error.flatten());
      return;
    }
    try {
      const workspace = workspaces.defaultWorkspace();
      if (["stage", "unstage", "discard", "stage_hunk", "unstage_hunk", "discard_hunk"].includes(parsed.data.action) && config.writeMode !== "workspace") {
        jsonError(res, 403, "changes_read_only", "Changing the Git index or working tree requires workspace write mode.");
        return;
      }
      if (parsed.data.action === "comment") {
        const raw = await rawReviewDiff(config, guard, workspace, parsed.data.path, parsed.data.staged);
        const hunks = reviewHunks(raw.diff, raw.path, parsed.data.staged, raw.untracked);
        addReviewComment(guard, workspace, { ...parsed.data, hunks });
        res.json({
          ...(await desktopChangesResponse(config, guard, workspace, raw.path, parsed.data.staged)),
          message: "Inline review comment added.", action: parsed.data.action
        });
        return;
      }
      if (parsed.data.action === "delete_comment") {
        deleteReviewComment(workspace, parsed.data.commentId);
        res.json({
          ...(await desktopChangesAfterMutation(config, guard, workspace, parsed.data.path, parsed.data.staged)),
          message: "Inline review comment deleted.", action: parsed.data.action
        });
        return;
      }
      if (["stage_hunk", "unstage_hunk", "discard_hunk"].includes(parsed.data.action)) {
        const command = parsed.data as Extract<z.infer<typeof AdminChangesCommand>, { action: "stage_hunk" | "unstage_hunk" | "discard_hunk" }>;
        await runReviewHunkAction(config, guard, workspace, command);
        res.json({
          ...(await desktopChangesAfterMutation(config, guard, workspace, command.path, command.staged)),
          message: command.action === "stage_hunk" ? "Hunk staged." : command.action === "unstage_hunk" ? "Hunk unstaged." : "Hunk reverted.",
          action: command.action
        });
        return;
      }
      const command = parsed.data as Extract<z.infer<typeof AdminChangesCommand>, { action: "stage" | "unstage" | "discard" }>;
      const result = runGitWorkflow(config, guard, workspace, {
        action: command.action,
        paths: command.paths,
        includeStaged: command.includeStaged
      });
      res.json({
        ...(await desktopChangesResponse(config, guard, workspace)),
        message: `${command.paths.length} file${command.paths.length === 1 ? "" : "s"} ${command.action === "stage" ? "staged" : command.action === "unstage" ? "unstaged" : "discarded"}.`,
        action: result.action
      });
    } catch (error) {
      jsonError(res, 400, "changes_action_failed", error instanceof Error ? error.message : String(error));
    }
  });

  app.all("/admin/changes", (_req, res) => {
    jsonError(res, 405, "method_not_allowed", "Use GET or POST for /admin/changes.");
  });

  app.get("/admin/environments", (_req, res) => {
    try {
      const workspace = workspaces.defaultWorkspace();
      const environments = listLocalEnvironments(config, workspace).map((environment) => localEnvironmentSummary(environment));
      res.json({ ok: true, root: workspace.root, environments });
    } catch (error) {
      jsonError(res, 400, "environments_unavailable", error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/admin/environments", adminRateLimit, adminBodyLimit, express.json({ limit: "32kb" }), async (req, res) => {
    if (config.writeMode !== "workspace" || config.bashMode === "off") {
      jsonError(res, 403, "environments_disabled", "Local environment actions require workspace write access and bash mode.");
      return;
    }
    const parsed = AdminEnvironmentCommand.safeParse(req.body ?? {});
    if (!parsed.success) {
      jsonError(res, 400, "invalid_environment_command", "Invalid local environment command.", parsed.error.flatten());
      return;
    }
    const workspace = workspaces.defaultWorkspace();
    const terminalRoute = `desktop_${workspace.id}`;
    try {
      if (parsed.data.action === "stop") {
        const stopped = persistentTerminals.stop(terminalRoute);
        res.json({ ok: true, stopped, message: stopped ? "Environment action stopped." : "No environment action was running." });
        return;
      }
      const environment = resolveLocalEnvironment(config, workspace, parsed.data.configPath);
      if (parsed.data.action === "run") {
        if (!parsed.data.actionName) {
          jsonError(res, 400, "action_name_required", "actionName is required for run.");
          return;
        }
        const action = environmentAction(environment, parsed.data.actionName);
        const terminal = await persistentTerminals.run(
          config,
          guard,
          terminalRoute,
          workspace,
          environmentTerminalCommand(action.command, workspace.root, workspace.root),
          {
            timeoutMs: parsed.data.timeoutMs,
            wait: parsed.data.background === false,
            trustedProjectCommand: true
          }
        );
        res.json({
          ok: true,
          message: terminal.completed ? `${action.name} finished.` : `${action.name} is running in the project terminal.`,
          environment: localEnvironmentSummary(environment),
          action: action.name,
          terminal
        });
        return;
      }
      const result = await runLocalEnvironmentCommand(config, environment, {
        kind: parsed.data.action,
        cwd: workspace.root,
        sourceWorkspacePath: workspace.root,
        worktreePath: workspace.root,
        timeoutMs: parsed.data.timeoutMs
      });
      res.json({
        ok: true,
        message: `${environment.name} ${parsed.data.action} finished.`,
        environment: localEnvironmentSummary(environment),
        result
      });
    } catch (error) {
      jsonError(res, 400, "environment_action_failed", error instanceof Error ? error.message : String(error));
    }
  });

  app.all("/admin/environments", (_req, res) => {
    jsonError(res, 405, "method_not_allowed", "Use GET or POST for /admin/environments.");
  });

  app.get("/admin/worktrees", (_req, res) => {
    try {
      res.json({ ok: true, worktrees: listManagedWorktrees(config, workspaces.defaultWorkspace()) });
    } catch (error) {
      jsonError(res, 400, "worktrees_unavailable", error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/admin/worktrees", adminRateLimit, adminBodyLimit, express.json({ limit: "32kb" }), async (req, res) => {
    if (config.writeMode !== "workspace") {
      jsonError(res, 403, "worktrees_disabled", "Managed worktrees require workspace write mode.");
      return;
    }
    const parsed = AdminWorktreeCommand.safeParse(req.body ?? {});
    if (!parsed.success) {
      jsonError(res, 400, "invalid_worktree_command", "Invalid managed worktree command.", parsed.error.flatten());
      return;
    }
    try {
      const workspace = workspaces.defaultWorkspace();
      if (parsed.data.action === "create") {
        const environment = parsed.data.environmentConfigPath
          ? resolveLocalEnvironment(config, workspace, parsed.data.environmentConfigPath)
          : undefined;
        const created = await createManagedWorktree(config, workspace, {
          baseRef: parsed.data.baseRef,
          includeChanges: parsed.data.includeChanges,
          environment,
          setupTimeoutMs: parsed.data.setupTimeoutMs
        });
        res.json({
          ok: true,
          message: "Managed worktree created.",
          worktree: created.worktree,
          worktrees: listManagedWorktrees(config, workspace)
        });
        return;
      }
      if (!parsed.data.worktreeId) {
        jsonError(res, 400, "worktree_id_required", "worktreeId is required for remove.");
        return;
      }
      const removed = await removeManagedWorktree(config, workspace, parsed.data.worktreeId);
      res.json({
        ok: true,
        message: removed.snapshotPath ? "Managed worktree removed and its tracked changes were snapshotted." : "Managed worktree removed.",
        removed,
        worktrees: listManagedWorktrees(config, workspace)
      });
    } catch (error) {
      jsonError(res, 400, "worktree_action_failed", error instanceof Error ? error.message : String(error));
    }
  });

  app.all("/admin/worktrees", (_req, res) => {
    jsonError(res, 405, "method_not_allowed", "Use GET or POST for /admin/worktrees.");
  });

  app.post("/admin/chats", adminRateLimit, adminBodyLimit, express.json({ limit: "32kb" }), (req, res) => {
    const parsed = AdminChatCommand.safeParse(req.body ?? {});
    if (!parsed.success) {
      jsonError(res, 400, "invalid_chat_command", "Invalid chat lifecycle command.", parsed.error.flatten());
      return;
    }
    try {
      const { action, chatId } = parsed.data;
      if (action === "rename" && parsed.data.title === undefined) {
        jsonError(res, 400, "chat_title_required", "title is required for rename.");
        return;
      }
      if ((action === "pin" || action === "archive") && parsed.data.value === undefined) {
        jsonError(res, 400, "chat_value_required", "value is required for pin or archive.");
        return;
      }
      const session = runtimeMonitor.updateSession(chatId, {
        ...(action === "rename" ? { title: parsed.data.title } : {}),
        ...(action === "pin" ? { pinned: parsed.data.value } : {}),
        ...(action === "archive" ? { archived: parsed.data.value } : {})
      });
      res.json({ ok: true, message: `Chat ${action} updated.`, session });
    } catch (error) {
      jsonError(res, 404, "chat_action_failed", error instanceof Error ? error.message : String(error));
    }
  });

  app.all("/admin/chats", (_req, res) => {
    jsonError(res, 405, "method_not_allowed", "Use POST for /admin/chats.");
  });

  app.post("/mcp", express.json({ limit: "20mb" }), async (req, res) => {
    try {
      const sessionId = requestSessionId(req);
      let transport: StreamableHTTPServerTransport;

      const existingTransport = getTransport(sessionId);
      if (existingTransport) {
        transport = existingTransport;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        const monitorSession = runtimeMonitor.beginSession();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId: string) => {
            monitorSession.bindTransport(newSessionId);
            pruneTransports();
            transports.set(newSessionId, {
              transport,
              monitorSession,
              createdAt: Date.now(),
              lastSeenAt: Date.now()
            });
            pruneTransports();
          }
        } as any);

        (transport as any).onclose = () => {
          const closedSessionId = (transport as any).sessionId;
          if (closedSessionId) transports.delete(closedSessionId);
          monitorSession.close();
        };

        const server = createCodexFlowServer(config, {
          onWorkspaceChanged: (workspace) => monitorSession.selectProject(runtimeProject(workspace)),
          onTaskProgress: (event) => {
            monitorSession.selectProject(runtimeProject(event.workspace), event.routeId);
            runtimeMonitor.updateRouteTask(event.routeId, event.task);
          },
          onAgentProgress: (event) => {
            monitorSession.selectProject(runtimeProject(event.workspace), event.parentRouteId);
            return runtimeMonitor.mutateRouteAgent(event.parentRouteId, event.sourceRouteId, event.command);
          },
          onToolCall: (event) => {
            if (event.workspace) monitorSession.selectProject(runtimeProject(event.workspace), event.routeId);
            monitorSession.recordTool({
              name: event.name,
              status: event.status,
              durationMs: event.durationMs,
              at: event.at,
              routeId: event.routeId
            });
          }
        });
        try {
          await server.connect(transport);
        } catch (error) {
          monitorSession.close();
          throw error;
        }
      } else {
        sendSessionError(res, sessionId);
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal CodexFlow MCP error. Check the local terminal for details." },
          id: null
        });
      }
    }
  });

  const handleSessionRequest = async (req: express.Request, res: express.Response) => {
    const sessionId = requestSessionId(req);
    const transport = getTransport(sessionId);
    if (!transport) {
      sendSessionError(res, sessionId);
      return;
    }
    await transport.handleRequest(req, res);
  };

  app.get("/mcp", handleSessionRequest);
  app.delete("/mcp", handleSessionRequest);

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!error || typeof error !== "object" || !("type" in error)) {
      next(error);
      return;
    }
    const type = String((error as { type?: unknown }).type ?? "");
    if (type !== "entity.parse.failed" && type !== "entity.too.large") {
      next(error);
      return;
    }
    const status = type === "entity.too.large" ? 413 : 400;
    if (req.path === "/mcp") {
      res.status(status).json({
        jsonrpc: "2.0",
        error: {
          code: type === "entity.too.large" ? -32000 : -32700,
          message: type === "entity.too.large" ? "Payload too large." : "Parse error."
        },
        id: null
      });
      return;
    }
    if (req.path === "/admin/profile" || req.path === "/admin/remotes" || req.path === "/admin/computer" || req.path === "/admin/browser" || req.path === "/admin/browser/complete" || req.path === "/admin/changes" || req.path === "/admin/environments" || req.path === "/admin/worktrees" || req.path === "/admin/chats") {
      jsonError(
        res,
        status,
        type === "entity.too.large" ? "payload_too_large" : "invalid_json",
        type === "entity.too.large" ? "Request body is too large." : "Request body must be valid JSON."
      );
      return;
    }
    next(error);
  });

  app.listen(config.port, config.host, () => {
    console.error(`[CodexFlow] HTTP MCP listening on http://${config.host}:${config.port}/mcp`);
    console.error(`[CodexFlow] defaultRoot=${config.defaultRoot}`);
    console.error(`[CodexFlow] allowedRoots=${config.allowedRoots.join(", ")}`);
    console.error(`[CodexFlow] bashMode=${config.bashMode}`);
    console.error(`[CodexFlow] writeMode=${config.writeMode}`);
    console.error(`[CodexFlow] widgetDomain=${config.widgetDomain}`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
