import type { WorkspaceAnalysis } from "./analysis/types.js";
import type { CodexFlowConfig } from "./config.js";
import type { SavedRemoteProject } from "./remoteConnections.js";
import { runRemoteWorkspaceOperation } from "./remoteWorkspace.js";

export async function inspectRemoteWorkspace(
  config: CodexFlowConfig,
  project: SavedRemoteProject,
  limits: { maxFiles: number; maxSymbols: number; maxRelationships: number }
): Promise<WorkspaceAnalysis> {
  const maxFiles = Math.max(1, Math.min(limits.maxFiles, config.analysisLimits.maxInventoryFiles, 3_000));
  const maxSymbols = Math.max(1, Math.min(limits.maxSymbols, config.analysisLimits.maxSymbols, 5_000));
  const maxRelationships = Math.max(1, Math.min(limits.maxRelationships, config.analysisLimits.maxRelationships, 10_000));
  const result = await runRemoteWorkspaceOperation<Omit<WorkspaceAnalysis, "workspaceId">>(project.hostAlias, config, {
    action: "inspect",
    root: project.root,
    maxFiles,
    maxAnalyzedFiles: config.analysisLimits.maxAnalyzedFiles,
    maxScannedBytes: config.analysisLimits.maxScannedBytes,
    maxSymbols,
    maxRelationships
  }, 120_000);
  const transportLimited = limits.maxFiles > maxFiles || limits.maxSymbols > maxSymbols || limits.maxRelationships > maxRelationships;
  if (!transportLimited) return { ...result, workspaceId: project.id };
  const warning = "Remote analysis output was bounded for transport safety. Use path or narrower max_* arguments for focused inspection.";
  const warnings = result.warnings.includes(warning) ? result.warnings : [...result.warnings, warning];
  return {
    ...result,
    workspaceId: project.id,
    warnings,
    coverage: { ...result.coverage, truncated: true, warnings }
  };
}
