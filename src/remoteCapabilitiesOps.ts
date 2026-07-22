import type { CodexFlowConfig } from "./config.js";
import type { LoadedSkill, SkillInventoryItem } from "./capabilitiesOps.js";
import type { SavedRemoteProject } from "./remoteConnections.js";
import { runRemoteWorkspaceOperation } from "./remoteWorkspace.js";

export async function discoverRemoteSkillInventory(
  config: CodexFlowConfig,
  project: SavedRemoteProject,
  maxSkills = 120
): Promise<SkillInventoryItem[]> {
  return runRemoteWorkspaceOperation<SkillInventoryItem[]>(project.hostAlias, config, {
    action: "list_skills",
    root: project.root,
    maxSkills: Math.max(1, Math.min(maxSkills, 500))
  });
}

export async function loadRemoteSkill(
  config: CodexFlowConfig,
  project: SavedRemoteProject,
  options: { name: string; path?: string; maxSkills?: number; maxBytes?: number }
): Promise<LoadedSkill> {
  return runRemoteWorkspaceOperation<LoadedSkill>(project.hostAlias, config, {
    action: "load_skill",
    root: project.root,
    name: options.name.trim(),
    ...(options.path ? { path: options.path.trim() } : {}),
    maxSkills: Math.max(1, Math.min(options.maxSkills ?? 500, 500)),
    maxBytes: Math.max(1_000, Math.min(options.maxBytes ?? 40_000, 100_000))
  });
}
