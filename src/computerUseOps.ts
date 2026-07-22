import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodexFlowError } from "./guard.js";
import { codexFlowHome } from "./profileStore.js";
import { hasSecretValue, redactSensitiveText } from "./redact.js";

export interface ComputerHelperStatus {
  available: boolean;
  platform: string;
  screen_recording: boolean;
  accessibility: boolean;
  error?: string;
}

export interface ComputerApp {
  bundle_id: string;
  name: string;
  pid: number;
  active: boolean;
  prohibited: boolean;
  prohibited_reason?: string;
}

interface TrustedComputerApp extends ComputerApp { identity: string }

interface HelperElement {
  path: number[];
  role: string;
  subrole?: string;
  title?: string;
  value?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  actions: string[];
}

interface StoredApproval { bundleId: string; name: string; identity: string; approvedAt: string }
interface ApprovalStore { version: 1; alwaysAllowed: StoredApproval[] }

export interface ComputerAccessRequest {
  id: string;
  bundle_id: string;
  app_name: string;
  reason: string;
  route_display: string;
  created_at: string;
  expires_at: string;
}

export interface ComputerActionRequest {
  id: string;
  bundle_id: string;
  app_name: string;
  operation: string;
  target: string;
  value_preview?: string;
  route_display: string;
  created_at: string;
  expires_at: string;
}

interface PrivateAccessRequest extends ComputerAccessRequest { routeId: string; identity: string }
interface PrivateActionRequest extends ComputerActionRequest {
  routeId: string;
  fingerprint: string;
  approved: boolean;
}
interface SnapshotRecord {
  routeId: string;
  bundleId: string;
  appName: string;
  pid: number;
  identity: string;
  createdAt: number;
  elements: Map<string, HelperElement>;
}

const REQUEST_TTL_MS = 10 * 60_000;
const SNAPSHOT_TTL_MS = 90_000;
const ACTION_TTL_MS = 3 * 60_000;
const MAX_HELPER_OUTPUT_BYTES = 12 * 1024 * 1024;
const MAX_AUDIT_EVENTS = 100;

const PROHIBITED_BUNDLE_IDS = new Map<string, string>([
  ["com.apple.Terminal", "Terminal apps cannot be automated because that could bypass CodexFlow shell policy."],
  ["com.googlecode.iterm2", "Terminal apps cannot be automated because that could bypass CodexFlow shell policy."],
  ["com.github.wez.wezterm", "Terminal apps cannot be automated because that could bypass CodexFlow shell policy."],
  ["com.openai.chat", "ChatGPT cannot be automated because that could bypass ChatGPT approvals."],
  ["com.openai.codex", "ChatGPT/Codex cannot be automated because that could bypass ChatGPT approvals."],
  ["com.flow7.codexflow", "CodexFlow cannot automate its own approval surface."],
  ["com.apple.systempreferences", "System privacy and security settings must be changed by the user."],
  ["com.apple.Safari", "Browser apps require the separate website-host permission boundary."],
  ["com.google.Chrome", "Browser apps require the separate website-host permission boundary."],
  ["com.microsoft.edgemac", "Browser apps require the separate website-host permission boundary."],
  ["org.mozilla.firefox", "Browser apps require the separate website-host permission boundary."],
  ["company.thebrowser.Browser", "Browser apps require the separate website-host permission boundary."],
  ["com.microsoft.terminal", "Terminal apps cannot be automated because that could bypass CodexFlow shell policy."],
  ["com.windows.browser.msedge", "Browser apps require the separate website-host permission boundary."],
  ["com.windows.browser.chrome", "Browser apps require the separate website-host permission boundary."],
  ["com.windows.browser.firefox", "Browser apps require the separate website-host permission boundary."],
  ["com.windows.browser.brave", "Browser apps require the separate website-host permission boundary."]
]);

function statePath(): string { return path.join(codexFlowHome(), "computer-use.json"); }
function routeDisplay(routeId: string): string { return `route-${createHash("sha256").update(routeId).digest("hex").slice(0, 8)}`; }
function opaqueId(prefix: string): string { return `${prefix}_${randomBytes(8).toString("hex")}`; }
function nowIso(): string { return new Date().toISOString(); }

function readStore(): ApprovalStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8")) as Partial<ApprovalStore>;
    const values = Array.isArray(parsed.alwaysAllowed) ? parsed.alwaysAllowed : [];
    return {
      version: 1,
      alwaysAllowed: values.filter((value): value is StoredApproval => Boolean(
        value && typeof value.bundleId === "string" && value.bundleId.length <= 300 &&
        typeof value.name === "string" && value.name.length <= 300 && typeof value.identity === "string" && value.identity.length <= 1000 &&
        typeof value.approvedAt === "string"
      )).slice(-200)
    };
  } catch { return { version: 1, alwaysAllowed: [] }; }
}

function writeStore(store: ApprovalStore): void {
  const target = statePath();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, alwaysAllowed: store.alwaysAllowed.slice(-200) }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  try { fs.chmodSync(target, 0o600); } catch { /* best effort */ }
}

function helperCandidates(): string[] {
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const windowsInstallRoot = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "CodexFlow")
    : path.join(os.homedir(), "AppData", "Local", "CodexFlow");
  return [
    process.env.CODEXFLOW_COMPUTER_HELPER ?? "",
    path.join(process.env.CODEXFLOW_DESKTOP_INSTALL_DIR ?? path.join(os.homedir(), "Applications"), "CodexFlow.app", "Contents", "Helpers", "CodexFlowComputer"),
    path.join(moduleRoot, "desktop", "prebuilt", "CodexFlow.app", "Contents", "Helpers", "CodexFlowComputer"),
    path.join(process.env.CODEXFLOW_DESKTOP_INSTALL_DIR ?? windowsInstallRoot, "CodexFlowComputer.exe"),
    path.join(moduleRoot, "desktop", "prebuilt", "windows", "CodexFlowComputer.exe")
  ].filter(Boolean);
}

function helperPath(): string {
  if (!["darwin", "win32"].includes(process.platform) && !process.env.CODEXFLOW_COMPUTER_HELPER) {
    throw new CodexFlowError("Computer Use requires the native CodexFlow app on macOS or Windows.");
  }
  const found = helperCandidates().find((candidate) => {
    try {
      const stat = fs.statSync(candidate);
      return stat.isFile() && (process.platform === "win32" || (stat.mode & 0o111) !== 0);
    }
    catch { return false; }
  });
  if (!found) throw new CodexFlowError("The CodexFlow Computer helper is unavailable. Reopen CodexFlow to refresh the installed native app.");
  return found;
}

async function callHelper<T extends Record<string, unknown>>(request: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  const executable = helperPath();
  return new Promise<T>((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new CodexFlowError("The native Computer Use helper timed out."));
    }, timeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_HELPER_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(new CodexFlowError("The native Computer Use response exceeded its safety limit."));
      } else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => { if (Buffer.concat(stderr).length < 32_000) stderr.push(chunk); });
    child.on("error", (error) => finish(new CodexFlowError(`The native Computer Use helper failed: ${error.message}`)));
    child.on("exit", (code) => {
      if (settled) return;
      try {
        const parsed = JSON.parse(Buffer.concat(stdout).toString("utf8")) as T & { ok?: boolean; error?: string };
        if (code !== 0 || parsed.ok === false) throw new Error(parsed.error || Buffer.concat(stderr).toString("utf8") || `helper exited with ${code}`);
        finish(undefined, parsed);
      } catch (error) {
        finish(new CodexFlowError(redactSensitiveText(error instanceof Error ? error.message : String(error))));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

function prohibitedReason(bundleId: string): string | undefined {
  return PROHIBITED_BUNDLE_IDS.get(bundleId);
}

function cleanApps(values: unknown): TrustedComputerApp[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value): TrustedComputerApp[] => {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const bundleId = String(record.bundle_id ?? record.bundleId ?? "").trim();
    const name = String(record.name ?? "").trim();
    const pid = Number(record.pid);
    if (!bundleId || !name || !Number.isInteger(pid)) return [];
    const reason = prohibitedReason(bundleId);
    const identity = String(record.identity ?? "").trim();
    if (!identity || identity.length > 1000) return [];
    return [{ bundle_id: bundleId, name, pid, active: Boolean(record.active), prohibited: Boolean(reason), ...(reason ? { prohibited_reason: reason } : {}), identity }];
  }).slice(0, 200);
}

function cleanElements(values: unknown): HelperElement[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value): HelperElement[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (!Array.isArray(item.path) || !item.path.every((index) => Number.isInteger(index) && Number(index) >= 0)) return [];
    const role = String(item.role ?? "").slice(0, 100);
    if (!role) return [];
    return [{
      path: item.path.map(Number).slice(0, 20), role,
      ...(typeof item.subrole === "string" ? { subrole: item.subrole.slice(0, 100) } : {}),
      ...(typeof item.title === "string" ? { title: redactSensitiveText(item.title.slice(0, 300)) } : {}),
      ...(typeof item.value === "string" ? { value: redactSensitiveText(item.value.slice(0, 500)) } : {}),
      ...(Number.isFinite(item.x) ? { x: Number(item.x) } : {}), ...(Number.isFinite(item.y) ? { y: Number(item.y) } : {}),
      ...(Number.isFinite(item.width) ? { width: Number(item.width) } : {}), ...(Number.isFinite(item.height) ? { height: Number(item.height) } : {}),
      actions: Array.isArray(item.actions) ? item.actions.map(String).slice(0, 20) : []
    }];
  }).slice(0, 240);
}

export class ComputerUseManager {
  private accessRequests = new Map<string, PrivateAccessRequest>();
  private onceAllowed = new Map<string, number>();
  private snapshots = new Map<string, SnapshotRecord>();
  private actionRequests = new Map<string, PrivateActionRequest>();
  private audit: Array<{ at: string; route_display: string; app_name: string; operation: string; outcome: string }> = [];

  private prune(): void {
    const now = Date.now();
    for (const [id, request] of this.accessRequests) if (Date.parse(request.expires_at) <= now) this.accessRequests.delete(id);
    for (const [key, expires] of this.onceAllowed) if (expires <= now) this.onceAllowed.delete(key);
    for (const [id, snapshot] of this.snapshots) if (snapshot.createdAt + SNAPSHOT_TTL_MS <= now) this.snapshots.delete(id);
    for (const [id, request] of this.actionRequests) if (Date.parse(request.expires_at) <= now) this.actionRequests.delete(id);
  }

  private record(routeId: string, appName: string, operation: string, outcome: string): void {
    this.audit.push({ at: nowIso(), route_display: routeDisplay(routeId), app_name: appName, operation, outcome });
    if (this.audit.length > MAX_AUDIT_EVENTS) this.audit.splice(0, this.audit.length - MAX_AUDIT_EVENTS);
  }

  async status(): Promise<ComputerHelperStatus> {
    try {
      const result = await callHelper<Record<string, unknown>>({ action: "status" });
      return {
        available: true,
        platform: String(result.platform ?? process.platform),
        screen_recording: Boolean(result.screen_recording),
        accessibility: Boolean(result.accessibility)
      };
    } catch (error) {
      return { available: false, platform: process.platform, screen_recording: false, accessibility: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async requestSystemPermissions(): Promise<ComputerHelperStatus> {
    const result = await callHelper<Record<string, unknown>>({ action: "request_permissions" }, 45_000);
    return { available: true, platform: String(result.platform ?? process.platform), screen_recording: Boolean(result.screen_recording), accessibility: Boolean(result.accessibility) };
  }

  private async listApps(): Promise<TrustedComputerApp[]> {
    const result = await callHelper<Record<string, unknown>>({ action: "list_apps" });
    return cleanApps(result.apps);
  }

  overview = async (): Promise<Record<string, unknown>> => {
    this.prune();
    const [status, apps] = await Promise.all([this.status(), this.listApps().catch(() => [])]);
    return {
      ok: true, status, apps: apps.map(({ identity: _identity, ...app }) => app),
      always_allowed: readStore().alwaysAllowed.map((approval) => ({ bundle_id: approval.bundleId, app_name: approval.name, approved_at: approval.approvedAt })),
      access_requests: [...this.accessRequests.values()].map(({ routeId: _routeId, identity: _identity, ...request }) => request),
      action_requests: [...this.actionRequests.values()].filter((request) => !request.approved).map(({ routeId: _routeId, fingerprint: _fingerprint, approved: _approved, ...request }) => request),
      recent_activity: [...this.audit].reverse()
    };
  };

  async routeStatus(routeId: string): Promise<Record<string, unknown>> {
    this.prune();
    const status = await this.status();
    const apps = await this.listApps().catch(() => []);
    const stored = readStore().alwaysAllowed;
    const always = apps.filter((app) => stored.some((approval) => approval.bundleId === app.bundle_id && approval.identity === app.identity))
      .map((app) => ({ bundle_id: app.bundle_id, app_name: app.name }));
    const once = apps.filter((app) => (this.onceAllowed.get(`${routeId}\0${app.bundle_id}\0${app.identity}`) ?? 0) > Date.now())
      .map((app) => ({ bundle_id: app.bundle_id, app_name: app.name }));
    const pending = [...this.accessRequests.values()]
      .filter((request) => request.routeId === routeId)
      .map((request) => ({ request_id: request.id, bundle_id: request.bundle_id, app_name: request.app_name, expires_at: request.expires_at }));
    return { status, allowed_apps: [...always, ...once], pending_requests: pending };
  }

  async requestAccess(routeId: string, appQuery: string, reason: string): Promise<Record<string, unknown>> {
    this.prune();
    const query = appQuery.trim().toLowerCase();
    if (!query || !reason.trim()) throw new CodexFlowError("Name the target app and the scoped reason for access.");
    if (reason.length > 500 || hasSecretValue(reason)) throw new CodexFlowError("The access reason must be at most 500 characters and cannot contain a credential.");
    const apps = await this.listApps();
    const matches = apps.filter((app) => app.bundle_id.toLowerCase() === query || app.name.toLowerCase() === query);
    if (matches.length !== 1) {
      if (!matches.length) throw new CodexFlowError("That app is not running or its exact name was not found. Open it, then retry with its exact app name.");
      throw new CodexFlowError("More than one running app matches that name. Retry with the bundle identifier shown in the native Computer view.");
    }
    const app = matches[0]!;
    if (app.prohibited) throw new CodexFlowError(app.prohibited_reason!);
    if (this.allowed(routeId, app.bundle_id, app.identity)) return { status: "allowed", bundle_id: app.bundle_id, app_name: app.name };
    const existing = [...this.accessRequests.values()].find((request) => request.routeId === routeId && request.bundle_id === app.bundle_id);
    if (existing) return { status: "pending", request_id: existing.id, bundle_id: app.bundle_id, app_name: app.name, expires_at: existing.expires_at };
    const created = Date.now();
    const request: PrivateAccessRequest = {
      id: opaqueId("cua"), routeId, identity: app.identity, bundle_id: app.bundle_id, app_name: app.name,
      reason: reason.trim(), route_display: routeDisplay(routeId), created_at: new Date(created).toISOString(),
      expires_at: new Date(created + REQUEST_TTL_MS).toISOString()
    };
    this.accessRequests.set(request.id, request);
    this.record(routeId, app.name, "request_access", "pending");
    return { status: "pending", request_id: request.id, bundle_id: app.bundle_id, app_name: app.name, expires_at: request.expires_at };
  }

  decideAccess(requestId: string, decision: "allow_once" | "always_allow" | "deny"): void {
    this.prune();
    const request = this.accessRequests.get(requestId);
    if (!request) throw new CodexFlowError("Computer Use access request not found or expired.");
    this.accessRequests.delete(requestId);
    if (decision === "allow_once") this.onceAllowed.set(`${request.routeId}\0${request.bundle_id}\0${request.identity}`, Date.now() + REQUEST_TTL_MS);
    if (decision === "always_allow") {
      const store = readStore();
      store.alwaysAllowed = store.alwaysAllowed.filter((approval) => approval.bundleId !== request.bundle_id);
      store.alwaysAllowed.push({ bundleId: request.bundle_id, name: request.app_name, identity: request.identity, approvedAt: nowIso() });
      writeStore(store);
    }
    this.record(request.routeId, request.app_name, "access", decision);
  }

  revoke(bundleId: string): void {
    const store = readStore();
    const next = store.alwaysAllowed.filter((approval) => approval.bundleId !== bundleId);
    if (next.length === store.alwaysAllowed.length) throw new CodexFlowError("That app is not always allowed.");
    writeStore({ version: 1, alwaysAllowed: next });
    for (const key of this.onceAllowed.keys()) if (key.includes(`\0${bundleId}\0`)) this.onceAllowed.delete(key);
  }

  private allowed(routeId: string, bundleId: string, identity: string): boolean {
    if (prohibitedReason(bundleId)) return false;
    if (readStore().alwaysAllowed.some((approval) => approval.bundleId === bundleId && approval.identity === identity)) return true;
    return (this.onceAllowed.get(`${routeId}\0${bundleId}\0${identity}`) ?? 0) > Date.now();
  }

  async snapshot(routeId: string, bundleId: string): Promise<Record<string, unknown>> {
    this.prune();
    const app = (await this.listApps()).find((candidate) => candidate.bundle_id === bundleId);
    if (!app) throw new CodexFlowError("The approved app is not currently running or its signing identity is unavailable.");
    if (!this.allowed(routeId, bundleId, app.identity)) throw new CodexFlowError("This app is not approved for this chat, or its code-signing identity changed. Request access and approve it in the native Computer view first.");
    const result = await callHelper<Record<string, unknown>>({ action: "snapshot", bundleId, expectedIdentity: app.identity });
    if (result.identity !== app.identity) throw new CodexFlowError("The target app identity changed while it was being observed.");
    const elements = cleanElements(result.elements);
    const snapshotId = opaqueId("cus");
    const exposed = elements.map((element) => {
      const id = `axe_${createHash("sha256").update(`${snapshotId}\0${JSON.stringify(element.path)}\0${element.role}\0${element.title ?? ""}`).digest("hex").slice(0, 16)}`;
      return { id, ...element };
    });
    this.snapshots.set(snapshotId, {
      routeId, bundleId, identity: app.identity, appName: String(result.app_name ?? bundleId).slice(0, 300), pid: Number(result.pid), createdAt: Date.now(),
      elements: new Map(exposed.map(({ id, ...element }) => [id, element]))
    });
    this.record(routeId, String(result.app_name ?? bundleId), "observe", "ok");
    return {
      snapshot_id: snapshotId, bundle_id: bundleId, app_name: String(result.app_name ?? bundleId),
      expires_at: new Date(Date.now() + SNAPSHOT_TTL_MS).toISOString(), elements: exposed,
      screenshot_base64: String(result.screenshot_base64 ?? "")
    };
  }

  async act(routeId: string, options: {
    bundleId: string; snapshotId: string; elementId: string; operation: "press" | "focus" | "set_value" | "key";
    value?: string; key?: "return" | "tab" | "escape" | "space" | "delete"; actionRequestId?: string;
  }): Promise<Record<string, unknown>> {
    this.prune();
    const snapshot = this.snapshots.get(options.snapshotId);
    if (!snapshot || snapshot.routeId !== routeId || snapshot.bundleId !== options.bundleId) throw new CodexFlowError("The Computer Use snapshot is missing, expired, or belongs to another chat. Observe the app again.");
    const app = (await this.listApps()).find((candidate) => candidate.bundle_id === options.bundleId);
    if (!app || app.identity !== snapshot.identity || !this.allowed(routeId, options.bundleId, app.identity)) {
      throw new CodexFlowError("The approved app identity changed or access was revoked. Request access again before acting.");
    }
    const element = snapshot.elements.get(options.elementId);
    if (!element) throw new CodexFlowError("The interface element is missing from this snapshot. Observe the app again.");
    if (options.operation === "set_value") {
      if (typeof options.value !== "string" || options.value.length > 4000) throw new CodexFlowError("Text input must contain at most 4000 characters.");
      if (hasSecretValue(options.value)) throw new CodexFlowError("CodexFlow will not type content that appears to contain a credential or secret.");
    }
    const fingerprint = createHash("sha256").update(JSON.stringify({
      routeId, bundleId: options.bundleId, snapshotId: options.snapshotId, elementId: options.elementId,
      operation: options.operation, value: options.value ?? null, key: options.key ?? null
    })).digest("hex");
    const lowRisk = options.operation === "focus" || (options.operation === "key" && ["tab", "escape"].includes(options.key ?? ""));
    if (!lowRisk) {
      const approved = options.actionRequestId ? this.actionRequests.get(options.actionRequestId) : undefined;
      if (!approved || !approved.approved || approved.routeId !== routeId || approved.fingerprint !== fingerprint) {
        const created = Date.now();
        const request: PrivateActionRequest = {
          id: opaqueId("cux"), routeId, fingerprint, approved: false,
          bundle_id: options.bundleId, app_name: snapshot.appName, operation: options.operation,
          target: `${element.role}${element.title ? ` · ${element.title}` : ""}`.slice(0, 400),
          ...(options.value ? { value_preview: redactSensitiveText(options.value.slice(0, 160)) } : {}),
          route_display: routeDisplay(routeId), created_at: new Date(created).toISOString(), expires_at: new Date(created + ACTION_TTL_MS).toISOString()
        };
        this.actionRequests.set(request.id, request);
        this.record(routeId, snapshot.appName, options.operation, "confirmation_pending");
        return { status: "confirmation_required", action_request_id: request.id, expires_at: request.expires_at };
      }
      this.actionRequests.delete(approved.id);
    }
    const result = await callHelper<Record<string, unknown>>({
      action: "perform", bundleId: options.bundleId, expectedIdentity: snapshot.identity, elementPath: element.path,
      expectedRole: element.role, expectedTitle: element.title,
      operation: options.operation, ...(options.value !== undefined ? { value: options.value } : {}),
      ...(options.key !== undefined ? { key: options.key } : {})
    });
    this.snapshots.delete(options.snapshotId);
    this.record(routeId, snapshot.appName, options.operation, "ok");
    return { status: "completed", operation: options.operation, bundle_id: options.bundleId, result };
  }

  decideAction(requestId: string, approve: boolean): void {
    this.prune();
    const request = this.actionRequests.get(requestId);
    if (!request) throw new CodexFlowError("Computer Use action request not found or expired.");
    if (approve) request.approved = true;
    else this.actionRequests.delete(requestId);
    this.record(request.routeId, request.app_name, request.operation, approve ? "approved" : "denied");
  }
}

export const computerUse = new ComputerUseManager();
