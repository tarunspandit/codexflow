import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawnSync } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CodexFlowConfig } from "./config.js";
import { WorkspaceManager, PathGuard, CodexFlowError, type Workspace } from "./guard.js";
import { repoTree, readTextFile, writeTextFile, editTextFile, ensureAiBridge } from "./fsOps.js";
import { searchWorkspace, type SearchResult } from "./searchOps.js";
import { assertBashSession, runBash } from "./bashOps.js";
import { gitDiff, gitDiffStatus, gitLog, gitStatus } from "./gitOps.js";
import { runGitWorkflow } from "./gitWorkflow.js";
import {
  createManagedWorktree,
  handoffManagedWorktree,
  listManagedWorktrees,
  managedWorktreePaths,
  removeManagedWorktree
} from "./worktreeOps.js";
import { persistentTerminals } from "./terminalOps.js";
import {
  environmentAction,
  environmentActionForPlatform,
  environmentScriptForPlatform,
  environmentTerminalCommand,
  listLocalEnvironments,
  localEnvironmentSummary,
  resolveLocalEnvironment,
  runLocalEnvironmentCommand
} from "./localEnvironmentOps.js";
import { listRemoteEnvironments, resolveRemoteEnvironment } from "./remoteEnvironmentOps.js";
import { readAiBridgeContext, readCodexContext, workspaceSummary } from "./workspaceOps.js";
import { buildProContext, exportProContext } from "./proContext.js";
import { codexflowInventory, loadSkill } from "./capabilitiesOps.js";
import { discoverRemoteSkillInventory, loadRemoteSkill } from "./remoteCapabilitiesOps.js";
import { listCodexSessions, readCodexSession } from "./codexSessions.js";
import { discoverProjects } from "./projectCatalog.js";
import { TOOL_CARD_LEGACY_URIS, TOOL_CARD_MIME_TYPE, TOOL_CARD_URI, toolCardWidgetHtml } from "./toolCardWidget.js";
import {
  PROJECT_PICKER_LEGACY_URIS,
  PROJECT_PICKER_URI,
  projectPickerWidgetHtml
} from "./projectPickerWidget.js";
import { hasSecretValue, redactSensitiveText, redactStructured } from "./redact.js";
import { inspectWorkspace, invalidateWorkspaceAnalysis, reviewWorkspaceChanges } from "./analysis/index.js";
import { inspectRemoteWorkspace } from "./remoteAnalysisOps.js";
import {
  createRemoteManagedWorktree,
  handoffRemoteManagedWorktree,
  listRemoteManagedWorktrees,
  removeRemoteManagedWorktree
} from "./remoteWorktreeOps.js";
import { CODEXFLOW_VERSION } from "./version.js";
import { ChatRouteStore, isChatRouteId } from "./chatRoutes.js";
import { codexFlowHome } from "./profileStore.js";
import {
  getApprovedRemoteProject,
  listSavedRemoteProjects,
  type SavedRemoteProject
} from "./remoteConnections.js";
import {
  assertRemoteBash,
  assertRemoteWriteContent,
  runRemoteWorkspaceOperation
} from "./remoteWorkspace.js";

const STRUCTURED_STRING_MAX_CHARS = 30_000;

export interface CodexFlowRuntimeObserver {
  onWorkspaceChanged?(workspace: Workspace): void;
  onToolCall?(event: {
    name: string;
    status: "ok" | "error";
    durationMs: number;
    at: number;
    workspace?: Workspace;
    routeId?: string;
  }): void;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return redactSensitiveText(`${error.name}: ${error.message}`);
  return redactSensitiveText(String(error));
}

function compactStructuredContent<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length <= STRUCTURED_STRING_MAX_CHARS) return value as T;
    return `${value.slice(0, STRUCTURED_STRING_MAX_CHARS)}\n...[structured field truncated to ${STRUCTURED_STRING_MAX_CHARS} chars]` as T;
  }
  if (Array.isArray(value)) return value.map((item) => compactStructuredContent(item, depth + 1)) as T;
  if (typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = compactStructuredContent(item, depth + 1);
  }
  return out as T;
}

function textResult(text: string, structuredContent: Record<string, unknown> = {}, meta: Record<string, unknown> = {}): any {
  return {
    content: [{ type: "text", text: redactSensitiveText(text) }],
    structuredContent: redactStructured(structuredContent),
    _meta: meta
  };
}

function countTextLines(value: string | undefined): number {
  if (!value) return 0;
  return value.split(/\r?\n/).filter((line) => line.length > 0).length;
}

function bashTextResult(config: CodexFlowConfig, result: Awaited<ReturnType<typeof runBash>>): string {
  if (config.bashTranscript === "full") {
    return `# Bash\n\n\`\`\`bash\n$ ${result.command}\n\`\`\`\n\nCWD: ${result.cwd}\nExit: ${result.exitCode}${result.signal ? ` (${result.signal})` : ""}\nDuration: ${result.durationMs} ms\n\n## stdout\n\n\`\`\`text\n${result.stdout || ""}\n\`\`\`\n\n## stderr\n\n\`\`\`text\n${result.stderr || ""}\n\`\`\``;
  }

  const stdoutLines = countTextLines(result.stdout);
  const stderrLines = countTextLines(result.stderr);
  return [
    "# Bash",
    "",
    `\`${result.command}\``,
    "",
    `CWD: ${result.cwd}`,
    `Exit: ${result.exitCode}${result.signal ? ` (${result.signal})` : ""}`,
    `Duration: ${result.durationMs} ms`,
    `Output: stdout ${stdoutLines} line${stdoutLines === 1 ? "" : "s"}, stderr ${stderrLines} line${stderrLines === 1 ? "" : "s"}.`,
    "",
    "Raw stdout/stderr are in the structured CodexFlow card. Start with `--bash-transcript full` to print raw output in chat."
  ].join("\n");
}

function errorResult(error: unknown): any {
  return {
    isError: true,
    content: [{ type: "text", text: errorText(error) }],
    structuredContent: { error: errorText(error) }
  };
}

function validateToolArgs(name: string, options: Record<string, unknown>, args: unknown): any {
  const inputSchema = options.inputSchema;
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) return args ?? {};
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(inputSchema)) {
    if (value && typeof (value as { safeParse?: unknown }).safeParse === "function") {
      shape[key] = value as z.ZodTypeAny;
    }
  }
  if (!Object.keys(shape).length) return {};
  const parsed = z.object(shape).safeParse(args ?? {});
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "arguments"}: ${issue.message}`)
    .join("; ");
  throw new CodexFlowError(`Invalid arguments for ${name}: ${details}`);
}

function tagToolResult(result: any, name: string, options: Record<string, unknown>): any {
  if (!result || typeof result !== "object") return result;
  const structured = result.structuredContent;
  const base =
    structured && typeof structured === "object" && !Array.isArray(structured)
      ? structured
      : {};
  const tagged = {
    codexflow_tool: name,
    codexflow_title: options.title ?? name,
    ...base
  };
  const meta = (options._meta as Record<string, unknown> | undefined) ?? {};
  result.structuredContent = meta.ui || meta["openai/outputTemplate"] ? compactStructuredContent(tagged) : tagged;
  return result;
}

function toolCardMeta(): Record<string, unknown> {
  return {
    ui: { resourceUri: TOOL_CARD_URI },
    "openai/outputTemplate": TOOL_CARD_URI
  };
}

function projectPickerMeta(): Record<string, unknown> {
  return {
    ui: { resourceUri: PROJECT_PICKER_URI, visibility: ["model", "app"] },
    "openai/outputTemplate": PROJECT_PICKER_URI
  };
}

const LIST_PROJECTS_OUTPUT_SCHEMA = {
  codexflow_tool: z.literal("list_projects"),
  codexflow_title: z.string(),
  route_id: z.string(),
  projects: z.array(z.object({
    project_id: z.string(),
    name: z.string(),
    root: z.string(),
    location: z.enum(["local", "remote"]),
    host_alias: z.string().nullable(),
    sources: z.array(z.string()),
    last_active_at: z.string().nullable(),
    selected: z.boolean()
  })),
  count: z.number().int().nonnegative(),
  selected_project_id: z.string().nullable(),
  picker_optional: z.boolean()
};

const SKILL_INVENTORY_OUTPUT_SCHEMA = z.object({
  name: z.string(),
  description: z.string().optional(),
  source: z.enum(["workspace", "user", "plugin", "other"]),
  path: z.string()
});

const PLUGIN_INVENTORY_OUTPUT_SCHEMA = z.object({
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  source: z.string(),
  capabilities: z.array(z.string()),
  hasSkills: z.boolean(),
  hasApps: z.boolean(),
  hasMcpServers: z.boolean()
});

const MCP_SERVER_INVENTORY_OUTPUT_SCHEMA = z.object({
  name: z.string(),
  source: z.string()
});

const SELECT_PROJECT_OUTPUT_SCHEMA = {
  codexflow_tool: z.literal("select_project"),
  codexflow_title: z.string(),
  route_id: z.string(),
  selected: z.literal(true),
  project_id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  root: z.string(),
  location: z.enum(["local", "remote"]),
  host_alias: z.string().nullable(),
  sources: z.array(z.string()),
  agents_loaded: z.boolean(),
  agents_path: z.string().optional(),
  tree: z.string().optional(),
  git_status: z.string(),
  skills: z.array(SKILL_INVENTORY_OUTPUT_SCHEMA),
  skill_count: z.number().int().nonnegative(),
  plugins: z.array(PLUGIN_INVENTORY_OUTPUT_SCHEMA),
  plugin_count: z.number().int().nonnegative(),
  plugin_skills: z.array(SKILL_INVENTORY_OUTPUT_SCHEMA),
  mcp_servers: z.array(MCP_SERVER_INVENTORY_OUTPUT_SCHEMA),
  mcp_server_count: z.number().int().nonnegative(),
  bash_mode: z.string(),
  write_mode: z.string(),
  tool_mode: z.string()
};

const OPTIONAL_TOOL_CARD_META = [
  "ui",
  "openai/outputTemplate",
  "openai/toolInvocation/invoking",
  "openai/toolInvocation/invoked"
] as const;

function descriptorOptionsForConfig(config: CodexFlowConfig, options: Record<string, unknown>): Record<string, unknown> {
  const originalMeta = (options._meta as Record<string, unknown> | undefined) ?? {};
  if (config.toolCards || originalMeta["codexflow/alwaysWidget"] === true) return options;
  const meta = { ...originalMeta };
  const ui = originalMeta.ui && typeof originalMeta.ui === "object" && !Array.isArray(originalMeta.ui)
    ? originalMeta.ui as Record<string, unknown>
    : undefined;
  for (const key of OPTIONAL_TOOL_CARD_META) delete meta[key];
  if (ui?.visibility) meta.ui = { visibility: ui.visibility };
  return { ...options, _meta: meta };
}

function toolCallLoggingEnabled(): boolean {
  return process.env.CODEXFLOW_LOG_TOOL_CALLS === "1" || process.env.CODEXFLOW_LOG_REQUESTS === "1";
}

function logToolCall(name: string, status: "ok" | "error", started: number): void {
  if (!toolCallLoggingEnabled()) return;
  console.error(`[CodexFlowTool] ${name} ${status} ${Date.now() - started}ms`);
}

function registerToolCardResource(server: McpServer, config: CodexFlowConfig): void {
  if (config.connectionTest) return;
  const s = server as any;
  if (typeof s.registerResource !== "function") {
    throw new Error("Unsupported MCP SDK: CodexFlow widgets require registerResource.");
  }

  const registerUri = (
    uri: string,
    name: string,
    title: string,
    description: string,
    widgetDescription: string,
    html: string
  ): void => {
    const uiMeta = {
      prefersBorder: true,
      csp: {
        connectDomains: [] as string[],
        resourceDomains: [] as string[]
      },
      ...(config.widgetDomain ? { domain: config.widgetDomain } : {})
    };
    s.registerResource(
      name,
      uri,
      {
        title,
        description,
        mimeType: TOOL_CARD_MIME_TYPE
      },
      async () => ({
        contents: [
          {
            uri,
            mimeType: TOOL_CARD_MIME_TYPE,
            text: html,
            _meta: {
              ui: uiMeta,
              "openai/widgetDescription": widgetDescription,
              "openai/widgetPrefersBorder": true,
              "openai/widgetCSP": {
                connect_domains: [],
                resource_domains: []
              },
              ...(config.widgetDomain ? { "openai/widgetDomain": config.widgetDomain } : {})
            }
          }
        ]
      })
    );
  };

  registerUri(
    PROJECT_PICKER_URI,
    "codexflow-project-picker",
    "Choose a CodexFlow project",
    "Small, host-native picker for binding this conversation to one synchronized local project.",
    "Choose the local project this conversation should use. You can also reply in chat with an exact project name.",
    projectPickerWidgetHtml
  );
  for (const legacyUri of PROJECT_PICKER_LEGACY_URIS) {
    registerUri(
      legacyUri,
      `codexflow-project-picker-${legacyUri.match(/v\d+/)?.[0] ?? "legacy"}`,
      "Choose a CodexFlow project",
      "Compatibility resource for prior CodexFlow project pickers.",
      "Choose the local project this conversation should use. You can also reply in chat with an exact project name.",
      projectPickerWidgetHtml
    );
  }
  registerUri(
    TOOL_CARD_URI,
    "codexflow-tool-card",
    "CodexFlow workspace card",
    "Compact, bounded workspace results for CodexFlow.",
    "Presents bounded CodexFlow workspace results without leaving ChatGPT.",
    toolCardWidgetHtml
  );
  for (const legacyUri of TOOL_CARD_LEGACY_URIS) {
    registerUri(
      legacyUri,
      `codexflow-tool-card-${legacyUri.match(/v\d+/)?.[0] ?? "legacy"}`,
      "CodexFlow workspace card",
      "Compatibility resource for prior CodexFlow result cards.",
      "Presents bounded CodexFlow workspace results without leaving ChatGPT.",
      toolCardWidgetHtml
    );
  }
}

interface CodexToolExtra {
  sessionId?: string;
  _meta?: Record<string, unknown>;
}

interface RouteInvocationContext {
  routeId?: string;
}

type CodexToolHandler = (args: any, extra?: CodexToolExtra) => Promise<any> | any;

const routeInvocationStorage = new AsyncLocalStorage<RouteInvocationContext>();

function invocationRouteId(): string | undefined {
  return routeInvocationStorage.getStore()?.routeId;
}

function requestRouteId(args: any, extra?: CodexToolExtra): string | undefined {
  const meta = extra?._meta ?? {};
  const candidates = [
    args?.route_id,
    meta["codexflow/routeId"],
    meta["openai/widgetSessionId"],
    meta.widgetSessionId
  ];
  return candidates.find(isChatRouteId);
}

function resultRouteId(result: any): string | undefined {
  const meta = result?._meta ?? {};
  const candidates = [
    result?.structuredContent?.route_id,
    meta["codexflow/routeId"],
    meta["openai/widgetSessionId"],
    meta.widgetSessionId
  ];
  return candidates.find(isChatRouteId);
}

const ROUTE_ID_INPUT = z.string()
  .regex(/^route_[a-f0-9]{32}$/)
  .optional()
  .describe("Private chat route from list_projects, select_project, or picker context. In ChatGPT, pass it on every project-scoped call so separate MCP transports stay on the selected project.");

function withRouteInput(name: string, options: Record<string, unknown>): Record<string, unknown> {
  const inputSchema = options.inputSchema;
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) return options;
  const shape = inputSchema as Record<string, unknown>;
  const routeAware = Object.hasOwn(shape, "workspace_id") || [
    SUPERTOOL_NAME,
    "list_projects",
    "select_project",
    "open_current_workspace",
    "open_workspace"
  ].includes(name);
  if (!routeAware || Object.hasOwn(shape, "route_id")) return options;
  return { ...options, inputSchema: { route_id: ROUTE_ID_INPUT, ...shape } };
}

interface ServerRuntimeContext {
  observer: CodexFlowRuntimeObserver;
  activeWorkspace: () => Workspace | undefined;
}

type SelectedProjectTarget =
  | { kind: "local"; workspace: Workspace }
  | { kind: "remote"; workspace: Workspace; project: SavedRemoteProject };

const serverRuntimeContexts = new WeakMap<object, ServerRuntimeContext>();

function notifyRuntimeToolCall(
  server: McpServer,
  name: string,
  status: "ok" | "error",
  started: number,
  routeId?: string
): void {
  const context = serverRuntimeContexts.get(server as object);
  if (!context?.observer.onToolCall) return;
  const at = Date.now();
  try {
    context.observer.onToolCall({
      name,
      status,
      durationMs: at - started,
      at,
      workspace: context.activeWorkspace(),
      routeId
    });
  } catch {
    // Operational telemetry must never interrupt a tool response.
  }
}

const SUPERTOOL_NAME = "codexflow";
const SUPERTOOL_ACTION_ALIASES: Record<string, string> = {
  actions: "list_actions",
  config: "server_config",
  self_test: "codexflow_self_test",
  inventory: "codexflow_inventory",
  open: "open_current_workspace",
  snapshot: "workspace_snapshot",
  changes: "show_changes",
  handoff_poll: "wait_for_handoff",
  pro_export: "export_pro_context",
  agent_handoff: "handoff_to_agent",
  codex_handoff: "handoff_to_codex"
};

const registeredToolHandlersByServer = new WeakMap<object, Map<string, CodexToolHandler>>();

function rememberRegisteredToolHandler(server: McpServer, name: string, handler: CodexToolHandler): void {
  const key = server as object;
  const handlers = registeredToolHandlersByServer.get(key) ?? new Map<string, CodexToolHandler>();
  if (!registeredToolHandlersByServer.has(key)) registeredToolHandlersByServer.set(key, handlers);
  handlers.set(name, handler);
}

function registeredToolHandler(server: McpServer, name: string): CodexToolHandler | undefined {
  return registeredToolHandlersByServer.get(server as object)?.get(name);
}

function normalizeSupertoolAction(value: unknown): string {
  const raw = String(value ?? "list_actions").trim();
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_");
  return SUPERTOOL_ACTION_ALIASES[normalized] ?? normalized;
}


function isContextPath(config: CodexFlowConfig, relPath: string): boolean {
  const normalized = relPath.split(path.sep).join("/").replace(/^\.\//, "");
  const contextDir = config.contextDir.replace(/^\.\//, "").replace(/\/$/, "");
  return normalized === contextDir || normalized.startsWith(`${contextDir}/`);
}

function assertWriteToolAllowed(config: CodexFlowConfig, relPath: string): void {
  if (config.writeMode === "workspace") return;
  if (config.writeMode === "handoff" && isContextPath(config, relPath)) return;
  if (config.writeMode === "handoff") {
    throw new CodexFlowError(
      `Source writes are disabled because CODEXFLOW_WRITE_MODE=handoff. ` +
        `Use handoff_to_agent or handoff_to_codex, or write/edit/apply_patch only inside ${config.contextDir}/.`
    );
  }
  throw new CodexFlowError("write/edit/apply_patch tools are disabled because CODEXFLOW_WRITE_MODE=off. handoff_to_agent and handoff_to_codex are still available for planning.");
}

function registerToolCompat(
  server: McpServer,
  name: string,
  options: Record<string, unknown>,
  handler: CodexToolHandler
): void {
  const wrapped = async (args: any, extra?: CodexToolExtra) => {
    const started = Date.now();
    const requestedRouteId = requestRouteId(args ?? {}, extra);
    try {
      const result = tagToolResult(await handler(args ?? {}, extra), name, options);
      const status = result?.isError ? "error" : "ok";
      logToolCall(name, status, started);
      notifyRuntimeToolCall(server, name, status, started, requestedRouteId ?? resultRouteId(result));
      return result;
    } catch (error) {
      const result = tagToolResult(errorResult(error), name, options);
      logToolCall(name, "error", started);
      notifyRuntimeToolCall(server, name, "error", started, requestedRouteId);
      return result;
    }
  };

  const securitySchemes = [{ type: "noauth" }];
  const fullOptions: Record<string, unknown> = {
    securitySchemes,
    ...options,
    _meta: {
      securitySchemes,
      ...(options._meta as Record<string, unknown> | undefined)
    }
  };

  const s = server as any;
  if (typeof s.registerTool === "function") {
    s.registerTool(name, fullOptions, wrapped);
    return;
  }

  if (typeof s.tool === "function") {
    s.tool(name, (fullOptions.description as string | undefined) ?? name, fullOptions.inputSchema ?? {}, wrapped);
    return;
  }

  throw new Error("Unsupported MCP SDK: McpServer has neither registerTool nor tool.");
}

const MINIMAL_TOOL_NAMES = [
  SUPERTOOL_NAME,
  "server_config",
  "codexflow_self_test",
  "list_projects",
  "select_project",
  "load_skill",
  "open_current_workspace",
  "open_workspace",
  "read",
  "write",
  "edit",
  "apply_patch",
  "bash",
  "show_changes"
] as const;

const STANDARD_TOOL_NAMES = [
  ...MINIMAL_TOOL_NAMES,
  "inspect_workspace",
  "tree",
  "search",
  "terminal",
  "git_workflow",
  "local_environment",
  "worktree",
  "prepare_scheduled_task",
  "read_handoff",
  "wait_for_handoff",
  "export_pro_context",
  "handoff_to_agent"
] as const;

const FULL_TOOL_NAMES = [
  SUPERTOOL_NAME,
  "server_config",
  "codexflow_self_test",
  "codexflow_inventory",
  "list_projects",
  "select_project",
  "load_skill",
  "list_workspaces",
  "open_current_workspace",
  "open_workspace",
  "workspace_snapshot",
  "inspect_workspace",
  "tree",
  "search",
  "read",
  "write",
  "edit",
  "apply_patch",
  "bash",
  "terminal",
  "git_status",
  "git_diff",
  "git_workflow",
  "local_environment",
  "worktree",
  "prepare_scheduled_task",
  "show_changes",
  "read_handoff",
  "wait_for_handoff",
  "codex_context",
  "export_pro_context",
  "handoff_to_agent",
  "handoff_to_codex"
] as const;

const CONNECTION_TEST_HIDDEN_TOOLS = new Set<string>([
  SUPERTOOL_NAME,
  "codexflow_self_test",
  "write",
  "edit",
  "apply_patch",
  "bash",
  "terminal",
  "git_workflow",
  "local_environment",
  "worktree",
  "prepare_scheduled_task",
  "export_pro_context",
  "handoff_to_agent",
  "handoff_to_codex"
]);

function codexSessionToolNames(config: CodexFlowConfig): string[] {
  if (config.codexSessions === "off") return [];
  return config.codexSessions === "read"
    ? ["codex_sessions", "read_codex_session"]
    : ["codex_sessions"];
}

function toolNamesForMode(config: CodexFlowConfig): string[] {
  const names: string[] =
    config.toolMode === "full"
      ? [...FULL_TOOL_NAMES]
      : config.toolMode === "minimal"
        ? [...MINIMAL_TOOL_NAMES]
        : [...STANDARD_TOOL_NAMES];
  if (config.bashMode === "off") {
    for (const commandTool of ["bash", "terminal", "local_environment"]) {
      const commandIndex = names.indexOf(commandTool);
      if (commandIndex !== -1) names.splice(commandIndex, 1);
    }
  }
  if (config.writeMode !== "workspace") {
    for (const writeTool of ["write", "edit", "apply_patch", "git_workflow", "local_environment", "worktree"]) {
      const toolIndex = names.indexOf(writeTool);
      if (toolIndex !== -1) names.splice(toolIndex, 1);
    }
  }
  if (config.writeMode === "handoff" && !names.includes("handoff_to_agent")) names.push("handoff_to_agent");
  if (!config.analysisEnabled) {
    const analysisIndex = names.indexOf("inspect_workspace");
    if (analysisIndex !== -1) names.splice(analysisIndex, 1);
  }
  if (config.connectionTest) {
    for (const hiddenTool of CONNECTION_TEST_HIDDEN_TOOLS) {
      const toolIndex = names.indexOf(hiddenTool);
      if (toolIndex !== -1) names.splice(toolIndex, 1);
    }
  }
  for (const name of codexSessionToolNames(config)) {
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

const MINIMAL_TOOLS = new Set<string>(MINIMAL_TOOL_NAMES);
const STANDARD_TOOLS = new Set<string>(STANDARD_TOOL_NAMES);
const registeredToolNamesByServer = new WeakMap<object, string[]>();

function rememberRegisteredTool(server: McpServer, name: string): void {
  const key = server as object;
  const names = registeredToolNamesByServer.get(key) ?? [];
  if (!registeredToolNamesByServer.has(key)) registeredToolNamesByServer.set(key, names);
  if (!names.includes(name)) names.push(name);
}

function registeredToolNames(server: McpServer): string[] {
  return [...(registeredToolNamesByServer.get(server as object) ?? [])];
}

function shouldRegisterTool(config: CodexFlowConfig, name: string): boolean {
  if (config.connectionTest && CONNECTION_TEST_HIDDEN_TOOLS.has(name)) return false;
  if (name === "bash" && config.bashMode === "off") return false;
  if (name === "terminal" && config.bashMode === "off") return false;
  if (name === "local_environment" && config.bashMode === "off") return false;
  if ((name === "write" || name === "edit" || name === "apply_patch") && config.writeMode !== "workspace") return false;
  if ((name === "git_workflow" || name === "local_environment" || name === "worktree") && config.writeMode !== "workspace") return false;
  if (name === "codex_sessions") return config.codexSessions !== "off";
  if (name === "read_codex_session") return config.codexSessions === "read";
  if (name === "inspect_workspace" && !config.analysisEnabled) return false;
  if (name === "handoff_to_agent" && config.writeMode === "handoff") return true;
  if (config.toolMode === "full") return true;
  if (config.toolMode === "minimal") return MINIMAL_TOOLS.has(name);
  return STANDARD_TOOLS.has(name);
}

function registerCodexTool(
  config: CodexFlowConfig,
  server: McpServer,
  name: string,
  options: Record<string, unknown>,
  handler: CodexToolHandler
): void {
  if (!shouldRegisterTool(config, name)) return;
  const routedOptions = withRouteInput(name, options);
  const validatedHandler: CodexToolHandler = (args, extra) => {
    const validated = validateToolArgs(name, routedOptions, args);
    const routeId = requestRouteId(validated, extra);
    return routeInvocationStorage.run({ routeId }, () => handler(validated, extra));
  };
  registerToolCompat(server, name, descriptorOptionsForConfig(config, routedOptions), validatedHandler);
  rememberRegisteredTool(server, name);
  rememberRegisteredToolHandler(server, name, validatedHandler);
}

function serverInstructions(config: CodexFlowConfig): string {
  const editInstruction =
    config.connectionTest
      ? "5. Connection test mode is read-only. Write, patch, export, and handoff-writing tools are unavailable."
      : config.writeMode === "workspace"
      ? "5. Edit source files with write/edit/apply_patch. After edits, call show_changes once for git status, diff stats, and review diff. Use git_workflow for deliberate stage, commit, branch, push, or pull-request actions."
      : config.writeMode === "handoff"
        ? "5. Source writes are disabled and generic write/edit/apply_patch tools are unavailable. Use handoff_to_agent/handoff_to_codex for plans."
        : "5. Write/edit/apply_patch tools are disabled. Do not attempt direct file writes; use handoff or context export workflows instead.";
  const bashInstruction =
    config.bashMode === "off"
      ? "6. Bash is disabled and the bash tool is unavailable. Do not attempt shell commands."
      : "6. Use bash for isolated verification commands. Use terminal when a chat needs persistent shell state, a background process, or interactive input.";

  return [
    "CodexFlow gives this ChatGPT conversation Codex-style access to one selected local project while sharing a single local broker with other conversations. It never invokes the Codex CLI.",
    "",
    "Preferred workflow:",
    "1. At the start of a new coding conversation, call list_projects so the user can choose a project. It returns a private route_id. If the user already named an exact project, call select_project directly with that name; preserve the returned route_id.",
    "1a. The visual project picker is optional enhancement, never a prerequisite. After list_projects, tell the user they may pick in the card or reply with an exact project name. If the card is missing or reports an error, show a short set of project names from the tool result and ask for the name. Never strand the conversation by referring only to a picker that did not render.",
    "2. The selected project is bound to route_id, not to one MCP transport. ChatGPT can open a new transport for every tool call, so pass route_id on every later project-scoped call. Also reuse workspace_id when convenient. Never fall back to the configured default after the picker supplied route context.",
    "2a. The picker updates model-visible context with route_id, workspace_id, project name, and root. Treat those exact values as authoritative. Use select_project again only when the user explicitly switches projects.",
    "3. Follow AGENTS.md and load relevant advertised skills returned by select_project before editing files.",
    "4. Inspect with tree, search, and read. Do not use bash for git status, git diff, cat, sed, grep, rg, find, ls, or file reading.",
    editInstruction,
    bashInstruction,
    config.writeMode === "workspace"
      ? "6a. Use local_environment to discover the project's shared .codex/environments configuration and run named actions. Use worktree to isolate parallel tasks; a selected local environment automatically sets up a new worktree. Creating or handing off a worktree moves this private chat route to that checkout while preserving project scope."
      : "",
    "6b. When the user asks to schedule recurring or background project work, call prepare_scheduled_task. ChatGPT Scheduled owns the cadence, model turn, and run history; CodexFlow supplies the durable local project route and tools. Never create a local cron job or claim CodexFlow itself runs the model.",
    "7. Keep tool calls minimal. Prefer one targeted search plus show_changes instead of repeated broad inspection calls.",
    config.codexSessions !== "off"
      ? `8. Codex session history access is enabled in ${config.codexSessions} mode. Use it only when the user asks for local Codex session history.`
      : "",
    config.requireBashSession && config.bashSessionId
      ? `9. Bash session guard is enabled. Every bash call must include session_id="${config.bashSessionId}".`
      : config.bashSessionId
        ? `9. Bash session label for this server is "${config.bashSessionId}".`
        : "",
    "",
    `Current modes: tool=${config.toolMode}, bash=${config.bashMode}, write=${config.writeMode}.`
  ].filter(Boolean).join("\n");
}

function limitInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return fallback;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
}

function diffBlock(diff: string): string {
  return `\n\n\`\`\`diff\n${diff}\n\`\`\``;
}

function diffStats(diff: string): { additions: number; deletions: number; changed: boolean } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions, changed: Boolean(diff.trim()) };
}

const reviewCheckpoints = new Map<string, string>();

function reviewCheckpointKey(workspace: Workspace, options: { path?: string; staged: boolean }): string {
  return `${workspace.id}\0${options.path ?? ""}\0${options.staged ? "staged" : "unstaged"}`;
}

function reviewFingerprint(status: string, diff: string): string {
  return createHash("sha256").update(status).update("\0").update(diff).digest("hex");
}

async function untrackedReviewFingerprint(config: CodexFlowConfig, guard: PathGuard, workspace: Workspace, changedFiles: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const line of changedFiles) {
    const match = line.match(/^\?\?\s+(.+)$/);
    if (!match) continue;
    const relPath = match[1];
    hash.update(relPath).update("\0");
    try {
      const resolved = guard.resolve(workspace, relPath);
      const stat = await fsp.stat(resolved.absPath);
      hash.update(String(stat.size)).update("\0").update(String(Math.floor(stat.mtimeMs))).update("\0");
      if (stat.isFile() && stat.size <= config.maxReadBytes) {
        hash.update(await fsp.readFile(resolved.absPath));
      }
    } catch (error) {
      hash.update(errorText(error));
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function normalizeGitOutput(output: string): string {
  return output.trim() === "(no output)" ? "" : output;
}

function decodeGitQuotedPath(pathText: string): string {
  const input = pathText.startsWith('"') && pathText.endsWith('"') ? pathText.slice(1, -1) : pathText;
  let decoded = "";
  let escapedBytes: number[] = [];
  const flushEscapedBytes = () => {
    if (!escapedBytes.length) return;
    decoded += Buffer.from(escapedBytes).toString("utf8");
    escapedBytes = [];
  };
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char !== "\\") {
      flushEscapedBytes();
      decoded += char;
      continue;
    }
    i += 1;
    const escaped = input[i];
    if (escaped === undefined) throw new CodexFlowError(`Invalid quoted Git path: ${pathText}`);
    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      for (let j = 0; j < 2 && i + 1 < input.length && /[0-7]/.test(input[i + 1]); j += 1) {
        i += 1;
        octal += input[i];
      }
      escapedBytes.push(Number.parseInt(octal, 8));
    } else {
      flushEscapedBytes();
      decoded += ({ a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" } as Record<string, string>)[escaped] ?? escaped;
    }
  }
  flushEscapedBytes();
  return decoded;
}

function stripPatchPathComponents(filePath: string, stripComponents: number): string {
  if (path.isAbsolute(filePath) || path.win32.isAbsolute(filePath)) return filePath;
  let stripped = filePath;
  for (let i = 0; i < stripComponents; i += 1) {
    const slash = stripped.indexOf("/");
    if (slash < 0) return stripped;
    stripped = stripped.slice(slash + 1);
  }
  return stripped;
}

function normalizePatchPath(rawPath: string, stripComponents = 1): string | undefined {
  const raw = rawPath.trim().split("\t")[0]?.trim();
  if (!raw || raw === "/dev/null") return undefined;
  const unquoted = raw.startsWith('"') && raw.endsWith('"') ? decodeGitQuotedPath(raw.slice(1, -1)) : raw;
  return stripPatchPathComponents(unquoted, stripComponents);
}

function patchHasSymlinkMode(patch: string): boolean {
  return patch.split(/\r?\n/).some((line) => /^(?:new|old|deleted) file mode 120000\s*$/.test(line) || /^new mode 120000\s*$/.test(line) || /^old mode 120000\s*$/.test(line));
}

function patchTouchedPaths(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const normalized = normalizePatchPath(line.slice(4));
      if (normalized) paths.add(normalized);
    } else if (line.startsWith("rename from ") || line.startsWith("rename to ") || line.startsWith("copy from ") || line.startsWith("copy to ")) {
      const normalized = normalizePatchPath(line.replace(/^(?:rename|copy) (?:from|to) /, ""), 0);
      if (normalized) paths.add(normalized);
    }
  }
  return [...paths];
}

function applyWorkspacePatch(
  config: CodexFlowConfig,
  guard: PathGuard,
  workspace: Workspace,
  patch: string
): { paths: string[]; stdout: string; stderr: string; diff: string; additions: number; deletions: number; changed: boolean } {
  if (!patch.trim()) throw new CodexFlowError("patch is required.");
  if (Buffer.byteLength(patch, "utf8") > config.maxWriteBytes) {
    throw new CodexFlowError(`Patch is too large. Limit: ${config.maxWriteBytes} bytes.`);
  }
  if (hasSecretValue(patch)) {
    throw new CodexFlowError("Secret-looking content is blocked from apply_patch. Use placeholders such as [REDACTED_SECRET].");
  }
  if (patchHasSymlinkMode(patch)) {
    throw new CodexFlowError("Symlink patches are blocked from apply_patch.");
  }

  const paths = patchTouchedPaths(patch);
  if (!paths.length) throw new CodexFlowError("Patch must include at least one file path.");
  for (const touchedPath of paths) {
    guard.resolve(workspace, touchedPath, { forWrite: true });
    assertWriteToolAllowed(config, touchedPath);
  }

  const check = spawnSync("git", ["apply", "--check", "--whitespace=nowarn"], {
    cwd: workspace.root,
    input: patch,
    encoding: "utf8",
    maxBuffer: config.maxOutputBytes,
    env: { ...process.env, NO_COLOR: "1" }
  });
  if (check.error || check.status !== 0) {
    throw new CodexFlowError(redactSensitiveText(check.stderr?.trim() || check.stdout?.trim() || check.error?.message || "git apply --check failed"));
  }

  const applied = spawnSync("git", ["apply", "--whitespace=nowarn"], {
    cwd: workspace.root,
    input: patch,
    encoding: "utf8",
    maxBuffer: config.maxOutputBytes,
    env: { ...process.env, NO_COLOR: "1" }
  });
  if (applied.error || applied.status !== 0) {
    throw new CodexFlowError(redactSensitiveText(applied.stderr?.trim() || applied.stdout?.trim() || applied.error?.message || "git apply failed"));
  }

  const diff = redactSensitiveText(patch.trimEnd());
  const stats = diffStats(diff);
  return {
    paths,
    stdout: redactSensitiveText(applied.stdout?.trim() || ""),
    stderr: redactSensitiveText(applied.stderr?.trim() || ""),
    diff,
    additions: stats.additions,
    deletions: stats.deletions,
    changed: true
  };
}

function looksLikeGitError(output: string): boolean {
  const trimmed = output.trim();
  const lower = trimmed.toLowerCase();
  return (
    trimmed.startsWith("fatal:") ||
    trimmed.startsWith("error:") ||
    trimmed.startsWith("git unavailable or failed:") ||
    trimmed.startsWith("git exited with status") ||
    trimmed.startsWith("usage: git ") ||
    lower.includes("not a git repository")
  );
}

function previewText(value: string, maxLines = 40, maxChars = 12_000): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n").slice(0, maxLines).join("\n");
  return lines.length > maxChars ? `${lines.slice(0, maxChars)}\n...[preview truncated]` : lines;
}

function changedStatusLines(status: string): string[] {
  return status
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "(no output)" && !line.startsWith("##"));
}

function changedPathsFromStatus(lines: string[]): string[] {
  const paths: string[] = [];
  for (const line of lines) {
    let raw: string;
    if (line.startsWith("?? ")) raw = line.slice(3).trim();
    else if (line.includes("\t")) raw = line.split("\t").pop()?.trim() ?? "";
    else if (/^.{2}\s/.test(line)) raw = line.slice(3).trim();
    else continue;
    if (raw.includes(" -> ")) raw = raw.split(" -> ").pop() ?? raw;
    const decoded = decodeGitQuotedPath(raw);
    if (decoded && !paths.includes(decoded)) paths.push(decoded);
  }
  return paths;
}

function jsonlEvent(event: string, data: Record<string, unknown>): string {
  return JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + "\n";
}

function cleanOneLine(value: unknown, fallback: string, maxLength = 120): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

function normalizeAgentId(value: unknown): string {
  const agent = cleanOneLine(value, "custom", 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(agent)) {
    throw new CodexFlowError("agent must use only lowercase letters, numbers, dots, underscores, or hyphens.");
  }
  return agent;
}

function displayAgentName(agent: string, agentName?: unknown): string {
  const explicit = cleanOneLine(agentName, "", 80);
  if (explicit) return explicit;
  if (agent === "codex") return "Codex";
  if (agent === "opencode") return "OpenCode";
  if (agent === "pi") return "Pi";
  return agent;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function agentCommandHint(agent: string, planPath: string, model?: string): string {
  const modelArg = model ? ` --model ${shellQuote(model)}` : " --model '<provider/model>'";
  const quotedPlanPath = shellQuote(planPath);
  if (agent === "opencode") return `opencode run${modelArg} "$(cat ${quotedPlanPath})"`;
  if (agent === "pi") return `pi run${modelArg} "$(cat ${quotedPlanPath})"`;
  if (agent === "codex") return `Read ${planPath} and execute it in small, reviewable steps.`;
  return `Run your local implementation agent manually with ${planPath} as the task input.`;
}

async function readRawTextFileBounded(config: CodexFlowConfig, guard: PathGuard, workspace: Workspace, filePath: string): Promise<string> {
  const resolved = guard.resolve(workspace, filePath);
  await guard.assertTextFile(resolved.absPath, config.maxReadBytes);
  return fsp.readFile(resolved.absPath, "utf8");
}

function buildAgentPlanBody(options: {
  title: string;
  plan: string;
  workspace: Workspace;
  agent: string;
  agentName: string;
  model?: string;
  statusPath: string;
  diffPath: string;
  executionLogPath: string;
}): string {
  const modelLine = options.model ? `Model: ${options.model}\n` : "";
  return `# ${options.title}

Updated: ${new Date().toISOString()}
Workspace: ${options.workspace.root}
Target agent: ${options.agentName} (${options.agent})
${modelLine}
## Plan

${options.plan.trim()}

## Implementation contract

- Work from this plan in small, reviewable steps.
- Keep edits scoped to the requested task and existing project conventions.
- Run focused verification before handing work back.
- Update ${options.statusPath} with files touched, checks run, results, blockers, and review notes.
- Save the final review diff to ${options.diffPath} when practical.
- Append notable execution events to ${options.executionLogPath} when the implementation agent supports logging.
`;
}

async function writeAgentHandoff(
  config: CodexFlowConfig,
  guard: PathGuard,
  workspace: Workspace,
  options: {
    agent: string;
    agentName?: string;
    model?: string;
    title: string;
    plan: string;
    append: boolean;
    eventName: string;
  }
): Promise<{
  agent: string;
  agentName: string;
  model?: string;
  title: string;
  planPath: string;
  statusPath: string;
  diffPath: string;
  logPath: string;
  executionLogPath: string;
  prompt: string;
  writeResult: Awaited<ReturnType<typeof writeTextFile>>;
}> {
  await ensureAiBridge(config, guard, workspace);
  const agent = normalizeAgentId(options.agent);
  const agentName = displayAgentName(agent, options.agentName);
  const model = options.model ? cleanOneLine(options.model, "", 120) : undefined;
  const plan = String(options.plan ?? "").trim();
  if (!plan) throw new CodexFlowError("plan must not be empty.");
  const planPath = `${config.contextDir}/current-plan.md`;
  const statusPath = `${config.contextDir}/agent-status.md`;
  const legacyCodexStatusPath = `${config.contextDir}/codex-status.md`;
  const diffPath = `${config.contextDir}/implementation-diff.patch`;
  const logPath = `${config.contextDir}/session-log.jsonl`;
  const executionLogPath = `${config.contextDir}/execution-log.jsonl`;
  const body = buildAgentPlanBody({
    title: options.title,
    plan,
    workspace,
    agent,
    agentName,
    model,
    statusPath,
    diffPath,
    executionLogPath
  });

  let content = body;
  if (options.append) {
    const raw = await readRawTextFileBounded(config, guard, workspace, planPath);
    content = `${raw.trimEnd()}\n\n---\n\n${body}`;
  }

  const writeResult = await writeTextFile(config, guard, workspace, planPath, content, { createDirs: true, overwrite: true });
  const event = {
    agent,
    agent_name: agentName,
    model,
    title: options.title,
    plan_path: planPath,
    status_path: statusPath,
    diff_path: diffPath
  };
  const logResolved = guard.resolve(workspace, logPath, { forWrite: true });
  const executionLogResolved = guard.resolve(workspace, executionLogPath, { forWrite: true });
  await fsp.appendFile(logResolved.absPath, jsonlEvent(options.eventName, event), "utf8");
  await fsp.appendFile(executionLogResolved.absPath, jsonlEvent(options.eventName, event), "utf8");

  const promptLines = [
    `Read ${planPath} and execute it in small, reviewable steps.`,
    `After each meaningful change, update ${statusPath} with files touched, checks run, results, blockers, and the next review focus.`,
    `Before review, write the final diff to ${diffPath} when practical.`,
    agentCommandHint(agent, planPath, model)
  ];
  if (agent === "codex") {
    promptLines.splice(2, 0, `For legacy Codex handoffs, mirror key status notes to ${legacyCodexStatusPath} if your workflow expects that file.`);
  }
  const prompt = promptLines.join("\n");

  return {
    agent,
    agentName,
    model,
    title: options.title,
    planPath,
    statusPath,
    diffPath,
    logPath,
    executionLogPath,
    prompt,
    writeResult
  };
}

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false, destructiveHint: false };
const SESSION_READ_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: false };
const LOCAL_WRITE_ANNOTATIONS = { readOnlyHint: false, openWorldHint: false, destructiveHint: true, idempotentHint: false };
const BASH_ANNOTATIONS = { readOnlyHint: false, openWorldHint: true, destructiveHint: true, idempotentHint: false };
const HANDOFF_WRITE_ANNOTATIONS = { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: false };

const workspaceManagers = new Map<string, WorkspaceManager>();
const chatRouteStores = new Map<string, ChatRouteStore>();

function workspaceManagerKey(config: CodexFlowConfig): string {
  return JSON.stringify({
    defaultRoot: config.defaultRoot,
    allowedRoots: [...config.allowedRoots].sort(),
    contextDir: config.contextDir
  });
}

function getSharedWorkspaceManager(config: CodexFlowConfig): WorkspaceManager {
  const key = workspaceManagerKey(config);
  const existing = workspaceManagers.get(key);
  if (existing) return existing;
  const manager = new WorkspaceManager(config);
  workspaceManagers.set(key, manager);
  return manager;
}

function getSharedChatRouteStore(config: CodexFlowConfig): ChatRouteStore {
  const key = `${workspaceManagerKey(config)}\n${codexFlowHome()}`;
  const existing = chatRouteStores.get(key);
  if (existing) return existing;
  const store = new ChatRouteStore(config.defaultRoot);
  chatRouteStores.set(key, store);
  return store;
}

export function createCodexFlowServer(config: CodexFlowConfig, observer: CodexFlowRuntimeObserver = {}): McpServer {
  const workspaceManager = getSharedWorkspaceManager(config);
  const routeStore = getSharedChatRouteStore(config);
  let activeWorkspaceId: string | undefined;
  const markWorkspaceActive = (workspace: Workspace): Workspace => {
    const changed = activeWorkspaceId !== workspace.id;
    activeWorkspaceId = workspace.id;
    if (changed) {
      try {
        observer.onWorkspaceChanged?.(workspace);
      } catch {
        // Operational telemetry must never interrupt project routing.
      }
    }
    return workspace;
  };
  const bindWorkspace = (workspace: Workspace, routeId = invocationRouteId()): Workspace => {
    if (routeId) routeStore.bind(routeId, workspace);
    return markWorkspaceActive(workspace);
  };
  const workspaceForRoute = (routeId: string): Workspace => {
    const route = routeStore.get(routeId);
    if (!route) {
      throw new CodexFlowError("This private chat route is not bound to a project. Call select_project with this route_id before using project tools.");
    }
    if (route.location === "remote") {
      throw new CodexFlowError("This route uses a remote project. This particular tool is not remote-capable yet; use inspect_workspace, tree, search, read, write, edit, apply_patch, bash, terminal, git_status, git_diff, git_log, local_environment, or load_skill.");
    }
    let workspace: Workspace;
    try {
      workspace = workspaceManager.openWorkspace(route.root);
    } catch {
      throw new CodexFlowError("The project bound to this private chat route is no longer available or allowed. Call list_projects and select_project again.");
    }
    if (workspace.id !== route.workspaceId) {
      throw new CodexFlowError("The project identity for this private chat route changed. Call list_projects and select_project again.");
    }
    return markWorkspaceActive(workspace);
  };
  const workspaces = {
    defaultWorkspace(): Workspace {
      const routeId = invocationRouteId();
      if (routeId) return workspaceForRoute(routeId);
      return bindWorkspace(workspaceManager.defaultWorkspace());
    },
    openWorkspace(root?: string): Workspace {
      return bindWorkspace(workspaceManager.openWorkspace(root));
    },
    getWorkspace(id?: string): Workspace {
      const routeId = invocationRouteId();
      if (routeId) {
        const route = routeStore.get(routeId);
        if (!route) {
          throw new CodexFlowError("This private chat route is not bound to a project. Call select_project with this route_id before using project tools.");
        }
        if (id && id !== route.workspaceId) {
          throw new CodexFlowError("workspace_id does not belong to this private chat route. Use the workspace_id from the picker context or call select_project to switch this route.");
        }
        return workspaceForRoute(routeId);
      }
      if (id && activeWorkspaceId && id !== activeWorkspaceId) {
        throw new CodexFlowError("This ChatGPT conversation is bound to a different project. Call select_project or open_workspace explicitly to switch it first.");
      }
      const workspace = workspaceManager.getWorkspace(id ?? activeWorkspaceId);
      return bindWorkspace(workspace);
    },
    listWorkspaces(): Workspace[] {
      return workspaceManager.listWorkspaces();
    },
    activeWorkspace(): Workspace | undefined {
      const routeId = invocationRouteId();
      if (routeId) {
        const route = routeStore.get(routeId);
        if (!route) return undefined;
        if (route.location === "remote") return { id: route.workspaceId, root: route.root, openedAt: route.updatedAt };
        return workspaceForRoute(routeId);
      }
      return activeWorkspaceId ? workspaceManager.getWorkspace(activeWorkspaceId) : undefined;
    }
  };
  const remoteTargetForRoute = (routeId: string): SelectedProjectTarget => {
    const route = routeStore.get(routeId);
    if (!route) throw new CodexFlowError("This private chat route is not bound to a project. Call select_project first.");
    if (route.location !== "remote") return { kind: "local", workspace: workspaceForRoute(routeId) };
    let project: SavedRemoteProject;
    try {
      project = getApprovedRemoteProject(route.workspaceId);
    } catch (error) {
      throw new CodexFlowError(error instanceof Error ? error.message : String(error));
    }
    if (
      project.root !== route.root ||
      project.hostAlias !== route.remoteHostAlias ||
      project.hostFingerprint !== route.remoteHostFingerprint
    ) {
      throw new CodexFlowError("The remote project identity changed. Verify the host and select the saved project again.");
    }
    return {
      kind: "remote",
      project,
      workspace: { id: project.id, root: project.root, openedAt: project.updatedAt }
    };
  };
  const projectTarget = (workspaceId?: string): SelectedProjectTarget => {
    const routeId = invocationRouteId();
    if (routeId) {
      const target = remoteTargetForRoute(routeId);
      if (workspaceId && workspaceId !== target.workspace.id) {
        throw new CodexFlowError("workspace_id does not belong to this private chat route. Use the workspace_id returned by select_project.");
      }
      return target;
    }
    return { kind: "local", workspace: workspaces.getWorkspace(workspaceId) };
  };
  const guard = new PathGuard(config);
  const server = new McpServer({ name: "CodexFlow", version: CODEXFLOW_VERSION }, { instructions: serverInstructions(config) });
  serverRuntimeContexts.set(server as object, {
    observer,
    activeWorkspace: () => workspaces.activeWorkspace()
  });
  registeredToolNamesByServer.set(server as object, []);
  registerToolCardResource(server, config);

  registerCodexTool(
    config,
    server,
    SUPERTOOL_NAME,
    {
      title: "CodexFlow Supertool",
      description:
        "Stable wrapper for advanced ChatGPT connector setups. Pass action plus args to call an already-registered CodexFlow tool without changing the visible schema; it cannot call tools disabled by the current mode.",
      inputSchema: {
        action: z.string().optional().describe("Action or registered tool name. Use list_actions to see what this server mode allows."),
        args: z.record(z.any()).optional().describe("Arguments for the selected action. Same shape as the wrapped CodexFlow tool.")
      },
      annotations: BASH_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Running CodexFlow supertool action...",
        "openai/toolInvocation/invoked": "CodexFlow supertool action complete"
      }
    },
    async (args) => {
      const action = normalizeSupertoolAction(args.action);
      const names = registeredToolNames(server).filter((name) => name !== SUPERTOOL_NAME);
      if (action === "list_actions" || action === "help") {
        const text = [
          "# CodexFlow Supertool",
          "",
          "Use `codexflow` only when a stable wrapper is useful for ChatGPT connector caching or custom workflows. The explicit tools remain the preferred default because they give clearer descriptions and validation.",
          "",
          "## Available actions",
          "",
          names.length ? names.map((name) => `- ${name}`).join("\n") : "- none",
          "",
          "## Usage",
          "",
          "```json",
          JSON.stringify({ action: "search", args: { workspace_id: "ws_...", query: "needle", path: "src" } }, null, 2),
          "```"
        ].join("\n");
        return textResult(text, {
          actions: names,
          action_count: names.length,
          aliases: SUPERTOOL_ACTION_ALIASES,
          tool_mode: config.toolMode,
          bash_mode: config.bashMode,
          write_mode: config.writeMode
        });
      }

      if (action === SUPERTOOL_NAME) {
        throw new CodexFlowError("codexflow cannot call itself. Use action=list_actions to inspect available wrapped actions.");
      }

      const handler = registeredToolHandler(server, action);
      if (!handler) {
        throw new CodexFlowError(
          `CodexFlow action is not available in the current mode: ${action}. ` +
            "Call codexflow with action=list_actions, or restart CodexFlow with a broader tool mode if that action should be exposed."
        );
      }

      const childArgs =
        args.args && typeof args.args === "object" && !Array.isArray(args.args)
          ? args.args
          : {};
      let result: any;
      try {
        result = await handler(childArgs);
      } catch (error) {
        result = errorResult(error);
      }
      if (result && typeof result === "object") {
        const structured = result.structuredContent;
        result.structuredContent = {
          codexflow_tool: action,
          codexflow_title: action,
          codexflow_super_action: action,
          wrapped_tool: action,
          ...(structured && typeof structured === "object" && !Array.isArray(structured) ? structured : {})
        };
      }
      return result;
    }
  );

  registerCodexTool(
    config,
    server,
    "server_config",
    {
      title: "Server Config",
      description: "Show CodexFlow server configuration, safety modes, limits, and blocked paths. Does not reveal auth tokens.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Reading CodexFlow server config...",
        "openai/toolInvocation/invoked": "CodexFlow server config ready"
      }
    },
    async () => {
      const safeConfig = {
        defaultRoot: config.defaultRoot,
        allowedRoots: config.allowedRoots,
        host: config.host,
        port: config.port,
        widgetDomain: config.widgetDomain,
        authEnabled: Boolean(config.authToken),
        bashMode: config.bashMode,
        bashTranscript: config.bashTranscript,
        bashSessionId: config.bashSessionId ?? null,
        requireBashSession: config.requireBashSession,
        codexSessions: config.codexSessions,
        codexDir: config.codexDir,
        writeMode: config.writeMode,
        toolMode: config.toolMode,
        toolCards: config.toolCards,
        connectionTest: config.connectionTest,
        analysisEnabled: config.analysisEnabled,
        analysisLimits: config.analysisLimits,
        inheritEnv: config.inheritEnv,
        contextDir: config.contextDir,
        maxReadBytes: config.maxReadBytes,
        maxWriteBytes: config.maxWriteBytes,
        maxOutputBytes: config.maxOutputBytes,
        maxSearchResults: config.maxSearchResults,
        blockedGlobs: config.blockedGlobs,
        registeredTools: registeredToolNames(server),
        registeredToolCount: registeredToolNames(server).length
      };
      return textResult(`# CodexFlow Server Config\n\n${JSON.stringify(safeConfig, null, 2)}`, safeConfig);
    }
  );

  registerCodexTool(
    config,
    server,
    "codexflow_self_test",
    {
      title: "CodexFlow Self Test",
      description:
        "Run one controlled, local-only CodexFlow diagnostic. It checks modes, expected tools, workspace access, skills, git, safe bash policy, selected-only Pro context, and optional .ai-bridge write/edit probe without touching source files.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        write_probe: z.boolean().optional().describe("Create/edit only .ai-bridge/codexflow-self-test.md. Default: true."),
        bash_probe: z.boolean().optional().describe("Check bash policy with safe local commands only. Default: true."),
        pro_context_probe: z.boolean().optional().describe("Build a selected-only Pro context bundle in memory without writing pro-context.md. Default: true."),
        include_global_skills: z.boolean().optional().describe("Include user/plugin skill discovery in the inventory check. Default: true."),
        max_skills: z.number().int().min(1).max(120).optional().describe("Maximum skills to inspect during the inventory check. Default: 40.")
      },
      annotations: HANDOFF_WRITE_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Running CodexFlow self-test...",
        "openai/toolInvocation/invoked": "CodexFlow self-test complete"
      }
    },
    async (args) => {
      const workspace = workspaces.getWorkspace(args.workspace_id);
      const started = Date.now();
      const checks: Array<{ name: string; status: "pass" | "warn" | "fail"; detail: string }> = [];
      const filesTouched: string[] = [];
      const probePath = `${config.contextDir}/codexflow-self-test.md`;

      const check = (name: string, status: "pass" | "warn" | "fail", detail: string) => {
        checks.push({ name, status, detail: cleanOneLine(detail, detail, 260) });
      };

      check("workspace", "pass", workspace.root);
      check("tool mode", config.toolMode === "full" ? "pass" : "warn", `${config.toolMode}; expected tools: ${toolNamesForMode(config).length}`);
      check("write mode", config.writeMode === "off" ? "warn" : "pass", config.writeMode);
      check("bash mode", config.bashMode === "full" ? "warn" : "pass", config.bashMode);
      check(
        "http auth",
        "pass",
        config.authToken
          ? "token configured"
          : config.requireHttpToken
            ? "token required when serving HTTP"
            : "token auth explicitly disabled"
      );
      const expectedTools = toolNamesForMode(config).sort();
      const actualTools = registeredToolNames(server).sort();
      const missingTools = expectedTools.filter((name) => !actualTools.includes(name));
      const extraTools = actualTools.filter((name) => !expectedTools.includes(name));
      check(
        "registered tool set",
        missingTools.length || extraTools.length ? "fail" : "pass",
        missingTools.length || extraTools.length
          ? `missing: ${missingTools.join(", ") || "none"}; extra: ${extraTools.join(", ") || "none"}`
          : `${actualTools.length} tools registered for ${config.toolMode} mode`
      );

      try {
        const inventory = await codexflowInventory(config, workspace, {
          includeGlobalSkills: parseBool(args.include_global_skills, true),
          includeMcpServers: true,
          maxSkills: limitInt(args.max_skills, 40, 1, 120)
        });
        check("inventory", "pass", `${inventory.skills.length} skills inspected, ${inventory.mcpServers.length} MCP server names visible`);
      } catch (error) {
        check("inventory", "fail", errorText(error));
      }

      try {
        const status = gitStatus(config, workspace);
        const gitFailed = looksLikeGitError(status);
        const changed = gitFailed ? 0 : changedStatusLines(status).length;
        check("git status", gitFailed ? "warn" : "pass", gitFailed ? status : `${changed} changed entries`);
      } catch (error) {
        check("git status", "fail", errorText(error));
      }

      if (parseBool(args.write_probe, true)) {
        if (config.writeMode === "off") {
          check("write/edit probe", "warn", "skipped because CODEXFLOW_WRITE_MODE=off");
        } else {
          try {
            assertWriteToolAllowed(config, probePath);
            const content = [
              "# CodexFlow Self Test",
              "",
              `Updated: ${new Date().toISOString()}`,
              `Workspace: ${workspace.root}`,
              "marker: before",
              ""
            ].join("\n");
            await writeTextFile(config, guard, workspace, probePath, content, { createDirs: true, overwrite: true });
            await editTextFile(config, guard, workspace, probePath, "marker: before", "marker: after", { expectedReplacements: 1 });
            const readBack = await readTextFile(config, guard, workspace, probePath, { maxBytes: 20_000 });
            if (!readBack.text.includes("marker: after")) throw new CodexFlowError("self-test edit marker was not found after edit.");
            const scopedStatus = gitStatus(config, workspace, guard, probePath);
            const scopedFiles = changedStatusLines(scopedStatus);
            filesTouched.push(probePath);
            check(
              "write/edit probe",
              scopedFiles.length && scopedFiles.every((line) => line.includes(probePath)) ? "pass" : "warn",
              scopedFiles.length ? `path-scoped status: ${scopedFiles.join(", ")}` : "path-scoped status clean after write/edit"
            );
          } catch (error) {
            check("write/edit probe", "fail", errorText(error));
          }
        }
      } else {
        check("write/edit probe", "warn", "skipped by request");
      }

      if (parseBool(args.pro_context_probe, true)) {
        try {
          if (!filesTouched.includes(probePath)) {
            check("selected-only pro context", "warn", "skipped because write probe did not create the selected file");
          } else {
            const context = await buildProContext(config, guard, workspace, {
              title: "CodexFlow Self Test Context",
              selectedPaths: [probePath],
              includeImportantFiles: false,
              includeChangedFiles: false,
              includeDiff: false,
              includeAiBridge: false,
              maxFiles: 4,
              maxTotalBytes: 80_000
            });
            const exactOnly = context.filesIncluded.length === 1 && context.filesIncluded[0] === probePath;
            check(
              "selected-only pro context",
              exactOnly ? "pass" : "fail",
              exactOnly ? `included only ${probePath}` : `included ${context.filesIncluded.join(", ") || "no files"}`
            );
          }
        } catch (error) {
          check("selected-only pro context", "fail", errorText(error));
        }
      } else {
        check("selected-only pro context", "warn", "skipped by request");
      }

      if (parseBool(args.bash_probe, true)) {
        try {
          if (config.bashMode === "off") {
            check("bash policy", "warn", "bash disabled");
          } else {
            const bashProbeOptions = { timeoutMs: 10_000, sessionId: config.bashSessionId };
            const pwd = await runBash(config, guard, workspace, "pwd", bashProbeOptions);
            if (config.bashMode === "safe") {
              try {
                await runBash(config, guard, workspace, "ls $HOME", bashProbeOptions);
                check("bash policy", "fail", "safe bash allowed environment expansion unexpectedly");
              } catch {
                check("bash policy", pwd.exitCode === 0 ? "pass" : "warn", "safe bash allowed pwd and blocked environment expansion");
              }
            } else {
              check("bash policy", pwd.exitCode === 0 ? "warn" : "fail", "full bash is enabled; use only for trusted local repos");
            }
          }
        } catch (error) {
          check("bash policy", "fail", errorText(error));
        }
      } else {
        check("bash policy", "warn", "skipped by request");
      }

      check(
        "terms boundary",
        "pass",
        "local workspace bridge only; does not provide models, proxy model access, bypass quotas, or execute remote/local agents from MCP"
      );

      const failed = checks.filter((item) => item.status === "fail").length;
      const warned = checks.filter((item) => item.status === "warn").length;
      const passed = checks.filter((item) => item.status === "pass").length;
      const status = failed ? "fail" : warned ? "warn" : "pass";
      const text = [
        "# CodexFlow Self Test",
        "",
        `Status: ${status}`,
        `Workspace: ${workspace.root}`,
        `Mode: tools=${config.toolMode}, write=${config.writeMode}, bash=${config.bashMode}${config.bashSessionId ? `, bash_session=${config.bashSessionId}${config.requireBashSession ? " required" : ""}` : ""}`,
        `Expected tools: ${expectedTools.length}`,
        `Registered tools: ${actualTools.length}`,
        `Duration: ${Date.now() - started} ms`,
        "",
        "## Checks",
        "",
        ...checks.map((item) => `- ${item.status.toUpperCase()} ${item.name}: ${item.detail}`),
        "",
        "## Terms Boundary",
        "",
        "CodexFlow exposes local repo tools to the ChatGPT session the user controls. It does not provide models, proxy model access, resell access, modify quotas, bypass limits, or run local implementation agents through remote MCP tools."
      ].join("\n");

      return textResult(text, {
        workspace_id: workspace.id,
        root: workspace.root,
        status,
        passed,
        warned,
        failed,
        duration_ms: Date.now() - started,
        expected_tools: expectedTools,
        expected_tool_count: expectedTools.length,
        registered_tools: actualTools,
        registered_tool_count: actualTools.length,
        bash_mode: config.bashMode,
        bash_session_id: config.bashSessionId ?? null,
        require_bash_session: config.requireBashSession,
        write_mode: config.writeMode,
        tool_mode: config.toolMode,
        files_touched: filesTouched,
        checks,
        terms_boundary: {
          local_workspace_bridge: true,
          provides_models: false,
          proxies_model_access: false,
          bypasses_quotas: false,
          remote_agent_execution: false
        }
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "codexflow_inventory",
    {
      title: "CodexFlow Inventory",
      description:
        "List CodexFlow modes plus discovered skills, locally available Codex plugin manifests, and configured MCP server names. Use this early when planning needs local agent capabilities.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        include_global_skills: z.boolean().optional().describe("Include user and plugin skill folders. Default: true."),
        include_mcp_servers: z.boolean().optional().describe("Include configured MCP server names from safe config files. Default: true."),
        max_skills: z.number().int().min(1).max(500).optional().describe("Maximum skills to list. Default: 120.")
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Reading CodexFlow inventory...",
        "openai/toolInvocation/invoked": "CodexFlow inventory ready"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const inventoryWorkspace = target.kind === "remote" ? workspaceManager.defaultWorkspace() : target.workspace;
      const inventory = await codexflowInventory(config, inventoryWorkspace, {
        includeGlobalSkills: parseBool(args.include_global_skills, true),
        includeMcpServers: parseBool(args.include_mcp_servers, true),
        maxSkills: limitInt(args.max_skills, 120, 1, 500)
      });
      const skills = target.kind === "remote"
        ? [
            ...await discoverRemoteSkillInventory(config, target.project, limitInt(args.max_skills, 120, 1, 500)),
            ...inventory.skills.filter((skill) => skill.source !== "workspace")
          ].slice(0, limitInt(args.max_skills, 120, 1, 500))
        : inventory.skills;
      const inventoryText = target.kind === "remote"
        ? `${inventory.text}\n\n## Remote workspace skills\n\n${skills.filter((skill) => skill.source === "workspace").map((skill) => `- ${skill.name} — ${skill.path}`).join("\n") || "- none"}`
        : inventory.text;
      return textResult(inventoryText, {
        workspace_id: target.workspace.id,
        root: target.workspace.root,
        location: target.kind,
        host_alias: target.kind === "remote" ? target.project.hostAlias : null,
        bash_mode: config.bashMode,
        write_mode: config.writeMode,
        tool_mode: config.toolMode,
        skills,
        skill_count: skills.length,
        plugins: inventory.plugins,
        plugin_count: inventory.plugins.length,
        mcp_servers: inventory.mcpServers,
        mcp_server_count: inventory.mcpServers.length,
        widget_uri: TOOL_CARD_URI
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "load_skill",
    {
      title: "Load Skill",
      description:
        "Load the bounded SKILL.md body for a discovered workspace, user, or plugin skill by name. Does not accept arbitrary paths; use after open_current_workspace/open_workspace shows skill_inventory.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        name: z.string().describe("Exact skill name from skill_inventory or codexflow_inventory."),
        source: z.enum(["workspace", "user", "plugin", "other"]).optional().describe("Optional source when multiple skills share a name."),
        path: z.string().optional().describe("Exact sanitized path from skill_inventory when name/source are still ambiguous."),
        include_global_skills: z.boolean().optional().describe("Also scan installed user/plugin skills. Default: auto when source/path is not workspace."),
        max_skills: z.number().int().min(1).max(500).optional().describe("Maximum skills to scan while resolving the requested skill. Default: 500."),
        max_bytes: z.number().int().min(1000).max(100000).optional().describe("Maximum bytes to return from SKILL.md. Default: 40000.")
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Loading skill instructions...",
        "openai/toolInvocation/invoked": "Skill instructions loaded"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const requestedPath = typeof args.path === "string" ? args.path : undefined;
      const includeGlobalDefault =
        args.source === undefined ||
        (args.source !== undefined && args.source !== "workspace") ||
        Boolean(requestedPath && !requestedPath.startsWith("$WORKSPACE/"));
      let loaded;
      if (target.kind === "remote" && (args.source === "workspace" || requestedPath?.startsWith("$WORKSPACE/") || args.source === undefined)) {
        const remoteSkills = await discoverRemoteSkillInventory(config, target.project, limitInt(args.max_skills, 500, 1, 500));
        const remoteMatches = remoteSkills.filter((skill) =>
          skill.name === String(args.name ?? "") && (!requestedPath || skill.path === requestedPath)
        );
        if (remoteMatches.length > 1) throw new CodexFlowError("Multiple remote workspace skills share that name. Pass the exact advertised path.");
        if (remoteMatches.length === 1) {
          loaded = await loadRemoteSkill(config, target.project, {
            name: String(args.name ?? ""),
            path: requestedPath,
            maxSkills: limitInt(args.max_skills, 500, 1, 500),
            maxBytes: limitInt(args.max_bytes, 40_000, 1_000, 100_000)
          });
        } else if (args.source === "workspace" || requestedPath?.startsWith("$WORKSPACE/")) {
          throw new CodexFlowError(`Remote workspace skill not found: ${String(args.name ?? "")}`);
        }
      }
      loaded ??= await loadSkill(target.kind === "remote" ? workspaceManager.defaultWorkspace() : workspace, {
          name: String(args.name ?? ""),
          source: args.source,
          path: requestedPath,
          includeGlobal: parseBool(args.include_global_skills, includeGlobalDefault),
          maxSkills: limitInt(args.max_skills, 500, 1, 500),
          maxBytes: limitInt(args.max_bytes, 40_000, 1_000, 100_000)
        });
      const truncated = loaded.truncated ? "\n\n[truncated: increase max_bytes if more context is required]" : "";
      const text = `# Load Skill\n\nName: ${loaded.skill.name}\nSource: ${loaded.skill.source}\nPath: ${loaded.skill.path}\nBytes: ${loaded.bytes}/${loaded.totalBytes}\n\n\`\`\`markdown\n${loaded.text}${truncated}\n\`\`\``;
      return textResult(text, {
        workspace_id: workspace.id,
        root: workspace.root,
        location: target.kind,
        host_alias: target.kind === "remote" ? target.project.hostAlias : null,
        skill: loaded.skill,
        bytes: loaded.bytes,
        total_bytes: loaded.totalBytes,
        truncated: loaded.truncated,
        text: loaded.text
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "list_projects",
    {
      title: "Choose a project",
      description:
        "Call this first in a new CodexFlow coding chat. It creates a private route_id and returns synchronized local folders plus saved projects on approved SSH hosts. Preserve route_id on selection and later project calls. The text list remains the fallback when a client cannot render components. It does not run the Codex CLI.",
      inputSchema: {
        refresh: z.boolean().optional().describe("Rescan configured roots and local Codex project metadata. Default: false."),
        query: z.string().optional().describe("Optional case-insensitive filter over project name and path."),
        max_projects: z.number().int().min(1).max(250).optional().describe("Maximum projects to show. Default: 100.")
      },
      outputSchema: LIST_PROJECTS_OUTPUT_SCHEMA,
      annotations: SESSION_READ_ANNOTATIONS,
      _meta: {
        ...projectPickerMeta(),
        "codexflow/alwaysWidget": true,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Synchronizing local projects...",
        "openai/toolInvocation/invoked": "Choose a local project"
      }
    },
    async (args) => {
      const routeId = invocationRouteId() ?? routeStore.createRouteId();
      const boundRoute = routeStore.get(routeId);
      const candidates = await discoverProjects(config, {
        refresh: parseBool(args.refresh, false),
        maxProjects: limitInt(args.max_projects, 100, 1, 250)
      });
      const query = String(args.query ?? "").trim().toLowerCase();
      const localProjects = candidates.flatMap((candidate) => {
        if (query && !`${candidate.name}\n${candidate.root}`.toLowerCase().includes(query)) return [];
        const workspace = workspaceManager.openWorkspace(candidate.root);
        return [{
          project_id: workspace.id,
          name: candidate.name,
          root: candidate.root,
          location: "local" as const,
          host_alias: null,
          sources: candidate.sources,
          last_active_at: candidate.lastActiveAt ? new Date(candidate.lastActiveAt).toISOString() : null,
          selected: workspace.id === (boundRoute?.workspaceId ?? activeWorkspaceId)
        }];
      });
      const remoteProjects = listSavedRemoteProjects({ availableOnly: true }).flatMap((project) => {
        if (query && !`${project.name}\n${project.root}\n${project.hostAlias}`.toLowerCase().includes(query)) return [];
        return [{
          project_id: project.id,
          name: project.name,
          root: project.root,
          location: "remote" as const,
          host_alias: project.hostAlias,
          sources: ["saved-remote", `ssh:${project.hostAlias}`],
          last_active_at: project.updatedAt,
          selected: project.id === boundRoute?.workspaceId
        }];
      });
      const projects = [...localProjects, ...remoteProjects].slice(0, limitInt(args.max_projects, 100, 1, 250));
      const rows = projects.length
        ? projects.map((project) => `- ${project.project_id} — ${project.name} — ${project.location === "remote" ? `${project.host_alias}:` : ""}${project.root}${project.selected ? " (selected)" : ""}`).join("\n")
        : "No projects found inside the configured allowed roots.";
      return textResult(`# Choose a project\n\nPrivate route ID: ${routeId}\n\nUse the optional picker if it is visible, or reply with an exact project name. Preserve route_id on select_project and every later project tool call. The conversation remains fully usable when the picker cannot render.\n\n${rows}`, {
        route_id: routeId,
        projects,
        count: projects.length,
        selected_project_id: boundRoute?.workspaceId ?? activeWorkspaceId ?? null,
        picker_optional: true
      }, { "openai/widgetSessionId": routeId });
    }
  );

  registerCodexTool(
    config,
    server,
    "select_project",
    {
      title: "Select Project",
      description:
        "Bind one private route_id to a synchronized local project or saved project on an approved SSH host. Return and preserve route_id plus workspace_id. ChatGPT may create a separate MCP transport for every call, so pass route_id on every later CodexFlow file, git, search, and edit call.",
      inputSchema: {
        project_id: z.string().optional().describe("Project id returned by list_projects."),
        name: z.string().optional().describe("Exact project name from list_projects when project_id is unavailable."),
        include_tree: z.boolean().optional().describe("Include a compact initial tree. Default: true."),
        max_depth: z.number().int().min(1).max(8).optional().describe("Initial tree depth. Default: 2.")
      },
      outputSchema: SELECT_PROJECT_OUTPUT_SCHEMA,
      annotations: SESSION_READ_ANNOTATIONS,
      _meta: {
        ui: { visibility: ["model", "app"] },
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Binding this chat to the project...",
        "openai/toolInvocation/invoked": "Project selected"
      }
    },
    async (args) => {
      if (!args.project_id && !args.name) throw new CodexFlowError("project_id or name is required. Call list_projects first.");
      const routeId = invocationRouteId() ?? routeStore.createRouteId();
      const candidates = await discoverProjects(config, { maxProjects: 250 });
      const choices = candidates.map((candidate) => ({ candidate, workspace: workspaceManager.openWorkspace(candidate.root) }));
      const localMatches = args.project_id
        ? choices.filter((choice) => choice.workspace.id === args.project_id)
        : choices.filter((choice) => choice.candidate.name.toLowerCase() === String(args.name).trim().toLowerCase());
      const remoteMatches = listSavedRemoteProjects({ availableOnly: true }).filter((project) => args.project_id
        ? project.id === args.project_id
        : project.name.toLowerCase() === String(args.name).trim().toLowerCase());
      if (localMatches.length + remoteMatches.length > 1) throw new CodexFlowError(`Multiple projects are named ${args.name}. Select one by project_id.`);
      const remoteSelection = remoteMatches[0];
      if (remoteSelection) {
        let project: SavedRemoteProject;
        try {
          project = getApprovedRemoteProject(remoteSelection.id);
        } catch (error) {
          throw new CodexFlowError(error instanceof Error ? error.message : String(error));
        }
        routeStore.bindRemote(routeId, project);
        const [summary, inventory, remoteWorkspaceSkills] = await Promise.all([
          Promise.resolve(runRemoteWorkspaceOperation<{
            tree?: string;
            gitStatus: string;
            agentsPath?: string;
            agentsText?: string;
          }>(project.hostAlias, config, {
            action: "summary",
            root: project.root,
            maxDepth: limitInt(args.max_depth, 2, 1, 8),
            maxEntries: 500
          })),
          codexflowInventory(config, workspaceManager.defaultWorkspace(), { includeGlobalSkills: true, includeMcpServers: true, maxSkills: 120 }),
          discoverRemoteSkillInventory(config, project, 120)
        ]);
        const skills = [
          ...remoteWorkspaceSkills,
          ...inventory.skills.filter((skill) => skill.source !== "workspace")
        ].slice(0, 120);
        const pluginSkills = skills.filter((skill) => skill.source === "plugin");
        const text = [
          `# Remote project selected: ${project.name}`,
          "",
          `Project ID: ${project.id}`,
          `Private route ID: ${routeId}`,
          `Host: ${project.hostAlias}`,
          `Root: ${project.root}`,
          "This conversation now routes bounded project tools through CodexFlow's own SSH helper. Codex and the Codex CLI are not invoked.",
          "",
          summary.agentsPath ? `Repository instructions: ${summary.agentsPath}` : "Repository instructions: none found",
          `Broker skills advertised: ${skills.length}`,
          `Plugins advertised: ${inventory.plugins.length}`
        ].join("\n");
        return textResult(text, {
          route_id: routeId,
          selected: true,
          project_id: project.id,
          workspace_id: project.id,
          name: project.name,
          root: project.root,
          location: "remote",
          host_alias: project.hostAlias,
          sources: ["saved-remote", `ssh:${project.hostAlias}`],
          agents_loaded: Boolean(summary.agentsPath),
          ...(summary.agentsPath ? { agents_path: summary.agentsPath } : {}),
          tree: parseBool(args.include_tree, true) ? summary.tree : undefined,
          git_status: summary.gitStatus,
          skills,
          skill_count: skills.length,
          plugins: inventory.plugins,
          plugin_count: inventory.plugins.length,
          plugin_skills: pluginSkills,
          mcp_servers: inventory.mcpServers,
          mcp_server_count: inventory.mcpServers.length,
          bash_mode: config.bashMode,
          write_mode: config.writeMode,
          tool_mode: config.toolMode
        }, { "openai/widgetSessionId": routeId });
      }
      const selected = localMatches[0];
      if (!selected) throw new CodexFlowError("Project not found in the synchronized catalog. Call list_projects with refresh=true.");
      bindWorkspace(selected.workspace, routeId);
      routeStore.selectEnvironment(routeId, undefined);
      const [summary, inventory] = await Promise.all([
        workspaceSummary(config, guard, selected.workspace, {
          includeTree: parseBool(args.include_tree, true),
          maxDepth: limitInt(args.max_depth, 2, 1, 8),
          includeSkills: false,
          bootstrapContext: false
        }),
        codexflowInventory(config, selected.workspace, { includeGlobalSkills: true, includeMcpServers: true, maxSkills: 120 })
      ]);
      const pluginSkills = inventory.skills.filter((skill) => skill.source === "plugin");
      const text = [
        `# Project selected: ${selected.candidate.name}`,
        "",
        `Project ID: ${selected.workspace.id}`,
        `Private route ID: ${routeId}`,
        `Root: ${selected.workspace.root}`,
        "This ChatGPT conversation is now routed to this project. Pass route_id on every subsequent project-scoped call because ChatGPT may use a new MCP transport each time.",
        "",
        summary.agentsLoaded ? `Repository instructions: ${summary.agentsPath}` : "Repository instructions: none found",
        `Skills advertised: ${inventory.skills.length}`,
        `Plugins advertised: ${inventory.plugins.length}`,
        `Plugin skills advertised: ${pluginSkills.length}`,
        `Configured MCP servers advertised: ${inventory.mcpServers.length}`
      ].join("\n");
      return textResult(text, {
        route_id: routeId,
        selected: true,
        project_id: selected.workspace.id,
        workspace_id: selected.workspace.id,
        name: selected.candidate.name,
        root: selected.workspace.root,
        location: "local",
        host_alias: null,
        sources: selected.candidate.sources,
        agents_loaded: summary.agentsLoaded,
        agents_path: summary.agentsPath,
        tree: summary.tree,
        git_status: summary.gitStatus,
        skills: inventory.skills,
        skill_count: inventory.skills.length,
        plugins: inventory.plugins,
        plugin_count: inventory.plugins.length,
        plugin_skills: pluginSkills,
        mcp_servers: inventory.mcpServers,
        mcp_server_count: inventory.mcpServers.length,
        bash_mode: config.bashMode,
        write_mode: config.writeMode,
        tool_mode: config.toolMode
      }, { "openai/widgetSessionId": routeId });
    }
  );

  registerCodexTool(
    config,
    server,
    "prepare_scheduled_task",
    {
      title: "Prepare Scheduled Task",
      description:
        "Prepare a durable ChatGPT Scheduled prompt for this local project. ChatGPT owns scheduling and model execution; CodexFlow reacquires a private route on every run and optionally creates an isolated managed worktree.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id bound to this private route."),
        task: z.string().trim().min(1).max(6000).describe("Concrete work to perform on every scheduled run."),
        run_location: z.enum(["local", "worktree"]).optional().describe("Run directly in the project or create a new managed worktree for each run. Default: worktree when writes are enabled, otherwise local."),
        chat_mode: z.enum(["same_chat", "standalone"]).optional().describe("Return each run to this chat or start an independent Scheduled run. Default: same_chat."),
        verify: z.boolean().optional().describe("Require focused verification and show_changes before reporting. Default: true."),
        allow_push: z.boolean().optional().describe("Permit the scheduled run to push or open a pull request. Default: false.")
      },
      annotations: SESSION_READ_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Preparing scheduled project work...",
        "openai/toolInvocation/invoked": "Scheduled task context ready"
      }
    },
    async (args) => {
      const workspace = workspaces.getWorkspace(args.workspace_id);
      const routeId = invocationRouteId();
      const route = routeId ? routeStore.get(routeId) : undefined;
      const gitState = gitStatus(config, workspace).toLowerCase();
      const gitAvailable = !gitState.includes("not a git repository") && !gitState.startsWith("git unavailable") && !gitState.startsWith("git exited");
      const requestedLocation = args.run_location ?? (config.writeMode === "workspace" && gitAvailable ? "worktree" : "local");
      if (requestedLocation === "worktree" && (config.writeMode !== "workspace" || !gitAvailable)) {
        throw new CodexFlowError("Scheduled worktrees require a Git project and workspace write mode. Choose run_location=local or update the project policy.");
      }
      const chatMode = args.chat_mode ?? "same_chat";
      const verify = parseBool(args.verify, true);
      const allowPush = parseBool(args.allow_push, false);
      if (allowPush && config.writeMode !== "workspace") {
        throw new CodexFlowError("Scheduled push requires workspace write mode.");
      }
      const projectName = path.basename(workspace.root) || workspace.root;
      const environmentConfigPath = route?.environmentConfigPath;
      const steps = [
        "Use the CodexFlow app for this run. Do not use the Codex CLI.",
        "Call list_projects. Preserve the private route_id it returns for every later CodexFlow call in this run.",
        `Call select_project with that route_id and project_id \"${workspace.id}\". Confirm the selected project is \"${projectName}\" before continuing.`,
        ...(environmentConfigPath && config.writeMode === "workspace" && config.bashMode !== "off"
          ? [`Call local_environment with action=select and config_path=${JSON.stringify(environmentConfigPath)} on the selected route.`]
          : []),
        ...(requestedLocation === "worktree"
          ? ["Call worktree with action=create and include_changes=false. Perform all work in the returned managed worktree and leave it available for review."]
          : ["Work directly in the selected local project. Do not switch projects during the run."]),
        "Follow the project AGENTS.md and load any relevant advertised skills before editing.",
        `Perform this task:\n\n${String(args.task).trim()}`,
        ...(verify ? ["Run the narrowest relevant verification, then call show_changes and summarize files changed, checks run, and any remaining risk."] : []),
        ...(allowPush
          ? ["You may push or open a pull request only when the task clearly requires it; report the branch and URL."]
          : ["Do not push, publish, merge, or open a pull request. Leave changes local for review."]),
        "If the broker, project, required environment, or tool is unavailable, stop and report the exact blocker instead of changing another project."
      ];
      const prompt = steps.map((step, index) => `${index + 1}. ${step}`).join("\n\n");
      return textResult([
        "# Scheduled Task Context Ready",
        "",
        `Project: ${projectName}`,
        `Project ID: ${workspace.id}`,
        `Run location: ${requestedLocation}`,
        `Chat mode: ${chatMode === "same_chat" ? "return to this chat" : "standalone run"}`,
        "Scheduler: ChatGPT Scheduled (not CodexFlow)",
        "",
        "Ask ChatGPT to schedule the following durable prompt with your preferred cadence:",
        "",
        prompt,
        "",
        "Keep this computer awake, the CodexFlow broker running, and the plugin URL stable when a run needs local files."
      ].join("\n"), {
        workspace_id: workspace.id,
        project_id: workspace.id,
        project_name: projectName,
        run_location: requestedLocation,
        chat_mode: chatMode,
        environment_config_path: environmentConfigPath ?? null,
        prompt,
        scheduler: "chatgpt_scheduled",
        git_available: gitAvailable,
        requires_running_broker: true,
        creates_schedule: false
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "list_workspaces",
    {
      title: "List Workspaces",
      description: "List currently opened CodexFlow workspaces for this server/config.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Listing CodexFlow workspaces...",
        "openai/toolInvocation/invoked": "CodexFlow workspaces listed"
      }
    },
    async () => {
      const current = workspaces.listWorkspaces();
      const text = current.length
        ? current.map((workspace) => `- ${workspace.id} — ${workspace.root} (opened ${workspace.openedAt})`).join("\n")
        : "No workspaces opened on this CodexFlow server/config yet. Call open_workspace first.";
      return textResult(text, { workspaces: current, count: current.length });
    }
  );

  registerCodexTool(
    config,
    server,
    "open_current_workspace",
    {
      title: "Open Current Workspace",
      description:
        "Open the project bound to route_id. Only use the configured default when no picker or route context exists; after a picker selection, always pass its exact route_id.",
      inputSchema: {
        include_tree: z.boolean().optional().describe("Include a compact file tree. Default: false for speed."),
        max_depth: z.number().int().min(1).max(8).optional().describe("Tree depth when include_tree=true. Default: 2."),
        include_skills: z.boolean().optional().describe("Discover skills by name/description. Default: false for speed."),
        include_global_skills: z.boolean().optional().describe("Also scan installed user/plugin skills when include_skills=true. Default: false.")
      },
      annotations: SESSION_READ_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Opening current CodexFlow workspace...",
        "openai/toolInvocation/invoked": "Current CodexFlow workspace opened"
      }
    },
    async (args) => {
      const workspace = workspaces.activeWorkspace() ?? workspaces.defaultWorkspace();
      const summary = await workspaceSummary(config, guard, workspace, {
        includeTree: parseBool(args.include_tree, false),
        maxDepth: limitInt(args.max_depth, 2, 1, 8),
        includeSkills: parseBool(args.include_skills, false),
        includeGlobalSkills: parseBool(args.include_global_skills, false),
        bootstrapContext: false
      });
      return textResult(summary.text, {
        workspace_id: summary.workspaceId,
        root: summary.root,
        agents_loaded: summary.agentsLoaded,
        agents_path: summary.agentsPath,
        skills: summary.skills,
        skill_inventory: summary.skillInventory,
        skill_counts: summary.skillCounts,
        tree: summary.tree,
        git_status: summary.gitStatus,
        bash_mode: config.bashMode,
        write_mode: config.writeMode,
        tool_mode: config.toolMode
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "open_workspace",
    {
      title: "Open Workspace",
      description:
        "Open a local project directory as a CodexFlow workspace. When route_id is supplied, this explicitly binds or switches that private chat route. Returns a workspace_id plus git status, AGENTS.md, and a compact file tree.",
      inputSchema: {
        root: z.string().optional().describe("Project directory to open. Omit to use CODEXFLOW_ROOT/current working directory. Supports ~/ paths."),
        path: z.string().optional().describe("Alias for root. Useful for clients that naturally send path instead of root."),
        include_tree: z.boolean().optional().describe("Include a compact file tree. Default: true."),
        max_depth: z.number().int().min(1).max(8).optional().describe("Tree depth. Default: 3."),
        max_files: z.number().int().min(1).max(3000).optional().describe("Alias for maximum tree entries. Default: 500."),
        include_skills: z.boolean().optional().describe("Discover skills by name/description. Default: false for speed."),
        include_global_skills: z.boolean().optional().describe("Also scan installed user/plugin skills when include_skills=true. Default: false."),
        bootstrap_context: z.boolean().optional().describe("Deprecated and ignored. Use handoff_to_agent to create .ai-bridge files.")
      },
      annotations: SESSION_READ_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Opening CodexFlow workspace...",
        "openai/toolInvocation/invoked": "CodexFlow workspace opened"
      }
    },
    async (args) => {
      if (args.root && args.path && args.root !== args.path) {
        throw new CodexFlowError("open_workspace accepts either root or path. If both are provided, they must match.");
      }
      const requestedRoot = args.root ?? args.path;
      const workspace = requestedRoot
        ? workspaces.openWorkspace(requestedRoot)
        : workspaces.activeWorkspace() ?? workspaces.defaultWorkspace();
      const routeId = invocationRouteId();
      if (requestedRoot && routeId) routeStore.selectEnvironment(routeId, undefined);
      const summary = await workspaceSummary(config, guard, workspace, {
        includeTree: args.include_tree !== false,
        maxDepth: limitInt(args.max_depth, 3, 1, 8),
        maxEntries: limitInt(args.max_files, 500, 1, 3000),
        includeSkills: parseBool(args.include_skills, false),
        includeGlobalSkills: parseBool(args.include_global_skills, false),
        bootstrapContext: false
      });
      return textResult(summary.text, {
        workspace_id: summary.workspaceId,
        root: summary.root,
        agents_loaded: summary.agentsLoaded,
        agents_path: summary.agentsPath,
        skills: summary.skills,
        skill_inventory: summary.skillInventory,
        skill_counts: summary.skillCounts,
        tree: summary.tree,
        git_status: summary.gitStatus,
        bash_mode: config.bashMode,
        write_mode: config.writeMode,
        tool_mode: config.toolMode
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "workspace_snapshot",
    {
      title: "Workspace Snapshot",
      description: "Return git status, recent commits, .ai-bridge context, and a compact tree for an opened workspace.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        max_depth: z.number().int().min(1).max(8).optional().describe("Tree depth. Default: 3."),
        max_files: z.number().int().min(1).max(3000).optional().describe("Alias for maximum tree entries. Default: 500."),
        include_skills: z.boolean().optional().describe("Discover repo-local skills. Default: false for speed."),
        include_global_skills: z.boolean().optional().describe("Also scan home-level skill folders when include_skills=true. Default: false.")
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Collecting workspace snapshot...",
        "openai/toolInvocation/invoked": "Workspace snapshot ready"
      }
    },
    async (args) => {
      const workspace = workspaces.getWorkspace(args.workspace_id);
      const summary = await workspaceSummary(config, guard, workspace, {
        includeTree: true,
        maxDepth: limitInt(args.max_depth, 3, 1, 8),
        maxEntries: limitInt(args.max_files, 500, 1, 3000),
        includeSkills: parseBool(args.include_skills, false),
        includeGlobalSkills: parseBool(args.include_global_skills, false)
      });
      const ai = await readAiBridgeContext(config, guard, workspace);
      const text = `${summary.text}\n\n## AI handoff context\n\n${ai.text}`;
      return textResult(text, {
        workspace_id: workspace.id,
        root: workspace.root,
        agents_loaded: summary.agentsLoaded,
        agents_path: summary.agentsPath,
        skills: summary.skills,
        skill_inventory: summary.skillInventory,
        skill_counts: summary.skillCounts,
        tree: summary.tree,
        git_status: summary.gitStatus,
        ai_context_files: ai.files,
        bash_mode: config.bashMode,
        write_mode: config.writeMode,
        tool_mode: config.toolMode
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "inspect_workspace",
    {
      title: "Inspect Workspace",
      description: "Build a bounded repository map with languages, project types, entrypoints, areas, symbols, relationships, and coverage warnings.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        path: z.string().optional().describe("Optional workspace-relative area to emphasize. Default: entire workspace."),
        max_files: z.number().int().min(1).max(100000).optional().describe("Maximum returned file records. Default: 300."),
        include_symbols: z.boolean().optional().describe("Include symbols in structured output. Default: true."),
        include_relationships: z.boolean().optional().describe("Include relationships in structured output. Default: true."),
        max_symbols: z.number().int().min(1).max(100000).optional().describe("Maximum returned symbols. Analysis remains bounded by server config."),
        max_relationships: z.number().int().min(1).max(250000).optional().describe("Maximum returned relationships. Analysis remains bounded by server config.")
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Inspecting workspace analysis...",
        "openai/toolInvocation/invoked": "Workspace analysis ready"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const fileLimit = config.toolCards ? 120 : limitInt(args.max_files, 300, 1, config.analysisLimits.maxInventoryFiles);
      const symbolLimit = config.toolCards ? 80 : limitInt(args.max_symbols, 500, 1, config.analysisLimits.maxSymbols);
      const relationshipLimit = config.toolCards ? 120 : limitInt(args.max_relationships, 800, 1, config.analysisLimits.maxRelationships);
      let prefix = "";
      if (typeof args.path === "string" && args.path.trim()) {
        if (target.kind === "remote") {
          if (path.posix.isAbsolute(args.path)) throw new CodexFlowError("Analysis path must be relative to the remote project.");
          prefix = path.posix.normalize(args.path).replace(/^\.\/?$/, "");
          if (prefix === ".." || prefix.startsWith("../")) throw new CodexFlowError("Analysis path escapes the remote project.");
        } else {
          prefix = guard.resolve(workspace, args.path).relPath.replace(/^\.\/?$/, "");
        }
      }
      const result = target.kind === "remote"
        ? await inspectRemoteWorkspace(config, target.project, {
            maxFiles: fileLimit,
            maxSymbols: symbolLimit,
            maxRelationships: relationshipLimit
          })
        : await inspectWorkspace(config, guard, workspace);
      const inScope = (filePath: string) => !prefix || filePath === prefix || filePath.startsWith(`${prefix}/`);
      const areaInScope = (areaPath: string) => !prefix || areaPath === "." || inScope(areaPath) || prefix.startsWith(`${areaPath}/`);
      const scopedFiles = result.files.filter((file) => inScope(file.path));
      const scopedSymbols = result.symbols.filter((symbol) => inScope(symbol.path));
      const scopedRelationships = result.relationships.filter((relationship) => inScope(relationship.from) || inScope(relationship.to));
      const files = scopedFiles.slice(0, fileLimit);
      const symbols = args.include_symbols === false
        ? []
        : scopedSymbols.slice(0, symbolLimit);
      const relationships = args.include_relationships === false
        ? []
        : scopedRelationships.slice(0, relationshipLimit);
      const outputLimited = files.length < scopedFiles.length ||
        (args.include_symbols !== false && symbols.length < scopedSymbols.length) ||
        (args.include_relationships !== false && relationships.length < scopedRelationships.length);
      const outputWarnings = [
        ...result.warnings,
        ...(outputLimited ? ["Structured output was limited. Use path or max_* arguments to request a narrower or larger result."] : [])
      ];
      const text = [
        "# Workspace Analysis",
        "",
        `Workspace: ${workspace.root}`,
        `Projects: ${result.projectTypes.join(", ") || "unknown"}`,
        `Languages: ${result.languages.join(", ") || "unknown"}`,
        `Entrypoints: ${result.entrypoints.filter(inScope).join(", ") || "none detected"}`,
        `Coverage: ${result.coverage.analyzedFiles}/${result.coverage.inventoryFiles} files analyzed, ${result.coverage.symbolCount} symbols, ${result.coverage.relationshipCount} relationships${result.coverage.truncated ? " (partial)" : ""}`,
        `Returned: ${files.length} files, ${symbols.length} symbols, ${relationships.length} relationships`,
        ...(outputWarnings.length ? ["", "## Warnings", "", ...outputWarnings.map((warning) => `- ${warning}`)] : [])
      ].join("\n");
      return textResult(text, {
        schema_version: 1,
        workspace_id: workspace.id,
        root: workspace.root,
        location: target.kind,
        host_alias: target.kind === "remote" ? target.project.hostAlias : null,
        path: args.path ?? ".",
        languages: result.languages,
        project_types: result.projectTypes,
        entrypoints: result.entrypoints.filter(inScope),
        important_files: result.importantFiles.filter(inScope),
        areas: result.areas.filter((area) => areaInScope(area.path)),
        files,
        symbols,
        relationships,
        coverage: result.coverage,
        warnings: outputWarnings,
        output_limited: outputLimited,
        returned: { files: files.length, symbols: symbols.length, relationships: relationships.length },
        cache: result.cache
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "tree",
    {
      title: "File Tree",
      description: "List files and directories inside the workspace, excluding blocked paths.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        path: z.string().optional().describe("Directory relative to workspace root. Default: ."),
        max_depth: z.number().int().min(1).max(12).optional().describe("Maximum depth. Default: 4."),
        include_hidden: z.boolean().optional().describe("Include dotfiles/dotfolders that are not blocked. Default: false."),
        max_entries: z.number().int().min(1).max(3000).optional().describe("Maximum entries. Default: 800.")
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Listing workspace files...",
        "openai/toolInvocation/invoked": "Workspace files listed"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const treeOptions = {
        path: args.path ?? ".",
        maxDepth: limitInt(args.max_depth, 4, 1, 12),
        includeHidden: parseBool(args.include_hidden, false),
        maxEntries: limitInt(args.max_entries, 800, 1, 3000)
      };
      const result = target.kind === "remote"
        ? await runRemoteWorkspaceOperation<{ text: string; entries: number; truncated: boolean }>(target.project.hostAlias, config, {
            action: "tree",
            root: target.project.root,
            ...treeOptions
          })
        : await repoTree(config, guard, workspace, treeOptions);
      return textResult(result.text, { workspace_id: workspace.id, root: workspace.root, ...result });
    }
  );

  registerCodexTool(
    config,
    server,
    "search",
    {
      title: "Search Files",
      description: "Use this for targeted verification or code lookup. Prefer one specific final search instead of repeated broad verification searches.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        query: z.string().describe("Text or regex to search for."),
        regex: z.boolean().optional().describe("Treat query as a regular expression. Requires ripgrep. Default: false."),
        path: z.string().optional().describe("Directory or file relative to workspace root. Default: ."),
        glob: z.string().optional().describe("Optional glob, for example src/**/*.ts."),
        include_hidden: z.boolean().optional().describe("Include hidden files that are not blocked. Default: false."),
        max_results: z.number().int().min(1).max(2000).optional().describe("Maximum results. Default from config."),
        intent: z.enum(["auto", "text", "symbol", "references", "impact"]).optional().describe("Optional structured search intent. Omit for legacy lexical behavior."),
        symbol: z.string().optional().describe("Optional symbol query. Uses repository analysis and overrides query text."),
        include_tests: z.boolean().optional().describe("Include related tests in structured results. Default: false.")
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Searching workspace...",
        "openai/toolInvocation/invoked": "Workspace search complete"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const searchOptions = {
        query: args.symbol?.toString() || args.query,
        regex: parseBool(args.regex, false),
        root: args.path ?? ".",
        glob: args.glob,
        includeHidden: parseBool(args.include_hidden, false),
        maxResults: limitInt(args.max_results, config.maxSearchResults, 1, config.maxSearchResults),
        intent: args.intent,
        symbol: args.symbol,
        includeTests: args.include_tests === undefined ? undefined : parseBool(args.include_tests, false)
      };
      const result: SearchResult = target.kind === "remote"
        ? await runRemoteWorkspaceOperation<SearchResult>(target.project.hostAlias, config, {
            action: "search",
            root: target.project.root,
            path: searchOptions.root,
            query: searchOptions.query,
            regex: searchOptions.regex,
            glob: searchOptions.glob,
            includeHidden: searchOptions.includeHidden,
            maxResults: searchOptions.maxResults,
            maxReadBytes: config.maxReadBytes
          })
        : await searchWorkspace(config, guard, workspace, searchOptions);
      const structured: Record<string, unknown> = {
        workspace_id: workspace.id,
        root: workspace.root,
        matches: result.matches,
        truncated: result.truncated,
        used: result.used
      };
      if (result.analysis) {
        structured.analysis = config.toolCards
          ? {
              ...result.analysis,
              groups: Object.fromEntries(Object.entries(result.analysis.groups).map(([name, matches]) => [name, matches.slice(0, 24)])),
              matches: result.analysis.matches.slice(0, 80)
            }
          : result.analysis;
      }
      // The tool card widget renders search hits from structuredContent.text.
      // When cards are disabled (the default), including it would only duplicate
      // the human-readable content payload, so omit the large blob in that case.
      if (config.toolCards) structured.text = result.text;
      return textResult(result.text, structured);
    }
  );

  registerCodexTool(
    config,
    server,
    "read",
    {
      title: "Read File",
      description: "Read a specific text file with line numbers. Avoid rereading files after write/edit/apply_patch unless exact final content is needed.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        path: z.string().describe("File path relative to workspace root."),
        start_line: z.number().int().min(1).optional().describe("First line to read. Default: 1."),
        end_line: z.number().int().min(1).optional().describe("Last line to read. Default: end of file."),
        max_bytes: z.number().int().min(1000).max(2000000).optional().describe("Maximum file bytes. Capped by server config.")
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Reading file...",
        "openai/toolInvocation/invoked": "File read"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const maxBytes = Math.min(args.max_bytes ?? config.maxReadBytes, config.maxReadBytes);
      const result = target.kind === "remote"
        ? await runRemoteWorkspaceOperation<{
            path: string;
            text: string;
            startLine: number;
            endLine: number;
            totalLines: number;
            bytes: number;
            sha256: string;
            truncated: boolean;
          }>(target.project.hostAlias, config, {
            action: "read",
            root: target.project.root,
            path: args.path,
            startLine: args.start_line,
            endLine: args.end_line,
            maxBytes
          })
        : await readTextFile(config, guard, workspace, args.path, {
            startLine: args.start_line,
            endLine: args.end_line,
            maxBytes
          });
      const text = `# Read File\n\nPath: ${result.path}\nLines: ${result.startLine}-${result.endLine} of ${result.totalLines}\nBytes: ${result.bytes}\nSHA-256: ${result.sha256}\n\n\`\`\`text\n${result.text}\n\`\`\``;
      return textResult(text, { workspace_id: workspace.id, root: workspace.root, ...result });
    }
  );

  registerCodexTool(
    config,
    server,
    "write",
    {
      title: "Write File",
      description: "Create or overwrite a meaningful text file inside the workspace. Returns a unified diff; do not create empty placeholder files.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        path: z.string().describe("File path relative to workspace root."),
        content: z.string().describe("Complete file contents to write."),
        create_dirs: z.boolean().optional().describe("Create parent directories if missing. Default: true."),
        overwrite: z.boolean().optional().describe("Allow overwriting existing files. Default: true.")
      },
      annotations: LOCAL_WRITE_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Writing file...",
        "openai/toolInvocation/invoked": "File written"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const content = String(args.content ?? "");
      let result: {
        path: string;
        existed: boolean;
        bytes: number;
        sha256: string;
        diff: { additions: number; deletions: number; diff: string; changed: boolean };
      };
      if (target.kind === "remote") {
        assertWriteToolAllowed(config, args.path);
        assertRemoteWriteContent("write", [content]);
        const remote = await runRemoteWorkspaceOperation<{
          path: string;
          existed: boolean;
          bytes: number;
          sha256: string;
          additions: number;
          deletions: number;
          diff: string;
          changed: boolean;
        }>(target.project.hostAlias, config, {
          action: "write",
          root: target.project.root,
          path: args.path,
          content,
          createDirs: args.create_dirs !== false,
          overwrite: args.overwrite !== false,
          maxWriteBytes: config.maxWriteBytes
        });
        result = {
          path: remote.path,
          existed: remote.existed,
          bytes: remote.bytes,
          sha256: remote.sha256,
          diff: { additions: remote.additions, deletions: remote.deletions, diff: remote.diff, changed: remote.changed }
        };
      } else {
        const resolved = guard.resolve(workspace, args.path, { forWrite: true });
        assertWriteToolAllowed(config, resolved.relPath);
        const local = await writeTextFile(config, guard, workspace, args.path, content, {
          createDirs: args.create_dirs !== false,
          overwrite: args.overwrite !== false
        });
        result = local;
      }
      if (result.diff.changed) invalidateWorkspaceAnalysis(workspace.id);
      const text = `# Write File\n\nPath: ${result.path}\nExisted before: ${result.existed}\nBytes: ${result.bytes}\nSHA-256: ${result.sha256}\nDiff stats: +${result.diff.additions} -${result.diff.deletions}${diffBlock(result.diff.diff)}`;
      return textResult(text, {
        workspace_id: workspace.id,
        root: workspace.root,
        path: result.path,
        existed: result.existed,
        bytes: result.bytes,
        sha256: result.sha256,
        additions: result.diff.additions,
        deletions: result.diff.deletions,
        diff: result.diff.diff
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "edit",
    {
      title: "Edit File",
      description: "Apply a targeted exact text replacement inside a workspace text file. Returns a unified diff.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        path: z.string().describe("File path relative to workspace root."),
        old_text: z.string().describe("Exact text to replace. Must match once unless replace_all=true."),
        new_text: z.string().describe("Replacement text."),
        replace_all: z.boolean().optional().describe("Replace all occurrences. Default: false."),
        expected_replacements: z.number().int().min(1).optional().describe("Fail if actual replacement count differs.")
      },
      annotations: LOCAL_WRITE_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Editing file...",
        "openai/toolInvocation/invoked": "File edited"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const oldText = String(args.old_text ?? "");
      const newText = String(args.new_text ?? "");
      let result: {
        path: string;
        replacements: number;
        bytes: number;
        sha256: string;
        diff: { additions: number; deletions: number; diff: string; changed: boolean };
      };
      if (target.kind === "remote") {
        assertWriteToolAllowed(config, args.path);
        assertRemoteWriteContent("edit", [newText]);
        const remote = await runRemoteWorkspaceOperation<{
          path: string;
          replacements: number;
          bytes: number;
          sha256: string;
          additions: number;
          deletions: number;
          diff: string;
          changed: boolean;
        }>(target.project.hostAlias, config, {
          action: "edit",
          root: target.project.root,
          path: args.path,
          oldText,
          newText,
          replaceAll: parseBool(args.replace_all, false),
          expectedReplacements: args.expected_replacements,
          maxWriteBytes: config.maxWriteBytes
        });
        result = {
          path: remote.path,
          replacements: remote.replacements,
          bytes: remote.bytes,
          sha256: remote.sha256,
          diff: { additions: remote.additions, deletions: remote.deletions, diff: remote.diff, changed: remote.changed }
        };
      } else {
        const resolved = guard.resolve(workspace, args.path, { forWrite: true });
        assertWriteToolAllowed(config, resolved.relPath);
        result = await editTextFile(config, guard, workspace, args.path, oldText, newText, {
          replaceAll: parseBool(args.replace_all, false),
          expectedReplacements: args.expected_replacements
        });
      }
      if (result.diff.changed) invalidateWorkspaceAnalysis(workspace.id);
      const text = `# Edit File\n\nPath: ${result.path}\nReplacements: ${result.replacements}\nBytes: ${result.bytes}\nSHA-256: ${result.sha256}\nDiff stats: +${result.diff.additions} -${result.diff.deletions}${diffBlock(result.diff.diff)}`;
      return textResult(text, {
        workspace_id: workspace.id,
        root: workspace.root,
        path: result.path,
        replacements: result.replacements,
        bytes: result.bytes,
        sha256: result.sha256,
        additions: result.diff.additions,
        deletions: result.diff.deletions,
        diff: result.diff.diff
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "apply_patch",
    {
      title: "Apply Patch",
      description:
        "Apply one unified diff patch inside the workspace. Paths are validated before applying. Prefer edit for tiny replacements and apply_patch for multi-file diffs.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        patch: z.string().describe("Unified diff patch to apply. File paths must stay inside the workspace and avoid blocked paths.")
      },
      annotations: LOCAL_WRITE_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Applying patch...",
        "openai/toolInvocation/invoked": "Patch applied"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const patch = String(args.patch ?? "");
      const result = target.kind === "remote"
        ? await (async () => {
            const remotePaths = patchTouchedPaths(patch);
            if (!remotePaths.length) throw new CodexFlowError("Patch does not contain any writable file paths.");
            for (const remotePath of remotePaths) assertWriteToolAllowed(config, remotePath);
            if (patchHasSymlinkMode(patch)) throw new CodexFlowError("Symlink patches are blocked from apply_patch.");
            assertRemoteWriteContent("apply_patch", [patch]);
            return await runRemoteWorkspaceOperation<{
              paths: string[];
              stdout: string;
              stderr: string;
              additions: number;
              deletions: number;
              changed: boolean;
              diff: string;
            }>(target.project.hostAlias, config, {
              action: "apply_patch",
              root: target.project.root,
              patch,
              maxWriteBytes: config.maxWriteBytes
            });
          })()
        : applyWorkspacePatch(config, guard, workspace, patch);
      if (result.changed) invalidateWorkspaceAnalysis(workspace.id);
      const text = [
        "# Apply Patch",
        "",
        `Paths: ${result.paths.join(", ")}`,
        `Diff stats: +${result.additions} -${result.deletions}`,
        result.stderr ? `stderr: ${result.stderr}` : "",
        result.diff ? diffBlock(result.diff) : "No diff output."
      ].filter(Boolean).join("\n");
      return textResult(text, {
        workspace_id: workspace.id,
        root: workspace.root,
        paths: result.paths,
        stdout: result.stdout,
        stderr: result.stderr,
        additions: result.additions,
        deletions: result.deletions,
        changed: result.changed,
        diff: result.diff
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "bash",
    {
      title: "Bash",
      description:
        "Run one allowlisted verification command in the workspace, such as tests, build, lint, typecheck, or a project script. Do not use for git status/diff or file inspection; use show_changes, tree, search, and read instead. Do not chain commands with &&, pipes, redirects, or shell file readers.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        command: z.string().describe("Command to run."),
        session_id: z.string().optional().describe(config.requireBashSession && config.bashSessionId ? `Required bash session id for this server: ${config.bashSessionId}.` : "Optional bash session id. If configured on the server, a provided value must match it."),
        cwd: z.string().optional().describe("Working directory relative to workspace root. Default: ."),
        timeout_ms: z.number().int().min(1000).max(180000).optional().describe("Timeout in milliseconds. Default: 30000.")
      },
      annotations: BASH_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Running bash command...",
        "openai/toolInvocation/invoked": "Bash command finished"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const command = String(args.command ?? "");
      const timeoutMs = Math.max(1_000, Math.min(args.timeout_ms ?? 30_000, 180_000));
      const result = target.kind === "remote"
        ? await (async () => {
            const bashSessionId = assertRemoteBash(config, command, args.session_id);
            const remote = await runRemoteWorkspaceOperation<Awaited<ReturnType<typeof runBash>>>(target.project.hostAlias, config, {
              action: "bash",
              root: target.project.root,
              command,
              cwd: args.cwd,
              timeoutMs
            }, timeoutMs + 15_000);
            return { ...remote, ...(bashSessionId ? { bashSessionId } : {}) };
          })()
        : await runBash(config, guard, workspace, command, {
            cwd: args.cwd,
            timeoutMs,
            sessionId: args.session_id
          });
      const text = bashTextResult(config, result);
      return textResult(text, { workspace_id: workspace.id, root: workspace.root, ...result, bash_session_id: result.bashSessionId ?? null });
    }
  );

  registerCodexTool(
    config,
    server,
    "terminal",
    {
      title: "Persistent Terminal",
      description:
        "Use the private chat route's persistent shell in its selected local or approved SSH project. run waits for one command; start launches a long-running or interactive command; read returns new transcript output; write sends input in full bash mode; stop closes the route terminal. Shell cwd and environment changes persist between commands and never cross private routes.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id bound to this private route."),
        action: z.enum(["run", "start", "read", "write", "stop"]),
        command: z.string().optional().describe("Command for run or start."),
        data: z.string().max(32768).optional().describe("Raw terminal input for write. Add a newline when submitting a response."),
        cwd: z.string().optional().describe("Optional workspace-relative directory to enter before the command."),
        timeout_ms: z.number().int().min(1000).max(180000).optional().describe("Command timeout. Default: 30000."),
        after_cursor: z.number().int().min(0).optional().describe("For read, return transcript chunks after this cursor."),
        wait_ms: z.number().int().min(0).max(5000).optional().describe("For read, briefly wait before collecting output."),
        session_id: z.string().optional().describe(config.requireBashSession && config.bashSessionId ? `Required bash session id for this server: ${config.bashSessionId}.` : "Optional configured bash session guard.")
      },
      annotations: BASH_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Using persistent terminal...",
        "openai/toolInvocation/invoked": "Terminal updated"
      }
    },
    async (args) => {
      const routeId = invocationRouteId();
      if (!routeId) throw new CodexFlowError("terminal requires the private route_id returned by list_projects or select_project.");
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      if (args.action === "run" || args.action === "start") {
        const options = {
          cwd: args.cwd,
          timeoutMs: args.timeout_ms,
          wait: args.action === "run",
          bashSessionId: args.session_id
        };
        const result = target.kind === "remote"
          ? await persistentTerminals.runRemote(config, routeId, target.project, String(args.command ?? ""), options)
          : await persistentTerminals.run(config, guard, routeId, workspace, String(args.command ?? ""), options);
        const text = [
          `# ${target.kind === "remote" ? "Remote " : ""}Persistent Terminal`,
          "",
          `Terminal: ${result.terminalId}`,
          `Command: ${result.commandId}`,
          `State: ${result.completed ? "completed" : "running"}`,
          result.completed ? `Exit: ${result.exitCode ?? "unknown"}` : "Use terminal action=read with this route_id to collect output.",
          result.output ? `\n## Output\n\n${result.output}` : ""
        ].filter(Boolean).join("\n");
        return textResult(text, {
          workspace_id: workspace.id,
          root: workspace.root,
          location: target.kind,
          host_alias: target.kind === "remote" ? target.project.hostAlias : null,
          ...result
        });
      }
      if (args.action === "read") {
        if (args.wait_ms) await new Promise((resolve) => setTimeout(resolve, args.wait_ms));
        const result = target.kind === "remote"
          ? persistentTerminals.readRemote(config, routeId, target.project, args.after_cursor ?? 0, args.session_id)
          : persistentTerminals.read(config, routeId, workspace, args.after_cursor ?? 0, args.session_id);
        const text = [
          "# Terminal Output",
          "",
          `Terminal: ${result.terminalId}`,
          `State: ${result.running ? "running" : "idle"}`,
          `Cursor: ${result.cursor}`,
          result.output ? `\n${result.output}` : "\nNo new output."
        ].join("\n");
        return textResult(text, {
          workspace_id: workspace.id,
          root: workspace.root,
          location: target.kind,
          host_alias: target.kind === "remote" ? target.project.hostAlias : null,
          ...result
        });
      }
      if (args.action === "write") {
        const result = target.kind === "remote"
          ? persistentTerminals.writeRemote(config, routeId, target.project, String(args.data ?? ""), args.session_id)
          : persistentTerminals.write(config, routeId, workspace, String(args.data ?? ""), args.session_id);
        return textResult(`# Terminal Input\n\nInput sent to ${result.terminalId}.`, {
          workspace_id: workspace.id,
          root: workspace.root,
          location: target.kind,
          host_alias: target.kind === "remote" ? target.project.hostAlias : null,
          ...result,
          input_sent: true
        });
      }
      if (args.action === "stop") {
        assertBashSession(config, args.session_id);
        const stopped = persistentTerminals.stop(routeId);
        return textResult(`# Terminal Stopped\n\n${stopped ? "The route terminal was closed." : "No route terminal was running."}`, {
          workspace_id: workspace.id,
          root: workspace.root,
          location: target.kind,
          host_alias: target.kind === "remote" ? target.project.hostAlias : null,
          stopped
        });
      }
      throw new CodexFlowError(`Unsupported terminal action: ${String(args.action)}`);
    }
  );

  registerCodexTool(
    config,
    server,
    "git_status",
    {
      title: "Git Status",
      description: "Show git branch and changed files for the workspace.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        path: z.string().optional().describe("Optional file path relative to workspace root.")
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Reading git status...",
        "openai/toolInvocation/invoked": "Git status ready"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const scopedPath = typeof args.path === "string" ? args.path : undefined;
      const status = target.kind === "remote"
        ? (await runRemoteWorkspaceOperation<{ text: string }>(target.project.hostAlias, config, {
            action: "git_status",
            root: target.project.root,
            path: scopedPath
          })).text
        : gitStatus(config, workspace, guard, scopedPath);
      const statusError = looksLikeGitError(status) ? status : "";
      const changedFiles = statusError ? [] : changedStatusLines(status);
      return textResult(status, {
        workspace_id: workspace.id,
        root: workspace.root,
        path: args.path ?? "workspace status",
        status,
        status_error: statusError || undefined,
        changed_files: changedFiles,
        changed: !statusError && changedFiles.length > 0
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "git_diff",
    {
      title: "Git Diff",
      description: "Show current unstaged or staged git diff, optionally scoped to a file.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        path: z.string().optional().describe("Optional file path relative to workspace root."),
        staged: z.boolean().optional().describe("Show staged diff. Default: false."),
        include_diff: z.boolean().optional().describe("Include the raw unified diff in the response. Default: true. Set false for stats-only checks.")
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Reading git diff...",
        "openai/toolInvocation/invoked": "Git diff ready"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const staged = parseBool(args.staged, false);
      const rawDiff = normalizeGitOutput(target.kind === "remote"
        ? (await runRemoteWorkspaceOperation<{ text: string }>(target.project.hostAlias, config, {
            action: "git_diff",
            root: target.project.root,
            path: args.path,
            staged
          })).text
        : gitDiff(config, guard, workspace, args.path, staged));
      const diffError = rawDiff && looksLikeGitError(rawDiff) ? rawDiff : "";
      const stats = diffError ? { additions: 0, deletions: 0, changed: false } : diffStats(rawDiff);
      const includeDiff = parseBool(args.include_diff, true);
      const text = diffError
        ? diffError
        : includeDiff
        ? rawDiff
        : [
            "# Git Diff",
            "",
            `Workspace: ${workspace.root}`,
            `Path: ${args.path ?? "workspace diff"}`,
            `Staged: ${parseBool(args.staged, false)}`,
            `Diff stats: +${stats.additions} -${stats.deletions}`,
            "",
            "Raw diff omitted by include_diff=false."
          ].join("\n");
      return textResult(text, {
        workspace_id: workspace.id,
        root: workspace.root,
        path: args.path ?? "workspace diff",
        staged: parseBool(args.staged, false),
        include_diff: includeDiff,
        diff_error: diffError || undefined,
        additions: stats.additions,
        deletions: stats.deletions,
        changed: !diffError && stats.changed,
        diff: diffError || includeDiff ? rawDiff : ""
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "git_workflow",
    {
      title: "Git Workflow",
      description: "Perform one deliberate Git workflow action in the selected project: stage, unstage, discard explicit paths, create or switch branches, commit staged changes, push, or create a GitHub pull request. Each call is separately approval-visible.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from the active project or worktree."),
        action: z.enum(["stage", "unstage", "discard", "create_branch", "switch_branch", "commit", "push", "create_pr"]),
        paths: z.array(z.string()).max(200).optional().describe("Workspace-relative paths. stage/unstage default to all; discard always requires explicit paths."),
        branch: z.string().optional().describe("Branch to create, switch to, or push. push defaults to the current branch."),
        message: z.string().max(500).optional().describe("Commit message for action=commit."),
        remote: z.string().optional().describe("Configured Git remote for push. Default: origin."),
        set_upstream: z.boolean().optional().describe("Set the push upstream. Default: true."),
        title: z.string().max(256).optional().describe("Pull request title for action=create_pr."),
        body: z.string().max(20_000).optional().describe("Pull request body for action=create_pr."),
        base: z.string().optional().describe("Optional pull request base branch."),
        include_staged: z.boolean().optional().describe("For discard, restore both index and working tree. Default: false.")
      },
      annotations: BASH_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Running Git workflow action...",
        "openai/toolInvocation/invoked": "Git workflow action complete"
      }
    },
    async (args) => {
      const workspace = workspaces.getWorkspace(args.workspace_id);
      const result = runGitWorkflow(config, guard, workspace, {
        action: args.action,
        paths: args.paths,
        branch: args.branch,
        message: args.message,
        remote: args.remote,
        setUpstream: args.set_upstream,
        title: args.title,
        body: args.body,
        base: args.base,
        includeStaged: args.include_staged
      });
      invalidateWorkspaceAnalysis(workspace.root);
      const text = [
        "# Git Workflow",
        "",
        `Action: ${result.action}`,
        `Workspace: ${result.root}`,
        result.branch ? `Branch: ${result.branch}` : "",
        result.paths.length ? `Paths: ${result.paths.join(", ")}` : "Paths: workspace",
        result.url ? `Pull request: ${result.url}` : "",
        result.stdout ? `\n## Output\n\n${result.stdout}` : "",
        result.stderr ? `\n## stderr\n\n${result.stderr}` : ""
      ].filter(Boolean).join("\n");
      return textResult(text, { workspace_id: workspace.id, ...result });
    }
  );

  registerCodexTool(
    config,
    server,
    "local_environment",
    {
      title: "Project Environment",
      description: "Discover and select the same version 1 .codex/environments/*.toml files used by Codex Desktop in the route's local or approved SSH project. Run platform-aware setup, cleanup, or named toolbar actions in its isolated persistent terminal.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id bound to this private route."),
        action: z.enum(["list", "select", "run", "setup", "cleanup"]),
        config_path: z.string().optional().describe("Absolute config path, environment name, or TOML filename. Required when more than one environment exists."),
        action_name: z.string().max(120).optional().describe("Named project environment action for action=run."),
        background: z.boolean().optional().describe("Run a named action in the persistent terminal without waiting. Default: false."),
        timeout_ms: z.number().int().min(1000).max(600000).optional().describe("Timeout for setup, cleanup, or a foreground action. Default: 600000 for setup/cleanup and 30000 for actions."),
        session_id: z.string().optional().describe(config.requireBashSession && config.bashSessionId ? `Required bash session id for this server: ${config.bashSessionId}.` : "Optional configured bash session guard.")
      },
      annotations: BASH_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Using project environment...",
        "openai/toolInvocation/invoked": "Project environment updated"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const routeId = invocationRouteId();
      const selectedConfigPath = routeId ? routeStore.get(routeId)?.environmentConfigPath : undefined;

      if (target.kind === "remote") {
        if (args.action === "list") {
          const catalog = await listRemoteEnvironments(config, target.project);
          const summaries = catalog.environments.map((environment) => localEnvironmentSummary(environment, catalog.platform));
          const rows = summaries.length
            ? summaries.map((environment) => {
                const selected = environment.config_path === selectedConfigPath ? "  selected" : "";
                const actions = (environment.actions as Array<{ name: string }>).map((action) => action.name).join(", ") || "none";
                return `- ${environment.name}${selected}\n  ${environment.config_path}\n  Actions: ${actions}`;
              }).join("\n")
            : "- No remote environments found.";
          return textResult(`# Remote Project Environments\n\n${rows}`, {
            workspace_id: workspace.id,
            root: workspace.root,
            location: "remote",
            host_alias: target.project.hostAlias,
            platform: catalog.platform,
            selected_config_path: selectedConfigPath ?? null,
            environments: summaries,
            count: summaries.length
          });
        }

        const selector = args.config_path ?? selectedConfigPath;
        const { environment, platform } = await resolveRemoteEnvironment(config, target.project, selector);
        const summary = localEnvironmentSummary(environment, platform);
        if (args.action === "select") {
          if (!routeId) throw new CodexFlowError("Selecting a remote environment requires the private route_id returned by list_projects or select_project.");
          routeStore.selectEnvironment(routeId, environment.configPath);
          return textResult(`# Remote Environment Selected\n\n${environment.name}\n\n${environment.configPath}`, {
            workspace_id: workspace.id,
            root: workspace.root,
            location: "remote",
            host_alias: target.project.hostAlias,
            platform,
            selected_config_path: environment.configPath,
            environment: summary
          });
        }

        if (!routeId) throw new CodexFlowError("Running a remote environment command requires a private route_id.");
        if (args.action === "run" && !args.action_name) throw new CodexFlowError("action_name is required for action=run.");
        const action = args.action === "run"
          ? environmentActionForPlatform(environment, args.action_name!, platform)
          : undefined;
        const command = action?.command ?? environmentScriptForPlatform(environment, args.action, platform);
        if (!command) {
          return textResult(`# Remote Environment ${args.action}\n\n${environment.name} has no ${args.action} script for ${platform}.`, {
            workspace_id: workspace.id,
            root: workspace.root,
            location: "remote",
            host_alias: target.project.hostAlias,
            platform,
            environment: summary,
            action: action?.name ?? args.action,
            completed: true,
            exitCode: 0,
            output: ""
          });
        }
        const result = await persistentTerminals.runRemote(
          config,
          routeId,
          target.project,
          environmentTerminalCommand(command, target.project.root, target.project.root),
          {
            timeoutMs: args.timeout_ms ?? (args.action === "run" ? 30_000 : 600_000),
            wait: args.action === "run" ? !parseBool(args.background, false) : true,
            bashSessionId: args.session_id,
            trustedProjectCommand: true
          }
        );
        return textResult([
          `# Remote Environment ${action ? "Action" : args.action === "setup" ? "Setup" : "Cleanup"}`,
          "",
          `Environment: ${environment.name}`,
          action ? `Action: ${action.name}` : "",
          `State: ${result.completed ? "completed" : "running"}`,
          result.completed ? `Exit: ${result.exitCode ?? "unknown"}` : "Use terminal action=read to follow output.",
          result.output ? `\n## Output\n\n${result.output}` : ""
        ].filter(Boolean).join("\n"), {
          workspace_id: workspace.id,
          root: workspace.root,
          location: "remote",
          host_alias: target.project.hostAlias,
          platform,
          environment: summary,
          action: action?.name ?? args.action,
          ...result
        });
      }

      const paths = managedWorktreePaths(config, workspace);
      const environmentWorkspace = paths.worktreeId
        ? workspaceManager.openWorkspace(paths.sourceWorkspacePath)
        : workspace;
      if (args.action === "list") {
        const environments = listLocalEnvironments(config, environmentWorkspace);
        const summaries = environments.map((environment) => localEnvironmentSummary(environment));
        const rows = summaries.length
          ? summaries.map((environment) => {
              const selected = environment.config_path === selectedConfigPath ? "  selected" : "";
              const actions = (environment.actions as Array<{ name: string }>).map((action) => action.name).join(", ") || "none";
              return `- ${environment.name}${selected}\n  ${environment.config_path}\n  Actions: ${actions}`;
            }).join("\n")
          : "- No local environments found.";
        return textResult(`# Local Environments\n\n${rows}`, {
          workspace_id: workspace.id,
          root: workspace.root,
          selected_config_path: selectedConfigPath ?? null,
          environments: summaries,
          count: summaries.length
        });
      }

      const selector = args.config_path ?? selectedConfigPath;
      const environment = resolveLocalEnvironment(config, environmentWorkspace, selector);
      if (args.action === "select") {
        if (!routeId) throw new CodexFlowError("Selecting a local environment requires the private route_id returned by list_projects or select_project.");
        routeStore.selectEnvironment(routeId, environment.configPath);
        return textResult(`# Local Environment Selected\n\n${environment.name}\n\n${environment.configPath}\n\nNew managed worktrees on this route will run its setup script automatically.`, {
          workspace_id: workspace.id,
          root: workspace.root,
          selected_config_path: environment.configPath,
          environment: localEnvironmentSummary(environment)
        });
      }

      if (args.action === "run") {
        if (!routeId) throw new CodexFlowError("Running a local environment action requires a private route_id.");
        if (!args.action_name) throw new CodexFlowError("action_name is required for action=run.");
        const action = environmentAction(environment, args.action_name);
        const result = await persistentTerminals.run(
          config,
          guard,
          routeId,
          workspace,
          environmentTerminalCommand(action.command, paths.sourceWorkspacePath, paths.worktreePath),
          {
            timeoutMs: args.timeout_ms,
            wait: !parseBool(args.background, false),
            bashSessionId: args.session_id,
            trustedProjectCommand: true
          }
        );
        return textResult([
          "# Local Environment Action",
          "",
          `Environment: ${environment.name}`,
          `Action: ${action.name}`,
          `State: ${result.completed ? "completed" : "running"}`,
          result.completed ? `Exit: ${result.exitCode ?? "unknown"}` : "Use terminal action=read to follow output.",
          result.output ? `\n## Output\n\n${result.output}` : ""
        ].filter(Boolean).join("\n"), {
          workspace_id: workspace.id,
          root: workspace.root,
          environment: localEnvironmentSummary(environment),
          action: action.name,
          ...result
        });
      }

      const result = await runLocalEnvironmentCommand(config, environment, {
        kind: args.action,
        cwd: workspace.root,
        sourceWorkspacePath: paths.sourceWorkspacePath,
        worktreePath: paths.worktreePath,
        timeoutMs: args.timeout_ms
      });
      return textResult([
        `# Local Environment ${args.action === "setup" ? "Setup" : "Cleanup"}`,
        "",
        `Environment: ${environment.name}`,
        `Exit: ${result.exitCode ?? "unknown"}`,
        `Duration: ${result.durationMs} ms`,
        result.stdout ? `\n## Output\n\n${result.stdout}` : ""
      ].filter(Boolean).join("\n"), {
        workspace_id: workspace.id,
        root: workspace.root,
        ...result
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "worktree",
    {
      title: "Managed Worktree",
      description: "List, create, hand off to/from, or remove CodexFlow-managed Git worktrees in the selected local or approved SSH project. Create and handoff preserve this private chat route while changing its checkout. Removal saves dirty-state snapshots before cleanup.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from the active local project or managed worktree."),
        action: z.enum(["list", "create", "handoff", "remove"]),
        worktree_id: z.string().optional().describe("Managed worktree id for handoff or remove."),
        destination: z.enum(["worktree", "local"]).optional().describe("Handoff destination."),
        base_ref: z.string().optional().describe("Commit-ish used to create a detached worktree. Default: HEAD."),
        include_changes: z.boolean().optional().describe("Copy current tracked and untracked project changes into a new worktree. Default: true."),
        environment_config_path: z.string().optional().describe("Selected .codex/environments TOML path, environment name, or filename. When omitted, use this route's selected environment if any."),
        setup_timeout_ms: z.number().int().min(1000).max(600000).optional().describe("Project environment setup or cleanup timeout. Default: 600000."),
        transfer_changes: z.boolean().optional().describe("Apply current tracked and untracked project changes to the handoff destination. Default: true.")
      },
      annotations: LOCAL_WRITE_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Managing worktree...",
        "openai/toolInvocation/invoked": "Worktree action complete"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const routeId = invocationRouteId();
      if (target.kind === "remote") {
        if (!routeId) throw new CodexFlowError("Remote worktree management requires the private route_id returned by list_projects or select_project.");
        if (args.action === "list") {
          const items = await listRemoteManagedWorktrees(config, target.project);
          const rows = items.length
            ? items.map((item) => `- ${item.id}  ${item.available === false ? "unavailable" : `${item.branch || "detached"}  ${item.dirty ? "dirty" : "clean"}`}  ${item.projectRoot}`).join("\n")
            : "- No remote managed worktrees.";
          return textResult(`# Remote Managed Worktrees\n\n${rows}`, {
            workspace_id: workspace.id, root: workspace.root, location: "remote", host_alias: target.project.hostAlias,
            worktrees: items, count: items.length
          });
        }
        if (args.action === "create") {
          const environmentSelector = args.environment_config_path ?? routeStore.get(routeId)?.environmentConfigPath;
          const created = await createRemoteManagedWorktree(config, target.project, { baseRef: args.base_ref, includeChanges: args.include_changes });
          persistentTerminals.stop(routeId);
          routeStore.bindRemote(routeId, created.project);
          let setup: unknown = null;
          try {
            if (environmentSelector) {
              const selector = path.posix.isAbsolute(environmentSelector) ? path.posix.basename(environmentSelector) : environmentSelector;
              const { environment, platform } = await resolveRemoteEnvironment(config, created.project, selector);
              const command = environmentScriptForPlatform(environment, "setup", platform);
              routeStore.selectEnvironment(routeId, environment.configPath);
              if (command) {
                const result = await persistentTerminals.runRemote(config, routeId, created.project,
                  environmentTerminalCommand(command, target.project.root, created.project.root), {
                  timeoutMs: args.setup_timeout_ms ?? 600_000, bashSessionId: undefined, trustedProjectCommand: true
                  });
                if (!result.completed || result.exitCode !== 0) throw new CodexFlowError(`Remote environment setup failed with exit ${result.exitCode ?? "unknown"}.`);
                setup = result;
              }
            }
          } catch (error) {
            persistentTerminals.stop(routeId);
            try { await removeRemoteManagedWorktree(config, created.project, created.worktree.id); } catch { /* preserve setup error */ }
            routeStore.bindRemote(routeId, target.project);
            if (environmentSelector) {
              const selector = path.posix.isAbsolute(environmentSelector) ? path.posix.basename(environmentSelector) : environmentSelector;
              try {
                const { environment } = await resolveRemoteEnvironment(config, target.project, selector);
                routeStore.selectEnvironment(routeId, environment.configPath);
              } catch { routeStore.selectEnvironment(routeId, undefined); }
            }
            throw error;
          }
          return textResult([
            "# Remote Worktree Created", "", `ID: ${created.worktree.id}`, `Project: ${created.project.root}`,
            `Base: ${created.worktree.baseRef}`, `Tracked changes applied: ${created.patchApplied}`,
            `Untracked files copied: ${created.untrackedCopied}`, environmentSelector ? "Environment: setup complete" : "Environment: none",
            "This private chat route now uses the remote managed worktree."
          ].join("\n"), {
            workspace_id: created.project.id, root: created.project.root, location: "remote", host_alias: created.project.hostAlias,
            worktree: created.worktree, patch_applied: created.patchApplied, untracked_copied: created.untrackedCopied,
            setup, route_switched: true
          });
        }
        if (args.action === "handoff") {
          if (!args.worktree_id || !args.destination) throw new CodexFlowError("worktree_id and destination are required for handoff.");
          const environmentSelector = routeStore.get(routeId)?.environmentConfigPath;
          persistentTerminals.stop(routeId);
          const handed = await handoffRemoteManagedWorktree(config, target.project, {
            worktreeId: args.worktree_id, destination: args.destination, transferChanges: args.transfer_changes
          });
          routeStore.bindRemote(routeId, handed.project);
          if (environmentSelector) {
            const selector = path.posix.isAbsolute(environmentSelector) ? path.posix.basename(environmentSelector) : environmentSelector;
            try {
              const { environment } = await resolveRemoteEnvironment(config, handed.project, selector);
              routeStore.selectEnvironment(routeId, environment.configPath);
            } catch { routeStore.selectEnvironment(routeId, undefined); }
          }
          return textResult([
            "# Remote Worktree Handoff", "", `Destination: ${args.destination}`, `Project: ${handed.project.root}`,
            `Tracked changes applied: ${handed.patchApplied}`, `Untracked files copied: ${handed.untrackedCopied}`,
            "This private chat route now uses the remote destination checkout."
          ].join("\n"), {
            workspace_id: handed.project.id, root: handed.project.root, location: "remote", host_alias: handed.project.hostAlias,
            worktree: handed.worktree, destination: args.destination, patch_applied: handed.patchApplied,
            untracked_copied: handed.untrackedCopied, route_switched: true
          });
        }
        if (args.action === "remove") {
          if (!args.worktree_id) throw new CodexFlowError("worktree_id is required for remove.");
          const environmentSelector = routeStore.get(routeId)?.environmentConfigPath;
          let cleanup: unknown = null;
          if (environmentSelector) {
            const worktree = (await listRemoteManagedWorktrees(config, target.project)).find((item) => item.id === args.worktree_id);
            if (!worktree) throw new CodexFlowError("Remote managed worktree not found for this project.");
            const worktreeProject = getApprovedRemoteProject(worktree.worktreeProjectId);
            const selector = path.posix.isAbsolute(environmentSelector) ? path.posix.basename(environmentSelector) : environmentSelector;
            const { environment, platform } = await resolveRemoteEnvironment(config, worktreeProject, selector);
            const command = environmentScriptForPlatform(environment, "cleanup", platform);
            if (command) {
              const result = await persistentTerminals.runRemote(config, routeId, worktreeProject,
                environmentTerminalCommand(command, getApprovedRemoteProject(worktree.sourceProjectId).root, worktreeProject.root), {
                timeoutMs: args.setup_timeout_ms ?? 600_000, bashSessionId: undefined, trustedProjectCommand: true
                });
              if (!result.completed || result.exitCode !== 0) throw new CodexFlowError(`Remote environment cleanup failed with exit ${result.exitCode ?? "unknown"}.`);
              cleanup = result;
            }
          }
          persistentTerminals.stop(routeId);
          const removed = await removeRemoteManagedWorktree(config, target.project, args.worktree_id);
          routeStore.bindRemote(routeId, removed.project);
          if (environmentSelector) {
            const selector = path.posix.isAbsolute(environmentSelector) ? path.posix.basename(environmentSelector) : environmentSelector;
            try {
              const { environment } = await resolveRemoteEnvironment(config, removed.project, selector);
              routeStore.selectEnvironment(routeId, environment.configPath);
            } catch { routeStore.selectEnvironment(routeId, undefined); }
          }
          return textResult([
            "# Remote Worktree Removed", "", `ID: ${removed.worktreeId}`,
            removed.snapshotPath ? `Remote snapshot: ${removed.snapshotPath}` : "Remote snapshot: no changes",
            `Project: ${removed.project.root}`, "This private chat route now uses the remote source checkout."
          ].join("\n"), {
            workspace_id: removed.project.id, root: removed.project.root, location: "remote", host_alias: removed.project.hostAlias,
            worktree_id: removed.worktreeId, snapshot_path: removed.snapshotPath ?? null, cleanup, removed: true, route_switched: true
          });
        }
        throw new CodexFlowError(`Unsupported remote worktree action: ${String(args.action)}`);
      }

      if (args.action === "list") {
        const items = listManagedWorktrees(config, workspace);
        const rows = items.length
          ? items.map((item) => `- ${item.id}  ${item.branch || "detached"}  ${item.dirty ? "dirty" : "clean"}  ${item.projectRoot}`).join("\n")
          : "- No managed worktrees.";
        return textResult(`# Managed Worktrees\n\n${rows}`, {
          workspace_id: workspace.id,
          root: workspace.root,
          worktrees: items,
          count: items.length
        });
      }
      if (args.action === "create") {
        const environmentSelector = args.environment_config_path ?? (routeId ? routeStore.get(routeId)?.environmentConfigPath : undefined);
        const environment = environmentSelector ? resolveLocalEnvironment(config, workspace, environmentSelector) : undefined;
        const created = await createManagedWorktree(config, workspace, {
          baseRef: args.base_ref,
          includeChanges: args.include_changes,
          environment,
          setupTimeoutMs: args.setup_timeout_ms
        });
        const destination = workspaces.openWorkspace(created.worktree.projectRoot);
        if (routeId && environment) routeStore.selectEnvironment(routeId, environment.configPath);
        return textResult([
          "# Worktree Created",
          "",
          `ID: ${created.worktree.id}`,
          `Project: ${destination.root}`,
          `Base: ${created.worktree.baseRef}`,
          `Tracked changes applied: ${created.patchApplied}`,
          `Untracked files copied: ${created.untrackedCopied}`,
          `Ignored setup files copied: ${created.ignoredFilesCopied}`,
          environment ? `Environment: ${environment.name} (setup complete)` : "Environment: none",
          "This private chat route now uses the managed worktree."
        ].join("\n"), {
          workspace_id: destination.id,
          root: destination.root,
          worktree: created.worktree,
          patch_applied: created.patchApplied,
          untracked_copied: created.untrackedCopied,
          ignored_files_copied: created.ignoredFilesCopied,
          setup: created.setup ?? null,
          route_switched: true
        });
      }
      if (args.action === "handoff") {
        if (!args.worktree_id || !args.destination) throw new CodexFlowError("worktree_id and destination are required for handoff.");
        const handed = handoffManagedWorktree(config, workspace, {
          worktreeId: args.worktree_id,
          destination: args.destination,
          transferChanges: args.transfer_changes
        });
        const destination = workspaces.openWorkspace(handed.destinationRoot);
        return textResult([
          "# Worktree Handoff",
          "",
          `Destination: ${args.destination}`,
          `Project: ${destination.root}`,
          `Tracked changes applied: ${handed.patchApplied}`,
          `Untracked files copied: ${handed.untrackedCopied}`,
          "This private chat route now uses the destination checkout."
        ].join("\n"), {
          workspace_id: destination.id,
          root: destination.root,
          worktree: handed.worktree,
          destination: args.destination,
          patch_applied: handed.patchApplied,
          untracked_copied: handed.untrackedCopied,
          route_switched: true
        });
      }
      if (args.action === "remove") {
        if (!args.worktree_id) throw new CodexFlowError("worktree_id is required for remove.");
        const removed = await removeManagedWorktree(config, workspace, args.worktree_id);
        const destination = workspaces.openWorkspace(removed.localRoot);
        return textResult([
          "# Worktree Removed",
          "",
          `ID: ${removed.worktreeId}`,
          removed.snapshotPath ? `Snapshot: ${removed.snapshotPath}` : "Snapshot: no tracked changes",
          `Project: ${destination.root}`,
          "This private chat route now uses the local checkout."
        ].join("\n"), {
          workspace_id: destination.id,
          root: destination.root,
          worktree_id: removed.worktreeId,
          snapshot_path: removed.snapshotPath ?? null,
          removed: true,
          route_switched: true
        });
      }
      throw new CodexFlowError(`Unsupported worktree action: ${String(args.action)}`);
    }
  );

  registerCodexTool(
    config,
    server,
    "show_changes",
    {
      title: "Show Changes",
      description: "Summarize the current workspace changes in one review-oriented result with git status, diff stats, and optional diff. Use this instead of bash git status, bash git diff, git_status, or git_diff when reviewing work.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        path: z.string().optional().describe("Optional file path relative to workspace root."),
        staged: z.boolean().optional().describe("Show staged diff. Default: false."),
        include_diff: z.boolean().optional().describe("Include the unified diff. Default: true."),
        since: z.enum(["last_shown", "workspace"]).optional().describe("Use last_shown to suppress unchanged repeated reviews. Default: last_shown."),
        mark_reviewed: z.boolean().optional().describe("Update the last-shown review checkpoint after this call. Default: true.")
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Summarizing workspace changes...",
        "openai/toolInvocation/invoked": "Workspace changes summarized"
      }
    },
    async (args) => {
      const target = projectTarget(args.workspace_id);
      const workspace = target.workspace;
      const scopedPath = typeof args.path === "string" ? args.path : undefined;
      const staged = parseBool(args.staged, false);
      const normalizedScopedPath = scopedPath?.trim()
        ? target.kind === "remote" ? scopedPath.trim() : guard.resolve(workspace, scopedPath).relPath
        : undefined;
      const status = normalizeGitOutput(target.kind === "remote"
        ? (await runRemoteWorkspaceOperation<{ text: string }>(target.project.hostAlias, config, {
            action: "git_status",
            root: target.project.root,
            path: normalizedScopedPath,
            staged
          })).text
        : gitDiffStatus(config, guard, workspace, normalizedScopedPath, staged));
      const includeDiff = parseBool(args.include_diff, true);
      const rawDiff = normalizeGitOutput(target.kind === "remote"
        ? (await runRemoteWorkspaceOperation<{ text: string }>(target.project.hostAlias, config, {
            action: "git_diff",
            root: target.project.root,
            path: normalizedScopedPath,
            staged
          })).text
        : gitDiff(config, guard, workspace, normalizedScopedPath, staged));
      const statusError = looksLikeGitError(status) ? status : "";
      const diffError = rawDiff && looksLikeGitError(rawDiff) ? rawDiff : "";
      const diff = diffError ? "" : rawDiff;
      const stats = diffStats(diff);
      const changedFiles = statusError ? [] : changedStatusLines(status);
      const untrackedFingerprint = statusError || target.kind === "remote" ? "" : await untrackedReviewFingerprint(config, guard, workspace, changedFiles);
      const since = args.since === "workspace" ? "workspace" : "last_shown";
      const markReviewed = parseBool(args.mark_reviewed, true);
      const checkpointKey = reviewCheckpointKey(workspace, { path: normalizedScopedPath, staged });
      const fingerprint = reviewFingerprint(status, `${diff}\0${untrackedFingerprint}`);
      const checkpointHit = includeDiff && since === "last_shown" && reviewCheckpoints.get(checkpointKey) === fingerprint;
      const checkpointWritten = markReviewed && includeDiff;
      if (checkpointWritten) reviewCheckpoints.set(checkpointKey, fingerprint);
      const responseDiff = checkpointHit ? "" : includeDiff ? diff : "";
      const responseStats = checkpointHit ? { additions: 0, deletions: 0, changed: false } : stats;
      const changedPaths = statusError ? [] : changedPathsFromStatus(changedFiles);
      let analysis: Record<string, unknown> | undefined;
      if (target.kind === "local" && config.analysisEnabled && changedPaths.length && !checkpointHit) {
        try {
          const impact = await reviewWorkspaceChanges(config, guard, workspace, { changedPaths });
          analysis = {
            schema_version: impact.schemaVersion,
            changed_paths: impact.changedPaths,
            affected_areas: impact.affectedAreas,
            dependent_files: impact.dependentFiles,
            related_tests: impact.relatedTests,
            risk_signals: impact.riskSignals,
            recommended_commands: impact.recommendedCommands,
            coverage: impact.coverage,
            warnings: impact.warnings,
            cache: impact.cache
          };
        } catch (error) {
          analysis = {
            schema_version: 1,
            changed_paths: changedPaths,
            affected_areas: [],
            dependent_files: [],
            related_tests: [],
            risk_signals: [],
            recommended_commands: [],
            warnings: [`Change analysis unavailable: ${errorText(error)}`]
          };
        }
      }
      const changedText = statusError
        ? `- Git status unavailable: ${statusError}`
        : checkpointHit
          ? "- No changes since last shown review."
          : changedFiles.length
          ? changedFiles.map((line) => `- ${line}`).join("\n")
          : "- No changed files.";
      const diffText = checkpointHit
        ? "\n\nNo new diff since last shown review."
        : includeDiff
        ? diffError
          ? `\n\nGit diff unavailable: ${diffError}`
          : diff
          ? diffBlock(diff)
            : "\n\nNo diff output."
        : "\n\nDiff omitted by request.";
      const analysisText = analysis
        ? `\n\n## Analysis\n\nAffected areas: ${(analysis.affected_areas as string[]).join(", ") || "none"}\nRisks: ${((analysis.risk_signals as Array<{ label?: string }>) ?? []).map((risk) => risk.label).filter(Boolean).join(", ") || "none"}\nRelated tests: ${((analysis.related_tests as Array<{ path?: string }>) ?? []).map((file) => file.path).filter(Boolean).join(", ") || "none"}`
        : "";
      const text = `# Show Changes\n\nWorkspace: ${workspace.root}\n\n## Changed\n\n${changedText}\n\n## Diff stats\n\n+${responseStats.additions} -${responseStats.deletions}${diffText}${analysisText}`;
      return textResult(text, {
        workspace_id: workspace.id,
        root: workspace.root,
        path: args.path ?? "workspace changes",
        status,
        status_error: statusError || undefined,
        diff_error: diffError || undefined,
        changed_files: checkpointHit ? [] : changedFiles,
        staged,
        include_diff: includeDiff,
        additions: responseStats.additions,
        deletions: responseStats.deletions,
        changed: !statusError && (checkpointHit ? false : changedFiles.length > 0 || responseStats.changed),
        diff: responseDiff,
        review_since: since,
        review_marked: checkpointWritten,
        review_checkpoint_hit: checkpointHit,
        ...(analysis ? { analysis } : {})
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "read_handoff",
    {
      title: "Read Handoff",
      description: "Read the shared .ai-bridge planning files used for ChatGPT-to-agent coordination.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace.")
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Reading agent handoff context...",
        "openai/toolInvocation/invoked": "Agent handoff context ready"
      }
    },
    async (args) => {
      const workspace = workspaces.getWorkspace(args.workspace_id);
      const context = await readAiBridgeContext(config, guard, workspace);
      return textResult(context.text, {
        workspace_id: workspace.id,
        root: workspace.root,
        files: context.files,
        file_count: context.files.length,
        preview: previewText(context.text)
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "wait_for_handoff",
    {
      title: "Wait For Handoff",
      description:
        "Read-only long-poll of the local handoff run state so ChatGPT can stay the planner/reviewer while a local executor runs. Reads .ai-bridge/handoff-run-state.json and returns the run status plus status/diff/log/test excerpts. It never starts processes or runs shell commands; it only observes local handoff state written by execute-handoff/watch-handoff/loop-handoff.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        plan_hash: z.string().optional().describe("Expected current-plan.md hash. If set, only a terminal run with this plan_hash counts as completed."),
        since_iteration: z.number().int().min(0).optional().describe("Only treat a run with iteration greater than this as the awaited completion."),
        max_wait_seconds: z.number().int().min(1).max(60).optional().describe("Maximum seconds to long-poll before returning the current state. Default: 20."),
        poll_ms: z.number().int().min(250).max(5000).optional().describe("Poll interval in milliseconds. Default: 1000."),
        include_diff: z.boolean().optional().describe("Include the implementation diff excerpt when completed. Default: true."),
        include_log_excerpt: z.boolean().optional().describe("Include the tail of execution-log.jsonl when completed. Default: true."),
        include_tests: z.boolean().optional().describe("Include the loop-tests.txt excerpt when completed. Default: true.")
      },
      annotations: { ...READ_ONLY_ANNOTATIONS, idempotentHint: false },
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Waiting for local handoff result...",
        "openai/toolInvocation/invoked": "Local handoff state ready"
      }
    },
    async (args) => {
      const workspace = workspaces.getWorkspace(args.workspace_id);
      const maxWaitSeconds = limitInt(args.max_wait_seconds, 20, 1, 60);
      const pollMs = limitInt(args.poll_ms, 1000, 250, 5000);
      const includeDiff = parseBool(args.include_diff, true);
      const includeLog = parseBool(args.include_log_excerpt, true);
      const includeTests = parseBool(args.include_tests, true);
      const expectedPlanHash =
        typeof args.plan_hash === "string" && args.plan_hash.trim() ? args.plan_hash.trim() : undefined;
      const sinceIteration =
        Number.isFinite(Number(args.since_iteration)) && args.since_iteration !== undefined
          ? Math.floor(Number(args.since_iteration))
          : undefined;

      const stateRel = `${config.contextDir}/handoff-run-state.json`;
      const contextPrefix = `${config.contextDir.replace(/\/+$/, "")}/`;
      const terminalStates = new Set(["completed", "failed", "timed_out"]);

      const readState = async (): Promise<Record<string, any> | undefined> => {
        try {
          const raw = await readRawTextFileBounded(config, guard, workspace, stateRel);
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
        } catch {
          return undefined;
        }
      };

      const isAwaited = (state: Record<string, any> | undefined): boolean =>
        Boolean(
          state &&
            terminalStates.has(state.state) &&
            (!expectedPlanHash || state.plan_hash === expectedPlanHash) &&
            (sinceIteration === undefined || (typeof state.iteration === "number" && state.iteration > sinceIteration))
        );

      const deadline = Date.now() + maxWaitSeconds * 1000;
      let state = await readState();
      while (Date.now() < deadline && !isAwaited(state)) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
        state = await readState();
      }

      const awaitedTerminal = isAwaited(state);
      const awaitedCompleted = awaitedTerminal && state?.state === "completed";
      const planHashMismatch = Boolean(expectedPlanHash && state && state.plan_hash !== expectedPlanHash);
      const reportedState = awaitedTerminal
        ? String(state?.state)
        : state
          ? state.state === "running" || planHashMismatch || sinceIteration !== undefined
            ? "running"
            : String(state.state)
          : "unknown";

      const excerpt = async (rel: string, maxChars: number, tailLines?: number): Promise<string | undefined> => {
        try {
          const raw = await readRawTextFileBounded(config, guard, workspace, rel);
          const body = tailLines
            ? raw.split(/\r?\n/).filter(Boolean).slice(-tailLines).join("\n")
            : raw;
          const trimmed = body.length > maxChars ? `${body.slice(0, maxChars)}\n...[excerpt truncated]` : body;
          return redactSensitiveText(trimmed);
        } catch {
          return undefined;
        }
      };
      const bridgeArtifact = (value: unknown, fallback: string): string => {
        const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
        const normalized = path.posix.normalize(raw.split(path.sep).join("/")).replace(/^\.\//, "");
        return normalized.startsWith(contextPrefix) ? normalized : fallback;
      };

      const structured: Record<string, unknown> = {
        workspace_id: workspace.id,
        root: workspace.root,
        state: reportedState,
        awaited_completed: awaitedCompleted,
        awaited_terminal: awaitedTerminal,
        succeeded: awaitedCompleted,
        state_file: stateRel,
        ...(state ? { run_state: state.state } : {}),
        ...(typeof state?.iteration === "number" ? { iteration: state.iteration } : {}),
        ...(state?.plan_hash ? { plan_hash: state.plan_hash } : {}),
        ...(expectedPlanHash ? { expected_plan_hash: expectedPlanHash, plan_hash_mismatch: planHashMismatch } : {}),
        ...(state && "exit_code" in state ? { exit_code: state.exit_code } : {}),
        ...(state && "timed_out" in state ? { timed_out: state.timed_out } : {}),
        ...(state?.started_at ? { started_at: state.started_at } : {}),
        ...(state?.finished_at ? { finished_at: state.finished_at } : {}),
        ...(state?.executor ? { executor: state.executor } : {}),
        ...(state?.model ? { model: state.model } : {}),
        ...(awaitedTerminal ? {} : { next_poll_after_seconds: Math.max(1, Math.ceil(pollMs / 1000)) })
      };

      if (awaitedTerminal) {
        const statusFile = bridgeArtifact(state?.status_file, `${config.contextDir}/agent-status.md`);
        const diffFile = bridgeArtifact(state?.diff_file, `${config.contextDir}/implementation-diff.patch`);
        const logFile = bridgeArtifact(state?.log_file, `${config.contextDir}/execution-log.jsonl`);
        const testsFile = bridgeArtifact(state?.tests_file, `${config.contextDir}/loop-tests.txt`);
        structured.status_file = statusFile;
        structured.diff_file = diffFile;
        structured.log_file = logFile;
        const status = await excerpt(statusFile, 6_000);
        if (status) structured.status_excerpt = status;
        if (includeDiff) {
          const diff = await excerpt(diffFile, 12_000);
          if (diff) structured.diff_excerpt = diff;
        }
        if (includeLog) {
          const log = await excerpt(logFile, 6_000, 20);
          if (log) structured.log_excerpt = log;
        }
        if (includeTests) {
          const tests = await excerpt(testsFile, 4_000);
          if (tests) {
            structured.tests_file = testsFile;
            structured.tests_excerpt = tests;
          }
        }
      }

      const summary = !state
        ? `No handoff run state found at ${stateRel}. Start a run with handoff_to_agent + local execute-handoff/watch-handoff, then call wait_for_handoff again.`
        : awaitedTerminal
          ? `Handoff run ${state.state} (iteration ${state.iteration ?? 1}, exit ${state.exit_code ?? "null"}).`
          : planHashMismatch
            ? `Executor has not completed the expected plan yet (last known run plan_hash=${state.plan_hash ?? "unknown"}). Still waiting.`
            : `Handoff run is ${state.state}. Re-poll after ~${Math.max(1, Math.ceil(pollMs / 1000))}s.`;

      const lines = [
        "# Wait For Handoff",
        "",
        summary,
        "",
        `State file: ${stateRel}`,
        ...(state?.plan_hash ? [`Plan hash: ${state.plan_hash}`] : []),
        ...(awaitedTerminal && structured.status_excerpt ? ["", "## Status", "", `\`\`\`text\n${structured.status_excerpt}\n\`\`\``] : []),
        ...(awaitedTerminal && structured.diff_excerpt ? ["", "## Diff", "", `\`\`\`diff\n${structured.diff_excerpt}\n\`\`\``] : []),
        ...(awaitedTerminal && structured.tests_excerpt ? ["", "## Tests", "", `\`\`\`text\n${structured.tests_excerpt}\n\`\`\``] : []),
        ...(awaitedTerminal && structured.log_excerpt ? ["", "## Log tail", "", `\`\`\`text\n${structured.log_excerpt}\n\`\`\``] : [])
      ];
      return textResult(lines.join("\n"), structured);
    }
  );

  registerCodexTool(
    config,
    server,
    "codex_context",
    {
      title: "Codex Context",
      description:
        "Load Codex-style workspace context in one call: AGENTS instructions for a target path, .ai-bridge handoff files, and optional git status/diff.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        target_path: z.string().optional().describe("Workspace-relative file or directory whose AGENTS instruction chain should be loaded. Default: ."),
        include_ai_bridge: z.boolean().optional().describe("Include .ai-bridge plan, agent status, diff, decisions, questions, and execution log. Default: true."),
        include_git: z.boolean().optional().describe("Include git status. Default: true."),
        include_diff: z.boolean().optional().describe("Include full git diff. Default: false for speed/noise."),
        max_agent_bytes: z.number().int().min(1000).max(200000).optional().describe("Maximum bytes per AGENTS file. Default: 60000.")
      },
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Loading Codex context...",
        "openai/toolInvocation/invoked": "Codex context ready"
      }
    },
    async (args) => {
      const workspace = workspaces.getWorkspace(args.workspace_id);
      const context = await readCodexContext(config, guard, workspace, {
        targetPath: args.target_path,
        includeAiBridge: args.include_ai_bridge,
        includeGit: args.include_git,
        includeDiff: parseBool(args.include_diff, false),
        maxAgentBytes: args.max_agent_bytes
      });
      return textResult(context.text, {
        workspace_id: context.workspaceId,
        root: context.root,
        target_path: context.targetPath,
        agents_files: context.agentsFiles,
        ai_context_files: context.aiContextFiles,
        included_git_status: context.gitStatus !== undefined,
        included_git_diff: context.gitDiff !== undefined,
        preview: previewText(context.text)
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "export_pro_context",
    {
      title: "Export Pro Context",
      description:
        "Create .ai-bridge/pro-context.md with repo tree, git state, selected files, and handoff context for high-context ChatGPT planning without live MCP tool calls.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        title: z.string().optional().describe("Markdown title for the context bundle."),
        selected_paths: z.array(z.string()).optional().describe("Specific workspace-relative files to include."),
        extra_globs: z.array(z.string()).optional().describe("Additional workspace-relative glob patterns to include, for example src/**/*.ts."),
        include_important_files: z.boolean().optional().describe("Auto-include important root config/docs such as AGENTS.md, README.md, and package.json. Default: true."),
        include_changed_files: z.boolean().optional().describe("Auto-include currently changed files from git status. Default: true."),
        include_diff: z.boolean().optional().describe("Include the current git diff. Default: true."),
        include_ai_bridge: z.boolean().optional().describe("Include existing .ai-bridge planning files. Default: true."),
        max_depth: z.number().int().min(1).max(6).optional().describe("Repository tree depth. Default: 3."),
        max_files: z.number().int().min(1).max(80).optional().describe("Maximum file contents to include. Default: 24."),
        max_file_bytes: z.number().int().min(1000).max(250000).optional().describe("Maximum bytes per included file. Default: 60000."),
        max_total_bytes: z.number().int().min(20000).max(2000000).optional().describe("Maximum bytes in the generated bundle.")
      },
      annotations: HANDOFF_WRITE_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Exporting Pro context...",
        "openai/toolInvocation/invoked": "Pro context exported"
      }
    },
    async (args) => {
      const workspace = workspaces.getWorkspace(args.workspace_id);
      const result = await exportProContext(config, guard, workspace, {
        title: args.title,
        selectedPaths: args.selected_paths,
        extraGlobs: args.extra_globs,
        includeImportantFiles: args.include_important_files,
        includeChangedFiles: args.include_changed_files,
        includeDiff: args.include_diff,
        includeAiBridge: args.include_ai_bridge,
        maxDepth: args.max_depth,
        maxFiles: args.max_files,
        maxFileBytes: args.max_file_bytes,
        maxTotalBytes: args.max_total_bytes
      });
      const text = `# Export Pro Context\n\nWrote ${result.path}.\nBytes: ${result.bytes}\nFiles included: ${result.filesIncluded.length}\nFiles skipped: ${result.filesSkipped.length}\nTruncated: ${result.truncated}\n\nPaste ${result.path} into a high-context planning model when MCP tools are unavailable, then save the returned plan with codexflow pro-apply.`;
      return textResult(text, {
        workspace_id: workspace.id,
        root: workspace.root,
        path: result.path,
        bytes: result.bytes,
        files_included: result.filesIncluded,
        files_skipped: result.filesSkipped,
        truncated: result.truncated
      });
    }
  );

  if (config.codexSessions !== "off") {
    registerCodexTool(
      config,
      server,
      "codex_sessions",
      {
        title: "Codex Sessions",
        description:
          "Opt-in, read-only local Codex session history browser. Lists metadata from the user's configured Codex session JSONL files without reading full transcripts.",
        inputSchema: {
          max_sessions: z.number().int().min(1).max(200).optional().describe("Maximum sessions to return. Default: 30."),
          query: z.string().optional().describe("Optional case-insensitive search over session id, title, cwd, and source path.")
        },
        annotations: READ_ONLY_ANNOTATIONS,
        _meta: {
          ...toolCardMeta(),
          "openai/toolInvocation/invoking": "Listing local Codex sessions...",
          "openai/toolInvocation/invoked": "Codex sessions ready"
        }
      },
      async (args) => {
        const result = await listCodexSessions(config, {
          maxSessions: args.max_sessions,
          query: args.query
        });
        const rows = result.sessions.length
          ? result.sessions.map((session) => `- ${session.session_id}  ${session.title || "(untitled)"}${session.project_dir ? `  cwd=${session.project_dir}` : ""}`).join("\n")
          : "- No Codex sessions found.";
        const text = `# Codex Sessions\n\nCodex dir: ${result.codex_dir}\nMode: ${config.codexSessions}\nTotal matched: ${result.total_found}\n\n${rows}`;
        return textResult(text, {
          codex_dir: result.codex_dir,
          roots: result.roots,
          sessions: result.sessions,
          total_found: result.total_found,
          codex_sessions_mode: config.codexSessions
        });
      }
    );

    if (config.codexSessions === "read") {
      registerCodexTool(
        config,
        server,
        "read_codex_session",
        {
          title: "Read Codex Session",
          description:
            "Opt-in, read-only local Codex transcript reader. Requires --codex-sessions read and returns a bounded transcript from a local Codex session JSONL file.",
          inputSchema: {
            session_id: z.string().optional().describe("Codex session id from codex_sessions."),
            source_path: z.string().optional().describe("Source path from codex_sessions. Must be inside the configured Codex session roots."),
            max_messages: z.number().int().min(1).max(400).optional().describe("Maximum transcript messages. Default: 80."),
            max_total_bytes: z.number().int().min(4000).max(400000).optional().describe("Maximum transcript content bytes. Default: 80000.")
          },
          annotations: READ_ONLY_ANNOTATIONS,
          _meta: {
            ...toolCardMeta(),
            "openai/toolInvocation/invoking": "Reading local Codex session...",
            "openai/toolInvocation/invoked": "Codex session read"
          }
        },
        async (args) => {
          const result = await readCodexSession(config, {
            sessionId: args.session_id,
            sourcePath: args.source_path,
            maxMessages: args.max_messages,
            maxTotalBytes: args.max_total_bytes
          });
          return textResult(result.text, {
            session: result.session,
            messages: result.messages,
            message_count: result.messages.length,
            truncated: result.truncated,
            codex_sessions_mode: config.codexSessions
          });
        }
      );
    }

  }

  registerCodexTool(
    config,
    server,
    "handoff_to_agent",
    {
      title: "Handoff To Agent",
      description:
        "Write .ai-bridge/current-plan.md for Codex, OpenCode, Pi, or another local implementation agent. This only creates handoff files; it does not execute local agent commands.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        agent: z.string().optional().describe("Target agent id, for example codex, opencode, pi, or custom. Default: custom."),
        agent_name: z.string().optional().describe("Human-readable agent name for custom agents."),
        model: z.string().optional().describe("Optional model identifier to include in the handoff plan."),
        title: z.string().optional().describe("Short task title."),
        plan: z.string().describe("Detailed implementation plan for the local agent."),
        append: z.boolean().optional().describe("Append to existing current-plan.md instead of overwriting. Default: false.")
      },
      annotations: HANDOFF_WRITE_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Writing agent handoff plan...",
        "openai/toolInvocation/invoked": "Agent handoff plan written"
      }
    },
    async (args) => {
      const workspace = workspaces.getWorkspace(args.workspace_id);
      const result = await writeAgentHandoff(config, guard, workspace, {
        agent: args.agent ?? "custom",
        agentName: args.agent_name,
        model: args.model,
        title: cleanOneLine(args.title, "Agent implementation plan"),
        plan: String(args.plan ?? ""),
        append: parseBool(args.append, false),
        eventName: "handoff_to_agent"
      });

      const text = `# Handoff To Agent

Agent: ${result.agentName} (${result.agent})
${result.model ? `Model: ${result.model}\n` : ""}Wrote ${result.planPath}.
Status path: ${result.statusPath}
Diff path: ${result.diffPath}
Execution log: ${result.executionLogPath}
Diff stats: +${result.writeResult.diff.additions} -${result.writeResult.diff.deletions}

Agent prompt:

\`\`\`text
${result.prompt}
\`\`\`${diffBlock(result.writeResult.diff.diff)}`;
      return textResult(text, {
        workspace_id: workspace.id,
        root: workspace.root,
        agent: result.agent,
        agent_name: result.agentName,
        model: result.model,
        plan_path: result.planPath,
        status_path: result.statusPath,
        diff_path: result.diffPath,
        log_path: result.logPath,
        execution_log_path: result.executionLogPath,
        additions: result.writeResult.diff.additions,
        deletions: result.writeResult.diff.deletions,
        diff: result.writeResult.diff.diff
      });
    }
  );

  registerCodexTool(
    config,
    server,
    "handoff_to_codex",
    {
      title: "Handoff To Codex",
      description: "Compatibility wrapper for handoff_to_agent with agent=codex.",
      inputSchema: {
        workspace_id: z.string().optional().describe("Workspace id from open_workspace. Omit to use default workspace."),
        title: z.string().optional().describe("Short task title."),
        plan: z.string().describe("Detailed implementation plan for Codex."),
        append: z.boolean().optional().describe("Append to existing current-plan.md instead of overwriting. Default: false.")
      },
      annotations: HANDOFF_WRITE_ANNOTATIONS,
      _meta: {
        ...toolCardMeta(),
        "openai/toolInvocation/invoking": "Writing Codex handoff plan...",
        "openai/toolInvocation/invoked": "Codex handoff plan written"
      }
    },
    async (args) => {
      const workspace = workspaces.getWorkspace(args.workspace_id);
      const result = await writeAgentHandoff(config, guard, workspace, {
        agent: "codex",
        title: cleanOneLine(args.title, "Codex implementation plan"),
        plan: String(args.plan ?? ""),
        append: parseBool(args.append, false),
        eventName: "handoff_to_codex"
      });
      const text = `# Handoff To Codex

Wrote ${result.planPath}.
Status path: ${result.statusPath}
Diff path: ${result.diffPath}
Diff stats: +${result.writeResult.diff.additions} -${result.writeResult.diff.deletions}

Codex prompt:

\`\`\`text
${result.prompt}
\`\`\`${diffBlock(result.writeResult.diff.diff)}`;
      return textResult(text, {
        workspace_id: workspace.id,
        root: workspace.root,
        agent: result.agent,
        agent_name: result.agentName,
        plan_path: result.planPath,
        status_path: result.statusPath,
        diff_path: result.diffPath,
        log_path: result.logPath,
        execution_log_path: result.executionLogPath,
        additions: result.writeResult.diff.additions,
        deletions: result.writeResult.diff.deletions,
        diff: result.writeResult.diff.diff
      });
    }
  );

  return server;
}
