import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type RuntimeToolStatus = "ok" | "error";
export type RuntimeSessionState = "initializing" | "active" | "closed";
export type RuntimeTaskStatus = "planning" | "working" | "waiting" | "review" | "complete" | "cancelled";
export type RuntimeTaskStepStatus = "pending" | "in_progress" | "completed" | "blocked";
export type RuntimeAgentStatus = "queued" | "working" | "waiting" | "done" | "failed" | "stopped";

export interface RuntimeAgentProgress {
  id: string;
  childRouteId: string;
  name: string;
  role: string;
  status: RuntimeAgentStatus;
  detail?: string;
  result?: string;
  updatedAt: string;
}

export interface RuntimeAgentSnapshot {
  id: string;
  child_route_id: string;
  name: string;
  role: string;
  status: RuntimeAgentStatus;
  detail: string | null;
  result: string | null;
  updated_at: string;
}

export interface RuntimeAgentOverview {
  id: string;
  name: string;
  role: string;
  status: RuntimeAgentStatus;
  detail: string | null;
  result: string | null;
  updated_at: string;
}

export type RuntimeAgentCommand =
  | { action: "list" }
  | { action: "register"; childRouteId: string; name: string; role: string; status?: RuntimeAgentStatus; detail?: string }
  | { action: "update"; agentId: string; status?: RuntimeAgentStatus; detail?: string | null; result?: string | null }
  | { action: "clear" };

export interface RuntimeTaskStep {
  title: string;
  status: RuntimeTaskStepStatus;
}

export interface RuntimeTaskProgress {
  title: string;
  status: RuntimeTaskStatus;
  detail?: string;
  steps: RuntimeTaskStep[];
  updatedAt: string;
}

export interface RuntimeTaskSnapshot {
  title: string;
  status: RuntimeTaskStatus;
  detail: string | null;
  steps: RuntimeTaskStep[];
  updated_at: string;
}

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
  title: string | null;
  pinned: boolean;
  archived: boolean;
  task: RuntimeTaskSnapshot | null;
  agents: RuntimeAgentOverview[];
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
  title?: string;
  pinned: boolean;
  archived: boolean;
  task?: RuntimeTaskProgress;
  agents: RuntimeAgentProgress[];
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

interface RuntimeSessionMetadata {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  task?: RuntimeTaskProgress;
  agents?: RuntimeAgentProgress[];
  updatedAt: string;
}

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

const TASK_STATUSES = new Set<RuntimeTaskStatus>(["planning", "working", "waiting", "review", "complete", "cancelled"]);
const TASK_STEP_STATUSES = new Set<RuntimeTaskStepStatus>(["pending", "in_progress", "completed", "blocked"]);
const AGENT_STATUSES = new Set<RuntimeAgentStatus>(["queued", "working", "waiting", "done", "failed", "stopped"]);
const MAX_ROUTE_AGENTS = 16;

function sanitizeTask(value: unknown): RuntimeTaskProgress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<RuntimeTaskProgress>;
  const title = typeof candidate.title === "string" ? candidate.title.trim().slice(0, 120) : "";
  if (!title || !TASK_STATUSES.has(candidate.status as RuntimeTaskStatus) || !Array.isArray(candidate.steps)) return undefined;
  const steps = candidate.steps.slice(0, 12).flatMap((step) => {
    if (!step || typeof step !== "object") return [];
    const title = typeof step.title === "string" ? step.title.trim().slice(0, 120) : "";
    if (!title || !TASK_STEP_STATUSES.has(step.status as RuntimeTaskStepStatus)) return [];
    return [{ title, status: step.status as RuntimeTaskStepStatus }];
  });
  return {
    title,
    status: candidate.status as RuntimeTaskStatus,
    ...(typeof candidate.detail === "string" && candidate.detail.trim() ? { detail: candidate.detail.trim().slice(0, 280) } : {}),
    steps,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString()
  };
}

function sanitizeAgent(value: unknown): RuntimeAgentProgress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<RuntimeAgentProgress>;
  const id = typeof candidate.id === "string" && /^agt_[a-f0-9]{16}$/.test(candidate.id) ? candidate.id : "";
  const childRouteId = typeof candidate.childRouteId === "string" && /^route_[a-f0-9]{32}$/.test(candidate.childRouteId) ? candidate.childRouteId : "";
  const name = typeof candidate.name === "string" ? candidate.name.trim().slice(0, 80) : "";
  const role = typeof candidate.role === "string" ? candidate.role.trim().slice(0, 120) : "";
  if (!id || !childRouteId || !name || !role || !AGENT_STATUSES.has(candidate.status as RuntimeAgentStatus)) return undefined;
  return {
    id,
    childRouteId,
    name,
    role,
    status: candidate.status as RuntimeAgentStatus,
    ...(typeof candidate.detail === "string" && candidate.detail.trim() ? { detail: candidate.detail.trim().slice(0, 280) } : {}),
    ...(typeof candidate.result === "string" && candidate.result.trim() ? { result: candidate.result.trim().slice(0, 600) } : {}),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString()
  };
}

export class RuntimeMonitor {
  private readonly sessions = new Map<string, RuntimeSessionRecord>();
  private readonly connections = new Map<string, RuntimeConnectionRecord>();
  private readonly activity: RuntimeActivitySnapshot[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly metadata = new Map<string, RuntimeSessionMetadata>();
  private readonly subagentRoutes = new Map<string, { parentDisplayId: string; agentId: string; active: boolean }>();

  constructor(
    private readonly activityLimit = DEFAULT_ACTIVITY_LIMIT,
    private readonly closedRetentionMs = DEFAULT_CLOSED_RETENTION_MS,
    private readonly sessionLimit = DEFAULT_SESSION_LIMIT,
    private readonly metadataPath?: string
  ) {
    this.loadMetadata();
  }

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
        const linkedParent = routeId ? this.subagentRoutes.get(routeId) : undefined;
        const metricsSession = linkedParent
          ? [...this.sessions.values()].find((candidate) => candidate.displayId === linkedParent.parentDisplayId) ?? session
          : session;
        metricsSession.toolCalls += 1;
        if (event.status === "error") metricsSession.errors += 1;
        metricsSession.lastTool = event.name;
        metricsSession.lastToolStatus = event.status;
        metricsSession.lastSeenAt = at;
        this.activity.unshift({
          id: `evt-${randomUUID()}`,
          session_id: metricsSession.displayId,
          tool: event.name,
          status: event.status,
          duration_ms: Math.max(0, Math.floor(event.durationMs)),
          at: iso(at),
          project: publicProject(metricsSession.project)
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
      .filter((session) => Boolean(session.project) && !this.subagentRoutes.has(session.key.replace(/^route:/, "")))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
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
        last_tool_status: session.lastToolStatus ?? null,
        title: session.title ?? null,
        pinned: session.pinned,
        archived: session.archived,
        task: session.task ? {
          title: session.task.title,
          status: session.task.status,
          detail: session.task.detail ?? null,
          steps: session.task.steps.map((step) => ({ ...step })),
          updated_at: session.task.updatedAt
        } : null,
        agents: session.agents.map((agent) => this.agentOverview(agent))
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

  updateSession(
    chatId: string,
    patch: { title?: string | null; pinned?: boolean; archived?: boolean }
  ): RuntimeSessionSnapshot {
    const session = [...this.sessions.values()].find((candidate) => candidate.displayId === chatId);
    if (!session) throw new Error(`Chat not found: ${chatId}`);
    if (patch.title !== undefined) {
      const title = patch.title?.trim() || undefined;
      if (title && title.length > 80) throw new Error("Chat title must be 80 characters or fewer.");
      session.title = title;
    }
    if (patch.pinned !== undefined) session.pinned = patch.pinned;
    if (patch.archived !== undefined) session.archived = patch.archived;
    this.persistSessionMetadata(session);
    this.emit();
    return this.snapshot().sessions.find((candidate) => candidate.id === chatId)!;
  }

  updateRouteTask(routeId: string, task: RuntimeTaskProgress | null): RuntimeSessionSnapshot {
    const session = this.sessions.get(routeSessionKey(routeId));
    if (!session) throw new Error("The routed chat is not available in the runtime monitor yet.");
    session.task = task ? sanitizeTask(task) : undefined;
    this.persistSessionMetadata(session);
    this.emit();
    return this.snapshot().sessions.find((candidate) => candidate.id === session.displayId)!;
  }

  mutateRouteAgent(
    parentRouteId: string,
    sourceRouteId: string,
    command: RuntimeAgentCommand
  ): { agent?: RuntimeAgentSnapshot; agents: RuntimeAgentSnapshot[] } {
    const parent = this.sessions.get(routeSessionKey(parentRouteId));
    if (!parent?.project) throw new Error("The parent routed task is not available in the runtime monitor yet.");
    const sourceLink = this.subagentRoutes.get(sourceRouteId);
    const sourceAllowed = sourceRouteId === parentRouteId || (sourceLink?.active === true && sourceLink.parentDisplayId === parent.displayId);
    if (!sourceAllowed) throw new Error("This route is not authorized for the requested parent task.");

    let changed: RuntimeAgentProgress | undefined;
    if (command.action === "register") {
      if (sourceRouteId !== parentRouteId) throw new Error("Only the parent route can register a subagent.");
      if (parent.agents.length >= MAX_ROUTE_AGENTS) throw new Error(`A task can coordinate at most ${MAX_ROUTE_AGENTS} subagents.`);
      if (parent.agents.some((agent) => agent.childRouteId === command.childRouteId)) {
        throw new Error("This child route is already registered to the parent task.");
      }
      changed = {
        id: `agt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        childRouteId: command.childRouteId,
        name: command.name.trim().slice(0, 80),
        role: command.role.trim().slice(0, 120),
        status: command.status ?? "queued",
        ...(command.detail?.trim() ? { detail: command.detail.trim().slice(0, 280) } : {}),
        updatedAt: new Date().toISOString()
      };
      if (!changed.name || !changed.role || !AGENT_STATUSES.has(changed.status)) throw new Error("Invalid subagent registration.");
      parent.agents.push(changed);
      this.subagentRoutes.set(changed.childRouteId, { parentDisplayId: parent.displayId, agentId: changed.id, active: true });
    } else if (command.action === "update") {
      changed = parent.agents.find((agent) => agent.id === command.agentId);
      if (!changed) throw new Error("Subagent not found for this parent task.");
      if (sourceRouteId !== parentRouteId && sourceLink?.agentId !== changed.id) {
        throw new Error("A child route can update only its own subagent record.");
      }
      if (command.status !== undefined) {
        if (!AGENT_STATUSES.has(command.status)) throw new Error("Invalid subagent status.");
        changed.status = command.status;
      }
      if (command.detail !== undefined) {
        const detail = command.detail?.trim().slice(0, 280);
        if (detail) changed.detail = detail;
        else delete changed.detail;
      }
      if (command.result !== undefined) {
        const result = command.result?.trim().slice(0, 600);
        if (result) changed.result = result;
        else delete changed.result;
      }
      changed.updatedAt = new Date().toISOString();
    } else if (command.action === "clear") {
      if (sourceRouteId !== parentRouteId) throw new Error("Only the parent route can clear subagent coordination.");
      for (const agent of parent.agents) {
        this.subagentRoutes.set(agent.childRouteId, { parentDisplayId: parent.displayId, agentId: agent.id, active: false });
      }
      parent.agents = [];
    }

    this.persistSessionMetadata(parent);
    this.emit();
    return {
      ...(changed ? { agent: this.agentSnapshot(changed) } : {}),
      agents: parent.agents.map((agent) => this.agentSnapshot(agent))
    };
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
      const id = displayId(displaySeed);
      const metadata = this.metadata.get(id);
      session = {
        key,
        displayId: id,
        state: connection.state === "closed" ? "closed" : "active",
        createdAt: at,
        lastSeenAt: at,
        project: project ? { ...project } : undefined,
        toolCalls: 0,
        errors: 0,
        connectionIds: new Set(),
        title: metadata?.title,
        pinned: Boolean(metadata?.pinned),
        archived: Boolean(metadata?.archived),
        task: metadata?.task,
        agents: metadata?.agents?.map((agent) => ({ ...agent })) ?? []
      };
      this.sessions.set(key, session);
      for (const agent of session.agents) {
        this.subagentRoutes.set(agent.childRouteId, { parentDisplayId: session.displayId, agentId: agent.id, active: true });
      }
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
      if (session.state === "closed" && !session.pinned && !session.archived && session.closedAt && now - session.closedAt > this.closedRetentionMs) {
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

  private agentSnapshot(agent: RuntimeAgentProgress): RuntimeAgentSnapshot {
    return {
      id: agent.id,
      child_route_id: agent.childRouteId,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      detail: agent.detail ?? null,
      result: agent.result ?? null,
      updated_at: agent.updatedAt
    };
  }

  private agentOverview(agent: RuntimeAgentProgress): RuntimeAgentOverview {
    const { child_route_id: _privateRoute, ...overview } = this.agentSnapshot(agent);
    return overview;
  }

  private persistSessionMetadata(session: RuntimeSessionRecord): void {
    const metadata: RuntimeSessionMetadata = {
      ...(session.title ? { title: session.title } : {}),
      ...(session.pinned ? { pinned: true } : {}),
      ...(session.archived ? { archived: true } : {}),
      ...(session.task ? { task: session.task } : {}),
      ...(session.agents.length ? { agents: session.agents.map((agent) => ({ ...agent })) } : {}),
      updatedAt: new Date().toISOString()
    };
    if (session.title || session.pinned || session.archived || session.task || session.agents.length) {
      this.metadata.set(session.displayId, metadata);
    } else {
      this.metadata.delete(session.displayId);
    }
    this.saveMetadata();
  }

  private loadMetadata(): void {
    if (!this.metadataPath) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.metadataPath, "utf8")) as { sessions?: Record<string, RuntimeSessionMetadata> };
      for (const [id, value] of Object.entries(parsed.sessions ?? {})) {
        if (!/^chat-[0-9a-f]{8}$/.test(id) || !value || typeof value !== "object") continue;
        const task = sanitizeTask(value.task);
        const agents = Array.isArray(value.agents)
          ? value.agents.slice(0, MAX_ROUTE_AGENTS).flatMap((agent) => {
            const sanitized = sanitizeAgent(agent);
            return sanitized ? [sanitized] : [];
          })
          : [];
        this.metadata.set(id, {
          ...(typeof value.title === "string" && value.title.trim() ? { title: value.title.trim().slice(0, 80) } : {}),
          ...(value.pinned === true ? { pinned: true } : {}),
          ...(value.archived === true ? { archived: true } : {}),
          ...(task ? { task } : {}),
          ...(agents.length ? { agents } : {}),
          updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString()
        });
        for (const agent of agents) {
          this.subagentRoutes.set(agent.childRouteId, { parentDisplayId: id, agentId: agent.id, active: true });
        }
      }
    } catch {
      // Missing or invalid optional metadata starts with an empty local catalog.
    }
  }

  private saveMetadata(): void {
    if (!this.metadataPath) return;
    const dir = path.dirname(this.metadataPath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temp = `${this.metadataPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ version: 1, sessions: Object.fromEntries(this.metadata) }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, this.metadataPath);
    try { fs.chmodSync(this.metadataPath, 0o600); } catch { /* best effort */ }
  }
}
