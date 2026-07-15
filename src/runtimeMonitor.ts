import { createHash, randomUUID } from "node:crypto";

export type RuntimeToolStatus = "ok" | "error";
export type RuntimeSessionState = "initializing" | "active" | "closed";

export interface RuntimeProjectRef {
  id: string;
  name: string;
  root: string;
}

export interface RuntimeToolEvent {
  name: string;
  status: RuntimeToolStatus;
  durationMs: number;
  at?: number;
}

export interface RuntimeActivitySnapshot {
  id: string;
  session_id: string;
  tool: string;
  status: RuntimeToolStatus;
  duration_ms: number;
  at: string;
  project: RuntimeProjectRef | null;
}

export interface RuntimeSessionSnapshot {
  id: string;
  state: RuntimeSessionState;
  created_at: string;
  last_seen_at: string;
  closed_at: string | null;
  project: RuntimeProjectRef | null;
  tool_calls: number;
  errors: number;
  last_tool: string | null;
  last_tool_status: RuntimeToolStatus | null;
}

export interface RuntimeMonitorSnapshot {
  sessions: RuntimeSessionSnapshot[];
  activity: RuntimeActivitySnapshot[];
  active_sessions: number;
  pending_sessions: number;
  open_connections: number;
  recent_sessions: number;
}

interface RuntimeSessionRecord {
  internalId: string;
  displayId: string;
  state: RuntimeSessionState;
  createdAt: number;
  lastSeenAt: number;
  closedAt?: number;
  project?: RuntimeProjectRef;
  toolCalls: number;
  errors: number;
  lastTool?: string;
  lastToolStatus?: RuntimeToolStatus;
}

export interface RuntimeSessionHandle {
  bindTransport(sessionId: string): void;
  touch(): void;
  selectProject(project: RuntimeProjectRef): void;
  recordTool(event: RuntimeToolEvent): void;
  close(): void;
}

const DEFAULT_ACTIVITY_LIMIT = 120;
const DEFAULT_CLOSED_RETENTION_MS = 5 * 60_000;
const DEFAULT_SESSION_LIMIT = 256;
const MAX_LISTENERS = 32;

function iso(value: number): string {
  return new Date(value).toISOString();
}

function displayId(seed: string): string {
  return `chat-${createHash("sha256").update(seed).digest("hex").slice(0, 8)}`;
}

function publicProject(project: RuntimeProjectRef | undefined): RuntimeProjectRef | null {
  return project ? { ...project } : null;
}

export class RuntimeMonitor {
  private readonly sessions = new Map<string, RuntimeSessionRecord>();
  private readonly activity: RuntimeActivitySnapshot[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly activityLimit = DEFAULT_ACTIVITY_LIMIT,
    private readonly closedRetentionMs = DEFAULT_CLOSED_RETENTION_MS,
    private readonly sessionLimit = DEFAULT_SESSION_LIMIT
  ) {}

  beginSession(now = Date.now()): RuntimeSessionHandle {
    this.prune(now);
    this.enforceSessionLimit();
    const internalId = randomUUID();
    const record: RuntimeSessionRecord = {
      internalId,
      displayId: displayId(internalId),
      state: "initializing",
      createdAt: now,
      lastSeenAt: now,
      toolCalls: 0,
      errors: 0
    };
    this.sessions.set(internalId, record);
    this.emit();

    const current = (): RuntimeSessionRecord | undefined => this.sessions.get(internalId);
    return {
      bindTransport: (_sessionId) => {
        const session = current();
        if (!session || session.state === "closed") return;
        session.state = "active";
        session.lastSeenAt = Date.now();
        this.emit();
      },
      touch: () => {
        const session = current();
        if (!session || session.state === "closed") return;
        session.lastSeenAt = Date.now();
      },
      selectProject: (project) => {
        const session = current();
        if (!session || session.state === "closed") return;
        const changed = session.project?.id !== project.id;
        session.project = { ...project };
        session.lastSeenAt = Date.now();
        if (changed) this.emit();
      },
      recordTool: (event) => {
        const session = current();
        if (!session || session.state === "closed") return;
        const at = event.at ?? Date.now();
        session.lastSeenAt = at;
        session.toolCalls += 1;
        if (event.status === "error") session.errors += 1;
        session.lastTool = event.name;
        session.lastToolStatus = event.status;
        this.activity.unshift({
          id: `evt-${randomUUID()}`,
          session_id: session.displayId,
          tool: event.name,
          status: event.status,
          duration_ms: Math.max(0, Math.floor(event.durationMs)),
          at: iso(at),
          project: publicProject(session.project)
        });
        if (this.activity.length > this.activityLimit) this.activity.length = this.activityLimit;
        this.emit();
      },
      close: () => {
        const session = current();
        if (!session || session.state === "closed") return;
        const now = Date.now();
        session.state = "closed";
        session.closedAt = now;
        session.lastSeenAt = now;
        this.emit();
      }
    };
  }

  snapshot(now = Date.now()): RuntimeMonitorSnapshot {
    this.prune(now);
    const records = [...this.sessions.values()];
    // ChatGPT may open short-lived MCP transports for discovery, metadata, and
    // component fetching. Those are connections, not user chats. Only expose a
    // session as a chat after it has called a tool or selected a project.
    const sessions = records
      .filter((session) => session.toolCalls > 0 || Boolean(session.project))
      .sort((a, b) => {
        const aActive = a.state === "active" || a.state === "initializing" ? 1 : 0;
        const bActive = b.state === "active" || b.state === "initializing" ? 1 : 0;
        return bActive - aActive || b.lastSeenAt - a.lastSeenAt;
      })
      .map((session): RuntimeSessionSnapshot => ({
        id: session.displayId,
        state: session.state,
        created_at: iso(session.createdAt),
        last_seen_at: iso(session.lastSeenAt),
        closed_at: session.closedAt ? iso(session.closedAt) : null,
        project: publicProject(session.project),
        tool_calls: session.toolCalls,
        errors: session.errors,
        last_tool: session.lastTool ?? null,
        last_tool_status: session.lastToolStatus ?? null
      }));
    return {
      sessions,
      activity: this.activity.map((event) => ({
        ...event,
        project: event.project ? { ...event.project } : null
      })),
      active_sessions: sessions.filter((session) => session.state !== "closed" && Boolean(session.project)).length,
      pending_sessions: sessions.filter((session) => session.state !== "closed" && !session.project).length,
      open_connections: records.filter((session) => session.state !== "closed").length,
      recent_sessions: sessions.length
    };
  }

  subscribe(listener: () => void): () => void {
    if (this.listeners.size >= MAX_LISTENERS) {
      throw new Error("Too many CodexFlow runtime monitor subscribers.");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private prune(now: number): void {
    for (const [id, session] of this.sessions) {
      if (session.state === "closed" && session.closedAt && now - session.closedAt > this.closedRetentionMs) {
        this.sessions.delete(id);
      }
    }
  }

  private enforceSessionLimit(): void {
    const limit = Math.max(1, Math.floor(this.sessionLimit));
    while (this.sessions.size >= limit) {
      const oldest = [...this.sessions.entries()].sort((a, b) => {
        const aClosed = a[1].state === "closed" ? 0 : 1;
        const bClosed = b[1].state === "closed" ? 0 : 1;
        return aClosed - bClosed || a[1].lastSeenAt - b[1].lastSeenAt;
      })[0];
      if (!oldest) return;
      this.sessions.delete(oldest[0]);
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Runtime telemetry must never interrupt a tool call or transport lifecycle.
      }
    }
  }
}
