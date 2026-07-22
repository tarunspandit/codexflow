import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CodexFlowConfig } from "./config.js";
import type { Workspace } from "./guard.js";
import { CodexFlowError, PathGuard } from "./guard.js";
import type { SavedRemoteProject } from "./remoteConnections.js";
import { runRemoteWorkspaceOperation } from "./remoteWorkspace.js";
import {
  assertBashCommandAllowed,
  assertBashSession,
  bashEnvironment,
  bashExecutable
} from "./bashOps.js";
import { redactSensitiveText } from "./redact.js";

interface TranscriptChunk {
  cursor: number;
  text: string;
}

interface ActiveCommand {
  id: string;
  command: string;
  startedAt: number;
  beginMarker: string;
  endMarker: string;
  raw: string;
  began: boolean;
  resolve: (result: TerminalCommandResult) => void;
  timer: NodeJS.Timeout;
}

interface TerminalSession {
  id: string;
  routeId: string;
  workspaceRoot: string;
  targetIdentity: string;
  child: ChildProcessWithoutNullStreams;
  chunks: TranscriptChunk[];
  transcriptBytes: number;
  cursor: number;
  createdAt: number;
  lastUsedAt: number;
  ready: Promise<void>;
  active?: ActiveCommand;
  closed: boolean;
}

interface TerminalTarget {
  workspaceRoot: string;
  identity: string;
  location: "local" | "remote";
}

interface TerminalProcessSpec {
  command: string;
  args: string[];
  detached: boolean;
  waitForReady: boolean;
  initialize: (readyMarker: string) => string;
  decode: (encoded: string) => string;
}

export interface TerminalCommandResult {
  terminalId: string;
  commandId: string;
  command: string;
  workspaceRoot: string;
  exitCode: number | null;
  durationMs: number;
  output: string;
  completed: boolean;
  cursor: number;
}

export interface TerminalReadResult {
  terminalId: string;
  workspaceRoot: string;
  output: string;
  cursor: number;
  earliestCursor: number;
  activeCommandId?: string;
  activeCommand?: string;
  running: boolean;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function terminalProcess(): TerminalProcessSpec {
  if (process.platform === "darwin") {
    return {
      command: "/bin/sh",
      args: ["-c", `cat | /usr/bin/script -q /dev/null ${shellQuote(bashExecutable())} --noprofile --norc`],
      detached: true,
      waitForReady: true,
      initialize: (readyMarker) => `stty -echo; printf '${readyMarker}\\n'\n`,
      decode: (encoded) => `printf '%s' '${encoded}' | /usr/bin/base64 -D`
    };
  }
  if (process.platform === "linux") {
    return {
      command: "/bin/sh",
      args: ["-c", `cat | /usr/bin/script -q -c ${shellQuote(`${bashExecutable()} --noprofile --norc`)} /dev/null`],
      detached: true,
      waitForReady: true,
      initialize: (readyMarker) => `stty -echo; printf '${readyMarker}\\n'\n`,
      decode: (encoded) => `printf '%s' '${encoded}' | base64 -d`
    };
  }
  return {
    command: bashExecutable(),
    args: ["--noprofile", "--norc"],
    detached: false,
    waitForReady: false,
    initialize: () => "",
    decode: (encoded) => `printf '%s' '${encoded}' | base64 -d`
  };
}

function expandHome(value: string): string {
  if (value === "~") return process.env.HOME ?? "";
  if (value.startsWith("~/")) return `${process.env.HOME ?? ""}/${value.slice(2)}`;
  return value;
}

function sshBinary(): string {
  const configured = process.env.CODEXFLOW_SSH_BIN?.trim();
  if (configured) return expandHome(configured);
  return process.platform !== "win32" && fs.existsSync("/usr/bin/ssh") ? "/usr/bin/ssh" : "ssh";
}

function remoteTerminalProcess(project: SavedRemoteProject): TerminalProcessSpec {
  const remoteCommand = "if [ -x /bin/bash ]; then exec /bin/bash --noprofile --norc; else exec bash --noprofile --norc; fi";
  return {
    command: sshBinary(),
    args: [
      "-T",
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=8",
      "-o", "StrictHostKeyChecking=yes",
      project.hostAlias,
      remoteCommand
    ],
    detached: process.platform !== "win32",
    waitForReady: true,
    initialize: (readyMarker) =>
      `cd -- ${shellQuote(project.root)} || exit 70; export NO_COLOR=1; export CI=1; printf '${readyMarker}\\n'\n`,
    decode: (encoded) => `node -e 'process.stdout.write(Buffer.from(process.argv[1],"base64").toString("utf8"))' '${encoded}'`
  };
}

function localTarget(workspace: Workspace): TerminalTarget {
  return {
    workspaceRoot: workspace.root,
    identity: `local:${workspace.id}:${workspace.root}`,
    location: "local"
  };
}

function remoteTarget(project: SavedRemoteProject): TerminalTarget {
  return {
    workspaceRoot: project.root,
    identity: `remote:${project.id}:${project.hostFingerprint}:${project.root}`,
    location: "remote"
  };
}

class TerminalRegistry {
  private readonly sessions = new Map<string, TerminalSession>();

  private append(config: CodexFlowConfig, session: TerminalSession, raw: string): void {
    if (!raw) return;
    const visible = raw
      .replace(/__CODEXFLOW_(?:BEGIN|END)_cmd_[a-f0-9]+__(?::\d+)?\r?\n?/g, "")
      .replace(/^stty -echo\r?\n?/gm, "");
    if (!visible) return;
    const text = redactSensitiveText(visible);
    session.cursor += 1;
    session.chunks.push({ cursor: session.cursor, text });
    session.transcriptBytes += Buffer.byteLength(text, "utf8");
    const maxBytes = Math.max(config.maxOutputBytes * 4, 64_000);
    while (session.chunks.length > 1 && session.transcriptBytes > maxBytes) {
      const removed = session.chunks.shift();
      if (removed) session.transcriptBytes -= Buffer.byteLength(removed.text, "utf8");
    }
  }

  private finishActive(config: CodexFlowConfig, session: TerminalSession, exitCode: number | null, output: string): void {
    const active = session.active;
    if (!active) return;
    clearTimeout(active.timer);
    session.active = undefined;
    session.lastUsedAt = Date.now();
    active.resolve({
      terminalId: session.id,
      commandId: active.id,
      command: active.command,
      workspaceRoot: session.workspaceRoot,
      exitCode,
      durationMs: Date.now() - active.startedAt,
      output: redactSensitiveText(output).trimEnd(),
      completed: true,
      cursor: session.cursor
    });
  }

  private consumeStdout(config: CodexFlowConfig, session: TerminalSession, raw: string): void {
    this.append(config, session, raw);
    const active = session.active;
    if (!active) return;
    active.raw += raw;
    if (Buffer.byteLength(active.raw, "utf8") > config.maxOutputBytes * 4) {
      const bounded = Buffer.from(active.raw, "utf8").subarray(0, config.maxOutputBytes * 2).toString("utf8");
      this.append(config, session, "\n[codexflow] Command output exceeded the persistent terminal limit; terminal stopped.\n");
      this.finishActive(config, session, null, `${bounded}\n...[terminal output truncated]`);
      this.stop(session.routeId);
      return;
    }
    if (!active.began) {
      const beginAt = active.raw.indexOf(active.beginMarker);
      if (beginAt < 0) return;
      active.raw = active.raw.slice(beginAt + active.beginMarker.length).replace(/^\r?\n/, "");
      active.began = true;
    }
    const endAt = active.raw.indexOf(active.endMarker);
    if (endAt < 0) return;
    const output = active.raw.slice(0, endAt).replace(/\r?\n$/, "");
    const afterMarker = active.raw.slice(endAt + active.endMarker.length);
    const match = afterMarker.match(/^:(\d+)\r?\n?/);
    const exitCode = match ? Number(match[1]) : null;
    this.finishActive(config, session, exitCode, output);
  }

  private create(
    config: CodexFlowConfig,
    routeId: string,
    target: TerminalTarget,
    processSpec: TerminalProcessSpec
  ): TerminalSession {
    this.prune(config);
    const child = spawn(processSpec.command, processSpec.args, {
      ...(target.location === "local" ? { cwd: target.workspaceRoot } : {}),
      env: target.location === "remote"
        ? { ...process.env, NO_COLOR: "1", CI: process.env.CI ?? "1" }
        : { ...bashEnvironment(config), PS1: "", PS2: "", PROMPT_COMMAND: "" },
      stdio: ["pipe", "pipe", "pipe"],
      detached: processSpec.detached
    });
    const now = Date.now();
    const readyMarker = `__CODEXFLOW_READY_${randomBytes(8).toString("hex")}__`;
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    let readyResolved = !processSpec.waitForReady;
    let readyBuffer = "";
    if (readyResolved) resolveReady();
    const session: TerminalSession = {
      id: `term_${randomBytes(8).toString("hex")}`,
      routeId,
      workspaceRoot: target.workspaceRoot,
      targetIdentity: target.identity,
      child,
      chunks: [],
      transcriptBytes: 0,
      cursor: 0,
      createdAt: now,
      lastUsedAt: now,
      ready,
      closed: false
    };
    this.sessions.set(routeId, session);
    const readyTimer = setTimeout(() => {
      if (readyResolved || session.closed) return;
      readyResolved = true;
      this.append(config, session, "[codexflow] terminal did not become ready within 15 seconds.\n");
      resolveReady();
      this.stop(routeId);
    }, 15_000);
    readyTimer.unref();
    child.stdout.on("data", (chunk) => {
      let raw = String(chunk);
      if (!readyResolved) {
        readyBuffer += raw;
        const readyMatch = readyBuffer.match(new RegExp(`(?:^|\\r?\\n)${readyMarker}\\r?\\n`));
        if (readyMatch?.index !== undefined) {
          readyResolved = true;
          clearTimeout(readyTimer);
          resolveReady();
          raw = readyBuffer.slice(readyMatch.index + readyMatch[0].length);
          readyBuffer = "";
        } else return;
      }
      this.consumeStdout(config, session, raw);
    });
    child.stderr.on("data", (chunk) => {
      const raw = String(chunk);
      this.append(config, session, raw);
      if (session.active?.began) {
        session.active.raw += raw;
        if (Buffer.byteLength(session.active.raw, "utf8") > config.maxOutputBytes * 4) {
          const bounded = Buffer.from(session.active.raw, "utf8").subarray(0, config.maxOutputBytes * 2).toString("utf8");
          this.append(config, session, "\n[codexflow] Command output exceeded the persistent terminal limit; terminal stopped.\n");
          this.finishActive(config, session, null, `${bounded}\n...[terminal output truncated]`);
          this.stop(session.routeId);
        }
      }
    });
    child.on("error", (error) => this.append(config, session, `[codexflow] terminal error: ${error.message}\n`));
    child.on("close", (code, signal) => {
      clearTimeout(readyTimer);
      if (!readyResolved) { readyResolved = true; resolveReady(); }
      session.closed = true;
      this.append(config, session, `[codexflow] terminal closed (${code ?? signal ?? "unknown"}).\n`);
      if (session.active) this.finishActive(config, session, code, session.active.raw);
      if (this.sessions.get(routeId) === session) this.sessions.delete(routeId);
    });
    if (processSpec.waitForReady) {
      const initialize = setTimeout(() => {
        if (!session.closed) child.stdin.write(processSpec.initialize(readyMarker));
      }, target.location === "local" ? 150 : 0);
      initialize.unref();
    }
    return session;
  }

  private session(
    config: CodexFlowConfig,
    routeId: string,
    target: TerminalTarget,
    processSpec: () => TerminalProcessSpec
  ): TerminalSession {
    const current = this.sessions.get(routeId);
    if (current && !current.closed && current.targetIdentity === target.identity) return current;
    if (current?.active) throw new CodexFlowError("The route changed projects while its terminal command is still running. Stop the terminal before switching.");
    if (current) this.stop(routeId);
    return this.create(config, routeId, target, processSpec());
  }

  private async runTarget(
    config: CodexFlowConfig,
    routeId: string,
    target: TerminalTarget,
    processSpec: () => TerminalProcessSpec,
    command: string,
    options: { cwd?: string; timeoutMs?: number; wait?: boolean; bashSessionId?: string; trustedProjectCommand?: boolean; resolvedCwd?: string } = {}
  ): Promise<TerminalCommandResult> {
    if (!command.trim()) throw new CodexFlowError("command is required.");
    assertBashSession(config, options.bashSessionId);
    if (options.trustedProjectCommand) {
      if (config.bashMode === "off") throw new CodexFlowError("Bash is disabled for this CodexFlow server.");
    } else {
      assertBashCommandAllowed(config, command);
    }
    const spec = processSpec();
    const session = this.session(config, routeId, target, () => spec);
    await session.ready;
    if (session.closed) throw new CodexFlowError("The persistent terminal exited before it became ready.");
    if (session.active) throw new CodexFlowError(`Terminal already has a running command (${session.active.id}). Read, write to, or stop it first.`);
    const commandId = `cmd_${randomBytes(8).toString("hex")}`;
    const beginMarker = `__CODEXFLOW_BEGIN_${commandId}__`;
    const endMarker = `__CODEXFLOW_END_${commandId}__`;
    const maxTimeoutMs = options.trustedProjectCommand ? 600_000 : 180_000;
    const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 30_000, maxTimeoutMs));
    let resolveCommand!: (result: TerminalCommandResult) => void;
    const completed = new Promise<TerminalCommandResult>((resolve) => { resolveCommand = resolve; });
    const timer = setTimeout(() => {
      this.append(config, session, `\n[codexflow] Command timed out after ${timeoutMs} ms; terminal stopped.\n`);
      const active = session.active;
      if (active) this.finishActive(config, session, null, active.raw);
      this.stop(routeId);
    }, timeoutMs);
    timer.unref();
    session.active = {
      id: commandId,
      command,
      startedAt: Date.now(),
      beginMarker,
      endMarker,
      raw: "",
      began: false,
      resolve: resolveCommand,
      timer
    };
    session.lastUsedAt = Date.now();
    const encodedCommand = Buffer.from(command, "utf8").toString("base64");
    const scopedCommand = `${options.resolvedCwd ? `cd -- ${shellQuote(options.resolvedCwd)} && ` : ""}eval "$(${spec.decode(encodedCommand)})"`;
    session.child.stdin.write(`printf '${beginMarker}\\n'; ${scopedCommand}; cf_status=$?; printf '\\n${endMarker}:%s\\n' "$cf_status"\n`);
    if (options.wait === false) {
      return {
        terminalId: session.id,
        commandId,
        command,
        workspaceRoot: target.workspaceRoot,
        exitCode: null,
        durationMs: 0,
        output: "",
        completed: false,
        cursor: session.cursor
      };
    }
    return completed;
  }

  async run(
    config: CodexFlowConfig,
    guard: PathGuard,
    routeId: string,
    workspace: Workspace,
    command: string,
    options: { cwd?: string; timeoutMs?: number; wait?: boolean; bashSessionId?: string; trustedProjectCommand?: boolean } = {}
  ): Promise<TerminalCommandResult> {
    const cwd = options.cwd ? guard.resolve(workspace, options.cwd).absPath : undefined;
    return this.runTarget(config, routeId, localTarget(workspace), terminalProcess, command, { ...options, resolvedCwd: cwd });
  }

  async runRemote(
    config: CodexFlowConfig,
    routeId: string,
    project: SavedRemoteProject,
    command: string,
    options: { cwd?: string; timeoutMs?: number; wait?: boolean; bashSessionId?: string; trustedProjectCommand?: boolean } = {}
  ): Promise<TerminalCommandResult> {
    const rawCwd = options.cwd?.trim();
    if (rawCwd && path.posix.isAbsolute(rawCwd)) throw new CodexFlowError("Terminal cwd must be relative to the remote project.");
    const resolved = rawCwd
      ? await runRemoteWorkspaceOperation<{ absolute: string; relative: string }>(project.hostAlias, config, {
          action: "resolve_directory",
          root: project.root,
          path: rawCwd
        })
      : undefined;
    return this.runTarget(config, routeId, remoteTarget(project), () => remoteTerminalProcess(project), command, {
      ...options,
      resolvedCwd: resolved?.absolute
    });
  }

  read(config: CodexFlowConfig, routeId: string, workspace: Workspace, afterCursor = 0, bashSessionId?: string): TerminalReadResult {
    assertBashSession(config, bashSessionId);
    const session = this.session(config, routeId, localTarget(workspace), terminalProcess);
    return this.readSession(session, afterCursor);
  }

  readRemote(config: CodexFlowConfig, routeId: string, project: SavedRemoteProject, afterCursor = 0, bashSessionId?: string): TerminalReadResult {
    assertBashSession(config, bashSessionId);
    const session = this.session(config, routeId, remoteTarget(project), () => remoteTerminalProcess(project));
    return this.readSession(session, afterCursor);
  }

  private readSession(session: TerminalSession, afterCursor: number): TerminalReadResult {
    session.lastUsedAt = Date.now();
    const earliestCursor = session.chunks[0]?.cursor ?? session.cursor;
    const chunks = session.chunks.filter((chunk) => chunk.cursor > Math.max(0, afterCursor));
    return {
      terminalId: session.id,
      workspaceRoot: session.workspaceRoot,
      output: chunks.map((chunk) => chunk.text).join("").trimEnd(),
      cursor: session.cursor,
      earliestCursor,
      activeCommandId: session.active?.id,
      activeCommand: session.active?.command,
      running: Boolean(session.active)
    };
  }

  write(config: CodexFlowConfig, routeId: string, workspace: Workspace, data: string, bashSessionId?: string): TerminalReadResult {
    assertBashSession(config, bashSessionId);
    if (config.bashMode !== "full") throw new CodexFlowError("Interactive terminal input requires CODEXFLOW_BASH_MODE=full.");
    const session = this.session(config, routeId, localTarget(workspace), terminalProcess);
    if (!session.active) throw new CodexFlowError("The terminal has no running command to receive input.");
    if (!data || Buffer.byteLength(data, "utf8") > 32_768) throw new CodexFlowError("data must contain 1 to 32768 bytes.");
    session.child.stdin.write(data);
    session.lastUsedAt = Date.now();
    return this.read(config, routeId, workspace, session.cursor, bashSessionId);
  }

  writeRemote(config: CodexFlowConfig, routeId: string, project: SavedRemoteProject, data: string, bashSessionId?: string): TerminalReadResult {
    assertBashSession(config, bashSessionId);
    if (config.bashMode !== "full") throw new CodexFlowError("Interactive terminal input requires CODEXFLOW_BASH_MODE=full.");
    const session = this.session(config, routeId, remoteTarget(project), () => remoteTerminalProcess(project));
    if (!session.active) throw new CodexFlowError("The terminal has no running command to receive input.");
    if (!data || Buffer.byteLength(data, "utf8") > 32_768) throw new CodexFlowError("data must contain 1 to 32768 bytes.");
    session.child.stdin.write(data);
    session.lastUsedAt = Date.now();
    return this.readRemote(config, routeId, project, session.cursor, bashSessionId);
  }

  stop(routeId: string): boolean {
    const session = this.sessions.get(routeId);
    if (!session) return false;
    session.closed = true;
    try { session.child.stdin.end(); } catch { /* best effort */ }
    try {
      if (process.platform !== "win32" && session.child.pid) process.kill(-session.child.pid, "SIGTERM");
      else session.child.kill("SIGTERM");
    } catch { /* best effort */ }
    this.sessions.delete(routeId);
    return true;
  }

  private prune(config: CodexFlowConfig): void {
    const now = Date.now();
    for (const [routeId, session] of this.sessions) {
      if (!session.active && now - session.lastUsedAt > config.httpSessionTtlMs) this.stop(routeId);
    }
    while (this.sessions.size >= config.maxHttpSessions) {
      const oldest = [...this.sessions.values()].filter((session) => !session.active).sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (!oldest) throw new CodexFlowError("All terminal slots are busy. Stop an existing route terminal before starting another.");
      this.stop(oldest.routeId);
    }
  }
}

export const persistentTerminals = new TerminalRegistry();
