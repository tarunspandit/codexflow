import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";
import type { CodexFlowConfig } from "./config.js";
import { bashEnvironment, bashExecutable } from "./bashOps.js";
import { CodexFlowError, isSubpath, type Workspace } from "./guard.js";
import { redactSensitiveText } from "./redact.js";

export type LocalEnvironmentPlatform = "darwin" | "linux" | "win32";
export type LocalEnvironmentScriptKind = "setup" | "cleanup";

export interface LocalEnvironmentScript {
  script: string;
  darwin?: string;
  linux?: string;
  win32?: string;
}

export interface LocalEnvironmentAction {
  name: string;
  icon?: "tool" | "run" | "debug" | "test";
  command: string;
  platform?: LocalEnvironmentPlatform;
}

export interface LocalEnvironment {
  configPath: string;
  sourceRoot: string;
  inherited: boolean;
  version: 1;
  name: string;
  setup: LocalEnvironmentScript;
  cleanup?: LocalEnvironmentScript;
  actions: LocalEnvironmentAction[];
}

export interface LocalEnvironmentCommandResult {
  environment: string;
  configPath: string;
  kind: LocalEnvironmentScriptKind | "action";
  action?: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

interface ScriptTable {
  script?: unknown;
  darwin?: { script?: unknown };
  linux?: { script?: unknown };
  win32?: { script?: unknown };
}

export function currentEnvironmentPlatform(): LocalEnvironmentPlatform {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  return "linux";
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseScript(value: unknown, required: boolean): LocalEnvironmentScript | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (required) return { script: "" };
    return undefined;
  }
  const table = value as ScriptTable;
  const result: LocalEnvironmentScript = { script: stringValue(table.script) };
  for (const platform of ["darwin", "linux", "win32"] as const) {
    const script = stringValue(table[platform]?.script);
    if (script) result[platform] = script;
  }
  return result;
}

export function parseEnvironmentText(
  raw: string,
  configPath: string,
  sourceRoot: string,
  workspaceRoot: string
): LocalEnvironment {
  let parsed: Record<string, unknown>;
  try {
    parsed = parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new CodexFlowError(`Invalid local environment TOML in ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed.version !== 1) throw new CodexFlowError(`Unsupported local environment version in ${configPath}. Expected version = 1.`);
  const name = stringValue(parsed.name).trim();
  if (!name) throw new CodexFlowError(`Local environment has no name: ${configPath}`);
  const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const actions: LocalEnvironmentAction[] = rawActions.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new CodexFlowError(`Invalid action ${index + 1} in ${configPath}.`);
    }
    const item = value as Record<string, unknown>;
    const actionName = stringValue(item.name).trim();
    const command = stringValue(item.command).trim();
    if (!actionName || !command) throw new CodexFlowError(`Action ${index + 1} in ${configPath} requires name and command.`);
    const platform = stringValue(item.platform) as LocalEnvironmentPlatform | "";
    if (platform && !["darwin", "linux", "win32"].includes(platform)) {
      throw new CodexFlowError(`Action ${actionName} in ${configPath} has an unsupported platform.`);
    }
    const icon = stringValue(item.icon) as LocalEnvironmentAction["icon"] | "";
    if (icon && !["tool", "run", "debug", "test"].includes(icon)) {
      throw new CodexFlowError(`Action ${actionName} in ${configPath} has an unsupported icon.`);
    }
    return {
      name: actionName,
      command,
      ...(icon ? { icon } : {}),
      ...(platform ? { platform } : {})
    };
  });
  return {
    configPath,
    sourceRoot,
    inherited: sourceRoot !== workspaceRoot,
    version: 1,
    name,
    setup: parseScript(parsed.setup, true)!,
    cleanup: parseScript(parsed.cleanup, false),
    actions
  };
}

function parseEnvironmentFile(config: CodexFlowConfig, file: string, sourceRoot: string, workspace: Workspace): LocalEnvironment {
  let raw: string;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new CodexFlowError("Local environment config must be a regular file.");
    if (stat.size > Math.min(config.maxReadBytes, 1024 * 1024)) {
      throw new CodexFlowError(`Local environment config is too large: ${file}`);
    }
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof CodexFlowError) throw error;
    throw new CodexFlowError(`Unable to read local environment config: ${file}`);
  }
  const configPath = fs.realpathSync(file);
  return parseEnvironmentText(raw, configPath, sourceRoot, workspace.root);
}

function discoveryCeiling(config: CodexFlowConfig, workspace: Workspace): string {
  const candidates = config.allowedRoots
    .filter((root) => isSubpath(workspace.root, root))
    .sort((a, b) => b.length - a.length);
  return candidates[0] ?? workspace.root;
}

export function listLocalEnvironments(config: CodexFlowConfig, workspace: Workspace): LocalEnvironment[] {
  const ceiling = discoveryCeiling(config, workspace);
  const roots: string[] = [];
  let cursor = workspace.root;
  while (isSubpath(cursor, ceiling)) {
    roots.push(cursor);
    if (cursor === ceiling) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  const environments: LocalEnvironment[] = [];
  for (const sourceRoot of roots) {
    const directory = path.join(sourceRoot, ".codex", "environments");
    let files: string[] = [];
    try {
      files = fs.readdirSync(directory)
        .filter((name) => name.endsWith(".toml"))
        .sort()
        .map((name) => path.join(directory, name));
    } catch {
      continue;
    }
    for (const file of files) environments.push(parseEnvironmentFile(config, file, sourceRoot, workspace));
  }
  return environments;
}

export function resolveLocalEnvironment(
  config: CodexFlowConfig,
  workspace: Workspace,
  selector?: string
): LocalEnvironment {
  const environments = listLocalEnvironments(config, workspace);
  if (!environments.length) {
    throw new CodexFlowError("No local environments were found. Create a version 1 TOML file in .codex/environments/.");
  }
  const needle = selector?.trim();
  if (!needle) {
    if (environments.length === 1) return environments[0];
    throw new CodexFlowError("More than one local environment is available. Provide config_path or environment name.");
  }
  const absoluteNeedle = path.isAbsolute(needle) ? path.resolve(needle) : undefined;
  const matches = environments.filter((environment) =>
    environment.name === needle ||
    environment.configPath === absoluteNeedle ||
    path.basename(environment.configPath) === needle
  );
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new CodexFlowError(`Local environment not found: ${needle}`);
  throw new CodexFlowError(`Local environment selector is ambiguous: ${needle}`);
}

export function environmentScript(environment: LocalEnvironment, kind: LocalEnvironmentScriptKind): string {
  return environmentScriptForPlatform(environment, kind, currentEnvironmentPlatform());
}

export function environmentScriptForPlatform(
  environment: LocalEnvironment,
  kind: LocalEnvironmentScriptKind,
  platform: LocalEnvironmentPlatform
): string {
  const table = kind === "setup" ? environment.setup : environment.cleanup;
  if (!table) return "";
  return (table[platform] ?? table.script).trim();
}

export function environmentAction(environment: LocalEnvironment, name: string): LocalEnvironmentAction {
  return environmentActionForPlatform(environment, name, currentEnvironmentPlatform());
}

export function environmentActionForPlatform(
  environment: LocalEnvironment,
  name: string,
  platform: LocalEnvironmentPlatform
): LocalEnvironmentAction {
  const matches = environment.actions.filter((action) => action.name === name && (!action.platform || action.platform === platform));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new CodexFlowError(`Action is unavailable for ${platform}: ${name}`);
  throw new CodexFlowError(`Action name is ambiguous for ${platform}: ${name}`);
}

function shellQuote(value: string): string {
  if (process.platform === "win32") return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function environmentTerminalCommand(command: string, sourceWorkspacePath: string, worktreePath: string): string {
  if (process.platform === "win32") {
    return `set "CODEX_SOURCE_TREE_PATH=${sourceWorkspacePath}" && set "CODEX_WORKTREE_PATH=${worktreePath}" && ${command}`;
  }
  return `export CODEX_SOURCE_TREE_PATH=${shellQuote(sourceWorkspacePath)} CODEX_WORKTREE_PATH=${shellQuote(worktreePath)}; ${command}`;
}

function boundedAppend(current: string, chunk: Buffer | string, maxBytes: number): { value: string; exceeded: boolean } {
  const next = current + chunk.toString();
  const bytes = Buffer.byteLength(next);
  if (bytes <= maxBytes) return { value: next, exceeded: false };
  return { value: Buffer.from(next).subarray(0, maxBytes).toString("utf8"), exceeded: true };
}

export async function runLocalEnvironmentCommand(
  config: CodexFlowConfig,
  environment: LocalEnvironment,
  options: {
    kind: LocalEnvironmentScriptKind | "action";
    actionName?: string;
    cwd: string;
    sourceWorkspacePath: string;
    worktreePath: string;
    timeoutMs?: number;
  }
): Promise<LocalEnvironmentCommandResult> {
  if (config.bashMode === "off") throw new CodexFlowError("Local environment scripts require bash mode to be enabled.");
  const action = options.kind === "action" ? environmentAction(environment, options.actionName ?? "") : undefined;
  const command = action?.command ?? environmentScript(environment, options.kind as LocalEnvironmentScriptKind);
  if (!command) {
    return {
      environment: environment.name,
      configPath: environment.configPath,
      kind: options.kind,
      ...(action ? { action: action.name } : {}),
      command: "",
      cwd: options.cwd,
      exitCode: 0,
      signal: null,
      timedOut: false,
      durationMs: 0,
      stdout: "",
      stderr: ""
    };
  }
  if (!fs.existsSync(options.cwd) || !fs.statSync(options.cwd).isDirectory()) {
    throw new CodexFlowError(`Local environment working directory does not exist: ${options.cwd}`);
  }
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 600_000, 600_000));
  const shell = process.platform === "win32"
    ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command] }
    : { command: bashExecutable(), args: ["--noprofile", "--norc", "-lc", command] };
  const started = Date.now();
  return await new Promise<LocalEnvironmentCommandResult>((resolve, reject) => {
    const child = spawn(shell.command, shell.args, {
      cwd: options.cwd,
      env: {
        ...bashEnvironment(config),
        CODEX_SOURCE_TREE_PATH: options.sourceWorkspacePath,
        CODEX_WORKTREE_PATH: options.worktreePath
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let exceeded = false;
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      const next = boundedAppend(stdout, chunk, config.maxOutputBytes);
      stdout = next.value;
      exceeded ||= next.exceeded;
      if (exceeded) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      const next = boundedAppend(stderr, chunk, config.maxOutputBytes);
      stderr = next.value;
      exceeded ||= next.exceeded;
      if (exceeded) child.kill("SIGTERM");
    });
    child.on("error", (error) => reject(new CodexFlowError(`Unable to start local environment command: ${error.message}`)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, timeoutMs);
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      const result: LocalEnvironmentCommandResult = {
        environment: environment.name,
        configPath: environment.configPath,
        kind: options.kind,
        ...(action ? { action: action.name } : {}),
        command,
        cwd: options.cwd,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - started,
        stdout: redactSensitiveText(stdout),
        stderr: redactSensitiveText(stderr)
      };
      if (timedOut) {
        reject(new CodexFlowError(`Local environment ${options.kind} timed out after ${timeoutMs} ms.`));
        return;
      }
      if (exceeded) {
        reject(new CodexFlowError("Local environment output exceeded the configured limit."));
        return;
      }
      if (exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim() || `exit ${exitCode ?? signal ?? "unknown"}`;
        reject(new CodexFlowError(`Local environment ${options.kind} failed: ${detail}`));
        return;
      }
      resolve(result);
    });
  });
}

export function localEnvironmentSummary(
  environment: LocalEnvironment,
  platform = currentEnvironmentPlatform()
): Record<string, unknown> {
  return {
    config_path: environment.configPath,
    source_root: environment.sourceRoot,
    inherited: environment.inherited,
    version: environment.version,
    name: environment.name,
    platform,
    has_setup: Boolean(environmentScriptForPlatform(environment, "setup", platform)),
    has_cleanup: Boolean(environmentScriptForPlatform(environment, "cleanup", platform)),
    actions: environment.actions
      .filter((action) => !action.platform || action.platform === platform)
      .map((action) => ({ name: action.name, icon: action.icon ?? "tool", platform: action.platform ?? "all" }))
  };
}
