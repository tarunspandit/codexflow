import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { CodexFlowConfig } from "./config.js";
import { isSubpath } from "./guard.js";
import { listCodexProjectDirectories } from "./codexSessions.js";

export type ProjectSource = "default" | "codex" | "allowed-root" | "discovered";

export interface ProjectCandidate {
  name: string;
  root: string;
  sources: ProjectSource[];
  lastActiveAt?: number;
}

const PROJECT_MARKERS = [
  ".git",
  "AGENTS.md",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts"
];
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", ".cache", "Library"]);
let cached: { key: string; at: number; projects: ProjectCandidate[] } | undefined;

function realDir(input: string): string | undefined {
  try {
    const real = fs.realpathSync(input);
    return fs.statSync(real).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

function allowed(config: CodexFlowConfig, root: string): boolean {
  return config.allowedRoots.some((allowedRoot) => isSubpath(root, allowedRoot));
}

async function looksLikeProject(root: string): Promise<boolean> {
  for (const marker of PROJECT_MARKERS) {
    if (fs.existsSync(path.join(root, marker))) return true;
  }
  try {
    return (await fsp.readdir(root, { withFileTypes: true })).some((entry) => entry.isDirectory() && entry.name.endsWith(".xcodeproj"));
  } catch {
    return false;
  }
}

async function discoverChildren(root: string, maxDepth: number, out: Set<string>, budget: { left: number }): Promise<void> {
  if (maxDepth < 0 || budget.left <= 0) return;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (budget.left <= 0) return;
    if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    budget.left -= 1;
    const child = realDir(path.join(root, entry.name));
    if (!child) continue;
    if (await looksLikeProject(child)) {
      out.add(child);
      continue;
    }
    if (maxDepth > 0) await discoverChildren(child, maxDepth - 1, out, budget);
  }
}

function mergeProject(
  records: Map<string, { sources: Set<ProjectSource>; lastActiveAt?: number }>,
  root: string | undefined,
  source: ProjectSource,
  lastActiveAt?: number
): void {
  if (!root) return;
  const current = records.get(root) ?? { sources: new Set<ProjectSource>() };
  current.sources.add(source);
  if (lastActiveAt && (!current.lastActiveAt || lastActiveAt > current.lastActiveAt)) current.lastActiveAt = lastActiveAt;
  records.set(root, current);
}

export async function discoverProjects(config: CodexFlowConfig, options: { refresh?: boolean; maxProjects?: number } = {}): Promise<ProjectCandidate[]> {
  const maxProjects = Math.max(1, Math.min(options.maxProjects ?? 100, 250));
  const key = JSON.stringify({ defaultRoot: config.defaultRoot, allowedRoots: config.allowedRoots, codexDir: config.codexDir, maxProjects });
  if (!options.refresh && cached?.key === key && Date.now() - cached.at < 15_000) return cached.projects.map((project) => ({ ...project, sources: [...project.sources] }));

  const records = new Map<string, { sources: Set<ProjectSource>; lastActiveAt?: number }>();
  const defaultRoot = realDir(config.defaultRoot);
  if (defaultRoot) mergeProject(records, defaultRoot, "default");

  for (const allowedRoot of config.allowedRoots) {
    const root = realDir(allowedRoot);
    if (!root) continue;
    if (await looksLikeProject(root)) mergeProject(records, root, "allowed-root");
  }

  try {
    const projects = await listCodexProjectDirectories({ ...config, codexSessions: "metadata" });
    for (const project of projects) {
      const root = realDir(project.project_dir);
      if (root && allowed(config, root)) mergeProject(records, root, "codex", project.last_active_at);
    }
  } catch {
    // Codex history is an optional discovery source; configured roots still work without it.
  }

  const discovered = new Set<string>();
  const budget = { left: 600 };
  for (const allowedRoot of config.allowedRoots) {
    const root = realDir(allowedRoot);
    if (root && !(root === defaultRoot && config.allowedRoots.length > 1)) await discoverChildren(root, 1, discovered, budget);
    if (budget.left <= 0) break;
  }
  for (const root of discovered) {
    if (allowed(config, root)) mergeProject(records, root, "discovered");
  }

  const projects = [...records.entries()].map(([root, record]) => ({
    name: path.basename(root) || root,
    root,
    sources: [...record.sources].sort(),
    ...(record.lastActiveAt ? { lastActiveAt: record.lastActiveAt } : {})
  })).sort((a, b) => {
    const aDefault = a.sources.includes("default") ? 1 : 0;
    const bDefault = b.sources.includes("default") ? 1 : 0;
    return bDefault - aDefault || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0) || a.name.localeCompare(b.name) || a.root.localeCompare(b.root);
  }).slice(0, maxProjects);

  cached = { key, at: Date.now(), projects };
  return projects.map((project) => ({ ...project, sources: [...project.sources] }));
}
