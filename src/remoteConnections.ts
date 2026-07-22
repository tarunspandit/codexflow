import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { minimatch } from "minimatch";
import { codexFlowHome } from "./profileStore.js";

const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SSH_PATTERN_CHARS = /[*?!]/;
const MAX_CONFIG_FILES = 128;
const MAX_HOSTS = 250;

interface SavedRemoteHost {
  alias: string;
  fingerprint: string;
  verifiedAt: string;
  platform?: string;
  home?: string;
  hasNode: boolean;
  hasGit: boolean;
}

interface RemoteHostStore {
  version: 1;
  hosts: SavedRemoteHost[];
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
}

export interface RemoteConnectionsOverview {
  ok: true;
  configPath: string;
  hosts: RemoteHostOverview[];
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
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8")) as Partial<RemoteHostStore>;
    const hosts = Array.isArray(parsed.hosts)
      ? parsed.hosts.filter((host): host is SavedRemoteHost => Boolean(
          host && concreteAlias(host.alias) && typeof host.fingerprint === "string" && typeof host.verifiedAt === "string"
        ))
      : [];
    return { version: 1, hosts };
  } catch {
    return { version: 1, hosts: [] };
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
  const saved = new Map(readStore().hosts.map((host) => [host.alias, host]));
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
      hasGit: approved ? previous?.hasGit ?? false : null
    });
  }
  hosts.sort((left, right) => Number(right.approved) - Number(left.approved) || left.alias.localeCompare(right.alias));
  return {
    ok: true,
    configPath,
    hosts,
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

export function disconnectRemoteConnection(alias: string): RemoteConnectionsOverview & { message: string } {
  if (!concreteAlias(alias)) throw new Error("Choose a concrete SSH host alias from the discovered list.");
  const store = readStore();
  const next = store.hosts.filter((host) => host.alias !== alias);
  if (next.length !== store.hosts.length) writeStore({ version: 1, hosts: next });
  return { ...overview(), message: `${alias} is no longer approved for CodexFlow remote access.` };
}
