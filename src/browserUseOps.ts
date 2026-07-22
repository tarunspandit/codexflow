import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CodexFlowError } from "./guard.js";
import { codexFlowHome } from "./profileStore.js";
import { hasSecretValue, redactSensitiveText } from "./redact.js";

interface StoredOrigin { origin: string; approvedAt: string }
interface BrowserStore { version: 1; alwaysAllowed: StoredOrigin[] }
interface PrivateHostRequest {
  id: string; routeId: string; origin: string; reason: string; route_display: string; created_at: string; expires_at: string;
}
interface PrivateActionRequest {
  id: string; routeId: string; fingerprint: string; approved: boolean; session_id: string; origin: string;
  operation: string; target: string; value_preview?: string; route_display: string; created_at: string; expires_at: string;
}
interface BrowserElement {
  id: string; role: string; name?: string; text?: string; type?: string; href?: string; disabled: boolean;
}
interface BrowserSnapshot {
  routeId: string; sessionId: string; nativeId: string; createdAt: number; elements: Map<string, BrowserElement>;
}
interface BrowserSession {
  id: string; routeId: string; origin: string; currentUrl: string; title: string; createdAt: number; updatedAt: number;
}
interface BrowserComment {
  id: string; routeId: string; sessionId: string; url: string; selector: string; target: string; note: string;
  route_display: string; created_at: string;
}
interface BrowserConsoleEntry { at: string; level: string; message: string; source?: string; line?: number }
interface BrowserNetworkEntry { url: string; kind: string; status?: number; duration_ms: number; transfer_bytes?: number }
interface BrowserSourceEntry { url: string; kind: string }
interface BrowserCommand {
  id: string; routeId: string; createdAt: number; leaseUntil: number; payload: Record<string, unknown>;
  resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout;
}

const ACCESS_TTL_MS = 10 * 60_000;
const ACTION_TTL_MS = 3 * 60_000;
const SNAPSHOT_TTL_MS = 90_000;
const COMMAND_TTL_MS = 30_000;
const MAX_ACTIVITY = 100;
const MAX_COMMENTS_PER_SESSION = 50;
const MAX_DIAGNOSTIC_ENTRIES = 100;

function statePath(): string { return path.join(codexFlowHome(), "browser-use.json"); }
function opaque(prefix: string): string { return `${prefix}_${randomBytes(8).toString("hex")}`; }
function nowIso(): string { return new Date().toISOString(); }
function routeDisplay(routeId: string): string { return `route-${createHash("sha256").update(routeId).digest("hex").slice(0, 8)}`; }

function parseTarget(raw: string): { url: string; origin: string } {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new CodexFlowError("Use a complete http:// or https:// URL."); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new CodexFlowError("The CodexFlow browser accepts only HTTP and HTTPS URLs.");
  if (parsed.username || parsed.password) throw new CodexFlowError("Browser URLs cannot contain embedded credentials.");
  if (!parsed.hostname || parsed.hostname.length > 253 || parsed.href.length > 4096) throw new CodexFlowError("The browser URL is invalid or too long.");
  if (hasSecretValue(parsed.search) || [...parsed.searchParams.keys()].some((key) => /token|secret|password|credential|api[_-]?key/i.test(key))) {
    throw new CodexFlowError("Browser URLs cannot contain credentials or secret-looking query values.");
  }
  const host = parsed.hostname.toLowerCase();
  const pathName = parsed.pathname.toLowerCase();
  const authenticationHosts = new Set([
    "accounts.google.com", "appleid.apple.com", "auth.openai.com", "login.live.com", "login.microsoftonline.com"
  ]);
  const sensitivePath = /\/(?:account|settings)\/(?:security|billing|password|payments?)(?:\/|$)|\/(?:checkout|payment)(?:\/|$)/.test(pathName);
  if (authenticationHosts.has(host) || sensitivePath) {
    throw new CodexFlowError("Authentication, account-security, billing, and payment pages are outside the CodexFlow browser boundary.");
  }
  parsed.hash = "";
  return { url: parsed.href, origin: parsed.origin.toLowerCase() };
}

function cleanHref(raw: string): string | undefined {
  try { return parseTarget(raw).url.slice(0, 1000); } catch { return undefined; }
}

function cleanDiagnosticUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw || raw.length > 4096) return undefined;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return undefined;
    parsed.search = "";
    parsed.hash = "";
    return parsed.href.slice(0, 1000);
  } catch { return undefined; }
}

function cleanDiagnostics(value: Record<string, unknown>): {
  captured_at: string; console: BrowserConsoleEntry[]; network: BrowserNetworkEntry[]; sources: BrowserSourceEntry[];
} {
  const consoleEntries = Array.isArray(value.console) ? value.console : [];
  const networkEntries = Array.isArray(value.network) ? value.network : [];
  const sourceEntries = Array.isArray(value.sources) ? value.sources : [];
  const cleanConsole = consoleEntries.flatMap((raw): BrowserConsoleEntry[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const rawMessage = typeof item.message === "string" ? item.message.slice(0, 1000) : "";
    if (!rawMessage) return [];
    const source = cleanDiagnosticUrl(item.source);
    const line = Number.isInteger(item.line) && Number(item.line) >= 0 && Number(item.line) <= 10_000_000 ? Number(item.line) : undefined;
    return [{
      at: typeof item.at === "string" && !Number.isNaN(Date.parse(item.at)) ? item.at : nowIso(),
      level: ["debug", "info", "log", "warn", "error"].includes(String(item.level)) ? String(item.level) : "log",
      message: hasSecretValue(rawMessage) || /(?:token|secret|password|credential|api[_-]?key)\s*[:=]\s*\S{4,}/i.test(rawMessage)
        ? "[redacted potentially sensitive console message]" : redactSensitiveText(rawMessage),
      ...(source ? { source } : {}), ...(line !== undefined ? { line } : {})
    }];
  }).slice(-MAX_DIAGNOSTIC_ENTRIES);
  const cleanNetwork = networkEntries.flatMap((raw): BrowserNetworkEntry[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const url = cleanDiagnosticUrl(item.url);
    if (!url) return [];
    const status = Number.isInteger(item.status) && Number(item.status) >= 0 && Number(item.status) <= 599 ? Number(item.status) : undefined;
    const duration = Number.isFinite(Number(item.duration_ms)) ? Math.max(0, Math.min(600_000, Math.round(Number(item.duration_ms)))) : 0;
    const transfer = Number.isFinite(Number(item.transfer_bytes)) ? Math.max(0, Math.min(100_000_000, Math.round(Number(item.transfer_bytes)))) : undefined;
    return [{
      url, kind: String(item.kind ?? "resource").replace(/[^a-z0-9_.-]/gi, "").slice(0, 40) || "resource",
      ...(status !== undefined ? { status } : {}), duration_ms: duration,
      ...(transfer !== undefined ? { transfer_bytes: transfer } : {})
    }];
  }).slice(-MAX_DIAGNOSTIC_ENTRIES);
  const cleanSources = sourceEntries.flatMap((raw): BrowserSourceEntry[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const url = cleanDiagnosticUrl(item.url);
    if (!url) return [];
    return [{ url, kind: ["document", "script", "stylesheet"].includes(String(item.kind)) ? String(item.kind) : "resource" }];
  }).slice(0, MAX_DIAGNOSTIC_ENTRIES);
  return { captured_at: nowIso(), console: cleanConsole, network: cleanNetwork, sources: cleanSources };
}

function readStore(): BrowserStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8")) as Partial<BrowserStore>;
    return {
      version: 1,
      alwaysAllowed: (Array.isArray(parsed.alwaysAllowed) ? parsed.alwaysAllowed : []).filter((entry): entry is StoredOrigin => Boolean(
        entry && typeof entry.origin === "string" && entry.origin.length <= 500 && typeof entry.approvedAt === "string"
      )).slice(-300)
    };
  } catch { return { version: 1, alwaysAllowed: [] }; }
}

function writeStore(store: BrowserStore): void {
  const target = statePath();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, alwaysAllowed: store.alwaysAllowed.slice(-300) }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  try { fs.chmodSync(target, 0o600); } catch { /* best effort */ }
}

function cleanElements(value: unknown): BrowserElement[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): BrowserElement[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const id = String(item.id ?? "");
    const role = String(item.role ?? "").slice(0, 100);
    if (!/^dom_[a-f0-9]{16}$/.test(id) || !role) return [];
    const href = typeof item.href === "string" ? cleanHref(item.href) : undefined;
    return [{
      id, role,
      ...(typeof item.name === "string" ? { name: redactSensitiveText(item.name.slice(0, 300)) } : {}),
      ...(typeof item.text === "string" ? { text: redactSensitiveText(item.text.slice(0, 500)) } : {}),
      ...(typeof item.type === "string" ? { type: item.type.slice(0, 80) } : {}),
      ...(href ? { href } : {}),
      disabled: Boolean(item.disabled)
    }];
  }).slice(0, 300);
}

export class BrowserUseManager {
  private hostRequests = new Map<string, PrivateHostRequest>();
  private actionRequests = new Map<string, PrivateActionRequest>();
  private onceAllowed = new Map<string, number>();
  private sessions = new Map<string, BrowserSession>();
  private comments = new Map<string, BrowserComment>();
  private snapshots = new Map<string, BrowserSnapshot>();
  private commands = new Map<string, BrowserCommand>();
  private activity: Array<{ at: string; route_display: string; origin: string; operation: string; outcome: string }> = [];
  private lastNativePollAt = 0;
  private nativeEngine = process.platform === "win32" ? "WebView2" : "WebKit";

  private prune(): void {
    const now = Date.now();
    for (const [id, request] of this.hostRequests) if (Date.parse(request.expires_at) <= now) this.hostRequests.delete(id);
    for (const [id, request] of this.actionRequests) if (Date.parse(request.expires_at) <= now) this.actionRequests.delete(id);
    for (const [key, expires] of this.onceAllowed) if (expires <= now) this.onceAllowed.delete(key);
    for (const [id, snapshot] of this.snapshots) if (snapshot.createdAt + SNAPSHOT_TTL_MS <= now) this.snapshots.delete(id);
  }

  private record(routeId: string, origin: string, operation: string, outcome: string): void {
    this.activity.push({ at: nowIso(), route_display: routeDisplay(routeId), origin, operation, outcome });
    if (this.activity.length > MAX_ACTIVITY) this.activity.splice(0, this.activity.length - MAX_ACTIVITY);
  }

  private allowed(routeId: string, origin: string): boolean {
    if (readStore().alwaysAllowed.some((entry) => entry.origin === origin)) return true;
    return (this.onceAllowed.get(`${routeId}\0${origin}`) ?? 0) > Date.now();
  }

  private allowedOrigins(routeId: string): string[] {
    this.prune();
    const persistent = readStore().alwaysAllowed.map((entry) => entry.origin);
    const once = [...this.onceAllowed.entries()].flatMap(([key, expires]) => {
      const [route, origin] = key.split("\0");
      return route === routeId && expires > Date.now() && origin ? [origin] : [];
    });
    return [...new Set([...persistent, ...once])].slice(0, 300);
  }

  overview(takeCommands = false, nativeEngine?: string): Record<string, unknown> {
    this.prune();
    const now = Date.now();
    if (takeCommands) {
      this.lastNativePollAt = now;
      if (nativeEngine === "WebKit" || nativeEngine === "WebView2") this.nativeEngine = nativeEngine;
    }
    const commands = takeCommands ? [...this.commands.values()].flatMap((command) => {
      if (command.leaseUntil > now) return [];
      command.leaseUntil = now + 5_000;
      return [{ id: command.id, ...command.payload }];
    }).slice(0, 10) : [];
    return {
      ok: true,
      status: { available: true, profile: "ephemeral", engine: this.nativeEngine, native_connected: now - this.lastNativePollAt < 3_000 },
      always_allowed: readStore().alwaysAllowed.map((entry) => ({ origin: entry.origin, approved_at: entry.approvedAt })),
      host_requests: [...this.hostRequests.values()].map(({ routeId: _routeId, ...request }) => request),
      action_requests: [...this.actionRequests.values()].filter((request) => !request.approved).map(({ routeId: _routeId, fingerprint: _fingerprint, approved: _approved, ...request }) => request),
      sessions: [...this.sessions.values()].map(({ routeId: _routeId, createdAt: _created, updatedAt: _updated, ...session }) => session),
      comments: [...this.comments.values()].map(({ routeId: _routeId, ...comment }) => comment),
      recent_activity: [...this.activity].reverse(),
      commands
    };
  }

  routeStatus(routeId: string): Record<string, unknown> {
    const sessions = [...this.sessions.values()].filter((session) => session.routeId === routeId)
      .map(({ routeId: _route, createdAt: _created, updatedAt: _updated, ...session }) => session);
    const comments = [...this.comments.values()].filter((comment) => comment.routeId === routeId)
      .map(({ routeId: _route, ...comment }) => comment);
    return { profile: "ephemeral", engine: this.nativeEngine, allowed_origins: this.allowedOrigins(routeId), sessions, comments };
  }

  requestHost(routeId: string, rawUrl: string, reason: string): Record<string, unknown> {
    this.prune();
    const target = parseTarget(rawUrl);
    if (!reason.trim() || reason.length > 500 || hasSecretValue(reason)) throw new CodexFlowError("Provide a scoped, non-secret reason of at most 500 characters.");
    if (this.allowed(routeId, target.origin)) return { status: "allowed", origin: target.origin, url: target.url };
    const existing = [...this.hostRequests.values()].find((request) => request.routeId === routeId && request.origin === target.origin);
    if (existing) return { status: "pending", request_id: existing.id, origin: existing.origin, expires_at: existing.expires_at };
    const created = Date.now();
    const request: PrivateHostRequest = {
      id: opaque("buh"), routeId, origin: target.origin, reason: reason.trim(), route_display: routeDisplay(routeId),
      created_at: new Date(created).toISOString(), expires_at: new Date(created + ACCESS_TTL_MS).toISOString()
    };
    this.hostRequests.set(request.id, request);
    this.record(routeId, target.origin, "request_host", "pending");
    return { status: "pending", request_id: request.id, origin: target.origin, expires_at: request.expires_at };
  }

  decideHost(requestId: string, decision: "allow_once" | "always_allow" | "deny"): void {
    this.prune();
    const request = this.hostRequests.get(requestId);
    if (!request) throw new CodexFlowError("Browser host request not found or expired.");
    this.hostRequests.delete(requestId);
    if (decision === "allow_once") this.onceAllowed.set(`${request.routeId}\0${request.origin}`, Date.now() + ACCESS_TTL_MS);
    if (decision === "always_allow") {
      const store = readStore();
      store.alwaysAllowed = store.alwaysAllowed.filter((entry) => entry.origin !== request.origin);
      store.alwaysAllowed.push({ origin: request.origin, approvedAt: nowIso() });
      writeStore(store);
    }
    this.record(request.routeId, request.origin, "host_access", decision);
  }

  revoke(origin: string): void {
    const normalized = parseTarget(origin).origin;
    const store = readStore();
    const next = store.alwaysAllowed.filter((entry) => entry.origin !== normalized);
    if (next.length === store.alwaysAllowed.length) throw new CodexFlowError("That browser origin is not always allowed.");
    writeStore({ version: 1, alwaysAllowed: next });
    for (const key of this.onceAllowed.keys()) if (key.endsWith(`\0${normalized}`)) this.onceAllowed.delete(key);
    for (const [id, session] of this.sessions) if (session.origin === normalized) this.sessions.delete(id);
    for (const [id, comment] of this.comments) {
      try { if (parseTarget(comment.url).origin === normalized) this.comments.delete(id); } catch { this.comments.delete(id); }
    }
  }

  addComment(sessionId: string, selector: string, target: string, note: string): BrowserComment {
    const session = this.sessions.get(sessionId);
    if (!session) throw new CodexFlowError("That browser session is missing or closed.");
    const cleanSelector = selector.trim();
    const rawTarget = target.trim();
    const cleanNote = note.trim();
    if (!cleanSelector || cleanSelector.length > 1000 || /[\r\n\0]/.test(cleanSelector)) {
      throw new CodexFlowError("The browser annotation target is invalid or too long.");
    }
    if (!rawTarget || rawTarget.length > 300) throw new CodexFlowError("The browser annotation needs a short visible target.");
    if (!cleanNote || cleanNote.length > 1000) throw new CodexFlowError("Browser comments must contain 1 to 1000 characters.");
    if (hasSecretValue(`${cleanSelector}\n${rawTarget}\n${cleanNote}`)) {
      throw new CodexFlowError("The browser comment was not saved because it appears to contain a credential or secret.");
    }
    const cleanTarget = redactSensitiveText(rawTarget);
    const existing = [...this.comments.values()].filter((comment) => comment.sessionId === sessionId);
    if (existing.length >= MAX_COMMENTS_PER_SESSION) throw new CodexFlowError(`A browser session can hold at most ${MAX_COMMENTS_PER_SESSION} comments.`);
    const comment: BrowserComment = {
      id: opaque("bua"), routeId: session.routeId, sessionId, url: session.currentUrl,
      selector: cleanSelector, target: cleanTarget, note: cleanNote,
      route_display: routeDisplay(session.routeId), created_at: nowIso()
    };
    this.comments.set(comment.id, comment);
    this.record(session.routeId, session.origin, "add_comment", "ok");
    return comment;
  }

  removeComment(commentId: string): void {
    const comment = this.comments.get(commentId);
    if (!comment) throw new CodexFlowError("Browser comment not found.");
    this.comments.delete(commentId);
    let origin = "browser";
    try { origin = parseTarget(comment.url).origin; } catch { /* bounded activity fallback */ }
    this.record(comment.routeId, origin, "remove_comment", "ok");
  }

  routeComments(routeId: string, sessionId?: string): Array<Omit<BrowserComment, "routeId" | "route_display">> {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session || session.routeId !== routeId) throw new CodexFlowError("That browser session is missing or belongs to another chat.");
    }
    return [...this.comments.values()].filter((comment) =>
      comment.routeId === routeId && (!sessionId || comment.sessionId === sessionId)
    ).map(({ routeId: _route, route_display: _display, ...comment }) => comment);
  }

  private dispatch(routeId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = opaque("buc");
      const timer = setTimeout(() => {
        this.commands.delete(id);
        reject(new CodexFlowError("The native CodexFlow browser did not respond. Keep the desktop app open and retry."));
      }, COMMAND_TTL_MS);
      timer.unref();
      this.commands.set(id, { id, routeId, createdAt: Date.now(), leaseUntil: 0, payload, resolve, reject, timer });
    });
  }

  completeCommand(commandId: string, ok: boolean, result: Record<string, unknown> | undefined, error?: string): void {
    const command = this.commands.get(commandId);
    if (!command) throw new CodexFlowError("Browser command not found or expired.");
    this.commands.delete(commandId);
    clearTimeout(command.timer);
    if (!ok) command.reject(new CodexFlowError(redactSensitiveText((error || "The native browser command failed.").slice(0, 2000))));
    else command.resolve(result ?? {});
  }

  async open(routeId: string, rawUrl: string): Promise<Record<string, unknown>> {
    const target = parseTarget(rawUrl);
    if (!this.allowed(routeId, target.origin)) throw new CodexFlowError("This website origin is not approved for this chat. Request it and approve it in the native Browser view first.");
    const session: BrowserSession = {
      id: opaque("but"), routeId, origin: target.origin, currentUrl: target.url, title: target.origin,
      createdAt: Date.now(), updatedAt: Date.now()
    };
    this.sessions.set(session.id, session);
    try {
      const result = await this.dispatch(routeId, { action: "open", session_id: session.id, url: target.url, allowed_origins: this.allowedOrigins(routeId) });
      const returned = parseTarget(String(result.url ?? target.url));
      if (!this.allowed(routeId, returned.origin)) throw new CodexFlowError("The page redirected to an origin that is not approved for this chat.");
      session.origin = returned.origin; session.currentUrl = returned.url; session.title = String(result.title ?? returned.origin).slice(0, 300); session.updatedAt = Date.now();
      this.record(routeId, session.origin, "open", "ok");
      return { status: "opened", session_id: session.id, origin: session.origin, url: session.currentUrl, title: session.title };
    } catch (error) { this.sessions.delete(session.id); throw error; }
  }

  async observe(routeId: string, sessionId: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(sessionId);
    if (!session || session.routeId !== routeId) throw new CodexFlowError("That browser session is missing or belongs to another chat.");
    if (!this.allowed(routeId, session.origin)) throw new CodexFlowError("Browser access was revoked. Request this origin again.");
    const result = await this.dispatch(routeId, { action: "observe", session_id: session.id, allowed_origins: this.allowedOrigins(routeId) });
    const target = parseTarget(String(result.url ?? session.currentUrl));
    if (!this.allowed(routeId, target.origin)) throw new CodexFlowError("The browser reached an origin that is not approved for this chat.");
    session.origin = target.origin; session.currentUrl = target.url; session.title = String(result.title ?? target.origin).slice(0, 300); session.updatedAt = Date.now();
    const elements = cleanElements(result.elements);
    const nativeId = String(result.native_snapshot_id ?? "");
    if (!/^nav_[a-f0-9]{16}$/.test(nativeId)) throw new CodexFlowError("The native browser returned an invalid snapshot identity.");
    const snapshotId = opaque("bus");
    this.snapshots.set(snapshotId, { routeId, sessionId, nativeId, createdAt: Date.now(), elements: new Map(elements.map((element) => [element.id, element])) });
    this.record(routeId, session.origin, "observe", "ok");
    return {
      snapshot_id: snapshotId, session_id: session.id, origin: session.origin, url: session.currentUrl,
      title: session.title, elements, comments: this.routeComments(routeId, session.id),
      screenshot_base64: String(result.screenshot_base64 ?? "")
    };
  }

  async diagnostics(routeId: string, sessionId: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(sessionId);
    if (!session || session.routeId !== routeId) throw new CodexFlowError("That browser session is missing or belongs to another chat.");
    if (!this.allowed(routeId, session.origin)) throw new CodexFlowError("Browser access was revoked. Request this origin again.");
    const result = await this.dispatch(routeId, { action: "diagnostics", session_id: session.id, allowed_origins: this.allowedOrigins(routeId) });
    const diagnostics = cleanDiagnostics(result);
    this.record(routeId, session.origin, "diagnostics", "ok");
    return { status: "captured", session_id: session.id, origin: session.origin, ...diagnostics };
  }

  async act(routeId: string, options: {
    sessionId: string; snapshotId: string; elementId: string; operation: "click" | "focus" | "set_value" | "key" | "scroll_into_view";
    value?: string; key?: "return" | "tab" | "escape" | "space" | "delete"; actionRequestId?: string;
  }): Promise<Record<string, unknown>> {
    this.prune();
    const session = this.sessions.get(options.sessionId);
    const snapshot = this.snapshots.get(options.snapshotId);
    if (!session || session.routeId !== routeId || !snapshot || snapshot.routeId !== routeId || snapshot.sessionId !== session.id) {
      throw new CodexFlowError("The browser snapshot is missing, expired, or belongs to another chat. Observe again.");
    }
    if (!this.allowed(routeId, session.origin)) throw new CodexFlowError("Browser access was revoked. Request this origin again.");
    const element = snapshot.elements.get(options.elementId);
    if (!element) throw new CodexFlowError("That DOM element is not present in the fresh snapshot.");
    if (element.disabled) throw new CodexFlowError("The selected DOM element is disabled.");
    if (options.operation === "set_value") {
      if (typeof options.value !== "string" || options.value.length > 4000) throw new CodexFlowError("Browser text input must contain at most 4000 characters.");
      if (hasSecretValue(options.value)) throw new CodexFlowError("CodexFlow will not type content that appears to contain a credential or secret.");
      if (/password|secret/i.test(element.type ?? "")) throw new CodexFlowError("CodexFlow will not type into password or secure fields.");
    }
    const fingerprint = createHash("sha256").update(JSON.stringify({ routeId, ...options, actionRequestId: undefined })).digest("hex");
    const lowRisk = options.operation === "focus" || options.operation === "scroll_into_view" || (options.operation === "key" && ["tab", "escape"].includes(options.key ?? ""));
    if (!lowRisk) {
      const approved = options.actionRequestId ? this.actionRequests.get(options.actionRequestId) : undefined;
      if (!approved || !approved.approved || approved.routeId !== routeId || approved.fingerprint !== fingerprint) {
        const existing = [...this.actionRequests.values()].find((request) =>
          !request.approved && request.routeId === routeId && request.fingerprint === fingerprint
        );
        if (existing) {
          return { status: "confirmation_required", action_request_id: existing.id, expires_at: existing.expires_at };
        }
        const created = Date.now();
        const request: PrivateActionRequest = {
          id: opaque("bux"), routeId, fingerprint, approved: false, session_id: session.id, origin: session.origin,
          operation: options.operation, target: `${element.role}${element.name ? ` · ${element.name}` : ""}`.slice(0, 400),
          ...(options.value ? { value_preview: redactSensitiveText(options.value.slice(0, 160)) } : {}), route_display: routeDisplay(routeId),
          created_at: new Date(created).toISOString(), expires_at: new Date(created + ACTION_TTL_MS).toISOString()
        };
        this.actionRequests.set(request.id, request);
        this.record(routeId, session.origin, options.operation, "confirmation_pending");
        return { status: "confirmation_required", action_request_id: request.id, expires_at: request.expires_at };
      }
      this.actionRequests.delete(approved.id);
    }
    const result = await this.dispatch(routeId, {
      action: "act", session_id: session.id, snapshot_id: snapshot.nativeId, element_id: options.elementId,
      operation: options.operation, ...(options.value !== undefined ? { value: options.value } : {}),
      ...(options.key !== undefined ? { key: options.key } : {}), allowed_origins: this.allowedOrigins(routeId)
    });
    this.snapshots.delete(options.snapshotId);
    this.record(routeId, session.origin, options.operation, "ok");
    return { status: "completed", session_id: session.id, operation: options.operation, result };
  }

  decideAction(requestId: string, approve: boolean): void {
    this.prune();
    const request = this.actionRequests.get(requestId);
    if (!request) throw new CodexFlowError("Browser action request not found or expired.");
    if (approve) request.approved = true; else this.actionRequests.delete(requestId);
    this.record(request.routeId, request.origin, request.operation, approve ? "approved" : "denied");
  }

  async close(routeId: string, sessionId: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(sessionId);
    if (!session || session.routeId !== routeId) throw new CodexFlowError("That browser session is missing or belongs to another chat.");
    await this.dispatch(routeId, { action: "close", session_id: session.id });
    this.sessions.delete(session.id);
    for (const [id, snapshot] of this.snapshots) if (snapshot.sessionId === session.id) this.snapshots.delete(id);
    for (const [id, comment] of this.comments) if (comment.sessionId === session.id) this.comments.delete(id);
    this.record(routeId, session.origin, "close", "ok");
    return { status: "closed", session_id: session.id };
  }
}

export const browserUse = new BrowserUseManager();
