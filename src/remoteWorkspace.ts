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
  | { action: "resolve_directory"; root: string; path?: string }
  | { action: "list_environments"; root: string; maxBytes: number; maxFiles: number }
  | { action: "list_skills"; root: string; maxSkills: number }
  | { action: "load_skill"; root: string; name: string; path?: string; maxSkills: number; maxBytes: number }
  | { action: "inspect"; root: string; maxFiles: number; maxAnalyzedFiles: number; maxScannedBytes: number; maxSymbols: number; maxRelationships: number }
  | { action: "worktree_create"; root: string; worktreeId: string; baseRef: string; includeChanges: boolean; maxCopyBytes: number }
  | { action: "worktree_status"; root: string }
  | { action: "worktree_transfer"; sourceRoot: string; destinationRoot: string; expectedDestinationState: string; maxCopyBytes: number }
  | { action: "worktree_remove"; sourceRoot: string; checkoutRoot: string; projectRoot: string; worktreeId: string; maxSnapshotBytes: number }
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

function inspectProject(root, request, limits) {
  const files = [];
  const warnings = [];
  let inventoryLimited = false;
  const languageByExtension = {
    ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".py": "python", ".go": "go", ".rs": "rust", ".swift": "swift", ".java": "java",
    ".cs": "csharp", ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp",
    ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml", ".md": "markdown", ".sh": "shell"
  };
  function classify(rel) {
    const lower = rel.toLowerCase();
    const language = languageByExtension[path.extname(lower)] || "unknown";
    const generated = /(^|\/)(dist|build|coverage|vendor|generated)(\/|$)/.test(lower) || /(?:\.min\.js|\.generated\.)/.test(lower);
    let role = "other";
    if (generated) role = "generated";
    else if (/(^|\/)(test|tests|__tests__|spec)(\/|$)|(?:\.test|\.spec)\./.test(lower)) role = "test";
    else if (/(^|\/)(readme|agents)\.md$|(^|\/)docs?\//.test(lower) || language === "markdown") role = "docs";
    else if (/(^|\/)(package\.json|tsconfig[^/]*\.json|pyproject\.toml|cargo\.toml|go\.mod|dockerfile|makefile|\.github\/)/.test(lower) || ["json", "yaml", "toml"].indexOf(language) >= 0) role = "config";
    else if (/(^|\/)(infra|terraform|deploy|docker)(\/|$)/.test(lower)) role = "infrastructure";
    else if (["typescript", "javascript", "python", "go", "rust", "swift", "java", "csharp", "c", "cpp"].indexOf(language) >= 0) role = "source";
    const base = path.basename(lower);
    const entrypoint = /^(index|main|app|server|cli)\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|swift|java|cs|c|cpp)$/.test(base);
    return { language: language, role: role, generated: generated, entrypoint: entrypoint };
  }
  function walk(directory, relDir) {
    if (files.length >= request.maxFiles) { inventoryLimited = true; return; }
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_) { return; }
    entries.sort(function (a, b) { return a.name.localeCompare(b.name); });
    for (let index = 0; index < entries.length; index += 1) {
      if (files.length >= request.maxFiles) { inventoryLimited = true; return; }
      const entry = entries[index];
      const rel = relDir ? relDir + "/" + entry.name : entry.name;
      if (blocked(rel, limits.blockedGlobs)) continue;
      const absolute = path.join(directory, entry.name);
      let stat;
      try { stat = fs.lstatSync(absolute); } catch (_) { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(absolute, rel);
      else if (stat.isFile() && stat.size <= 4000000) {
        let head;
        try { const fd = fs.openSync(absolute, "r"); head = Buffer.alloc(Math.min(stat.size, 4096)); fs.readSync(fd, head, 0, head.length, 0); fs.closeSync(fd); } catch (_) { continue; }
        if (head.indexOf(0) >= 0) continue;
        files.push(Object.assign({ path: rel, bytes: stat.size, modifiedMs: stat.mtimeMs }, classify(rel)));
      }
    }
  }
  walk(root, "");
  files.sort(function (a, b) { return a.path.localeCompare(b.path); });
  const fileSet = new Set(files.map(function (file) { return file.path; }));
  const symbols = [];
  const relationships = [];
  let analyzedFiles = 0;
  let scannedBytes = 0;
  let sourceLimited = false;
  const patterns = {
    typescript: [[/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, "function"], [/\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, "class"], [/\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, "interface"], [/\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, "variable"]],
    javascript: [[/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, "function"], [/\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, "class"], [/\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, "variable"]],
    python: [[/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, "function"], [/^\s*class\s+([A-Za-z_]\w*)/, "class"]],
    go: [[/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, "function"], [/^type\s+([A-Za-z_]\w*)\s+/, "type"]],
    rust: [[/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, "function"], [/^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/, "struct"], [/^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)/, "enum"], [/^\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)/, "trait"]]
  };
  function resolveImport(from, specifier) {
    if (specifier.indexOf(".") !== 0) return undefined;
    const raw = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)).replace(/\.(js|mjs|cjs)$/, "");
    const candidates = [raw, raw + ".ts", raw + ".tsx", raw + ".js", raw + ".jsx", raw + ".py", raw + ".go", raw + ".rs", raw + "/index.ts", raw + "/index.js", raw + "/index.py"];
    return candidates.find(function (candidate) { return fileSet.has(candidate); });
  }
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    if (!patterns[file.language] || file.generated) continue;
    if (analyzedFiles >= request.maxAnalyzedFiles || scannedBytes + file.bytes > request.maxScannedBytes) { sourceLimited = true; break; }
    let text;
    try { text = fs.readFileSync(path.join(root, file.path), "utf8"); } catch (_) { continue; }
    analyzedFiles += 1;
    scannedBytes += Buffer.byteLength(text, "utf8");
    text.split(/\r?\n/).forEach(function (line, lineIndex) {
      (patterns[file.language] || []).forEach(function (pattern) {
        if (symbols.length >= request.maxSymbols) return;
        const match = line.match(pattern[0]);
        if (match && match[1]) symbols.push({ name: match[1], kind: pattern[1], path: file.path, line: lineIndex + 1, exported: /\b(export|public|pub)\b/.test(line), confidence: "strong" });
      });
      if (relationships.length >= request.maxRelationships || (file.language !== "typescript" && file.language !== "javascript")) return;
      const match = line.match(/\b(?:import|export)\b[^"']*?["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)/);
      const target = match && resolveImport(file.path, match[1] || match[2]);
      if (target && !relationships.some(function (item) { return item.from === file.path && item.to === target; })) {
        relationships.push({ from: file.path, to: target, kind: file.role === "test" ? "tests" : "imports", confidence: "strong", source: "remote built-in import extraction" });
      }
    });
  }
  if (inventoryLimited) warnings.push("Remote inventory reached its configured file limit.");
  if (sourceLimited) warnings.push("Remote source analysis reached its file or byte limit.");
  if (symbols.length >= request.maxSymbols) warnings.push("Remote symbol extraction reached its configured limit.");
  if (relationships.length >= request.maxRelationships) warnings.push("Remote relationship extraction reached its configured limit.");
  const areaMap = {};
  files.forEach(function (file) {
    const top = file.path.indexOf("/") >= 0 ? file.path.split("/")[0] : ".";
    if (!areaMap[top]) areaMap[top] = { path: top, role: file.role, files: 0 };
    areaMap[top].files += 1;
    if (areaMap[top].role === "other" && file.role !== "other") areaMap[top].role = file.role;
  });
  const names = new Set(files.map(function (file) { return file.path.toLowerCase(); }));
  const projectTypes = [];
  if (names.has("package.json")) projectTypes.push("Node.js");
  if (names.has("pyproject.toml") || names.has("requirements.txt")) projectTypes.push("Python");
  if (names.has("go.mod")) projectTypes.push("Go");
  if (names.has("cargo.toml")) projectTypes.push("Rust");
  if (names.has("package.swift")) projectTypes.push("Swift");
  const fingerprint = crypto.createHash("sha256").update(files.map(function (file) { return file.path + ":" + file.bytes + ":" + file.modifiedMs; }).join("\n")).digest("hex");
  return {
    schemaVersion: 1,
    root: root,
    languages: Array.from(new Set(files.map(function (file) { return file.language; }).filter(function (language) { return language !== "unknown"; }))).sort(),
    projectTypes: projectTypes,
    entrypoints: files.filter(function (file) { return file.entrypoint; }).map(function (file) { return file.path; }),
    importantFiles: files.filter(function (file) { return file.role === "config" || /(^|\/)(README|AGENTS)\.md$/i.test(file.path); }).map(function (file) { return file.path; }),
    areas: Object.keys(areaMap).map(function (key) { return areaMap[key]; }).sort(function (a, b) { return b.files - a.files || a.path.localeCompare(b.path); }),
    files: files,
    symbols: symbols,
    relationships: relationships,
    coverage: { inventoryFiles: files.length, analyzedFiles: analyzedFiles, scannedBytes: scannedBytes, symbolCount: symbols.length, relationshipCount: relationships.length, truncated: inventoryLimited || sourceLimited || symbols.length >= request.maxSymbols || relationships.length >= request.maxRelationships, warnings: warnings },
    warnings: warnings,
    fingerprint: fingerprint,
    cache: { hit: false, key: "remote:" + fingerprint }
  };
}

function checkedGit(cwd, args, input, maxBuffer) {
  const result = run("git", args, { cwd: cwd, input: input, timeout: 120000, maxBuffer: maxBuffer || 16000000 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "git failed").trim().slice(0, 2000));
  return result.stdout;
}

function repoContextFor(root) {
  const canonicalProjectRoot = fs.realpathSync(path.resolve(root));
  const repositoryRoot = fs.realpathSync(checkedGit(canonicalProjectRoot, ["rev-parse", "--show-toplevel"]).trim());
  const rawCommonDir = checkedGit(repositoryRoot, ["rev-parse", "--git-common-dir"]).trim();
  const commonGitDir = fs.realpathSync(path.isAbsolute(rawCommonDir) ? rawCommonDir : path.resolve(repositoryRoot, rawCommonDir));
  const projectRelativePath = path.relative(repositoryRoot, canonicalProjectRoot).replace(/\\/g, "/") || ".";
  if (projectRelativePath === ".." || projectRelativePath.indexOf("../") === 0 || path.isAbsolute(projectRelativePath)) throw new Error("Project is outside its Git repository.");
  const head = checkedGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  return { repositoryRoot: repositoryRoot, commonGitDir: commonGitDir, projectRelativePath: projectRelativePath, head: head };
}

function pathspecFor(relative) { return relative === "." ? ["."] : [relative]; }

function untrackedFor(context) {
  const output = checkedGit(context.repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--"].concat(pathspecFor(context.projectRelativePath)), undefined, 16000000);
  return output.split("\0").filter(Boolean).sort();
}

function worktreeState(root, maxBytes) {
  const context = repoContextFor(root);
  const patch = checkedGit(context.repositoryRoot, ["diff", "--binary", "HEAD", "--"].concat(pathspecFor(context.projectRelativePath)), undefined, maxBytes * 2);
  const hash = crypto.createHash("sha256").update(context.head).update("\0").update(patch).update("\0untracked\0");
  let bytes = Buffer.byteLength(patch, "utf8");
  const untracked = untrackedFor(context);
  const untrackedEntries = [];
  untracked.forEach(function (name) {
    const absolute = path.resolve(context.repositoryRoot, name);
    if (!inside(context.repositoryRoot, absolute)) throw new Error("Unsafe untracked path.");
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Worktree transfer refuses symlinks and non-files: " + name);
    bytes += stat.size;
    if (bytes > maxBytes) throw new Error("Worktree changes exceed the configured transfer limit.");
    const content = fs.readFileSync(absolute);
    const mode = stat.mode & 0o777;
    hash.update(name).update("\0").update(String(mode)).update("\0").update(content).update("\0");
    untrackedEntries.push({ name: name, content: content, mode: mode });
  });
  return { context: context, patch: patch, untracked: untracked, untrackedEntries: untrackedEntries, state: hash.digest("hex"), bytes: bytes };
}

function clearProjectChanges(context) {
  checkedGit(context.repositoryRoot, ["restore", "--source=HEAD", "--staged", "--worktree", "--"].concat(pathspecFor(context.projectRelativePath)));
  untrackedFor(context).forEach(function (name) {
    const absolute = path.resolve(context.repositoryRoot, name);
    if (inside(context.repositoryRoot, absolute)) fs.rmSync(absolute, { force: true });
  });
}

function restoreProjectState(state, maxBytes) {
  clearProjectChanges(state.context);
  if (state.patch) checkedGit(state.context.repositoryRoot, ["apply", "--whitespace=nowarn", "-"], state.patch, maxBytes * 2);
  state.untrackedEntries.forEach(function (entry) {
    const destination = path.resolve(state.context.repositoryRoot, entry.name);
    if (!inside(state.context.repositoryRoot, destination)) throw new Error("Unsafe transfer path.");
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, entry.content, { flag: "wx", mode: entry.mode });
  });
}

function transferWorktreeChanges(sourceRoot, destinationRoot, expectedDestinationState, maxBytes) {
  const source = worktreeState(sourceRoot, maxBytes);
  const destination = worktreeState(destinationRoot, maxBytes);
  if (source.context.commonGitDir !== destination.context.commonGitDir) throw new Error("Source and destination are not worktrees of the same Git repository.");
  if (source.context.head !== destination.context.head) throw new Error("Source and destination HEAD commits diverged. Reconcile Git history before handoff.");
  if (source.state === destination.state) return { state: source.state, patchApplied: false, untrackedCopied: 0 };
  if (destination.state !== expectedDestinationState) throw new Error("Destination changed independently since the last handoff. Refusing to overwrite it.");
  try {
    restoreProjectState(Object.assign({}, source, { context: destination.context }), maxBytes);
    const state = worktreeState(destinationRoot, maxBytes).state;
    if (state !== source.state) throw new Error("Remote worktree handoff verification failed; the destination does not match the source state.");
    return { state: state, patchApplied: Boolean(source.patch), untrackedCopied: source.untrackedEntries.length };
  } catch (error) {
    try {
      restoreProjectState(destination, maxBytes);
      const restored = worktreeState(destinationRoot, maxBytes).state;
      if (restored !== destination.state) throw new Error("Destination rollback verification failed.");
    } catch (rollbackError) {
      throw new Error((error && error.message ? error.message : String(error)) + " Destination rollback also failed: " + (rollbackError && rollbackError.message ? rollbackError.message : String(rollbackError)));
    }
    throw error;
  }
}

function createRemoteWorktree(root, request) {
  if (!/^rwt_[a-f0-9]{16}$/.test(request.worktreeId)) throw new Error("Invalid remote worktree id.");
  const source = repoContextFor(root);
  const resolvedBase = checkedGit(source.repositoryRoot, ["rev-parse", "--verify", request.baseRef + "^{commit}"]).trim();
  const storage = path.join(process.env.HOME || "/tmp", ".codexflow", "worktrees", crypto.createHash("sha256").update(source.repositoryRoot).digest("hex").slice(0, 24), "checkouts");
  const checkoutRoot = path.join(storage, request.worktreeId);
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  if (fs.existsSync(checkoutRoot)) throw new Error("Remote worktree path already exists.");
  checkedGit(source.repositoryRoot, ["worktree", "add", "--detach", checkoutRoot, resolvedBase]);
  try {
    const projectRoot = source.projectRelativePath === "." ? checkoutRoot : path.join(checkoutRoot, source.projectRelativePath);
    if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) throw new Error("Project path is absent from the new worktree.");
    let transfer = { patchApplied: false, untrackedCopied: 0 };
    if (request.includeChanges) {
      const emptyState = worktreeState(projectRoot, request.maxCopyBytes).state;
      transfer = transferWorktreeChanges(root, projectRoot, emptyState, request.maxCopyBytes);
    }
    const sourceState = worktreeState(root, request.maxCopyBytes).state;
    const worktreeStateValue = worktreeState(projectRoot, request.maxCopyBytes).state;
    return Object.assign({ repositoryRoot: source.repositoryRoot, checkoutRoot: checkoutRoot, projectRoot: projectRoot, projectRelativePath: source.projectRelativePath, baseRef: request.baseRef, sourceState: sourceState, worktreeState: worktreeStateValue }, transfer);
  } catch (error) {
    checkedGit(source.repositoryRoot, ["worktree", "remove", "--force", checkoutRoot]);
    throw error;
  }
}

function removeRemoteWorktree(request) {
  const sourceRoot = canonicalRoot(request.sourceRoot);
  const projectRoot = canonicalRoot(request.projectRoot);
  const source = repoContextFor(sourceRoot);
  const target = repoContextFor(projectRoot);
  const checkoutRoot = fs.realpathSync(path.resolve(request.checkoutRoot));
  if (source.commonGitDir !== target.commonGitDir || target.repositoryRoot !== checkoutRoot) throw new Error("Remote worktree identity no longer matches its manifest.");
  const state = worktreeState(projectRoot, request.maxSnapshotBytes);
  let snapshotPath;
  if (state.patch || state.untracked.length) {
    const snapshotRoot = path.join(process.env.HOME || "/tmp", ".codexflow", "worktree-snapshots", request.worktreeId, String(Date.now()));
    fs.mkdirSync(snapshotRoot, { recursive: true, mode: 0o700 });
    if (state.patch) fs.writeFileSync(path.join(snapshotRoot, "changes.patch"), state.patch, { mode: 0o600 });
    state.untrackedEntries.forEach(function (entry) {
      const sourceFile = path.resolve(target.repositoryRoot, entry.name);
      const relativeToProject = path.relative(projectRoot, sourceFile);
      if (relativeToProject === ".." || relativeToProject.indexOf("../") === 0) return;
      const destination = path.join(snapshotRoot, "untracked", relativeToProject);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, entry.content, { flag: "wx", mode: entry.mode });
    });
    snapshotPath = snapshotRoot;
  }
  checkedGit(source.repositoryRoot, ["worktree", "remove", "--force", checkoutRoot]);
  return { removed: true, snapshotPath: snapshotPath, sourceRoot: sourceRoot };
}

function execute(request, limits) {
  if (request.action === "probe_project") {
    const root = canonicalRoot(request.root);
    const top = git(root, ["rev-parse", "--show-toplevel"], limits.maxOutputBytes).text;
    const gitRoot = top !== "(no output)" && path.isAbsolute(top) ? fs.realpathSync(top.trim()) : undefined;
    return { root: root, name: path.basename(root) || root, gitRoot: gitRoot, gitRelativePath: gitRoot && inside(gitRoot, root) ? (path.relative(gitRoot, root) || ".").replace(/\\/g, "/") : undefined };
  }
  if (request.action === "worktree_transfer") return transferWorktreeChanges(canonicalRoot(request.sourceRoot), canonicalRoot(request.destinationRoot), request.expectedDestinationState, request.maxCopyBytes);
  if (request.action === "worktree_remove") return removeRemoteWorktree(request);
  const root = canonicalRoot(request.root);
  if (request.action === "worktree_create") return createRemoteWorktree(root, request);
  if (request.action === "worktree_status") {
    const state = worktreeState(root, limits.maxOutputBytes * 8);
    const branch = checkedGit(state.context.repositoryRoot, ["branch", "--show-current"]).trim();
    return { state: state.state, dirty: Boolean(state.patch || state.untracked.length), branch: branch || undefined, head: state.context.head };
  }
  if (request.action === "inspect") return inspectProject(root, request, limits);
  if (request.action === "list_skills" || request.action === "load_skill") {
    const skillFiles = [];
    function visitSkills(directory, depth) {
      if (depth < 0 || skillFiles.length >= request.maxSkills) return;
      let entries = [];
      try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_) { return; }
      entries.sort(function (a, b) { return a.name.localeCompare(b.name); });
      entries.forEach(function (entry) {
        if (skillFiles.length >= request.maxSkills || entry.name === ".git" || entry.name === "node_modules") return;
        const absolute = path.join(directory, entry.name);
        let stat;
        try { stat = fs.lstatSync(absolute); } catch (_) { return; }
        if (stat.isSymbolicLink()) return;
        if (stat.isFile() && entry.name === "SKILL.md") skillFiles.push(absolute);
        else if (stat.isDirectory()) visitSkills(absolute, depth - 1);
      });
    }
    [path.join(root, ".codex", "skills"), path.join(root, ".agents", "skills"), path.join(root, "skills")].forEach(function (directory) {
      let real;
      try { real = fs.realpathSync(directory); } catch (_) { return; }
      if (inside(root, real)) visitSkills(real, 3);
    });
    const skills = skillFiles.map(function (file) {
      const rel = path.relative(root, file).replace(/\\/g, "/");
      let head = "";
      try { head = fs.readFileSync(file, "utf8").slice(0, 16000); } catch (_) {}
      const nameMatch = head.match(/^name:\s*(.+)$/m);
      const descriptionMatch = head.match(/^description:\s*(.+)$/m);
      function clean(value) { return String(value || "").trim().replace(/^["']|["']$/g, ""); }
      return {
        name: clean(nameMatch && nameMatch[1]) || path.basename(path.dirname(file)),
        description: clean(descriptionMatch && descriptionMatch[1]) || undefined,
        source: "workspace",
        path: "$WORKSPACE/" + rel,
        absolute: file
      };
    });
    if (request.action === "list_skills") {
      return skills.map(function (skill) { return { name: skill.name, description: skill.description, source: skill.source, path: skill.path }; });
    }
    const matches = skills.filter(function (skill) {
      return skill.name === request.name && (!request.path || skill.path === request.path);
    });
    if (!matches.length) throw new Error("Remote workspace skill not found: " + request.name);
    if (matches.length > 1) throw new Error("Multiple remote workspace skills share that name. Pass the exact advertised path.");
    const skill = matches[0];
    const stat = fs.lstatSync(skill.absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Remote workspace skill must be a regular file.");
    const body = trim(fs.readFileSync(skill.absolute, "utf8"), request.maxBytes);
    return {
      skill: { name: skill.name, description: skill.description, source: skill.source, path: skill.path },
      text: body.value,
      bytes: Math.min(stat.size, request.maxBytes),
      totalBytes: stat.size,
      truncated: body.truncated
    };
  }
  if (request.action === "list_environments") {
    const directory = path.join(root, ".codex", "environments");
    let directoryStat;
    try { directoryStat = fs.lstatSync(directory); } catch (_) {
      return { platform: process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux", files: [] };
    }
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("Remote environment directory must be a regular directory inside the project.");
    const realDirectory = fs.realpathSync(directory);
    if (!inside(root, realDirectory)) throw new Error("Remote environment directory escapes the project.");
    const names = fs.readdirSync(realDirectory).filter(function (name) { return /^[^/\\]+\.toml$/.test(name); }).sort();
    if (names.length > request.maxFiles) throw new Error("Remote project has too many environment files.");
    const files = names.map(function (name) {
      const file = path.join(realDirectory, name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Remote environment config must be a regular file: " + name);
      if (stat.size > request.maxBytes) throw new Error("Remote environment config is too large: " + name);
      return { configPath: file, sourceRoot: root, content: fs.readFileSync(file, "utf8") };
    });
    return { platform: process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux", files: files };
  }
  if (request.action === "resolve_directory") {
    const target = resolveTarget(root, request.path || ".", false, limits.blockedGlobs);
    if (!fs.statSync(target.absolute).isDirectory()) throw new Error("Terminal cwd is not a directory.");
    return { absolute: fs.realpathSync(target.absolute), relative: target.rel };
  }
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
