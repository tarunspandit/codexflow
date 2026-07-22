import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { CodexFlowConfig } from "./config.js";
import { assertBashCommandAllowed, assertBashSession } from "./bashOps.js";
import { CodexFlowError } from "./guard.js";
import { hasSecretValue, redactStructured } from "./redact.js";

export type RemoteWorkspaceOperation =
  | { action: "probe_project"; root: string }
  | { action: "summary"; root: string; maxDepth: number; maxEntries: number }
  | { action: "tree"; root: string; path?: string; maxDepth: number; maxEntries: number; includeHidden: boolean }
  | { action: "read"; root: string; path: string; startLine?: number; endLine?: number; maxBytes: number }
  | { action: "search"; root: string; path?: string; query: string; regex: boolean; glob?: string; includeHidden: boolean; maxResults: number; maxReadBytes: number }
  | { action: "write"; root: string; path: string; content: string; createDirs: boolean; overwrite: boolean; maxWriteBytes: number }
  | { action: "edit"; root: string; path: string; oldText: string; newText: string; replaceAll: boolean; expectedReplacements?: number; maxWriteBytes: number }
  | { action: "apply_patch"; root: string; patch: string; maxWriteBytes: number }
  | { action: "git_status"; root: string; path?: string; staged?: boolean }
  | { action: "git_diff"; root: string; path?: string; staged: boolean }
  | { action: "git_log"; root: string; maxCount: number }
  | { action: "bash"; root: string; command: string; cwd?: string; timeoutMs: number };

export interface RemoteProbeResult {
  root: string;
  name: string;
  gitRoot?: string;
  gitRelativePath?: string;
}

const REMOTE_HELPER_SOURCE = String.raw`
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", function (chunk) {
  input += chunk;
  if (Buffer.byteLength(input, "utf8") > 12000000) fail("Remote request is too large.");
});
process.stdin.on("end", function () {
  try {
    const envelope = JSON.parse(input || "{}");
    const request = envelope.request || {};
    const limits = envelope.limits || {};
    const result = execute(request, limits);
    process.stdout.write(JSON.stringify({ ok: true, result: result }));
  } catch (error) {
    fail(error && error.message ? error.message : String(error));
  }
});

function fail(message) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(message).slice(0, 2000) }));
  process.exit(1);
}

function expandHome(value) {
  const raw = String(value || "").trim();
  if (raw === "~") return process.env.HOME || "";
  if (raw.indexOf("~/") === 0) return path.join(process.env.HOME || "", raw.slice(2));
  return raw;
}

function inside(base, target) {
  return target === base || target.indexOf(base + path.sep) === 0;
}

function canonicalRoot(raw) {
  const expanded = expandHome(raw);
  if (!expanded || expanded.indexOf("\0") >= 0 || expanded.length > 4096) throw new Error("Remote project path is invalid.");
  const resolved = path.resolve(expanded);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error("Remote project path is not a directory.");
  return fs.realpathSync(resolved);
}

function normalizeRelative(raw) {
  const value = String(raw === undefined ? "." : raw).replace(/\\/g, "/");
  if (!value || value.length > 4096 || value.indexOf("\0") >= 0 || path.posix.isAbsolute(value)) throw new Error("Path must be relative to the remote project.");
  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.indexOf("../") === 0) throw new Error("Path escapes the remote project.");
  return normalized;
}

function globRegex(glob) {
  let source = "^";
  const value = String(glob || "").replace(/\\/g, "/");
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === "*") {
      if (value[i + 1] === "*") { source += ".*"; i += 1; }
      else source += "[^/]*";
    } else if (char === "?") source += "[^/]";
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(source + "$");
}

function blocked(rel, blockedGlobs) {
  const value = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = value.split("/");
  if (segments.some(function (segment) { return segment === ".git" || segment === ".ssh" || segment === "node_modules"; })) return true;
  if (segments.some(function (segment) { return /^\.env(?:\.|$)/.test(segment) || /^(?:id_rsa|id_ed25519)(?:\.|$)/.test(segment) || /\.(?:pem|key)$/.test(segment); })) return true;
  return (blockedGlobs || []).some(function (glob) {
    try { return globRegex(glob).test(value); } catch (_) { return false; }
  });
}

function resolveTarget(root, raw, forWrite, blockedGlobs) {
  const rel = normalizeRelative(raw);
  if (blocked(rel, blockedGlobs)) throw new Error("Path is blocked by CodexFlow policy: " + rel);
  const absolute = path.resolve(root, rel);
  if (!inside(root, absolute)) throw new Error("Path escapes the remote project.");
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const realExisting = fs.realpathSync(existing);
  if (!inside(root, realExisting)) throw new Error("Path crosses a symlink outside the remote project.");
  if (fs.existsSync(absolute)) {
    const real = fs.realpathSync(absolute);
    if (!inside(root, real)) throw new Error("Path crosses a symlink outside the remote project.");
    const stat = fs.lstatSync(absolute);
    if (forWrite && stat.isSymbolicLink()) throw new Error("Writes through symlinks are blocked.");
  }
  return { absolute: absolute, rel: rel === "" ? "." : rel };
}

function trim(value, maxBytes) {
  const text = String(value || "");
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return { value: text, truncated: false };
  return { value: buffer.subarray(0, maxBytes).toString("utf8") + "\n...[output truncated]", truncated: true };
}

function run(command, args, options) {
  const result = cp.spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    env: Object.assign({}, process.env, { NO_COLOR: "1", CI: process.env.CI || "1" })
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || result.error && result.error.message || ""),
    timedOut: Boolean(result.error && result.error.code === "ETIMEDOUT")
  };
}

function git(root, args, maxOutputBytes, input) {
  const result = run("git", args, { cwd: root, input: input, timeout: 120000, maxBuffer: maxOutputBytes * 2 });
  const out = trim(result.stdout, maxOutputBytes);
  const err = trim(result.stderr, maxOutputBytes);
  const text = result.status === 0 ? (out.value.trim() || "(no output)") : (err.value.trim() || out.value.trim() || "git exited with status " + result.status);
  return { text: text, status: result.status, stderr: err.value, truncated: out.truncated || err.truncated };
}

function countDiff(diff) {
  let additions = 0;
  let deletions = 0;
  String(diff || "").split(/\r?\n/).forEach(function (line) {
    if (line.indexOf("+") === 0 && line.indexOf("+++") !== 0) additions += 1;
    if (line.indexOf("-") === 0 && line.indexOf("---") !== 0) deletions += 1;
  });
  return { additions: additions, deletions: deletions, changed: additions + deletions > 0 };
}

function simpleDiff(oldText, newText, rel, maxOutputBytes) {
  if (oldText === newText) return { diff: "", additions: 0, deletions: 0, changed: false };
  const oldLines = String(oldText).split("\n");
  const newLines = String(newText).split("\n");
  const lines = ["--- a/" + rel, "+++ b/" + rel, "@@ -1," + oldLines.length + " +1," + newLines.length + " @@"];
  oldLines.forEach(function (line) { lines.push("-" + line); });
  newLines.forEach(function (line) { lines.push("+" + line); });
  const clipped = trim(lines.join("\n"), maxOutputBytes).value;
  return { diff: clipped, additions: newLines.length, deletions: oldLines.length, changed: true };
}

function listTree(root, request, limits) {
  const target = resolveTarget(root, request.path || ".", false, limits.blockedGlobs);
  if (!fs.statSync(target.absolute).isDirectory()) throw new Error("Not a directory: " + target.rel);
  const lines = [target.rel === "." ? "." : target.rel + "/"];
  let entries = 0;
  let truncated = false;
  function walk(directory, relDir, depth, prefix) {
    if (depth >= request.maxDepth || truncated) return;
    const dirents = fs.readdirSync(directory, { withFileTypes: true }).filter(function (entry) {
      const rel = relDir ? relDir + "/" + entry.name : entry.name;
      return (request.includeHidden || entry.name.indexOf(".") !== 0) && !blocked(rel, limits.blockedGlobs);
    }).sort(function (a, b) {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (let index = 0; index < dirents.length; index += 1) {
      if (entries >= request.maxEntries) { truncated = true; return; }
      const entry = dirents[index];
      const last = index === dirents.length - 1;
      const rel = relDir ? relDir + "/" + entry.name : entry.name;
      lines.push(prefix + (last ? "└── " : "├── ") + entry.name + (entry.isDirectory() ? "/" : ""));
      entries += 1;
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path.join(directory, entry.name), rel, depth + 1, prefix + (last ? "    " : "│   "));
      if (truncated) return;
    }
  }
  walk(target.absolute, target.rel === "." ? "" : target.rel, 0, "");
  if (truncated) lines.push("...[tree truncated after " + entries + " entries]");
  return { text: lines.join("\n"), entries: entries, truncated: truncated };
}

function readFile(root, request, limits) {
  const target = resolveTarget(root, request.path, false, limits.blockedGlobs);
  const stat = fs.statSync(target.absolute);
  if (!stat.isFile()) throw new Error("Not a file: " + target.rel);
  if (stat.size > request.maxBytes && request.startLine === undefined && request.endLine === undefined) throw new Error("File is too large. Limit: " + request.maxBytes + " bytes.");
  const buffer = fs.readFileSync(target.absolute);
  if (buffer.indexOf(0) >= 0) throw new Error("Binary files cannot be read.");
  const raw = buffer.toString("utf8");
  const lines = raw.split(/\r?\n/);
  const start = Math.max(1, Number(request.startLine || 1));
  const end = Math.min(lines.length, Number(request.endLine || lines.length));
  if (end < start) throw new Error("end_line must be greater than or equal to start_line.");
  const numbered = lines.slice(start - 1, end).map(function (line, index) { return String(start + index).padStart(6, " ") + "\t" + line; }).join("\n");
  if (Buffer.byteLength(numbered, "utf8") > request.maxBytes) throw new Error("Selected line range is too large.");
  return { path: target.rel, text: numbered, startLine: start, endLine: end, totalLines: lines.length, bytes: buffer.length, sha256: crypto.createHash("sha256").update(raw).digest("hex"), truncated: start > 1 || end < lines.length };
}

function searchFiles(root, request, limits) {
  const target = resolveTarget(root, request.path || ".", false, limits.blockedGlobs);
  const matches = [];
  let visible = 0;
  let scanned = 0;
  const matcher = request.regex ? new RegExp(request.query) : null;
  const fileGlob = request.glob ? globRegex(request.glob) : null;
  function scan(file, rel) {
    if (scanned >= 20000 || visible > request.maxResults) return;
    scanned += 1;
    if (fileGlob && !fileGlob.test(rel)) return;
    let stat;
    try { stat = fs.statSync(file); } catch (_) { return; }
    if (!stat.isFile() || stat.size > request.maxReadBytes) return;
    const buffer = fs.readFileSync(file);
    if (buffer.indexOf(0) >= 0) return;
    buffer.toString("utf8").split(/\r?\n/).forEach(function (line, index) {
      if (visible > request.maxResults) return;
      if (matcher) matcher.lastIndex = 0;
      const hit = matcher ? matcher.test(line) : line.indexOf(request.query) >= 0;
      if (hit) {
        visible += 1;
        if (matches.length < request.maxResults) matches.push({ path: rel, line: index + 1, text: line.length > 400 ? line.slice(0, 400) + "…" : line });
      }
    });
  }
  function walk(directory, relDir) {
    if (scanned >= 20000 || visible > request.maxResults) return;
    fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
      const rel = relDir ? relDir + "/" + entry.name : entry.name;
      if ((!request.includeHidden && entry.name.indexOf(".") === 0) || blocked(rel, limits.blockedGlobs)) return;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(absolute, rel);
      else if (entry.isFile()) scan(absolute, rel);
    });
  }
  if (fs.statSync(target.absolute).isFile()) scan(target.absolute, target.rel);
  else walk(target.absolute, target.rel === "." ? "" : target.rel);
  return { text: matches.length ? matches.map(function (match) { return match.path + ":" + match.line + ": " + match.text; }).join("\n") : "No matches.", matches: matches, truncated: visible > matches.length || scanned >= 20000, used: "remote-node" };
}

function writeFile(root, request, limits) {
  const target = resolveTarget(root, request.path, true, limits.blockedGlobs);
  const content = String(request.content || "");
  if (Buffer.byteLength(content, "utf8") > request.maxWriteBytes) throw new Error("Write content is too large.");
  let oldText = "";
  const existed = fs.existsSync(target.absolute);
  if (existed) {
    if (!request.overwrite) throw new Error("File already exists and overwrite=false: " + target.rel);
    if (!fs.statSync(target.absolute).isFile()) throw new Error("Not a file: " + target.rel);
    const old = fs.readFileSync(target.absolute);
    if (old.indexOf(0) >= 0) throw new Error("Binary files cannot be overwritten.");
    oldText = old.toString("utf8");
  }
  if (request.createDirs) fs.mkdirSync(path.dirname(target.absolute), { recursive: true });
  resolveTarget(root, request.path, true, limits.blockedGlobs);
  fs.writeFileSync(target.absolute, content, "utf8");
  return Object.assign({ path: target.rel, existed: existed, bytes: Buffer.byteLength(content, "utf8"), sha256: crypto.createHash("sha256").update(content).digest("hex") }, simpleDiff(oldText, content, target.rel, limits.maxOutputBytes));
}

function editFile(root, request, limits) {
  const target = resolveTarget(root, request.path, true, limits.blockedGlobs);
  const oldBuffer = fs.readFileSync(target.absolute);
  if (oldBuffer.indexOf(0) >= 0) throw new Error("Binary files cannot be edited.");
  const oldContent = oldBuffer.toString("utf8");
  if (!request.oldText) throw new Error("old_text is required.");
  const occurrences = oldContent.split(request.oldText).length - 1;
  if (!occurrences) throw new Error("old_text was not found in " + target.rel + ".");
  if (!request.replaceAll && occurrences !== 1) throw new Error("old_text matched " + occurrences + " times; make it unique or use replace_all=true.");
  const replacements = request.replaceAll ? occurrences : 1;
  if (request.expectedReplacements !== undefined && replacements !== request.expectedReplacements) throw new Error("Replacement count did not match expected_replacements.");
  const content = request.replaceAll ? oldContent.split(request.oldText).join(request.newText) : oldContent.replace(request.oldText, request.newText);
  if (Buffer.byteLength(content, "utf8") > request.maxWriteBytes) throw new Error("Edited file is too large.");
  fs.writeFileSync(target.absolute, content, "utf8");
  return Object.assign({ path: target.rel, replacements: replacements, bytes: Buffer.byteLength(content, "utf8"), sha256: crypto.createHash("sha256").update(content).digest("hex") }, simpleDiff(oldContent, content, target.rel, limits.maxOutputBytes));
}

function patchPaths(patch) {
  const paths = [];
  String(patch).split(/\r?\n/).forEach(function (line) {
    if (line.indexOf("+++ ") !== 0 && line.indexOf("--- ") !== 0) return;
    let value = line.slice(4).split("\t")[0].trim();
    if (value === "/dev/null") return;
    value = value.replace(/^[ab]\//, "");
    if (value && paths.indexOf(value) < 0) paths.push(value);
  });
  return paths;
}

function applyPatch(root, request, limits) {
  const patch = String(request.patch || "");
  if (!patch || Buffer.byteLength(patch, "utf8") > request.maxWriteBytes) throw new Error("Patch is empty or too large.");
  const paths = patchPaths(patch);
  if (!paths.length) throw new Error("Patch does not contain file paths.");
  paths.forEach(function (rel) { resolveTarget(root, rel, true, limits.blockedGlobs); });
  const check = git(root, ["apply", "--check", "--whitespace=nowarn", "-"], limits.maxOutputBytes, patch);
  if (check.status !== 0) throw new Error(check.text);
  const applied = git(root, ["apply", "--whitespace=nowarn", "-"], limits.maxOutputBytes, patch);
  if (applied.status !== 0) throw new Error(applied.text);
  const diff = git(root, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--"].concat(paths), limits.maxOutputBytes).text;
  return Object.assign({ paths: paths, stdout: applied.text === "(no output)" ? "" : applied.text, stderr: applied.stderr, diff: diff === "(no output)" ? "" : diff }, countDiff(diff));
}

function execute(request, limits) {
  if (request.action === "probe_project") {
    const root = canonicalRoot(request.root);
    const top = git(root, ["rev-parse", "--show-toplevel"], limits.maxOutputBytes).text;
    const gitRoot = top !== "(no output)" && path.isAbsolute(top) ? fs.realpathSync(top.trim()) : undefined;
    return { root: root, name: path.basename(root) || root, gitRoot: gitRoot, gitRelativePath: gitRoot && inside(gitRoot, root) ? (path.relative(gitRoot, root) || ".").replace(/\\/g, "/") : undefined };
  }
  const root = canonicalRoot(request.root);
  if (request.action === "tree") return listTree(root, request, limits);
  if (request.action === "read") return readFile(root, request, limits);
  if (request.action === "search") return searchFiles(root, request, limits);
  if (request.action === "write") return writeFile(root, request, limits);
  if (request.action === "edit") return editFile(root, request, limits);
  if (request.action === "apply_patch") return applyPatch(root, request, limits);
  if (request.action === "git_status") {
    const args = request.staged ? ["diff", "--cached", "--name-status"] : ["status", "--short", "--branch"];
    if (request.path) { const target = resolveTarget(root, request.path, false, limits.blockedGlobs); args.push("--", target.rel); }
    return git(root, args, limits.maxOutputBytes);
  }
  if (request.action === "git_diff") {
    const args = ["diff", "--no-color", "--no-ext-diff", "--no-textconv"];
    if (request.staged) args.push("--staged");
    if (request.path) { const target = resolveTarget(root, request.path, false, limits.blockedGlobs); args.push("--", target.rel); }
    const response = git(root, args, limits.maxOutputBytes);
    return Object.assign(response, countDiff(response.text === "(no output)" ? "" : response.text));
  }
  if (request.action === "git_log") return git(root, ["log", "--max-count=" + Math.max(1, Math.min(Number(request.maxCount || 8), 30)), "--oneline", "--decorate"], limits.maxOutputBytes);
  if (request.action === "bash") {
    const cwd = resolveTarget(root, request.cwd || ".", false, limits.blockedGlobs);
    if (!fs.statSync(cwd.absolute).isDirectory()) throw new Error("Bash cwd is not a directory.");
    const started = Date.now();
    const response = run(fs.existsSync("/bin/bash") ? "/bin/bash" : "bash", ["-lc", request.command], { cwd: cwd.absolute, timeout: request.timeoutMs, maxBuffer: limits.maxOutputBytes * 2 });
    const out = trim(response.stdout, limits.maxOutputBytes);
    const err = trim(response.stderr + (response.timedOut ? "\n[codexflow] Command timed out." : ""), limits.maxOutputBytes);
    return { command: request.command, cwd: cwd.rel, exitCode: response.status, signal: response.signal, durationMs: Date.now() - started, stdout: out.value, stderr: err.value, truncated: out.truncated || err.truncated };
  }
  if (request.action === "summary") {
    const tree = listTree(root, { path: ".", maxDepth: request.maxDepth, maxEntries: request.maxEntries, includeHidden: false }, limits);
    const status = git(root, ["status", "--short", "--branch"], limits.maxOutputBytes).text;
    let agentsPath;
    let agentsText;
    for (const name of ["AGENTS.md", ".agents/AGENTS.md"]) {
      try {
        const target = resolveTarget(root, name, false, limits.blockedGlobs);
        if (fs.statSync(target.absolute).isFile()) { agentsPath = target.rel; agentsText = trim(fs.readFileSync(target.absolute, "utf8"), 120000).value; break; }
      } catch (_) {}
    }
    return { tree: tree.text, gitStatus: status, agentsPath: agentsPath, agentsText: agentsText };
  }
  throw new Error("Unsupported remote operation.");
}
`;

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function sshBinary(): string {
  const configured = process.env.CODEXFLOW_SSH_BIN?.trim();
  if (configured) return path.resolve(expandHome(configured));
  return fs.existsSync("/usr/bin/ssh") ? "/usr/bin/ssh" : "ssh";
}

function helperCommand(): string {
  const source = Buffer.from(REMOTE_HELPER_SOURCE, "utf8").toString("base64");
  return `node -e 'eval(Buffer.from("${source}","base64").toString("utf8"))'`;
}

function operationEnvelope(
  config: Pick<CodexFlowConfig, "blockedGlobs" | "maxOutputBytes">,
  request: RemoteWorkspaceOperation
): string {
  return JSON.stringify({
    request,
    limits: {
      blockedGlobs: config.blockedGlobs,
      maxOutputBytes: config.maxOutputBytes
    }
  });
}

function sshOperationArgs(alias: string): string[] {
  return [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=8",
    "-o", "StrictHostKeyChecking=yes",
    alias,
    helperCommand()
  ];
}

function parseOperationResult<T>(alias: string, result: {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
  timedOut?: boolean;
}): T {
  if (result.timedOut || result.error?.name === "ETIMEDOUT") throw new CodexFlowError("Remote operation timed out.");
  let parsed: { ok?: boolean; result?: T; error?: string } | undefined;
  try {
    parsed = JSON.parse(result.stdout || "{}");
  } catch {
    // Report a bounded transport error below.
  }
  if (result.error || result.status !== 0 || !parsed?.ok) {
    const detail = String(parsed?.error || result.stderr || result.error?.message || "The remote helper exited without a response.")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 1000);
    throw new CodexFlowError(`Remote operation on ${alias} failed. ${detail}`.trim());
  }
  return redactStructured(parsed.result) as T;
}

function runRemoteWorkspaceOperationSync<T>(
  alias: string,
  config: Pick<CodexFlowConfig, "blockedGlobs" | "maxOutputBytes">,
  request: RemoteWorkspaceOperation,
  timeoutMs = 45_000
): T {
  const result = spawnSync(sshBinary(), sshOperationArgs(alias), {
    input: operationEnvelope(config, request),
    encoding: "utf8",
    timeout: Math.max(10_000, Math.min(timeoutMs, 200_000)),
    maxBuffer: Math.max(4 * 1024 * 1024, config.maxOutputBytes * 3),
    stdio: ["pipe", "pipe", "pipe"]
  });
  return parseOperationResult<T>(alias, {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    ...(result.error ? { error: result.error } : {})
  });
}

export function runRemoteWorkspaceOperation<T>(
  alias: string,
  config: Pick<CodexFlowConfig, "blockedGlobs" | "maxOutputBytes">,
  request: RemoteWorkspaceOperation,
  timeoutMs = 45_000
): Promise<T> {
  const boundedTimeout = Math.max(10_000, Math.min(timeoutMs, 200_000));
  const maxTransportBytes = Math.max(4 * 1024 * 1024, config.maxOutputBytes * 3);
  return new Promise((resolve, reject) => {
    const child = spawn(sshBinary(), sshOperationArgs(alias), { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let transportOverflow = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_500).unref();
    }, boundedTimeout);
    timer.unref();
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (Buffer.byteLength(stdout, "utf8") > maxTransportBytes) {
        transportOverflow = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (Buffer.byteLength(stderr, "utf8") > maxTransportBytes) {
        transportOverflow = true;
        child.kill("SIGTERM");
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new CodexFlowError(`Remote operation on ${alias} failed. ${error.message}`));
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (transportOverflow) {
        reject(new CodexFlowError(`Remote operation on ${alias} exceeded the bounded transport output limit.`));
        return;
      }
      try {
        resolve(parseOperationResult<T>(alias, { status, stdout, stderr, timedOut }));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.on("error", () => {
      // A close/error event reports the authoritative transport failure.
    });
    child.stdin.end(operationEnvelope(config, request));
  });
}

export function probeRemoteProject(alias: string, root: string, maxOutputBytes = 120_000): RemoteProbeResult {
  return runRemoteWorkspaceOperationSync<RemoteProbeResult>(alias, { blockedGlobs: [], maxOutputBytes }, { action: "probe_project", root }, 30_000);
}

export function assertRemoteWriteContent(action: "write" | "edit" | "apply_patch", values: string[]): void {
  if (values.some((value) => hasSecretValue(value))) {
    throw new CodexFlowError(`Secret-looking content is blocked from remote ${action}. Use placeholders such as [REDACTED_SECRET].`);
  }
}

export function assertRemoteBash(config: CodexFlowConfig, command: string, sessionId?: string): string | undefined {
  const accepted = assertBashSession(config, sessionId);
  assertBashCommandAllowed(config, command);
  return accepted;
}
