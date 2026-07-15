export const TOOL_CARD_URI = "ui://widget/codexflow-tool-card-v11.html";
export const TOOL_CARD_LEGACY_URIS = [
  "ui://widget/codexflow-tool-card-v10.html",
  "ui://widget/codexflow-tool-card-v9.html",
  "ui://widget/codexflow-tool-card-v8.html"
];
export const TOOL_CARD_MIME_TYPE = "text/html;profile=mcp-app";

export const toolCardWidgetHtml = String.raw`
<meta charset="utf-8">
<div id="root" class="wrap">
  <article class="card pending">
    <div class="rail"></div>
    <header class="head">
      <span class="glyph">C</span>
      <div class="headline">
        <div class="title">CodexFlow</div>
        <div class="subtitle">Waiting for tool result...</div>
      </div>
      <span class="pill info">waiting</span>
    </header>
    <div class="skeleton">
      <span></span>
      <span></span>
      <span></span>
    </div>
  </article>
</div>

<style>
  :root {
    color-scheme: light dark;
    --panel: #ffffff;
    --panel-subtle: #f7f7f8;
    --panel-code: #f2f3f5;
    --text: #171719;
    --soft: #46464b;
    --muted: #707078;
    --quiet: #8c8c94;
    --line: rgba(23, 23, 25, 0.14);
    --line-strong: rgba(23, 23, 25, 0.24);
    --accent: #3276a3;
    --accent-soft: rgba(50, 118, 163, 0.08);
    --green: #287a4c;
    --red: #a5403b;
    --amber: #8b6222;
    --focus: #3276a3;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    color: var(--text);
    background: transparent;
    font: 13px/1.48 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0;
    -webkit-font-smoothing: antialiased;
  }

  button,
  input {
    color: inherit;
    font: inherit;
  }

  button { cursor: pointer; }
  button:disabled { cursor: wait; opacity: 0.58; }
  button:active:not(:disabled) { transform: translateY(1px); }
  [hidden] { display: none !important; }

  :focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .wrap { width: 100%; }

  .card {
    overflow: hidden;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
  }

  .rail { display: none; }

  .head {
    min-height: 58px;
    display: grid;
    grid-template-columns: 9px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 11px 13px;
    border-bottom: 1px solid var(--line);
  }

  .glyph {
    width: 8px;
    height: 8px;
    overflow: hidden;
    display: block;
    color: transparent;
    background: var(--accent);
    border-radius: 50%;
    font-size: 0;
  }

  .headline { min-width: 0; }

  .title {
    overflow: hidden;
    color: var(--text);
    font-size: 13px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subtitle {
    overflow: hidden;
    margin-top: 2px;
    color: var(--muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 5px;
  }

  .pill {
    min-height: 22px;
    max-width: 22ch;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    color: var(--muted);
    background: var(--panel-subtle);
    border: 1px solid var(--line);
    border-radius: 999px;
    font-size: 10px;
    font-weight: 560;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pill.good { color: var(--green); border-color: color-mix(in srgb, var(--green) 28%, transparent); }
  .pill.bad { color: var(--red); border-color: color-mix(in srgb, var(--red) 28%, transparent); }
  .pill.info { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 28%, transparent); }
  .pill.warn { color: var(--amber); border-color: color-mix(in srgb, var(--amber) 28%, transparent); }

  .body { padding: 12px; }

  .metrics,
  .summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
  }

  .metric,
  .summary-item {
    min-width: 0;
    padding: 9px 10px;
    background: var(--panel-subtle);
    border: 1px solid var(--line);
    border-radius: 9px;
  }

  .metric .label,
  .summary-label {
    display: block;
    margin-bottom: 4px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 590;
  }

  .metric .value {
    overflow: hidden;
    color: var(--soft);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary-value {
    color: var(--text);
    font-size: 15px;
    font-variant-numeric: tabular-nums;
    font-weight: 640;
  }

  .code {
    overflow: hidden;
    background: var(--panel-code);
    border: 1px solid var(--line);
    border-radius: 9px;
  }

  .codebar {
    min-height: 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 10px;
    color: var(--muted);
    background: var(--panel-subtle);
    border-bottom: 1px solid var(--line);
    font-size: 11px;
    font-weight: 570;
  }

  pre {
    margin: 0;
    padding: 10px;
    overflow: visible;
    color: var(--soft);
    font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .diff-line { display: block; min-height: 18px; padding: 0 4px; border-radius: 3px; }
  .diff-add { color: var(--green); background: color-mix(in srgb, var(--green) 8%, transparent); }
  .diff-del { color: var(--red); background: color-mix(in srgb, var(--red) 8%, transparent); }
  .diff-hunk { color: var(--accent); }
  .terminal pre { color: var(--soft); }
  .prompt { color: var(--accent); }

  .project-search {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    margin-bottom: 9px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 560;
  }

  .project-search input {
    min-height: 44px;
    width: 100%;
    padding: 0 11px;
    color: var(--text);
    background: var(--panel-subtle);
    border: 1px solid var(--line-strong);
    border-radius: 9px;
  }

  .project-search input::placeholder { color: var(--quiet); }
  .project-list { display: grid; gap: 6px; }

  .project-button {
    width: 100%;
    min-height: 52px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    color: var(--text);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 9px;
    text-align: left;
    transition: background-color 140ms ease, border-color 140ms ease;
  }

  .project-button:hover {
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent) 38%, transparent);
  }

  .project-button[aria-pressed="true"] {
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }

  .project-main { min-width: 0; }

  .project-name {
    display: block;
    overflow: hidden;
    font-weight: 640;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-path {
    display: block;
    overflow: hidden;
    margin-top: 2px;
    color: var(--muted);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-action {
    color: var(--accent);
    font-size: 10px;
    font-weight: 650;
    white-space: nowrap;
  }

  .file-list {
    display: grid;
    gap: 5px;
    margin-bottom: 10px;
  }

  .section-label {
    margin: 10px 1px 7px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .fold {
    margin-top: 8px;
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 9px;
  }

  .fold > summary {
    min-height: 44px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    color: var(--soft);
    cursor: pointer;
    font-weight: 590;
    list-style: none;
  }

  .fold > summary::-webkit-details-marker { display: none; }
  .fold > summary::after { content: "+"; color: var(--muted); }
  .fold[open] > summary::after { content: "−"; }
  .fold-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fold-count { color: var(--muted); font-size: 10px; font-weight: 560; }
  .fold > summary::after { grid-column: 3; }
  .fold-body { padding: 0 8px 8px; }

  .file-row {
    min-height: 36px;
    display: grid;
    grid-template-columns: 46px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--panel-subtle);
    border: 1px solid var(--line);
    border-radius: 8px;
  }

  .file-code {
    color: var(--accent);
    font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 640;
  }

  .file-name {
    overflow: hidden;
    color: var(--soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    padding: 10px;
    color: var(--muted);
    background: var(--panel-subtle);
    border: 1px solid var(--line);
    border-radius: 9px;
  }

  .search { display: grid; gap: 4px; }

  .hit {
    min-height: 34px;
    display: grid;
    grid-template-columns: minmax(120px, .34fr) minmax(0, 1fr);
    align-items: start;
    gap: 8px;
    padding: 7px 8px;
    border-radius: 7px;
  }

  .hit:nth-child(odd) { background: var(--panel-subtle); }

  .hit-file {
    overflow: hidden;
    color: var(--accent);
    font-weight: 620;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hit-text { color: var(--soft); overflow-wrap: anywhere; }
  .muted { color: var(--muted); }

  .skeleton {
    display: grid;
    gap: 7px;
    padding: 13px;
  }

  .skeleton span {
    height: 7px;
    max-width: 78%;
    background: var(--line);
    border-radius: 999px;
    animation: codexflow-pulse 1.3s ease-in-out infinite;
  }

  .skeleton span:nth-child(2) { max-width: 52%; animation-delay: .12s; }
  .skeleton span:nth-child(3) { max-width: 66%; animation-delay: .24s; }

  @keyframes codexflow-pulse {
    0%, 100% { opacity: .45; }
    50% { opacity: 1; }
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --panel: #202124;
      --panel-subtle: #27282c;
      --panel-code: #18191c;
      --text: #f2f2f3;
      --soft: #d1d1d4;
      --muted: #a3a3aa;
      --quiet: #85858c;
      --line: rgba(255, 255, 255, .12);
      --line-strong: rgba(255, 255, 255, .22);
      --accent: #86bfe4;
      --accent-soft: rgba(134, 191, 228, .10);
      --green: #7bd39d;
      --red: #ef948d;
      --amber: #e0bd77;
      --focus: #86bfe4;
    }
  }

  @media (max-width: 640px) {
    .head { grid-template-columns: 9px minmax(0, 1fr); }
    .meta { grid-column: 2; justify-content: flex-start; }
    .summary,
    .metrics,
    .hit { grid-template-columns: 1fr; }
    .project-search { grid-template-columns: 1fr; gap: 5px; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: .001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: .001ms !important;
    }
  }

  @media (forced-colors: active) {
    .glyph { border: 1px solid CanvasText; }
  }
</style>

<script>
  const root = document.getElementById("root");

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function truncate(value, max = 9000) {
    const text = String(value ?? "");
    return text.length > max ? text.slice(0, max) + "\n...[truncated in widget]" : text;
  }

  function countLines(value) {
    const text = String(value || "");
    if (!text) return 0;
    return text.replace(/\n$/, "").split("\n").length;
  }

  function previewLines(value, maxLines = 18) {
    const text = String(value || "").replace(/\n$/, "");
    if (!text) return "";
    const lines = text.split("\n");
    const shown = lines.slice(0, maxLines).join("\n");
    const remaining = lines.length - maxLines;
    return remaining > 0 ? shown + "\n...[" + remaining + " more lines]" : shown;
  }

  function basename(value) {
    const text = String(value || "");
    return text.split("/").filter(Boolean).pop() || text || ".";
  }

  function titleFor(tool) {
    const titles = {
      server_config: "Server config",
      codexflow_self_test: "Self-test",
      codexflow_inventory: "Inventory",
      list_projects: "Choose a project",
      select_project: "Project selected",
      load_skill: "Skill",
      list_workspaces: "Workspaces",
      open_current_workspace: "Workspace",
      open_workspace: "Workspace",
      workspace_snapshot: "Workspace snapshot",
      inspect_workspace: "Workspace analysis",
      tree: "File tree",
      write: "File write",
      edit: "Exact edit",
      apply_patch: "Patch",
      git_status: "Git Status",
      git_diff: "Git Diff",
      show_changes: "Change review",
      read_handoff: "Handoff context",
      codex_context: "Codex context",
      export_pro_context: "Pro context",
      handoff_to_agent: "Agent handoff",
      handoff_to_codex: "Codex handoff",
      bash: "Terminal",
      search: "Search",
      read: "Read file"
    };
    return titles[tool] || "CodexFlow";
  }

  function iconFor(tool) {
    if (tool === "server_config") return "S";
    if (tool === "codexflow_self_test") return "T";
    if (tool === "codexflow_inventory") return "I";
    if (tool === "list_projects" || tool === "select_project") return "P";
    if (tool === "load_skill") return "L";
    if (tool === "list_workspaces") return "W";
    if (tool === "open_current_workspace" || tool === "open_workspace") return "W";
    if (tool === "workspace_snapshot") return "W";
    if (tool === "inspect_workspace") return "I";
    if (tool === "tree") return "T";
    if (tool === "write") return "W";
    if (tool === "edit") return "E";
    if (tool === "apply_patch") return "P";
    if (tool === "git_status" || tool === "git_diff") return "G";
    if (tool === "show_changes") return "D";
    if (tool === "read_handoff") return "H";
    if (tool === "codex_context") return "C";
    if (tool === "export_pro_context") return "P";
    if (tool === "handoff_to_agent") return "A";
    if (tool === "handoff_to_codex") return "H";
    if (tool === "bash") return "$";
    if (tool === "search") return "S";
    if (tool === "read") return "R";
    return "C";
  }

  function subtitleFor(data) {
    if (data?.codexflow_tool === "open_current_workspace" || data?.codexflow_tool === "open_workspace") {
      return data?.root || "Workspace opened";
    }
    if (data?.codexflow_tool === "show_changes") {
      if (data?.status_error || data?.diff_error) return "Git state unavailable";
      const count = Array.isArray(data?.changed_files) ? data.changed_files.length : 0;
      if (!count && !data?.changed) return "Workspace is clean";
      return count === 1 ? "1 changed file" : count + " changed files";
    }
    if (data?.codexflow_tool === "codexflow_self_test") return data?.status ? "Status " + data.status : "Local diagnostic";
    if (data?.codexflow_tool === "codexflow_inventory") return (data?.skill_count ?? 0) + " skills, " + (data?.mcp_server_count ?? 0) + " MCP servers";
    if (data?.codexflow_tool === "list_projects") return (data?.count ?? 0) + " synchronized projects";
    if (data?.codexflow_tool === "select_project") return data?.root || "Chat routed to project";
    if (data?.codexflow_tool === "list_workspaces") return (data?.count ?? 0) + " open workspaces";
    if (data?.codexflow_tool === "server_config") {
      const session = data?.bashSessionId || data?.bash_session_id;
      return "tools " + (data?.toolMode || data?.tool_mode || "-") + ", bash " + (data?.bashMode || data?.bash_mode || "-") + (session ? ", session " + session : "");
    }
    if (data?.codexflow_tool === "workspace_snapshot") return data?.root || "Workspace snapshot";
    if (data?.codexflow_tool === "inspect_workspace") {
      const coverage = data?.coverage || {};
      return (coverage.analyzedFiles ?? coverage.analyzed_files ?? 0) + " files analyzed, " + (coverage.symbolCount ?? coverage.symbol_count ?? 0) + " symbols";
    }
    if (data?.codexflow_tool === "git_status") {
      const count = Array.isArray(data?.changed_files) ? data.changed_files.length : 0;
      return count ? count + " changed entries" : "Working tree clean";
    }
    if (data?.codexflow_tool === "codex_context") return (data?.agents_files?.length ?? 0) + " AGENTS, " + (data?.ai_context_files?.length ?? 0) + " bridge files";
    if (data?.codexflow_tool === "read_handoff") return (data?.file_count ?? 0) + " bridge files";
    if (data?.codexflow_tool === "load_skill" && data?.skill?.name) return data.skill.name;
    if (data?.codexflow_tool === "handoff_to_agent" && data?.agent_name) return data.agent_name;
    if (data?.path) return data.path;
    if (data?.plan_path) return data.plan_path;
    if (data?.root) return data.root;
    if (data?.cwd) return data.cwd;
    return "Tool output";
  }

  function pill(text, cls) {
    return '<span class="pill ' + esc(cls || "") + '">' + esc(text) + '</span>';
  }

  function header(data, pills) {
    const tool = data?.codexflow_tool;
    return [
      '<div class="rail"></div>',
      '<header class="head">',
      '<span class="glyph">' + esc(iconFor(tool)) + '</span>',
      '<div class="headline"><div class="title">' + esc(titleFor(tool)) + '</div><div class="subtitle">' + esc(subtitleFor(data)) + '</div></div>',
      '<div class="meta">' + (pills || '') + '</div>',
      '</header>'
    ].join('');
  }

  function metric(label, value) {
    return '<div class="metric"><span class="label">' + esc(label) + '</span><div class="value">' + esc(value ?? "-") + '</div></div>';
  }

  function summaryItem(label, value) {
    return '<div class="summary-item"><span class="summary-label">' + esc(label) + '</span><div class="summary-value">' + esc(value ?? "-") + '</div></div>';
  }

  function codebox(label, text, extraClass) {
    return '<div class="code ' + esc(extraClass || "") + '"><div class="codebar"><span>' + esc(label || "output") + '</span></div><pre>' + text + '</pre></div>';
  }

  function fold(title, count, body, open) {
    if (!body) return "";
    return '<details class="fold"' + (open ? " open" : "") + '><summary><span class="fold-title">' + esc(title) + '</span><span class="fold-count">' + esc(count || "") + '</span></summary><div class="fold-body">' + body + '</div></details>';
  }

  function shortSource(value) {
    if (value === "workspace") return "repo";
    if (value === "plugin") return "plug";
    if (value === "user") return "user";
    return "skill";
  }

  function renderDiff(diff) {
    return previewLines(truncate(diff, 9000), 32).split("\n").map((line) => {
      let cls = "diff-line";
      if (line.startsWith("+") && !line.startsWith("+++")) cls += " diff-add";
      else if (line.startsWith("-") && !line.startsWith("---")) cls += " diff-del";
      else if (line.startsWith("@@")) cls += " diff-hunk";
      return '<span class="' + cls + '">' + esc(line) + '</span>';
    }).join("");
  }

  function renderFile(data) {
    const pills = [
      data.bytes !== undefined ? pill(data.bytes + " bytes") : "",
      data.additions !== undefined ? pill("+" + data.additions, "good") : "",
      data.deletions !== undefined ? pill("-" + data.deletions, "bad") : "",
      data.replacements !== undefined ? pill(data.replacements + " replacements", "info") : ""
    ].join("");
    const body = data.diff ? renderDiff(data.diff) : esc(truncate(data.text || ""));
    return '<article class="card">' + header(data, pills) + '<div class="body">' +
      codebox(basename(data.path || data.plan_path || "file"), body, "") +
      '</div></article>';
  }

  function renderChanges(data) {
    const files = Array.isArray(data.changed_files) ? data.changed_files : [];
    const hasGitError = Boolean(data.status_error || data.diff_error);
    const changed = Boolean(data.changed);
    const pills = [
      hasGitError ? pill("git unavailable", "warn") : changed ? pill("changed", "info") : pill("clean", "good"),
      data.additions !== undefined ? pill("+" + data.additions, "good") : "",
      data.deletions !== undefined ? pill("-" + data.deletions, "bad") : ""
    ].join("");
    const fileRows = files.slice(0, 10).map((line) => {
      const status = String(line).slice(0, 2).trim() || "?";
      const name = String(line).slice(2).trim() || String(line);
      return '<div class="file-row"><span class="file-code">' + esc(status) + '</span><span class="file-name">' + esc(name) + '</span></div>';
    }).join("");
    const moreFiles = files.length > 10 ? '<div class="empty">+' + esc(files.length - 10) + ' more changed files</div>' : "";
    const state = hasGitError
      ? '<div class="empty">' + esc(data.status_error || data.diff_error) + '</div>'
      : fileRows
        ? '<div class="file-list">' + fileRows + '</div>' + moreFiles
        : '<div class="empty">No changed files.</div>';
    const diff = data.diff ? codebox("diff", renderDiff(data.diff), "") : "";
    return '<article class="card">' + header(data, pills) + '<div class="body">' +
      '<div class="summary">' +
      summaryItem("Files", files.length) +
      summaryItem("Added", "+" + (data.additions ?? 0)) +
      summaryItem("Deleted", "-" + (data.deletions ?? 0)) +
      '</div>' +
      state +
      diff +
      '</div></article>';
  }

  function compactRows(values, code, max = 8) {
    const items = Array.isArray(values) ? values : [];
    const rows = items.slice(0, max).map((value) => {
      const label = typeof value === "string" ? value : (value?.path || value?.label || value?.name || "item");
      const detail = typeof value === "object" && value ? (value?.reasons || []).join(", ") : "";
      return '<div class="file-row"><span class="file-code">' + esc(code) + '</span><span class="file-name">' + esc(label + (detail ? ": " + detail : "")) + '</span></div>';
    }).join("");
    const more = items.length > max ? '<div class="empty">+' + esc(items.length - max) + ' more</div>' : "";
    return '<div class="file-list">' + (rows || '<div class="empty">None.</div>') + more + '</div>';
  }

  function renderWorkspaceAnalysis(data) {
    const coverage = data.coverage || {};
    const languages = Array.isArray(data.languages) ? data.languages : [];
    const projects = Array.isArray(data.project_types) ? data.project_types : [];
    const entrypoints = Array.isArray(data.entrypoints) ? data.entrypoints : [];
    const areas = Array.isArray(data.areas) ? data.areas : [];
    const symbols = Array.isArray(data.symbols) ? data.symbols : [];
    const relationships = Array.isArray(data.relationships) ? data.relationships : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    const partial = Boolean(coverage.truncated || data.output_limited);
    const pills = [
      pill(projects.join(", ") || "project", "info"),
      pill(languages.length + " languages"),
      partial ? pill("limited", "warn") : pill("complete", "good")
    ].join("");
    const relationshipRows = relationships.slice(0, 8).map((edge) =>
      '<div class="file-row"><span class="file-code">' + esc(edge?.kind || "edge") + '</span><span class="file-name">' + esc((edge?.from || "?") + " → " + (edge?.to || "?")) + '</span></div>'
    ).join("");
    return '<article class="card">' + header(data, pills) + '<div class="body">' +
      '<div class="summary">' +
      summaryItem("Files", coverage.inventoryFiles ?? coverage.inventory_files ?? 0) +
      summaryItem("Analyzed", coverage.analyzedFiles ?? coverage.analyzed_files ?? 0) +
      summaryItem("Symbols", coverage.symbolCount ?? coverage.symbol_count ?? symbols.length) +
      '</div>' +
      '<div class="section-label">Entrypoints</div>' + compactRows(entrypoints, "entry") +
      fold("Areas", areas.length + " areas", compactRows(areas, "area"), false) +
      fold("Symbols", symbols.length + " symbols", compactRows(symbols, "sym"), false) +
      fold("Relationships", relationships.length + " edges", '<div class="file-list">' + (relationshipRows || '<div class="empty">None.</div>') + '</div>', false) +
      (warnings.length ? fold("Warnings", warnings.length + " warnings", compactRows(warnings, "warn"), false) : "") +
      '</div></article>';
  }

  function renderStructuredSearch(data) {
    const analysis = data.analysis || {};
    const groups = analysis.groups || {};
    const order = ["definitions", "references", "tests", "configuration", "documentation", "other"];
    const count = order.reduce((sum, name) => sum + (Array.isArray(groups[name]) ? groups[name].length : 0), 0);
    const sections = order.map((name) => {
      const matches = Array.isArray(groups[name]) ? groups[name] : [];
      if (!matches.length) return "";
      const rows = matches.slice(0, 8).map((match) =>
        '<div class="hit"><div class="hit-file">' + esc((match.path || "match") + ":" + (match.line || 0)) + '</div><div class="hit-text">' + esc((match.text || "") + (match.reasons?.length ? ": " + match.reasons.join(", ") : "")) + '</div></div>'
      ).join("");
      const more = matches.length > 8 ? '<div class="empty">+' + esc(matches.length - 8) + ' more</div>' : "";
      return fold(name, matches.length + " matches", '<div class="search">' + rows + more + '</div>', name === "definitions");
    }).join("");
    const coverage = analysis.coverage || {};
    const pills = [pill(count + " grouped matches", "info"), pill(analysis.intent || "structured"), coverage.truncated ? pill("partial", "warn") : ""].join("");
    return '<article class="card">' + header(data, pills) + '<div class="body">' +
      '<div class="summary">' + summaryItem("Definitions", groups.definitions?.length ?? 0) + summaryItem("References", groups.references?.length ?? 0) + summaryItem("Tests", groups.tests?.length ?? 0) + '</div>' +
      (sections || '<div class="empty">No grouped matches.</div>') +
      '</div></article>';
  }

  function renderChangeAnalysis(data) {
    const analysis = data.analysis || {};
    const files = Array.isArray(data.changed_files) ? data.changed_files : [];
    const risks = Array.isArray(analysis.risk_signals) ? analysis.risk_signals : [];
    const tests = Array.isArray(analysis.related_tests) ? analysis.related_tests : [];
    const commands = Array.isArray(analysis.recommended_commands) ? analysis.recommended_commands : [];
    const affected = Array.isArray(analysis.affected_areas) ? analysis.affected_areas : [];
    const pills = [
      pill(data.changed ? "changed" : "clean", data.changed ? "info" : "good"),
      risks.length ? pill(risks.length + " risks", "warn") : pill("no risks", "good"),
      pill("+" + (data.additions ?? 0), "good"),
      pill("-" + (data.deletions ?? 0), "bad")
    ].join("");
    const commandRows = commands.slice(0, 8).map((item) =>
      '<div class="file-row"><span class="file-code">run</span><span class="file-name">' + esc(item?.command || "") + '</span></div>'
    ).join("");
    return '<article class="card">' + header(data, pills) + '<div class="body">' +
      '<div class="summary">' + summaryItem("Files", files.length) + summaryItem("Areas", affected.length) + summaryItem("Tests", tests.length) + '</div>' +
      '<div class="section-label">Affected areas</div>' + compactRows(affected, "area") +
      fold("Risk signals", risks.length + " signals", compactRows(risks, "risk"), risks.length > 0) +
      fold("Related tests", tests.length + " tests", compactRows(tests, "test"), false) +
      fold("Verification", commands.length + " commands", '<div class="file-list">' + (commandRows || '<div class="empty">None.</div>') + '</div>', false) +
      (data.diff ? fold("Diff", "+" + (data.additions ?? 0) + " -" + (data.deletions ?? 0), codebox("diff", renderDiff(data.diff), ""), false) : "") +
      '</div></article>';
  }

  function gitStatusRows(status, max = 8) {
    return String(status || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("##"))
      .slice(0, max)
      .map((line) => {
        const code = line.slice(0, 2).trim() || "?";
        const name = line.slice(2).trim() || line;
        return '<div class="file-row"><span class="file-code">' + esc(code) + '</span><span class="file-name">' + esc(name) + '</span></div>';
      })
      .join("");
  }

  function renderWorkspace(data) {
    const skills = Array.isArray(data.skill_inventory) ? data.skill_inventory : (Array.isArray(data.skills) ? data.skills : []);
    const skillCount = Number(data.skill_counts?.total ?? skills.length);
    const changedRows = gitStatusRows(data.git_status, 8);
    const gitLines = String(data.git_status || "").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("##"));
    const agentsLabel = data.agents_loaded ? (data.agents_path || "AGENTS.md") : "no AGENTS";
    const pills = [
      pill(agentsLabel, data.agents_loaded ? "good" : "warn"),
      pill(skillCount + " skills", skillCount ? "info" : ""),
      data.tool_mode ? pill("tools " + data.tool_mode) : ""
    ].join("");
    const contextRows = [
      '<div class="file-row"><span class="file-code">root</span><span class="file-name">' + esc(data.root || ".") + '</span></div>',
      data.workspace_id ? '<div class="file-row"><span class="file-code">id</span><span class="file-name">' + esc(data.workspace_id) + '</span></div>' : "",
      data.agents_loaded ? '<div class="file-row"><span class="file-code">rules</span><span class="file-name">' + esc(data.agents_path || "AGENTS.md") + '</span></div>' : ""
    ].join("");
    const skillRows = skills.slice(0, 16).map((skill) => {
      const value = typeof skill === "string" ? skill : (skill?.name || "skill");
      const source = typeof skill === "string" ? "skill" : shortSource(skill?.source);
      return '<div class="file-row"><span class="file-code">' + esc(source) + '</span><span class="file-name">' + esc(value) + '</span></div>';
    }).join("");
    const skillText = skills.length
      ? '<div class="file-list">' + skillRows + '</div>' + (skills.length > 16 ? '<div class="empty">+' + esc(skills.length - 16) + ' more skills</div>' : "")
      : '<div class="empty">No skills discovered. Use include_global_skills=true if this is unexpected.</div>';
    const gitText = changedRows
      ? '<div class="file-list">' + changedRows + '</div>' + (gitLines.length > 8 ? '<div class="empty">+' + esc(gitLines.length - 8) + ' more changed files</div>' : "")
      : '<div class="empty">Working tree clean.</div>';
    const tree = data.tree ? codebox("tree", esc(previewLines(data.tree, 18)), "") : "";
    return '<article class="card">' + header(data, pills) + '<div class="body">' +
      '<div class="summary">' +
      summaryItem("Write", data.write_mode || "-") +
      summaryItem("Bash", data.bash_mode || "-") +
      summaryItem("Tools", data.tool_mode || "-") +
      '</div>' +
      '<div class="section-label">Context</div><div class="file-list">' + contextRows + '</div>' +
      fold("Git", gitLines.length ? gitLines.length + " changed" : "clean", gitText, false) +
      fold("Skills", skillCount + " discovered", skillText, false) +
      fold("Tree", data.tree ? "available" : "", tree, false) +
      '</div></article>';
  }

  function renderHandoff(data) {
    const pills = [
      data.agent_name ? pill(data.agent_name, "info") : "",
      data.model ? pill(data.model) : "",
      data.additions !== undefined ? pill("+" + data.additions, "good") : "",
      data.deletions !== undefined ? pill("-" + data.deletions, "bad") : ""
    ].join("");
    const rows = [
      data.plan_path ? '<div class="file-row"><span class="file-code">plan</span><span class="file-name">' + esc(data.plan_path) + '</span></div>' : "",
      data.status_path ? '<div class="file-row"><span class="file-code">status</span><span class="file-name">' + esc(data.status_path) + '</span></div>' : "",
      data.diff_path ? '<div class="file-row"><span class="file-code">diff</span><span class="file-name">' + esc(data.diff_path) + '</span></div>' : ""
    ].join("");
    const diff = data.diff ? codebox("plan file diff", renderDiff(data.diff), "") : "";
    return '<article class="card">' + header(data, pills) + '<div class="body">' +
      '<div class="file-list">' + rows + '</div>' +
      diff +
      '</div></article>';
  }

  function renderBash(data) {
    const ok = Number(data.exitCode) === 0;
    const stdoutLines = countLines(data.stdout);
    const stderrLines = countLines(data.stderr);
    const totalLines = stdoutLines + stderrLines;
    const pills = [
      pill(ok ? "passed" : "failed", ok ? "good" : "bad"),
      pill(totalLines + " lines", "info"),
      pill((data.durationMs ?? "-") + " ms")
    ].join("");
    const command = '<span class="prompt">$</span> ' + esc(data.command || "");
    const output = previewLines(data.stdout || data.stderr || "", 18);
    const outputBox = output
      ? fold("Output preview", totalLines + " lines", codebox("output preview", esc(truncate(output, 5000)), "terminal"), false)
      : '<div class="empty">Command produced no output.</div>';
    return '<article class="card">' + header(data, pills) + '<div class="body">' +
      '<div class="summary">' +
      summaryItem("Exit", data.exitCode ?? "-") +
      summaryItem("Lines", totalLines) +
      summaryItem("Duration", (data.durationMs ?? "-") + " ms") +
      '</div>' +
      codebox("command", command, "terminal") +
      outputBox +
      '</div></article>';
  }

  function renderSearch(data) {
    const count = Array.isArray(data.matches) ? data.matches.length : 0;
    const lines = String(data.text || "").split("\\n").filter(Boolean).slice(0, 12);
    const hits = lines.map((line) => {
      const parts = line.split(":");
      const file = parts.length > 2 ? parts.slice(0, 2).join(":") : (parts[0] || "match");
      const body = parts.length > 2 ? parts.slice(2).join(":").trim() : line;
      return '<div class="hit"><div class="hit-file">' + esc(file) + '</div><div class="hit-text">' + esc(body) + '</div></div>';
    }).join("") || '<div class="muted">No matches.</div>';
    return '<article class="card">' + header(data, pill(count + " matches", "info") + pill(data.used || "search")) +
      '<div class="body"><div class="search">' + hits + '</div></div></article>';
  }

  function renderSelfTest(data) {
    const checks = Array.isArray(data.checks) ? data.checks : [];
    const status = String(data.status || "unknown");
    const pills = [
      pill(status, status === "pass" ? "good" : status === "fail" ? "bad" : "warn"),
      pill((data.expected_tool_count ?? "-") + " tools", "info"),
      pill((data.duration_ms ?? "-") + " ms")
    ].join("");
    const rows = checks.slice(0, 16).map((check) => {
      const state = String(check?.status || "?").toUpperCase();
      const cls = check?.status === "pass" ? "good" : check?.status === "fail" ? "bad" : "warn";
      return '<div class="file-row"><span class="file-code ' + esc(cls) + '">' + esc(state) + '</span><span class="file-name">' + esc((check?.name || "check") + ": " + (check?.detail || "")) + '</span></div>';
    }).join("");
    const terms = data.terms_boundary
      ? '<div class="file-list">' +
          '<div class="file-row"><span class="file-code">tos</span><span class="file-name">local repo bridge only; no model access, quota, resale, or bypass behavior</span></div>' +
        '</div>'
      : "";
    return '<article class="card">' + header(data, pills) + '<div class="body">' +
      '<div class="summary">' +
      summaryItem("Passed", data.passed ?? 0) +
      summaryItem("Warned", data.warned ?? 0) +
      summaryItem("Failed", data.failed ?? 0) +
      '</div>' +
      '<div class="file-list">' + (rows || '<div class="empty">No checks returned.</div>') + '</div>' +
      fold("Terms boundary", "", terms, false) +
      fold("Expected tools", Array.isArray(data.expected_tools) ? data.expected_tools.length + " tools" : "", codebox("tools", esc((data.expected_tools || []).join("\\n")), ""), false) +
      '</div></article>';
  }

  function renderInventory(data) {
    const skills = Array.isArray(data.skills) ? data.skills : [];
    const plugins = Array.isArray(data.plugins) ? data.plugins : [];
    const servers = Array.isArray(data.mcp_servers) ? data.mcp_servers : [];
    const skillRows = skills.slice(0, 18).map((skill) =>
      '<div class="file-row"><span class="file-code">' + esc(shortSource(skill?.source)) + '</span><span class="file-name">' + esc((skill?.name || "skill") + (skill?.description ? " — " + skill.description : "")) + '</span></div>'
    ).join("");
    const serverRows = servers.slice(0, 18).map((server) =>
      '<div class="file-row"><span class="file-code">mcp</span><span class="file-name">' + esc((server?.name || "server") + (server?.source ? " — " + server.source : "")) + '</span></div>'
    ).join("");
    const pluginRows = plugins.slice(0, 18).map((plugin) =>
      '<div class="file-row"><span class="file-code">plugin</span><span class="file-name">' + esc((plugin?.name || "plugin") + (plugin?.version ? " " + plugin.version : "") + (plugin?.description ? " — " + plugin.description : "")) + '</span></div>'
    ).join("");
    return '<article class="card">' + header(data, pill((data.skill_count ?? skills.length) + " skills", "info") + pill((data.plugin_count ?? plugins.length) + " plugins") + pill((data.mcp_server_count ?? servers.length) + " MCP")) +
      '<div class="body">' +
      '<div class="summary">' +
      summaryItem("Write", data.write_mode || "-") +
      summaryItem("Bash", data.bash_mode || "-") +
      summaryItem("Tools", data.tool_mode || "-") +
      '</div>' +
      fold("Skills", (data.skill_count ?? skills.length) + " found", '<div class="file-list">' + (skillRows || '<div class="empty">No skills discovered.</div>') + '</div>', false) +
      fold("Plugins", (data.plugin_count ?? plugins.length) + " found", '<div class="file-list">' + (pluginRows || '<div class="empty">No plugins discovered.</div>') + '</div>', false) +
      fold("MCP servers", (data.mcp_server_count ?? servers.length) + " found", '<div class="file-list">' + (serverRows || '<div class="empty">No MCP server names discovered.</div>') + '</div>', false) +
      '</div></article>';
  }

  function renderWorkspaces(data) {
    const spaces = Array.isArray(data.workspaces) ? data.workspaces : [];
    const rows = spaces.map((workspace) =>
      '<div class="file-row"><span class="file-code">ws</span><span class="file-name">' + esc((workspace?.id || "workspace") + " — " + (workspace?.root || "")) + '</span></div>'
    ).join("");
    return '<article class="card">' + header(data, pill((data.count ?? spaces.length) + " open", "info")) +
      '<div class="body"><div class="file-list">' + (rows || '<div class="empty">No workspaces opened yet.</div>') + '</div></div></article>';
  }

  function renderProjects(data) {
    const projects = Array.isArray(data.projects) ? data.projects : [];
    const rows = projects.map((project, index) => {
      const sources = Array.isArray(project?.sources) ? project.sources.join(", ") : "local";
      const searchable = ((project?.name || "") + " " + (project?.root || "") + " " + sources).toLowerCase();
      return '<button type="button" class="project-button" data-project-id="' + esc(project?.project_id || "") + '" data-project-name="' + esc(project?.name || "project") + '" data-project-search="' + esc(searchable) + '" aria-pressed="' + (project?.selected ? 'true' : 'false') + '"' + (index >= 8 ? ' hidden' : '') + '>' +
        '<span class="project-main"><span class="project-name">' + esc(project?.name || "Project") + '</span>' +
        '<span class="project-path">' + esc(project?.root || "") + ' · ' + esc(sources) + '</span></span>' +
        '<span class="project-action">' + (project?.selected ? "Selected" : "Use project") + '</span></button>';
    }).join("");
    const roots = Array.isArray(data.allowed_roots) ? data.allowed_roots : [];
    return '<article class="card">' + header(data, pill(projects.length + " projects", "info") + pill("one broker")) +
      '<div class="body"><div class="section-label">Choose where this chat works</div>' +
      '<label class="project-search"><span>Filter projects</span><input type="search" data-project-filter placeholder="Name or folder" autocomplete="off"></label>' +
      '<div class="project-list">' + (rows || '<div class="empty">No projects found. Add a projects directory with --allow-root and refresh.</div>') + '</div>' +
      fold("Synchronized roots", roots.length + " roots", compactRows(roots, "root", 12), false) +
      '<div class="empty" id="project-status" role="status" aria-live="polite">' + (projects.length > 8 ? 'Showing 8 of ' + esc(projects.length) + ' projects. Filter to find another.' : 'The selected project stays bound to this ChatGPT conversation.') + '</div>' +
      '</div></article>';
  }

  function renderServerConfig(data) {
    const blocked = Array.isArray(data.blockedGlobs) ? data.blockedGlobs : [];
    const allowed = Array.isArray(data.allowedRoots) ? data.allowedRoots : [];
    const bashSession = data.bashSessionId || data.bash_session_id || "";
    const bashSessionRequired = Boolean(data.requireBashSession || data.require_bash_session);
    const rootRows = [
      '<div class="file-row"><span class="file-code">root</span><span class="file-name">' + esc(data.defaultRoot || "-") + '</span></div>',
      '<div class="file-row"><span class="file-code">url</span><span class="file-name">' + esc((data.host || "127.0.0.1") + ":" + (data.port || "-")) + '</span></div>',
      '<div class="file-row"><span class="file-code">ui</span><span class="file-name">' + esc(data.widgetDomain || "-") + '</span></div>',
      bashSession ? '<div class="file-row"><span class="file-code">bash</span><span class="file-name">' + esc("session " + bashSession + (bashSessionRequired ? " required" : "")) + '</span></div>' : ""
    ].join("");
    const allowedRows = allowed.map((root) =>
      '<div class="file-row"><span class="file-code">allow</span><span class="file-name">' + esc(root) + '</span></div>'
    ).join("");
    const blockedRows = blocked.slice(0, 24).map((pattern) =>
      '<div class="file-row"><span class="file-code">block</span><span class="file-name">' + esc(pattern) + '</span></div>'
    ).join("");
    const limits = [
      summaryItem("Read", data.maxReadBytes ?? "-"),
      summaryItem("Write", data.maxWriteBytes ?? "-"),
      summaryItem("Output", data.maxOutputBytes ?? "-")
    ].join("");
    return '<article class="card">' + header(data, [
      pill("tools " + (data.toolMode || "-"), "info"),
      pill("bash " + (data.bashMode || "-")),
      bashSession ? pill("session " + bashSession, bashSessionRequired ? "warn" : "info") : "",
      pill(data.authEnabled ? "auth on" : "auth off", data.authEnabled ? "good" : "warn")
    ].join("")) + '<div class="body">' +
      '<div class="summary">' +
      summaryItem("Write", data.writeMode || "-") +
      summaryItem("Bash", data.bashMode || "-") +
      summaryItem("Session", bashSession ? bashSession + (bashSessionRequired ? " required" : "") : "-") +
      summaryItem("Tools", data.toolMode || "-") +
      '</div>' +
      '<div class="section-label">Runtime</div><div class="file-list">' + rootRows + '</div>' +
      fold("Allowed roots", allowed.length + " roots", '<div class="file-list">' + (allowedRows || '<div class="empty">No roots configured.</div>') + '</div>', false) +
      fold("Limits", "", '<div class="summary">' + limits + '</div>', false) +
      fold("Blocked paths", blocked.length + " patterns", '<div class="file-list">' + (blockedRows || '<div class="empty">No blocked globs configured.</div>') + '</div>', false) +
      fold("Raw config", "", codebox("config", esc(truncate(JSON.stringify(data || {}, null, 2), 8000)), ""), false) +
      '</div></article>';
  }

  function renderStatus(data) {
    const files = Array.isArray(data.changed_files) ? data.changed_files : [];
    const rows = files.slice(0, 14).map((line) => {
      const status = String(line).slice(0, 2).trim() || "?";
      const name = String(line).slice(2).trim() || String(line);
      return '<div class="file-row"><span class="file-code">' + esc(status) + '</span><span class="file-name">' + esc(name) + '</span></div>';
    }).join("");
    const state = data.status_error ? '<div class="empty">' + esc(data.status_error) + '</div>' : rows || '<div class="empty">Working tree clean.</div>';
    return '<article class="card">' + header(data, pill(files.length ? files.length + " changed" : "clean", files.length ? "info" : "good")) +
      '<div class="body"><div class="file-list">' + state + '</div>' +
      fold("Raw status", countLines(data.status) + " lines", codebox("git status", esc(previewLines(data.status, 40)), ""), false) +
      '</div></article>';
  }

  function renderTextSummary(data, label) {
    const files = Array.isArray(data.files) ? data.files : Array.isArray(data.ai_context_files) ? data.ai_context_files : [];
    const preview = data.preview || data.text || data.status || "";
    const rows = files.slice(0, 14).map((file) =>
      '<div class="file-row"><span class="file-code">file</span><span class="file-name">' + esc(file) + '</span></div>'
    ).join("");
    return '<article class="card">' + header(data, pill(files.length + " files", "info")) +
      '<div class="body">' +
      (rows ? '<div class="file-list">' + rows + '</div>' : '<div class="empty">No files listed.</div>') +
      fold(label || "Preview", countLines(preview) + " lines", codebox(label || "preview", esc(previewLines(preview, 24)), ""), false) +
      '</div></article>';
  }

  function renderGeneric(data) {
    const keys = Object.keys(data || {}).filter((key) => !key.startsWith("codexflow_"));
    const metrics = keys.slice(0, 3).map((key) => metric(key, typeof data[key] === "object" ? JSON.stringify(data[key]) : data[key])).join("");
    return '<article class="card">' + header(data, pill("structured", "info")) +
      '<div class="body">' + (metrics ? '<div class="metrics">' + metrics + '</div>' : '') +
      codebox("structured output", esc(previewLines(truncate(JSON.stringify(data || {}, null, 2), 6000), 24)), "") +
      '</div></article>';
  }

  function isPlaceholderPayload(data) {
    if (!data || typeof data !== "object") return true;
    const keys = Object.keys(data);
    return !keys.length || (keys.length === 1 && data.codexflow_tool === "codexflow");
  }

  function renderPending() {
    root.innerHTML = [
      '<article class="card pending">',
      '<div class="rail"></div>',
      '<header class="head">',
      '<span class="glyph">C</span>',
      '<div class="headline"><div class="title">CodexFlow</div><div class="subtitle">Waiting for tool result...</div></div>',
      '<span class="pill info">waiting</span>',
      '</header>',
      '<div class="skeleton"><span></span><span></span><span></span></div>',
      '</article>'
    ].join("");
  }

  function render(data) {
    if (isPlaceholderPayload(data)) {
      renderPending();
      return;
    }
    const tool = data.codexflow_tool;
    if (tool === "server_config") {
      root.innerHTML = renderServerConfig(data);
    } else if (tool === "codexflow_self_test") {
      root.innerHTML = renderSelfTest(data);
    } else if (tool === "codexflow_inventory") {
      root.innerHTML = renderInventory(data);
    } else if (tool === "list_projects") {
      root.innerHTML = renderProjects(data);
    } else if (tool === "list_workspaces") {
      root.innerHTML = renderWorkspaces(data);
    } else if (tool === "select_project" || tool === "open_current_workspace" || tool === "open_workspace" || tool === "workspace_snapshot") {
      root.innerHTML = renderWorkspace(data);
    } else if (tool === "inspect_workspace") {
      root.innerHTML = renderWorkspaceAnalysis(data);
    } else if (tool === "git_status") {
      root.innerHTML = renderStatus(data);
    } else if (tool === "show_changes") {
      root.innerHTML = data.analysis ? renderChangeAnalysis(data) : renderChanges(data);
    } else if (tool === "handoff_to_agent" || tool === "handoff_to_codex") {
      root.innerHTML = renderHandoff(data);
    } else if (tool === "write" || tool === "edit" || tool === "apply_patch" || tool === "git_diff" || tool === "export_pro_context" || tool === "read") {
      root.innerHTML = renderFile(data);
    } else if (tool === "bash") {
      root.innerHTML = renderBash(data);
    } else if (tool === "search") {
      root.innerHTML = data.analysis ? renderStructuredSearch(data) : renderSearch(data);
    } else if (tool === "read_handoff") {
      root.innerHTML = renderTextSummary(data, "handoff");
    } else if (tool === "codex_context") {
      root.innerHTML = renderTextSummary(data, "context");
    } else {
      root.innerHTML = renderGeneric(data);
    }
  }

  function extractStructuredContent(value) {
    if (!value || typeof value !== "object") return {};
    if (value.codexflow_tool || value.codexflow_title) return value;
    const candidates = [
      value.structuredContent,
      value.toolOutput?.structuredContent,
      value.toolOutput,
      value.toolResponseMetadata?.structuredContent,
      value.mcp_tool_result?.structuredContent,
      value.call_tool_result?.structuredContent,
      value.result?.structuredContent
    ];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === "object") return candidate;
    }
    return {};
  }

  render(extractStructuredContent(window.openai?.toolOutput || window.openai?.toolResponseMetadata || {}));

  root.addEventListener("click", async (event) => {
    const button = event.target?.closest?.("[data-project-id]");
    if (!button) return;
    const projectId = button.getAttribute("data-project-id") || "";
    const projectName = button.getAttribute("data-project-name") || "project";
    const status = document.getElementById("project-status");
    const buttons = root.querySelectorAll("[data-project-id]");
    buttons.forEach((item) => { item.disabled = true; });
    if (status) status.textContent = "Selecting " + projectName + "...";
    try {
      if (!window.openai?.callTool) throw new Error("Project selection is unavailable in this client.");
      await window.openai.callTool("select_project", { project_id: projectId });
      window.openai.setWidgetState?.({ selectedProjectId: projectId, selectedProjectName: projectName });
      buttons.forEach((item) => {
        const selected = item === button;
        item.setAttribute("aria-pressed", selected ? "true" : "false");
        const action = item.querySelector(".project-action");
        if (action) action.textContent = selected ? "Selected" : "Use project";
        item.disabled = false;
      });
      if (status) status.textContent = projectName + " is selected. This chat now routes file, git, and terminal tools there.";
      if (window.openai.sendFollowUpMessage) {
        try {
          await window.openai.sendFollowUpMessage({
            prompt: "Use the selected CodexFlow project " + projectName + " (project_id " + projectId + ") for this coding conversation. Inspect its repository instructions and relevant advertised skills before making changes.",
            scrollToBottom: true
          });
        } catch {
          if (status) status.textContent = projectName + " is selected. Continue this conversation to work in that project.";
        }
      }
    } catch (error) {
      buttons.forEach((item) => { item.disabled = false; });
      if (status) status.textContent = error instanceof Error ? error.message : "Could not select the project.";
    }
  });

  root.addEventListener("input", (event) => {
    const input = event.target?.closest?.("[data-project-filter]");
    if (!input) return;
    const query = String(input.value || "").trim().toLowerCase();
    const buttons = [...root.querySelectorAll("[data-project-search]")];
    let matching = 0;
    let visible = 0;
    buttons.forEach((button) => {
      const matches = !query || String(button.getAttribute("data-project-search") || "").includes(query);
      if (matches) matching += 1;
      const show = matches && visible < 8;
      button.hidden = !show;
      if (show) visible += 1;
    });
    const status = document.getElementById("project-status");
    if (status) status.textContent = matching
      ? "Showing " + visible + " of " + matching + " matching projects. Selection stays bound to this conversation."
      : "No projects match this filter.";
  });

  window.addEventListener("openai:set_globals", (event) => {
    render(extractStructuredContent(
      event.detail?.globals?.toolOutput ||
      event.detail?.globals?.toolResponseMetadata ||
      event.detail ||
      window.openai?.toolOutput ||
      window.openai?.toolResponseMetadata ||
      {}
    ));
  }, { passive: true });

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.method === "ui/notifications/tool-result") {
      render(extractStructuredContent(message.params || {}));
    }
  }, { passive: true });
</script>
`.trim();
