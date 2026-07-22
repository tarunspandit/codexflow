export const PROJECT_PICKER_URI = "ui://widget/codexflow-project-picker-v3.html";
export const PROJECT_PICKER_LEGACY_URIS = [
  "ui://widget/codexflow-project-picker-v2.html"
] as const;

export const projectPickerWidgetHtml = String.raw`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      color-scheme: light dark;
      --page: #f8f7f4;
      --panel: #ffffff;
      --ink: #17191c;
      --soft: #62676d;
      --quiet: #8a9097;
      --line: rgba(23, 25, 28, .12);
      --line-strong: rgba(23, 25, 28, .2);
      --signal: #55aee4;
      --signal-deep: #1679b7;
      --signal-wash: rgba(85, 174, 228, .1);
      --success: #25875f;
      --danger: #bd4d49;
      --shadow: 0 14px 36px rgba(31, 39, 47, .09);
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      min-height: 100%;
      background: transparent;
      color: var(--ink);
      font: 13px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    button, input { font: inherit; }
    button { cursor: pointer; }

    .shell {
      overflow: hidden;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
    }

    .head {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      padding: 16px;
      background:
        linear-gradient(135deg, rgba(85, 174, 228, .13), transparent 52%),
        var(--page);
      border-bottom: 1px solid var(--line);
    }

    .mark {
      display: grid;
      place-items: center;
      width: 42px;
      height: 42px;
      color: var(--signal-deep);
      background: var(--signal-wash);
      border: 1px solid rgba(85, 174, 228, .28);
      border-radius: 12px;
      font-size: 17px;
      font-weight: 750;
    }

    h1, p { margin: 0; }
    h1 { font-size: 15px; line-height: 1.2; letter-spacing: -.01em; }
    .sub { margin-top: 3px; color: var(--soft); font-size: 11px; }

    .count {
      padding: 5px 9px;
      color: var(--signal-deep);
      background: var(--signal-wash);
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      white-space: nowrap;
    }

    .body { padding: 14px; }

    .search {
      position: relative;
      display: block;
      margin-bottom: 10px;
    }

    .search span {
      position: absolute;
      left: 12px;
      top: 50%;
      color: var(--quiet);
      transform: translateY(-50%);
      pointer-events: none;
    }

    .search input {
      width: 100%;
      min-height: 43px;
      padding: 0 12px 0 34px;
      color: var(--ink);
      background: var(--page);
      border: 1px solid var(--line-strong);
      border-radius: 11px;
      outline: none;
    }

    .search input:focus {
      border-color: var(--signal);
      box-shadow: 0 0 0 3px var(--signal-wash);
    }

    .projects {
      display: grid;
      gap: 7px;
      max-height: 346px;
      overflow: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
    }

    .project {
      width: 100%;
      min-height: 58px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      padding: 9px 11px;
      color: var(--ink);
      background: transparent;
      border: 1px solid var(--line);
      border-radius: 11px;
      text-align: left;
      transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease;
    }

    .project:hover {
      background: var(--signal-wash);
      border-color: rgba(85, 174, 228, .42);
      transform: translateY(-1px);
    }

    .project:focus-visible { outline: 3px solid var(--signal-wash); border-color: var(--signal); }
    .project:disabled { cursor: wait; opacity: .58; transform: none; }
    .project[aria-pressed="true"] { background: var(--signal-wash); border-color: var(--signal); }

    .project-copy { min-width: 0; }
    .project-name { display: block; overflow: hidden; font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
    .project-path { display: block; overflow: hidden; margin-top: 2px; color: var(--soft); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    .action { color: var(--signal-deep); font-size: 10px; font-weight: 720; white-space: nowrap; }

    .empty {
      padding: 22px 14px;
      color: var(--soft);
      background: var(--page);
      border: 1px dashed var(--line-strong);
      border-radius: 11px;
      text-align: center;
    }

    .foot {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 43px;
      margin-top: 10px;
      padding: 9px 11px;
      color: var(--soft);
      background: var(--page);
      border-radius: 10px;
      font-size: 10px;
    }

    .dot { width: 7px; height: 7px; flex: 0 0 auto; background: var(--signal); border-radius: 50%; }
    .foot.good { color: var(--success); }
    .foot.good .dot { background: var(--success); }
    .foot.bad { color: var(--danger); }
    .foot.bad .dot { background: var(--danger); }

    .pending { padding: 22px; color: var(--soft); text-align: center; }

    @media (prefers-color-scheme: dark) {
      :root {
        --page: #202226;
        --panel: #191b1e;
        --ink: #f2f3f4;
        --soft: #b2b6bc;
        --quiet: #858b93;
        --line: rgba(255, 255, 255, .1);
        --line-strong: rgba(255, 255, 255, .18);
        --signal: #83c8ef;
        --signal-deep: #9bd7f7;
        --signal-wash: rgba(131, 200, 239, .1);
        --shadow: none;
      }
    }

    @media (max-width: 520px) {
      .head { grid-template-columns: 38px minmax(0, 1fr); }
      .mark { width: 38px; height: 38px; }
      .count { grid-column: 2; justify-self: start; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition-duration: .001ms !important; }
    }
  </style>
</head>
<body>
  <main id="app" class="shell" aria-live="polite"><div class="pending">Loading synchronized projects…</div></main>
  <script>
    const app = document.getElementById("app");
    let current = {};
    let hydrated = false;
    let hydrationAttempts = 0;
    let selectedProjectId = "";
    let selectedProjectName = "";
    let activeRouteId = "";
    let rpcCounter = 0;
    const MAX_HYDRATION_ATTEMPTS = 40;
    const HYDRATION_INTERVAL_MS = 250;

    function esc(value) {
      return String(value == null ? "" : value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function extract(value) {
      if (!value || typeof value !== "object") return {};
      if (Array.isArray(value.projects) || value.selected === true) return value;
      const candidates = [
        value.structuredContent,
        value.call_tool_result && value.call_tool_result.structuredContent,
        value.mcp_tool_result && value.mcp_tool_result.structuredContent,
        value.toolOutput && value.toolOutput.structuredContent,
        value.toolOutput,
        value.toolResponseMetadata && value.toolResponseMetadata.structuredContent,
        value.toolResponseMetadata && value.toolResponseMetadata.call_tool_result && value.toolResponseMetadata.call_tool_result.structuredContent,
        value.toolResponseMetadata && value.toolResponseMetadata.mcp_tool_result && value.toolResponseMetadata.mcp_tool_result.structuredContent,
        value.result && value.result.structuredContent,
        value.params && value.params.structuredContent,
        value.params && value.params.result && value.params.result.structuredContent
      ];
      for (const candidate of candidates) {
        if (candidate && typeof candidate === "object") return candidate;
      }
      return {};
    }

    function persistedRouteState() {
      const widgetState = (window.openai && window.openai.widgetState) || {};
      const privateState = widgetState.privateContent && typeof widgetState.privateContent === "object"
        ? widgetState.privateContent
        : widgetState;
      return privateState && typeof privateState === "object" ? privateState : {};
    }

    function render(data) {
      if (!data || !Array.isArray(data.projects)) return false;
      hydrated = true;
      current = data;
      const persisted = persistedRouteState();
      activeRouteId = String(data.route_id || persisted.routeId || activeRouteId || "");
      selectedProjectId = String(data.selected_project_id || persisted.selectedProjectId || selectedProjectId || "");
      selectedProjectName = String(persisted.selectedProjectName || selectedProjectName || "");
      const projects = data.projects;
      const rows = projects.map(function (project) {
        const location = project.location === "remote" ? "remote" : "local";
        const host = location === "remote" ? String(project.host_alias || "remote") : "";
        const sources = location === "remote" ? "Remote · " + host : "Local";
        const searchable = String((project.name || "") + " " + (project.root || "") + " " + host + " " + sources).toLowerCase();
        const selected = project.project_id === selectedProjectId || project.selected;
        if (selected && !selectedProjectName) selectedProjectName = project.name || "Project";
        return '<button class="project" type="button" data-id="' + esc(project.project_id) + '" data-name="' + esc(project.name || "Project") + '" data-location="' + location + '" data-host="' + esc(host) + '" data-search="' + esc(searchable) + '" aria-pressed="' + (selected ? "true" : "false") + '">' +
          '<span class="project-copy"><span class="project-name">' + esc(project.name || "Project") + '</span><span class="project-path">' + esc(project.root || "") + ' · ' + esc(sources) + '</span></span>' +
          '<span class="action">' + (selected ? "Selected" : "Use project") + '</span></button>';
      }).join("");
      const statusCopy = selectedProjectId
        ? esc(selectedProjectName || "Project") + " is selected. Continue in chat with the task."
        : "Pick here, or reply in chat with an exact project name.";
      app.innerHTML = '<header class="head"><span class="mark" aria-hidden="true">C</span><div><h1>Choose this chat’s project</h1><p class="sub">One private route for this conversation</p></div><span class="count">' + esc(projects.length) + ' projects</span></header>' +
        '<section class="body"><label class="search"><span aria-hidden="true">⌕</span><input type="search" data-filter placeholder="Filter by name or folder" autocomplete="off" aria-label="Filter projects"></label>' +
        '<div class="projects" data-projects>' + (rows || '<div class="empty">No synchronized projects were found.</div>') + '</div>' +
        '<div class="foot' + (selectedProjectId ? " good" : "") + '" id="status" role="status"><span class="dot" aria-hidden="true"></span><span>' + statusCopy + '</span></div></section>';
      return true;
    }

    function readOpenAiGlobals() {
      const bridge = window.openai || {};
      return extract(bridge.toolOutput || bridge.toolResponseMetadata || {});
    }

    function hydrateFromOpenAiGlobals() {
      return render(readOpenAiGlobals());
    }

    function waitForOpenAiGlobals() {
      if (hydrated || hydrationAttempts >= MAX_HYDRATION_ATTEMPTS) return;
      hydrationAttempts += 1;
      if (hydrateFromOpenAiGlobals()) return;
      window.setTimeout(waitForOpenAiGlobals, HYDRATION_INTERVAL_MS);
    }

    function setStatus(message, kind) {
      const node = document.getElementById("status");
      if (!node) return;
      node.className = "foot" + (kind ? " " + kind : "");
      const copy = node.querySelector("span:last-child");
      if (copy) copy.textContent = message;
    }

    function setBusy(busy) {
      app.querySelectorAll("[data-id]").forEach(function (button) { button.disabled = busy; });
    }

    function markSelected(id) {
      selectedProjectId = id;
      app.querySelectorAll("[data-id]").forEach(function (button) {
        const selected = button.getAttribute("data-id") === id;
        button.setAttribute("aria-pressed", selected ? "true" : "false");
        const action = button.querySelector(".action");
        if (action) action.textContent = selected ? "Selected" : "Use project";
      });
    }

    function rpcRequest(method, params) {
      return new Promise(function (resolve, reject) {
        const id = "codexflow-ui-" + Date.now() + "-" + (++rpcCounter);
        const timeout = window.setTimeout(function () {
          window.removeEventListener("message", onMessage);
          reject(new Error("The host did not acknowledge model context."));
        }, 3500);
        function onMessage(event) {
          if (event.source !== window.parent) return;
          const message = event.data;
          if (!message || message.jsonrpc !== "2.0" || message.id !== id) return;
          window.clearTimeout(timeout);
          window.removeEventListener("message", onMessage);
          if (message.error) reject(new Error(message.error.message || "The host rejected model context."));
          else resolve(message.result);
        }
        window.addEventListener("message", onMessage);
        window.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params }, "*");
      });
    }

    async function publishRouteContext(routeId, workspaceId, name, root, location, host) {
      const context = {
        route_id: routeId,
        workspace_id: workspaceId,
        project_name: name,
        root: root,
        location: location,
        host_alias: host || null,
        instruction: "Pass this exact route_id on every CodexFlow project-scoped tool call. Do not fall back to the broker default project."
      };
      try {
        if (window.openai && typeof window.openai.setWidgetState === "function") {
          window.openai.setWidgetState({
            modelContent: { codexflow_project_route: context },
            privateContent: {
              routeId: routeId,
              selectedProjectId: workspaceId,
              selectedProjectName: name,
              selectedProjectRoot: root
            },
            imageIds: []
          });
        }
      } catch {
        // The standard model-context bridge below remains the source of truth.
      }
      try {
        await rpcRequest("ui/update-model-context", {
          content: [{
            type: "text",
            text: "CodexFlow project selected by the user. route_id=" + routeId + "; workspace_id=" + workspaceId + "; project=" + name + "; location=" + location + (host ? "; ssh_host=" + host : "") + "; root=" + root + ". Pass this exact route_id on every later CodexFlow project-scoped tool call and never substitute the broker default project."
          }]
        });
        return true;
      } catch {
        return false;
      }
    }

    async function selectProject(button) {
      const id = button.getAttribute("data-id") || "";
      const name = button.getAttribute("data-name") || "project";
      const buttonLocation = button.getAttribute("data-location") || "local";
      const buttonHost = button.getAttribute("data-host") || "";
      if (!id) return;
      setBusy(true);
      setStatus("Binding this chat to " + name + "…", "");
      try {
        if (window.openai && typeof window.openai.callTool === "function") {
          if (!activeRouteId) throw new Error("This picker is missing its private route. Ask CodexFlow to show a fresh project picker.");
          const result = await window.openai.callTool("select_project", { route_id: activeRouteId, project_id: id });
          const selected = extract(result);
          if (selected && selected.selected === false) throw new Error("The project could not be selected.");
          const routeId = String(selected.route_id || activeRouteId);
          const workspaceId = String(selected.workspace_id || selected.project_id || id);
          const root = String(selected.root || button.querySelector(".project-path")?.textContent?.split(" · ")[0] || "");
          activeRouteId = routeId;
          selectedProjectName = String(selected.name || name);
          markSelected(workspaceId);
          await publishRouteContext(routeId, workspaceId, selectedProjectName, root, String(selected.location || buttonLocation), String(selected.host_alias || buttonHost));
          setStatus(name + " is selected. Continue in chat with the task.", "good");
        } else if (window.openai && typeof window.openai.sendFollowUpMessage === "function") {
          await window.openai.sendFollowUpMessage({ prompt: "Select the CodexFlow project named " + name + " with project_id " + id + " and route_id " + activeRouteId + ". Preserve that route_id on every later CodexFlow project tool call, then wait for my task.", scrollToBottom: true });
          setStatus("Selection sent to the conversation.", "good");
        } else {
          throw new Error("Reply in chat with the project name: " + name);
        }
      } catch (error) {
        const message = error && error.message ? error.message : "Selection failed. Reply in chat with the project name.";
        setStatus(message, "bad");
      } finally {
        setBusy(false);
      }
    }

    app.addEventListener("click", function (event) {
      const button = event.target && event.target.closest ? event.target.closest("[data-id]") : null;
      if (button) void selectProject(button);
    });

    app.addEventListener("input", function (event) {
      const input = event.target && event.target.closest ? event.target.closest("[data-filter]") : null;
      if (!input) return;
      const query = String(input.value || "").trim().toLowerCase();
      let matches = 0;
      app.querySelectorAll("[data-search]").forEach(function (button) {
        const visible = !query || String(button.getAttribute("data-search") || "").includes(query);
        button.hidden = !visible;
        if (visible) matches += 1;
      });
      setStatus(matches ? matches + " matching project" + (matches === 1 ? "" : "s") + "." : "No project matches that filter.", matches ? "" : "bad");
    });

    window.addEventListener("openai:set_globals", function (event) {
      const globals = (event.detail && event.detail.globals) || event.detail || {};
      render(extract(globals.toolOutput || globals.toolResponseMetadata || globals));
    }, { passive: true });

    waitForOpenAiGlobals();
  </script>
</body>
</html>
`.trim();
