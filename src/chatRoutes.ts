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
  createdAt: string;
  updatedAt: string;
}

interface ChatRouteFile {
  version: 1;
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
  return isChatRouteId(record.routeId) &&
    typeof record.workspaceId === "string" && Boolean(record.workspaceId) &&
    typeof record.root === "string" && path.isAbsolute(record.root) &&
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
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
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
    if (payload.version !== 1 || payload.defaultRoot !== this.defaultRoot || !Array.isArray(payload.routes)) return;
    for (const record of payload.routes.filter(validRecord).slice(-MAX_PERSISTED_ROUTES)) {
      this.routes.set(record.routeId, { ...record });
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
      version: 1,
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
