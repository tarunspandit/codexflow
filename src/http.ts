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
import { workspaceIdForRoot, type Workspace } from "./guard.js";
import { RuntimeMonitor, type RuntimeSessionHandle } from "./runtimeMonitor.js";
import { CODEXFLOW_VERSION } from "./version.js";
import { renderLocalAppPage } from "./localAppPage.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function copyCommand(title: string, description: string, command: string, displayCommand = command, copyKind = ""): string {
  const copyAttrs = copyKind
    ? `data-copy-kind="${escapeHtml(copyKind)}" data-copy-base="${escapeHtml(command)}"`
    : `data-copy="${escapeHtml(command)}"`;
  return `<div class="control">
    <div>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(description)}</p>
      <code>${escapeHtml(displayCommand)}</code>
    </div>
    <button type="button" class="copy-mini" ${copyAttrs}>Copy</button>
  </div>`;
}

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
  if (!raw) return "";
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
    widgetDomain: String(profile.widgetDomain ?? config.widgetDomain),
    noInstallCloudflared: Boolean(profile.noInstallCloudflared)
  };
}

const OPTION_LABELS: Record<string, string> = {
  cloudflare: "Cloudflare quick tunnel",
  ngrok: "ngrok stable URL",
  "cloudflare-named": "Cloudflare named tunnel",
  tailscale: "Tailscale Funnel",
  none: "Local only",
  agent: "Agent",
  handoff: "Handoff",
  pro: "Pro bundle",
  safe: "Safe",
  off: "Off",
  full: "Full",
  compact: "Compact",
  metadata: "Metadata",
  read: "Read",
  workspace: "Workspace",
  minimal: "Minimal",
  standard: "Standard"
};

function optionLabel(value: string): string {
  return OPTION_LABELS[value] ?? value;
}

function selectOptions(values: readonly string[], current: string): string {
  return values
    .map((value) => `<option value="${escapeHtml(value)}"${value === current ? " selected" : ""}>${escapeHtml(optionLabel(value))}</option>`)
    .join("");
}

function serverUrlDisplay(endpoint: string | undefined, authEnabled: boolean): string {
  if (!endpoint) return "";
  const safeEndpoint = redactSensitiveText(endpoint);
  if (!authEnabled) return safeEndpoint;
  const glue = safeEndpoint.includes("?") ? "&" : "?";
  return `${safeEndpoint}${glue}codexflow_token=<redacted>`;
}

function currentTunnelMessage(tunnel: TunnelMode, endpoint: string): string {
  if (endpoint) {
    if (tunnel === "cloudflare") return "Cloudflare generated this URL for the current run. Quick tunnel URLs change after restart.";
    if (tunnel === "ngrok") return "ngrok is using the saved public hostname for this run.";
    if (tunnel === "cloudflare-named") return "Cloudflare named tunnel is using the saved public hostname for this run.";
    if (tunnel === "tailscale") return "Tailscale Funnel is using the saved ts.net hostname for this run.";
    return "Local-only endpoint for clients that can reach this machine.";
  }
  if (tunnel === "cloudflare") return "Cloudflare quick tunnels print a generated URL after the tunnel opens.";
  if (tunnel === "ngrok") return "Enter your reserved ngrok domain, or set NGROK_DOMAIN before starting CodexFlow.";
  if (tunnel === "cloudflare-named") return "Enter the Cloudflare hostname routed to your named tunnel.";
  if (tunnel === "tailscale") return "Enter the Tailscale Funnel hostname for this device, for example machine.tailnet.ts.net.";
  return "No public tunnel is saved; local MCP clients can use the local URL.";
}

function profileForm(config: CodexFlowConfig): string {
  const profile = readWorkspaceProfile(config.defaultRoot);
  const values = profileValues(config, profile);
  const runtime = readRuntimeConnection(config.defaultRoot);
  const profilePath = profile.profilePath ?? profilePathForRoot(config.defaultRoot);
  const savedLabel = profile.profilePath ? "saved" : "not saved yet";
  const runtimeEndpoint = endpointBase(runtime.endpoint);
  const runtimeTunnel = oneOf(runtime.tunnel ?? values.tunnel, TUNNELS, values.tunnel);
  const runtimeUrl = serverUrlDisplay(runtimeEndpoint, Boolean(config.authToken));
  const savedEndpoint = values.hostname ? `https://${values.hostname}/mcp` : "";
  const savedUrl = serverUrlDisplay(savedEndpoint, Boolean(config.authToken));
  const ngrokHostname = process.env.NGROK_DOMAIN ?? (values.tunnel === "ngrok" ? values.hostname : "");
  const cloudflareHostname =
    process.env.CODEXFLOW_PUBLIC_HOSTNAME ??
    process.env.CODEXFLOW_HOSTNAME ??
    (values.tunnel === "cloudflare-named" ? values.hostname : "");
  const currentUrlBlock = runtimeUrl
    ? `<div class="current-url">
        <div>
          <span>Current Server URL</span>
          <code>${escapeHtml(runtimeUrl)}</code>
          <p>${escapeHtml(currentTunnelMessage(runtimeTunnel, runtimeEndpoint))}</p>
        </div>
        <button type="button" class="copy-mini" data-copy-kind="server-url" data-copy-base="${escapeHtml(redactSensitiveText(runtimeEndpoint))}">Copy</button>
      </div>`
    : `<div class="current-url idle">
        <div>
          <span>${savedUrl ? "Saved Server URL preview" : "Current Server URL"}</span>
          <code>${savedUrl ? escapeHtml(savedUrl) : "No public URL detected for this run"}</code>
          <p>${escapeHtml(savedUrl ? "This is based on the saved hostname. It becomes current after the launcher starts that tunnel." : currentTunnelMessage(values.tunnel, ""))}</p>
        </div>
        ${savedEndpoint ? `<button type="button" class="copy-mini" data-copy-kind="server-url" data-copy-base="${escapeHtml(redactSensitiveText(savedEndpoint))}">Copy</button>` : ""}
      </div>`;
  return `<section class="panel profile-panel" id="profile">
      <div class="section-head">
        <div>
          <h2>Next-launch profile</h2>
          <p>Optional advanced defaults for the next run. CodexFlow is already ready without changing these settings.</p>
        </div>
        <span class="pill ${profile.profilePath ? "" : "warn"}">${escapeHtml(savedLabel)}</span>
      </div>
      <form class="profile-form" data-profile-form>
        ${currentUrlBlock}
        <fieldset class="profile-group">
          <legend>Connection</legend>
          <p>Choose how ChatGPT reaches this local MCP server. Stable providers use the saved hostname; quick Cloudflare generates the URL at launch.</p>
          <div class="form-grid">
            <label><span>Tunnel</span><select name="tunnel" data-tunnel-select data-ngrok-hostname="${escapeHtml(ngrokHostname)}" data-cloudflare-hostname="${escapeHtml(cloudflareHostname)}">${selectOptions(TUNNELS, values.tunnel)}</select></label>
            <label><span>Public hostname</span><input name="hostname" value="${escapeHtml(values.hostname)}" data-hostname-input data-autofilled="0"></label>
            <label><span>Port</span><input name="port" type="number" min="1" max="65535" value="${escapeHtml(values.port)}"></label>
            <label><span>Mode</span><select name="mode">${selectOptions(MODES, values.mode)}</select></label>
            <label><span>Cloudflare tunnel name</span><input name="tunnelName" value="${escapeHtml(values.tunnelName)}"></label>
            <label><span>ngrok config file</span><input name="ngrokConfig" value="${escapeHtml(values.ngrokConfig)}"></label>
            <label><span>Cloudflare config file</span><input name="cloudflareConfig" value="${escapeHtml(values.cloudflareConfig)}"></label>
            <label><span>Cloudflare token file</span><input name="cloudflareTokenFile" value="${escapeHtml(values.cloudflareTokenFile)}"></label>
          </div>
          <p class="field-help" data-hostname-help>${escapeHtml(currentTunnelMessage(values.tunnel, runtimeEndpoint))}</p>
          <label class="check-row"><input name="noInstallCloudflared" type="checkbox" value="true"${values.noInstallCloudflared ? " checked" : ""}><span>Do not auto-install cloudflared</span></label>
        </fieldset>
        <fieldset class="profile-group">
          <legend>Runtime policy</legend>
          <p>Save the default access level for the next launch. These settings do not mutate the process that is already running.</p>
          <div class="form-grid">
            <label><span>Bash</span><select name="bash">${selectOptions(BASH_MODES, values.bash)}</select></label>
            <label><span>Write mode</span><select name="write">${selectOptions(WRITE_MODES, values.write)}</select></label>
            <label><span>Tool mode</span><select name="toolMode">${selectOptions(TOOL_MODES, values.toolMode)}</select></label>
            <label><span>Codex sessions</span><select name="codexSessions">${selectOptions(CODEX_SESSIONS, values.codexSessions)}</select></label>
            <label><span>Codex directory</span><input name="codexDir" value="${escapeHtml(values.codexDir)}"></label>
            <label><span>Bash session</span><input name="bashSession" value="${escapeHtml(values.bashSession)}"></label>
          </div>
          <label class="check-row"><input name="toolCards" type="checkbox" value="true"${values.toolCards ? " checked" : ""}><span>Enable ChatGPT tool cards</span></label>
          <label class="check-row"><input name="requireBashSession" type="checkbox" value="true"${values.requireBashSession ? " checked" : ""}><span>Require matching bash session id</span></label>
        </fieldset>
        <fieldset class="profile-group readonly-group">
          <legend>Read-only this run</legend>
          <div class="readonly-grid">
            <div><span>Bash transcript</span><code>${escapeHtml(values.bashTranscript)}</code></div>
            <div><span>Widget origin</span><code>${escapeHtml(values.widgetDomain)}</code></div>
          </div>
        </fieldset>
        <div class="actions">
          <button type="submit" class="primary">Save profile</button>
          <span class="mono">${escapeHtml(profilePath)}</span>
        </div>
        <p class="note" data-profile-status>Tokens stay hidden. Restart CodexFlow for saved profile changes to apply.</p>
      </form>
    </section>`;
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
    summary: {
      projects: projects.length,
      active_sessions: monitored.active_sessions,
      recent_sessions: monitored.recent_sessions,
      activity_events: monitored.activity.length
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
  const rootArg = shellQuote(config.defaultRoot);
  const sessionArg = shellQuote(config.bashSessionId || "main");
  const githubUrl = "https://github.com/tarunspandit/codexflow";
  const npmUrl = "https://www.npmjs.com/package/@tarunspandit/codexflow";
  const docsUrl = "https://tarunspandit.github.io/codexflow/";
  const chatgptUrl = "https://chatgpt.com/#settings/Connectors";
  const controls = [
    copyCommand("Restart CodexFlow", "The bare command rediscovers Codex projects and starts the broker and tunnel automatically.", "codexflow"),
    copyCommand("Copy local MCP URL", "Useful for a local MCP client. ChatGPT usually needs the public tunnel URL copied by the terminal.", localMcp, localMcpDisplay, "local-mcp"),
    copyCommand("Start without bash", "Restart with file tools but no ChatGPT-triggered bash tool.", `codexflow --root ${rootArg} --no-bash`),
    copyCommand("Require explicit bash target", "Restart so bash calls must include this matching session_id.", `codexflow --root ${rootArg} --bash-session ${sessionArg} --require-bash-session`),
    copyCommand("Show Codex session list", "Restart with read-only local Codex session metadata in full tool mode.", `codexflow --root ${rootArg} --tool-mode full --codex-sessions metadata`),
    copyCommand("Read Codex transcripts", "Restart with bounded local transcript reads from Codex JSONL history.", `codexflow --root ${rootArg} --tool-mode full --codex-sessions read`),
    copyCommand("Use full bash transcript", "Restart with the raw stdout/stderr transcript instead of compact tool cards.", `codexflow --root ${rootArg} --bash-transcript full`)
  ].join("");
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
    profileHtml: profileForm(config),
    controlsHtml: controls,
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
  const runtimeMonitor = new RuntimeMonitor();
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
      res.json(await applicationOverview(config, runtimeMonitor, startedAt, refresh));
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
          onToolCall: (event) => {
            if (event.workspace) monitorSession.selectProject(runtimeProject(event.workspace));
            monitorSession.recordTool(event);
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
    if (req.path === "/admin/profile") {
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
