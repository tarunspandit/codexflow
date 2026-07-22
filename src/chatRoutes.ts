import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { codexFlowHome, profileIdForRoot } from "./profileStore.js";

const ROUTE_ID_PATTERN = /^route_[a-f0-9]{32}$/;
const MAX_PERSISTED_ROUTES = 5_000;

export interface ChatRouteRecord {
  routeId: string;
  workspaceId: string;
  root: string;
  location: "local" | "remote";
  remoteHostAlias?: string;
  remoteHostFingerprint?: string;
  environmentConfigPath?: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatRouteFile {
  version: 1 | 2;
  defaultRoot: string;
  updatedAt: string;
  routes: ChatRouteRecord[];
}

export function isChatRouteId(value: unknown): value is string {
  return typeof value === "string" && ROUTE_ID_PATTERN.test(value);
}

export function createChatRouteId(): string {
  return `route_${randomBytes(16).toString("hex")}`;
}

export function chatRouteFilePath(defaultRoot: string): string {
  return path.join(codexFlowHome(), "routes", `${profileIdForRoot(defaultRoot)}.json`);
}

function validRecord(value: unknown): value is ChatRouteRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ChatRouteRecord>;
  const location = record.location === undefined ? "local" : record.location;
  return isChatRouteId(record.routeId) &&
    typeof record.workspaceId === "string" && Boolean(record.workspaceId) &&
    typeof record.root === "string" && path.isAbsolute(record.root) &&
    (location === "local" || location === "remote") &&
    (location === "local" || (
      typeof record.remoteHostAlias === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(record.remoteHostAlias) &&
      typeof record.remoteHostFingerprint === "string" && /^[a-f0-9]{64}$/.test(record.remoteHostFingerprint)
    )) &&
    (record.environmentConfigPath === undefined || (typeof record.environmentConfigPath === "string" && path.isAbsolute(record.environmentConfigPath))) &&
    typeof record.createdAt === "string" && Boolean(record.createdAt) &&
    typeof record.updatedAt === "string" && Boolean(record.updatedAt);
}

export class ChatRouteStore {
  private readonly filePath: string;
  private readonly routes = new Map<string, ChatRouteRecord>();

  constructor(private readonly defaultRoot: string) {
    this.filePath = chatRouteFilePath(defaultRoot);
    this.load();
  }

  createRouteId(): string {
    let routeId = createChatRouteId();
    while (this.routes.has(routeId)) routeId = createChatRouteId();
    return routeId;
  }

  get(routeId: string): ChatRouteRecord | undefined {
    if (!isChatRouteId(routeId)) return undefined;
    const record = this.routes.get(routeId);
    return record ? { ...record } : undefined;
  }

  bind(routeId: string, workspace: { id: string; root: string }): ChatRouteRecord {
    if (!isChatRouteId(routeId)) {
      throw new Error("Invalid CodexFlow route_id. Call list_projects to create a new private chat route.");
    }
    const now = new Date().toISOString();
    const existing = this.routes.get(routeId);
    const record: ChatRouteRecord = {
      routeId,
      workspaceId: workspace.id,
      root: workspace.root,
      location: "local",
      ...(existing?.environmentConfigPath ? { environmentConfigPath: existing.environmentConfigPath } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.routes.set(routeId, record);
    this.persist();
    return { ...record };
  }

  bindRemote(routeId: string, project: { id: string; root: string; hostAlias: string; hostFingerprint: string }): ChatRouteRecord {
    if (!isChatRouteId(routeId)) {
      throw new Error("Invalid CodexFlow route_id. Call list_projects to create a new private chat route.");
    }
    if (!path.posix.isAbsolute(project.root) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(project.hostAlias) || !/^[a-f0-9]{64}$/.test(project.hostFingerprint)) {
      throw new Error("Invalid approved remote project route.");
    }
    const now = new Date().toISOString();
    const existing = this.routes.get(routeId);
    const record: ChatRouteRecord = {
      routeId,
      workspaceId: project.id,
      root: project.root,
      location: "remote",
      remoteHostAlias: project.hostAlias,
      remoteHostFingerprint: project.hostFingerprint,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.routes.set(routeId, record);
    this.persist();
    return { ...record };
  }

  selectEnvironment(routeId: string, configPath?: string): ChatRouteRecord {
    if (!isChatRouteId(routeId)) throw new Error("Invalid CodexFlow route_id.");
    const existing = this.routes.get(routeId);
    if (!existing) throw new Error("This private chat route is not bound to a project.");
    const record: ChatRouteRecord = {
      ...existing,
      ...(configPath ? { environmentConfigPath: path.resolve(configPath) } : {}),
      updatedAt: new Date().toISOString()
    };
    if (!configPath) delete record.environmentConfigPath;
    this.routes.set(routeId, record);
    this.persist();
    return { ...record };
  }

  private load(): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const payload = parsed as Partial<ChatRouteFile>;
    if ((payload.version !== 1 && payload.version !== 2) || payload.defaultRoot !== this.defaultRoot || !Array.isArray(payload.routes)) return;
    for (const record of payload.routes.filter(validRecord).slice(-MAX_PERSISTED_ROUTES)) {
      this.routes.set(record.routeId, { ...record, location: record.location ?? "local" });
    }
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const routes = [...this.routes.values()]
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(-MAX_PERSISTED_ROUTES);
    if (routes.length !== this.routes.size) {
      this.routes.clear();
      for (const route of routes) this.routes.set(route.routeId, route);
    }
    const payload: ChatRouteFile = {
      version: 2,
      defaultRoot: this.defaultRoot,
      updatedAt: new Date().toISOString(),
      routes
    };
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, this.filePath);
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // Best-effort permission repair for filesystems that support chmod.
    }
  }
}
