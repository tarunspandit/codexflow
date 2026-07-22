import path from "node:path";
import type { CodexFlowConfig } from "./config.js";
import { CodexFlowError } from "./guard.js";
import {
  parseEnvironmentText,
  type LocalEnvironment,
  type LocalEnvironmentPlatform
} from "./localEnvironmentOps.js";
import type { SavedRemoteProject } from "./remoteConnections.js";
import { runRemoteWorkspaceOperation } from "./remoteWorkspace.js";

export interface RemoteEnvironmentCatalog {
  platform: LocalEnvironmentPlatform;
  environments: LocalEnvironment[];
}

interface RemoteEnvironmentResponse {
  platform: LocalEnvironmentPlatform;
  files: Array<{ configPath: string; sourceRoot: string; content: string }>;
}

export async function listRemoteEnvironments(
  config: CodexFlowConfig,
  project: SavedRemoteProject
): Promise<RemoteEnvironmentCatalog> {
  const result = await runRemoteWorkspaceOperation<RemoteEnvironmentResponse>(project.hostAlias, config, {
    action: "list_environments",
    root: project.root,
    maxBytes: Math.min(config.maxReadBytes, 1024 * 1024),
    maxFiles: 100
  });
  if (!["darwin", "linux", "win32"].includes(result.platform)) {
    throw new CodexFlowError("The remote host reported an unsupported environment platform.");
  }
  return {
    platform: result.platform,
    environments: result.files.map((file) => {
      if (!path.posix.isAbsolute(file.configPath) || !path.posix.isAbsolute(file.sourceRoot)) {
        throw new CodexFlowError("The remote host returned an invalid environment path.");
      }
      return parseEnvironmentText(file.content, file.configPath, file.sourceRoot, project.root);
    })
  };
}

export async function resolveRemoteEnvironment(
  config: CodexFlowConfig,
  project: SavedRemoteProject,
  selector?: string
): Promise<RemoteEnvironmentCatalog & { environment: LocalEnvironment }> {
  const catalog = await listRemoteEnvironments(config, project);
  if (!catalog.environments.length) {
    throw new CodexFlowError("No remote environments were found. Create a version 1 TOML file in .codex/environments/.");
  }
  const needle = selector?.trim();
  let matches: LocalEnvironment[];
  if (!needle) {
    if (catalog.environments.length !== 1) {
      throw new CodexFlowError("More than one remote environment is available. Provide config_path or environment name.");
    }
    matches = catalog.environments;
  } else {
    matches = catalog.environments.filter((environment) =>
      environment.name === needle ||
      environment.configPath === needle ||
      path.posix.basename(environment.configPath) === needle
    );
  }
  if (matches.length === 1) return { ...catalog, environment: matches[0]! };
  if (!matches.length) throw new CodexFlowError(`Remote environment not found: ${needle}`);
  throw new CodexFlowError(`Remote environment selector is ambiguous: ${needle}`);
}
