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
  routeId?: string;
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
  key: string;
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
  connectionIds: Set<string>;
}

interface RuntimeConnectionRecord {
  internalId: string;
  state: RuntimeSessionState;
  createdAt: number;
  lastSeenAt: number;
  closedAt?: number;
  pendingProject?: RuntimeProjectRef;
  sessionKeys: Set<string>;
  legacySessionKey?: string;
}

export interface RuntimeSessionHandle {
  bindTransport(sessionId: string): void;
  touch(): void;
  selectProject(project: RuntimeProjectRef, routeId?: string): void;
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

function routeSessionKey(routeId: string): string {
  return `route:${routeId}`;
}

export class RuntimeMonitor {
  private readonly sessions = new Map<string, RuntimeSessionRecord>();
  private readonly connections = new Map<string, RuntimeConnectionRecord>();
  private readonly activity: RuntimeActivitySnapshot[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly activityLimit = DEFAULT_ACTIVITY_LIMIT,
    private readonly closedRetentionMs = DEFAULT_CLOSED_RETENTION_MS,
    private readonly sessionLimit = DEFAULT_SESSION_LIMIT
  ) {}

  beginSession(now = Date.now()): RuntimeSessionHandle {
    this.prune(now);
    this.enforceConnectionLimit(now);
    const internalId = randomUUID();
    const connection: RuntimeConnectionRecord = {
      internalId,
      state: "initializing",
      createdAt: now,
      lastSeenAt: now,
      sessionKeys: new Set()
    };
    this.connections.set(internalId, connection);
    this.emit();

    const current = (): RuntimeConnectionRecord | undefined => this.connections.get(internalId);
    return {
      bindTransport: (_sessionId) => {
        const record = current();
        if (!record || record.state === "closed") return;
        record.state = "active";
        record.lastSeenAt = Date.now();
        this.emit();
      },
      touch: () => {
        const record = current();
        if (!record || record.state === "closed") return;
        const touchedAt = Date.now();
        record.lastSeenAt = touchedAt;
        for (const key of record.sessionKeys) {
          const session = this.sessions.get(key);
          if (session && session.state !== "closed") session.lastSeenAt = touchedAt;
        }
      },
      selectProject: (project, routeId) => {
        const record = current();
        if (!record || record.state === "closed") return;
        record.pendingProject = { ...project };
        record.lastSeenAt = Date.now();
        if (routeId) this.attachSession(record, routeSessionKey(routeId), routeId, project, record.lastSeenAt);
        else if (record.legacySessionKey) this.attachSession(record, record.legacySessionKey, record.legacySessionKey, project, record.lastSeenAt);
        this.emit();
      },
      recordTool: (event) => {
        const record = current();
        if (!record || record.state === "closed") return;
        const at = event.at ?? Date.now();
        record.lastSeenAt = at;
        const routeId = typeof event.routeId === "string" && event.routeId ? event.routeId : undefined;
        if (!routeId && !record.legacySessionKey) record.legacySessionKey = `transport:${record.internalId}`;
        const key = routeId ? routeSessionKey(routeId) : record.legacySessionKey!;
        const session = this.attachSession(record, key, routeId ?? key, record.pendingProject, at);
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
        const record = current();
        if (!record || record.state === "closed") return;
        const closedAt = Date.now();
        record.state = "closed";
        record.closedAt = closedAt;
        record.lastSeenAt = closedAt;
        this.detachConnection(record, closedAt);
        this.emit();
      }
    };
  }

  snapshot(now = Date.now()): RuntimeMonitorSnapshot {
    this.prune(now);
    // A ChatGPT conversation becomes a CodexFlow chat only after it is bound to
    // a project. Discovery probes and repeated picker attempts are operational
    // connections, not user chats, and therefore stay out of this list.
    const sessions = [...this.sessions.values()]
      .filter((session) => Boolean(session.project))
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
      active_sessions: sessions.filter((session) => session.state !== "closed").length,
      pending_sessions: 0,
      open_connections: [...this.connections.values()].filter((connection) => connection.state !== "closed").length,
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

  private attachSession(
    connection: RuntimeConnectionRecord,
    key: string,
    displaySeed: string,
    project: RuntimeProjectRef | undefined,
    at: number
  ): RuntimeSessionRecord {
    let session = this.sessions.get(key);
    if (!session) {
      this.enforceSessionLimit(at);
      session = {
        key,
        displayId: displayId(displaySeed),
        state: connection.state === "closed" ? "closed" : "active",
        createdAt: at,
        lastSeenAt: at,
        project: project ? { ...project } : undefined,
        toolCalls: 0,
        errors: 0,
        connectionIds: new Set()
      };
      this.sessions.set(key, session);
    }
    if (project) session.project = { ...project };
    if (connection.state !== "closed") {
      session.connectionIds.add(connection.internalId);
      session.state = "active";
      session.closedAt = undefined;
    }
    session.lastSeenAt = at;
    connection.sessionKeys.add(key);
    return session;
  }

  private detachConnection(connection: RuntimeConnectionRecord, at: number): void {
    for (const key of connection.sessionKeys) {
      const session = this.sessions.get(key);
      if (!session) continue;
      session.connectionIds.delete(connection.internalId);
      if (session.connectionIds.size === 0) {
        session.state = "closed";
        session.closedAt = at;
        session.lastSeenAt = at;
      }
    }
  }

  private deleteConnection(id: string, at: number): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    this.connections.delete(id);
    this.detachConnection(connection, at);
  }

  private deleteSession(key: string): void {
    this.sessions.delete(key);
    for (const connection of this.connections.values()) connection.sessionKeys.delete(key);
  }

  private prune(now: number): void {
    for (const [key, session] of this.sessions) {
      if (session.state === "closed" && session.closedAt && now - session.closedAt > this.closedRetentionMs) {
        this.deleteSession(key);
      }
    }
    for (const [id, connection] of this.connections) {
      if (connection.state === "closed" && connection.closedAt && now - connection.closedAt > this.closedRetentionMs) {
        this.connections.delete(id);
      }
    }
  }

  private enforceSessionLimit(now: number): void {
    const limit = Math.max(1, Math.floor(this.sessionLimit));
    while (this.sessions.size >= limit) {
      const oldest = [...this.sessions.entries()].sort((a, b) => {
        const aClosed = a[1].state === "closed" ? 0 : 1;
        const bClosed = b[1].state === "closed" ? 0 : 1;
        return aClosed - bClosed || a[1].lastSeenAt - b[1].lastSeenAt;
      })[0];
      if (!oldest) return;
      this.deleteSession(oldest[0]);
    }
    this.prune(now);
  }

  private enforceConnectionLimit(now: number): void {
    const limit = Math.max(1, Math.floor(this.sessionLimit));
    while (this.connections.size >= limit) {
      const oldest = [...this.connections.entries()].sort((a, b) => {
        const aClosed = a[1].state === "closed" ? 0 : 1;
        const bClosed = b[1].state === "closed" ? 0 : 1;
        return aClosed - bClosed || a[1].lastSeenAt - b[1].lastSeenAt;
      })[0];
      if (!oldest) return;
      this.deleteConnection(oldest[0], now);
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
