import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { minimatch } from "minimatch";
import { codexFlowHome } from "./profileStore.js";
import { probeRemoteProject } from "./remoteWorkspace.js";

const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SSH_PATTERN_CHARS = /[*?!]/;
const MAX_CONFIG_FILES = 128;
const MAX_HOSTS = 250;
const MAX_REMOTE_PROJECTS = 500;
const REMOTE_PROJECT_ID_PATTERN = /^rws_[a-f0-9]{24}$/;

export interface SavedRemoteHost {
  alias: string;
  fingerprint: string;
  verifiedAt: string;
  platform?: string;
  home?: string;
  hasNode: boolean;
  hasGit: boolean;
}

export interface SavedRemoteProject {
  id: string;
  hostAlias: string;
  hostFingerprint: string;
  root: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  gitRoot?: string;
  gitRelativePath?: string;
}

interface RemoteHostStore {
  version: 2;
  hosts: SavedRemoteHost[];
  projects: SavedRemoteProject[];
}

export interface RemoteHostOverview {
  alias: string;
  hostname: string;
  user: string;
  port: number;
  source: string;
  approved: boolean;
  status: "available" | "approved" | "config_changed" | "unresolved";
  verifiedAt: string | null;
  platform: string | null;
  home: string | null;
  hasNode: boolean | null;
  hasGit: boolean | null;
  projectCount: number;
}

export interface RemoteProjectOverview {
  id: string;
  hostAlias: string;
  root: string;
  name: string;
  status: "available" | "host_unapproved" | "config_changed" | "node_unavailable" | "project_stale";
  available: boolean;
  createdAt: string;
  updatedAt: string;
  gitRoot: string | null;
  gitRelativePath: string | null;
}

export interface RemoteConnectionsOverview {
  ok: true;
  configPath: string;
  hosts: RemoteHostOverview[];
  projects: RemoteProjectOverview[];
  approved: number;
  discovered: number;
}

export interface RemoteVerificationResult extends RemoteConnectionsOverview {
  message: string;
  verifiedAlias: string;
}

function sshConfigPath(): string {
  const configured = process.env.CODEXFLOW_SSH_CONFIG?.trim();
  return configured ? path.resolve(expandHome(configured)) : path.join(os.homedir(), ".ssh", "config");
}

function sshBinary(): string {
  const configured = process.env.CODEXFLOW_SSH_BIN?.trim();
  if (configured) return path.resolve(expandHome(configured));
  return fs.existsSync("/usr/bin/ssh") ? "/usr/bin/ssh" : "ssh";
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function stripComment(line: string): string {
  let quote = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? "" : quote ? quote : char;
    } else if (char === "#" && !quote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function words(value: string): string[] {
  const matches = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((item) => item.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2"));
}

function hasMagic(value: string): boolean {
  return /[*?\[]/.test(value);
}

function includeMatches(rawPattern: string, parentFile: string): string[] {
  const expanded = expandHome(rawPattern);
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(path.dirname(parentFile), expanded);
  if (!hasMagic(absolute)) return fs.existsSync(absolute) ? [absolute] : [];

  const parsed = path.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(path.sep);
  const firstMagic = segments.findIndex(hasMagic);
  const base = path.join(parsed.root, ...segments.slice(0, Math.max(0, firstMagic)));
  if (!fs.existsSync(base)) return [];
  const candidates: string[] = [];
  const visit = (directory: string, depth: number): void => {
    if (depth > 6 || candidates.length >= MAX_CONFIG_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(child, depth + 1);
      else if (entry.isFile() && minimatch(child, absolute, { dot: true, nocase: process.platform === "win32" })) candidates.push(child);
      if (candidates.length >= MAX_CONFIG_FILES) break;
    }
  };
  visit(base, 0);
  return candidates.sort();
}

function concreteAlias(value: string): boolean {
  return ALIAS_PATTERN.test(value) && !value.startsWith("!") && !SSH_PATTERN_CHARS.test(value);
}

function discoverAliases(configPath: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const visited = new Set<string>();
  const visit = (filePath: string): void => {
    if (visited.size >= MAX_CONFIG_FILES) return;
    let real: string;
    try {
      real = fs.realpathSync(filePath);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    let source: string;
    try {
      source = fs.readFileSync(real, "utf8");
    } catch {
      return;
    }
    for (const rawLine of source.split(/\r?\n/)) {
      const line = stripComment(rawLine).trim();
      if (!line) continue;
      const match = line.match(/^(\S+)(?:\s+|=\s*)(.*)$/);
      if (!match) continue;
      const key = match[1]?.toLowerCase();
      const values = words(match[2] ?? "");
      if (key === "include") {
        for (const pattern of values) for (const child of includeMatches(pattern, real)) visit(child);
      } else if (key === "host") {
        for (const alias of values) {
          if (aliases.size >= MAX_HOSTS) break;
          if (concreteAlias(alias) && !aliases.has(alias)) aliases.set(alias, real);
        }
      }
    }
  };
  visit(configPath);
  return aliases;
}

interface ResolvedHost {
  hostname: string;
  user: string;
  port: number;
  fingerprint: string;
}

function resolveHost(alias: string): ResolvedHost | null {
  const result = spawnSync(sshBinary(), ["-G", alias], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 256 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) return null;
  const values = new Map<string, string>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+(.*)$/);
    if (match?.[1] && !values.has(match[1])) values.set(match[1], match[2] ?? "");
  }
  const hostname = values.get("hostname")?.trim() ?? "";
  const user = values.get("user")?.trim() ?? "";
  const port = Number(values.get("port") ?? 22);
  if (!hostname || !user || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const fingerprint = createHash("sha256").update(`${alias}\0${hostname}\0${user}\0${port}`).digest("hex");
  return { hostname, user, port, fingerprint };
}

function storePath(): string {
  return path.join(codexFlowHome(), "remote-hosts.json");
}

function readStore(): RemoteHostStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8")) as Partial<RemoteHostStore> & { version?: number };
    const hosts = Array.isArray(parsed.hosts)
      ? parsed.hosts.filter((host): host is SavedRemoteHost => Boolean(
          host && concreteAlias(host.alias) && typeof host.fingerprint === "string" && typeof host.verifiedAt === "string"
        ))
      : [];
    const projects = Array.isArray(parsed.projects)
      ? parsed.projects.filter((project): project is SavedRemoteProject => Boolean(
          project && REMOTE_PROJECT_ID_PATTERN.test(project.id) && concreteAlias(project.hostAlias) &&
          typeof project.hostFingerprint === "string" && /^[a-f0-9]{64}$/.test(project.hostFingerprint) &&
          typeof project.root === "string" && path.posix.isAbsolute(project.root) && project.root.length <= 4096 &&
          typeof project.name === "string" && Boolean(project.name) &&
          typeof project.createdAt === "string" && typeof project.updatedAt === "string"
        )).slice(-MAX_REMOTE_PROJECTS)
      : [];
    return { version: 2, hosts, projects };
  } catch {
    return { version: 2, hosts: [], projects: [] };
  }
}

function writeStore(store: RemoteHostStore): void {
  const home = codexFlowHome();
  const target = storePath();
  const temporary = path.join(home, `.remote-hosts.${process.pid}.${randomUUID()}.tmp`);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    // Best-effort permission repair on filesystems with POSIX modes.
  }
}

function overview(configPath = sshConfigPath()): RemoteConnectionsOverview {
  const aliases = discoverAliases(configPath);
  const store = readStore();
  const saved = new Map(store.hosts.map((host) => [host.alias, host]));
  const hosts: RemoteHostOverview[] = [];
  for (const [alias, source] of aliases) {
    const resolved = resolveHost(alias);
    const previous = saved.get(alias);
    const approved = Boolean(resolved && previous?.fingerprint === resolved.fingerprint);
    hosts.push({
      alias,
      hostname: resolved?.hostname ?? "",
      user: resolved?.user ?? "",
      port: resolved?.port ?? 22,
      source,
      approved,
      status: !resolved ? "unresolved" : approved ? "approved" : previous ? "config_changed" : "available",
      verifiedAt: approved ? previous?.verifiedAt ?? null : null,
      platform: approved ? previous?.platform ?? null : null,
      home: approved ? previous?.home ?? null : null,
      hasNode: approved ? previous?.hasNode ?? false : null,
      hasGit: approved ? previous?.hasGit ?? false : null,
      projectCount: store.projects.filter((project) => project.hostAlias === alias).length
    });
  }
  hosts.sort((left, right) => Number(right.approved) - Number(left.approved) || left.alias.localeCompare(right.alias));
  const hostByAlias = new Map(hosts.map((host) => [host.alias, host]));
  const projects: RemoteProjectOverview[] = store.projects.map((project) => {
    const host = hostByAlias.get(project.hostAlias);
    const savedHost = saved.get(project.hostAlias);
    const configChanged = Boolean(host && savedHost && host.status === "config_changed");
    const status: RemoteProjectOverview["status"] = configChanged
      ? "config_changed"
      : !host?.approved
        ? "host_unapproved"
        : savedHost?.fingerprint !== project.hostFingerprint
          ? "project_stale"
        : !host.hasNode
          ? "node_unavailable"
          : "available";
    return {
      id: project.id,
      hostAlias: project.hostAlias,
      root: project.root,
      name: project.name,
      status,
      available: status === "available" && savedHost?.fingerprint === project.hostFingerprint,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      gitRoot: project.gitRoot ?? null,
      gitRelativePath: project.gitRelativePath ?? null
    };
  }).sort((left, right) => Number(right.available) - Number(left.available) || left.name.localeCompare(right.name));
  return {
    ok: true,
    configPath,
    hosts,
    projects,
    approved: hosts.filter((host) => host.approved).length,
    discovered: hosts.length
  };
}

export function listRemoteConnections(): RemoteConnectionsOverview {
  return overview();
}

function probeFields(output: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    fields[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }
  return fields;
}

export function verifyRemoteConnection(alias: string): RemoteVerificationResult {
  if (!concreteAlias(alias)) throw new Error("Choose a concrete SSH host alias from the discovered list.");
  const configPath = sshConfigPath();
  const aliases = discoverAliases(configPath);
  if (!aliases.has(alias)) throw new Error("That SSH host is not present as a concrete alias in the local SSH config.");
  const resolved = resolveHost(alias);
  if (!resolved) throw new Error("OpenSSH could not resolve that host alias.");

  const command = "printf 'codexflow_remote=1\\n'; printf 'platform='; uname -s 2>/dev/null || printf unknown; printf 'home=%s\\n' \"$HOME\"; command -v node >/dev/null 2>&1 && printf 'node=1\\n' || printf 'node=0\\n'; command -v git >/dev/null 2>&1 && printf 'git=1\\n' || printf 'git=0\\n'";
  const result = spawnSync(sshBinary(), [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=8",
    "-o", "StrictHostKeyChecking=yes",
    alias,
    command
  ], {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error?.name === "ETIMEDOUT") throw new Error("SSH verification timed out.");
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.error?.message || "SSH exited without completing the probe.")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 240);
    throw new Error(`SSH verification failed. ${detail}`.trim());
  }
  const fields = probeFields(result.stdout);
  if (fields.codexflow_remote !== "1") throw new Error("The remote host returned an invalid verification response.");

  const saved: SavedRemoteHost = {
    alias,
    fingerprint: resolved.fingerprint,
    verifiedAt: new Date().toISOString(),
    platform: fields.platform?.slice(0, 80) || undefined,
    home: fields.home?.slice(0, 4096) || undefined,
    hasNode: fields.node === "1",
    hasGit: fields.git === "1"
  };
  const store = readStore();
  store.hosts = [...store.hosts.filter((host) => host.alias !== alias), saved].sort((a, b) => a.alias.localeCompare(b.alias));
  writeStore(store);
  return { ...overview(configPath), verifiedAlias: alias, message: `${alias} is verified and approved for CodexFlow remote access.` };
}

function approvedHost(alias: string): SavedRemoteHost {
  if (!concreteAlias(alias)) throw new Error("Choose a concrete SSH host alias from the discovered list.");
  const configPath = sshConfigPath();
  if (!discoverAliases(configPath).has(alias)) throw new Error("That SSH host is no longer present as a concrete alias in the local SSH config.");
  const resolved = resolveHost(alias);
  const saved = readStore().hosts.find((host) => host.alias === alias);
  if (!resolved || !saved || saved.fingerprint !== resolved.fingerprint) {
    throw new Error("This SSH host is not currently approved. Verify it again before saving or using remote projects.");
  }
  if (!saved.hasNode) throw new Error("CodexFlow remote projects require Node.js on the approved host.");
  return saved;
}

export function listSavedRemoteProjects(options: { availableOnly?: boolean } = {}): RemoteProjectOverview[] {
  const projects = overview().projects;
  return options.availableOnly ? projects.filter((project) => project.available) : projects;
}

export function getApprovedRemoteProject(projectId: string): SavedRemoteProject {
  if (!REMOTE_PROJECT_ID_PATTERN.test(projectId)) throw new Error("Invalid remote project id.");
  const store = readStore();
  const project = store.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error("The saved remote project no longer exists.");
  const host = approvedHost(project.hostAlias);
  if (host.fingerprint !== project.hostFingerprint) throw new Error("The remote project's approved host identity changed. Verify the host and save the project again.");
  return { ...project };
}

export function saveRemoteProject(alias: string, requestedRoot: string): RemoteConnectionsOverview & { message: string; savedProjectId: string } {
  const rawRoot = requestedRoot.trim();
  if (!rawRoot || rawRoot.length > 4096 || /[\0\r\n]/.test(rawRoot)) throw new Error("Enter one valid remote folder path.");
  const host = approvedHost(alias);
  const probe = probeRemoteProject(alias, rawRoot);
  if (!path.posix.isAbsolute(probe.root) || probe.root.length > 4096) throw new Error("The remote host returned an invalid project path.");
  const id = `rws_${createHash("sha256").update(`${alias}\0${host.fingerprint}\0${probe.root}`).digest("hex").slice(0, 24)}`;
  const store = readStore();
  const existing = store.projects.find((project) => project.id === id);
  const now = new Date().toISOString();
  const project: SavedRemoteProject = {
    id,
    hostAlias: alias,
    hostFingerprint: host.fingerprint,
    root: probe.root,
    name: (probe.name || path.posix.basename(probe.root) || alias).slice(0, 160),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(probe.gitRoot ? { gitRoot: probe.gitRoot } : {}),
    ...(probe.gitRelativePath ? { gitRelativePath: probe.gitRelativePath } : {})
  };
  store.projects = [...store.projects.filter((candidate) => candidate.id !== id && !(candidate.hostAlias === alias && candidate.root === probe.root)), project]
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(-MAX_REMOTE_PROJECTS);
  writeStore(store);
  return { ...overview(), savedProjectId: id, message: `${project.name} on ${alias} is now available in the CodexFlow project picker.` };
}

export function removeRemoteProject(projectId: string): RemoteConnectionsOverview & { message: string } {
  if (!REMOTE_PROJECT_ID_PATTERN.test(projectId)) throw new Error("Invalid remote project id.");
  const store = readStore();
  const project = store.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error("The saved remote project no longer exists.");
  store.projects = store.projects.filter((candidate) => candidate.id !== projectId);
  writeStore(store);
  return { ...overview(), message: `${project.name} was removed from the CodexFlow project picker.` };
}

export function disconnectRemoteConnection(alias: string): RemoteConnectionsOverview & { message: string } {
  if (!concreteAlias(alias)) throw new Error("Choose a concrete SSH host alias from the discovered list.");
  const store = readStore();
  const next = store.hosts.filter((host) => host.alias !== alias);
  if (next.length !== store.hosts.length || store.projects.some((project) => project.hostAlias === alias)) {
    writeStore({ version: 2, hosts: next, projects: store.projects.filter((project) => project.hostAlias !== alias) });
  }
  return { ...overview(), message: `${alias} is no longer approved for CodexFlow remote access.` };
}
