import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CodexFlowConfig } from "./config.js";
import { CodexFlowError, isSubpath, PathGuard, type Workspace } from "./guard.js";
import { hasSecretValue, redactSensitiveText } from "./redact.js";

export type GitWorkflowAction =
  | "stage"
  | "unstage"
  | "discard"
  | "create_branch"
  | "switch_branch"
  | "commit"
  | "push"
  | "create_pr";

export interface GitWorkflowOptions {
  action: GitWorkflowAction;
  paths?: string[];
  branch?: string;
  message?: string;
  remote?: string;
  setUpstream?: boolean;
  title?: string;
  body?: string;
  base?: string;
  includeStaged?: boolean;
}

export interface GitWorkflowResult {
  action: GitWorkflowAction;
  root: string;
  branch?: string;
  paths: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  changed: boolean;
  url?: string;
}

function run(
  command: string,
  args: string[],
  cwd: string,
  maxOutputBytes: number
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: maxOutputBytes,
    env: { ...process.env, NO_COLOR: "1", GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" }
  });
  if (result.error) throw new CodexFlowError(`${command} failed: ${result.error.message}`);
  return {
    stdout: redactSensitiveText(result.stdout?.trim() || ""),
    stderr: redactSensitiveText(result.stderr?.trim() || ""),
    status: result.status ?? 1
  };
}

function runGit(config: CodexFlowConfig, workspace: Workspace, args: string[]): { stdout: string; stderr: string } {
  const result = run("git", args, workspace.root, config.maxOutputBytes);
  if (result.status !== 0) {
    throw new CodexFlowError(result.stderr || result.stdout || `git ${args[0]} exited with status ${result.status}`);
  }
  return result;
}

function resolvePaths(guard: PathGuard, workspace: Workspace, values: string[] | undefined): string[] {
  const requested = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
  return requested.map((value) => guard.resolve(workspace, value, { forWrite: true }).relPath);
}

function assertBranchName(config: CodexFlowConfig, workspace: Workspace, value: string | undefined): string {
  const branch = value?.trim();
  if (!branch) throw new CodexFlowError("branch is required.");
  const checked = run("git", ["check-ref-format", "--branch", branch], workspace.root, config.maxOutputBytes);
  if (checked.status !== 0) throw new CodexFlowError(`Invalid Git branch name: ${branch}`);
  return branch;
}

function assertRemote(value: string | undefined): string {
  const remote = value?.trim() || "origin";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(remote)) {
    throw new CodexFlowError("remote must be a configured Git remote name using letters, numbers, dot, underscore, or dash.");
  }
  return remote;
}

function currentBranch(config: CodexFlowConfig, workspace: Workspace): string {
  const { stdout } = runGit(config, workspace, ["branch", "--show-current"]);
  if (!stdout) throw new CodexFlowError("The workspace is in detached HEAD state. Create or switch to a branch before pushing.");
  return stdout;
}

function changedAfter(config: CodexFlowConfig, workspace: Workspace): boolean {
  return runGit(config, workspace, ["status", "--porcelain", "--", "."]).stdout.length > 0;
}

function stagedPaths(config: CodexFlowConfig, workspace: Workspace): string[] {
  const repositoryRoot = fs.realpathSync(runGit(config, workspace, ["rev-parse", "--show-toplevel"]).stdout);
  const result = spawnSync("git", ["diff", "--cached", "--name-only", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: config.maxOutputBytes,
    env: { ...process.env, NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" }
  });
  if (result.error) throw new CodexFlowError(`git failed: ${result.error.message}`);
  if ((result.status ?? 1) !== 0) throw new CodexFlowError(redactSensitiveText(Buffer.from(result.stderr ?? []).toString("utf8")));
  return Buffer.from(result.stdout ?? []).toString("utf8").split("\0").filter(Boolean).map((name) => path.resolve(repositoryRoot, name));
}

export function runGitWorkflow(
  config: CodexFlowConfig,
  guard: PathGuard,
  workspace: Workspace,
  options: GitWorkflowOptions
): GitWorkflowResult {
  const action = options.action;
  const paths = resolvePaths(guard, workspace, options.paths);
  let result: { stdout: string; stderr: string } = { stdout: "", stderr: "" };
  let branch: string | undefined;
  let url: string | undefined;

  if (action === "stage") {
    result = runGit(config, workspace, paths.length ? ["add", "--", ...paths] : ["add", "-A", "--", "."]);
  } else if (action === "unstage") {
    result = runGit(config, workspace, paths.length ? ["restore", "--staged", "--", ...paths] : ["restore", "--staged", "--", "."]);
  } else if (action === "discard") {
    if (!paths.length) throw new CodexFlowError("discard requires at least one explicit path. CodexFlow never discards the entire workspace implicitly.");
    const tracked: string[] = [];
    const untracked: string[] = [];
    for (const file of paths) {
      const trackedCheck = run("git", ["ls-files", "--error-unmatch", "--", file], workspace.root, config.maxOutputBytes);
      if (trackedCheck.status === 0) {
        tracked.push(file);
        continue;
      }
      const untrackedCheck = run("git", ["ls-files", "--others", "--exclude-standard", "--", file], workspace.root, config.maxOutputBytes);
      if (untrackedCheck.status === 0 && untrackedCheck.stdout.split("\n").includes(file)) {
        untracked.push(file);
        continue;
      }
      throw new CodexFlowError(`Cannot discard ${file} because it is not a tracked or untracked Git change.`);
    }
    if (tracked.length) {
      result = runGit(config, workspace, [
        "restore",
        ...(options.includeStaged ? ["--staged", "--worktree"] : ["--worktree"]),
        "--",
        ...tracked
      ]);
    }
    for (const file of untracked) {
      const resolved = guard.resolve(workspace, file, { forWrite: true });
      fs.rmSync(resolved.absPath, { force: true });
    }
    if (untracked.length) {
      result = {
        stdout: [result.stdout, `Removed ${untracked.length} untracked file${untracked.length === 1 ? "" : "s"}.`].filter(Boolean).join("\n"),
        stderr: result.stderr
      };
    }
  } else if (action === "create_branch") {
    branch = assertBranchName(config, workspace, options.branch);
    result = runGit(config, workspace, ["switch", "-c", branch]);
  } else if (action === "switch_branch") {
    branch = assertBranchName(config, workspace, options.branch);
    result = runGit(config, workspace, ["switch", branch]);
  } else if (action === "commit") {
    const message = options.message?.trim();
    if (!message) throw new CodexFlowError("message is required for commit.");
    if (message.length > 500) throw new CodexFlowError("commit message must be 500 characters or fewer.");
    if (hasSecretValue(message)) throw new CodexFlowError("Commit message appears to contain a credential or secret.");
    const staged = stagedPaths(config, workspace);
    if (!staged.length) throw new CodexFlowError("Nothing is staged. Use git_workflow action=stage before committing.");
    const outsideWorkspace = staged.filter((file) => !isSubpath(file, workspace.root));
    if (outsideWorkspace.length) {
      throw new CodexFlowError("The Git index contains changes outside this selected project. Unstage them before committing from this route.");
    }
    result = runGit(config, workspace, ["commit", "-m", message]);
    branch = runGit(config, workspace, ["branch", "--show-current"]).stdout || undefined;
  } else if (action === "push") {
    branch = options.branch?.trim() ? assertBranchName(config, workspace, options.branch) : currentBranch(config, workspace);
    const remote = assertRemote(options.remote);
    result = runGit(config, workspace, ["push", ...(options.setUpstream !== false ? ["--set-upstream"] : []), remote, branch]);
  } else if (action === "create_pr") {
    const title = options.title?.trim();
    if (!title) throw new CodexFlowError("title is required for create_pr.");
    if (title.length > 256) throw new CodexFlowError("pull request title must be 256 characters or fewer.");
    const body = options.body?.trim() || "";
    if (hasSecretValue(`${title}\n${body}`)) throw new CodexFlowError("Pull request title or body appears to contain a credential or secret.");
    const args = ["pr", "create", "--title", title, "--body", body];
    if (options.base?.trim()) args.push("--base", assertBranchName(config, workspace, options.base));
    const gh = run("gh", args, workspace.root, config.maxOutputBytes);
    if (gh.status !== 0) throw new CodexFlowError(gh.stderr || gh.stdout || `gh pr create exited with status ${gh.status}`);
    result = gh;
    url = gh.stdout.split(/\s+/).find((value) => /^https:\/\/github\.com\/.+\/pull\/\d+$/.test(value));
    branch = runGit(config, workspace, ["branch", "--show-current"]).stdout || undefined;
  } else {
    throw new CodexFlowError(`Unsupported git workflow action: ${String(action)}`);
  }

  return {
    action,
    root: workspace.root,
    branch,
    paths,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: 0,
    changed: changedAfter(config, workspace),
    url
  };
}
