import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { CodexFlowConfig } from "./config.js";
import type { Workspace } from "./guard.js";
import { CodexFlowError, PathGuard } from "./guard.js";
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
  workspaceId: string;
  workspaceRoot: string;
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

function terminalProcess(): { command: string; args: string[]; pseudoTerminal: boolean } {
  if (process.platform === "darwin") {
    return {
      command: "/bin/sh",
      args: ["-c", `cat | /usr/bin/script -q /dev/null ${shellQuote(bashExecutable())} --noprofile --norc`],
      pseudoTerminal: true
    };
  }
  if (process.platform === "linux") {
    return {
      command: "/bin/sh",
      args: ["-c", `cat | /usr/bin/script -q -c ${shellQuote(`${bashExecutable()} --noprofile --norc`)} /dev/null`],
      pseudoTerminal: true
    };
  }
  return { command: bashExecutable(), args: ["--noprofile", "--norc"], pseudoTerminal: false };
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

  private create(config: CodexFlowConfig, routeId: string, workspace: Workspace): TerminalSession {
    this.prune(config);
    const processSpec = terminalProcess();
    const child = spawn(processSpec.command, processSpec.args, {
      cwd: workspace.root,
      env: { ...bashEnvironment(config), PS1: "", PS2: "", PROMPT_COMMAND: "" },
      stdio: ["pipe", "pipe", "pipe"],
      detached: processSpec.pseudoTerminal
    });
    const now = Date.now();
    const readyMarker = `__CODEXFLOW_READY_${randomBytes(8).toString("hex")}__`;
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    let readyResolved = !processSpec.pseudoTerminal;
    let readyBuffer = "";
    if (readyResolved) resolveReady();
    const session: TerminalSession = {
      id: `term_${randomBytes(8).toString("hex")}`,
      routeId,
      workspaceId: workspace.id,
      workspaceRoot: workspace.root,
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
    child.stdout.on("data", (chunk) => {
      let raw = String(chunk);
      if (!readyResolved) {
        readyBuffer += raw;
        const readyMatch = readyBuffer.match(new RegExp(`(?:^|\\r?\\n)${readyMarker}\\r?\\n`));
        if (readyMatch?.index !== undefined) {
          readyResolved = true;
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
      if (!readyResolved) { readyResolved = true; resolveReady(); }
      session.closed = true;
      this.append(config, session, `[codexflow] terminal closed (${code ?? signal ?? "unknown"}).\n`);
      if (session.active) this.finishActive(config, session, code, session.active.raw);
      this.sessions.delete(routeId);
    });
    if (processSpec.pseudoTerminal) {
      const initialize = setTimeout(() => {
        if (!session.closed) child.stdin.write(`stty -echo; printf '${readyMarker}\\n'\n`);
      }, 150);
      initialize.unref();
    }
    return session;
  }

  private session(config: CodexFlowConfig, routeId: string, workspace: Workspace): TerminalSession {
    const current = this.sessions.get(routeId);
    if (current && !current.closed && current.workspaceId === workspace.id) return current;
    if (current?.active) throw new CodexFlowError("The route changed projects while its terminal command is still running. Stop the terminal before switching.");
    if (current) this.stop(routeId);
    return this.create(config, routeId, workspace);
  }

  async run(
    config: CodexFlowConfig,
    guard: PathGuard,
    routeId: string,
    workspace: Workspace,
    command: string,
    options: { cwd?: string; timeoutMs?: number; wait?: boolean; bashSessionId?: string } = {}
  ): Promise<TerminalCommandResult> {
    if (!command.trim()) throw new CodexFlowError("command is required.");
    assertBashSession(config, options.bashSessionId);
    assertBashCommandAllowed(config, command);
    const session = this.session(config, routeId, workspace);
    await session.ready;
    if (session.closed) throw new CodexFlowError("The persistent terminal exited before it became ready.");
    if (session.active) throw new CodexFlowError(`Terminal already has a running command (${session.active.id}). Read, write to, or stop it first.`);
    const commandId = `cmd_${randomBytes(8).toString("hex")}`;
    const beginMarker = `__CODEXFLOW_BEGIN_${commandId}__`;
    const endMarker = `__CODEXFLOW_END_${commandId}__`;
    const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 30_000, 180_000));
    const cwd = options.cwd ? guard.resolve(workspace, options.cwd).absPath : undefined;
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
    const decode = process.platform === "darwin" ? "/usr/bin/base64 -D" : "base64 -d";
    const scopedCommand = `${cwd ? `cd -- ${shellQuote(cwd)} && ` : ""}eval "$(printf '%s' '${encodedCommand}' | ${decode})"`;
    session.child.stdin.write(`printf '${beginMarker}\\n'; ${scopedCommand}; cf_status=$?; printf '\\n${endMarker}:%s\\n' "$cf_status"\n`);
    if (options.wait === false) {
      return {
        terminalId: session.id,
        commandId,
        command,
        workspaceRoot: workspace.root,
        exitCode: null,
        durationMs: 0,
        output: "",
        completed: false,
        cursor: session.cursor
      };
    }
    return completed;
  }

  read(config: CodexFlowConfig, routeId: string, workspace: Workspace, afterCursor = 0, bashSessionId?: string): TerminalReadResult {
    assertBashSession(config, bashSessionId);
    const session = this.session(config, routeId, workspace);
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
    const session = this.session(config, routeId, workspace);
    if (!session.active) throw new CodexFlowError("The terminal has no running command to receive input.");
    if (!data || Buffer.byteLength(data, "utf8") > 32_768) throw new CodexFlowError("data must contain 1 to 32768 bytes.");
    session.child.stdin.write(data);
    session.lastUsedAt = Date.now();
    return this.read(config, routeId, workspace, session.cursor, bashSessionId);
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
