export const PROJECT_PICKER_URI = "ui://widget/codexflow-project-picker-v2.html";

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
        value.toolOutput && value.toolOutput.structuredContent,
        value.toolOutput,
        value.toolResponseMetadata && value.toolResponseMetadata.structuredContent,
        value.result && value.result.structuredContent,
        value.params && value.params.structuredContent,
        value.params && value.params.result && value.params.result.structuredContent
      ];
      for (const candidate of candidates) {
        if (candidate && typeof candidate === "object") return candidate;
      }
      return {};
    }

    function render(data) {
      if (!data || !Array.isArray(data.projects)) return false;
      hydrated = true;
      current = data;
      const projects = data.projects;
      const rows = projects.map(function (project) {
        const sources = Array.isArray(project.sources) ? project.sources.join(" · ") : "local";
        const searchable = String((project.name || "") + " " + (project.root || "") + " " + sources).toLowerCase();
        return '<button class="project" type="button" data-id="' + esc(project.project_id) + '" data-name="' + esc(project.name || "Project") + '" data-search="' + esc(searchable) + '" aria-pressed="' + (project.selected ? "true" : "false") + '">' +
          '<span class="project-copy"><span class="project-name">' + esc(project.name || "Project") + '</span><span class="project-path">' + esc(project.root || "") + ' · ' + esc(sources) + '</span></span>' +
          '<span class="action">' + (project.selected ? "Selected" : "Use project") + '</span></button>';
      }).join("");
      app.innerHTML = '<header class="head"><span class="mark" aria-hidden="true">C</span><div><h1>Choose this chat’s project</h1><p class="sub">One private route for this conversation</p></div><span class="count">' + esc(projects.length) + ' projects</span></header>' +
        '<section class="body"><label class="search"><span aria-hidden="true">⌕</span><input type="search" data-filter placeholder="Filter by name or folder" autocomplete="off" aria-label="Filter projects"></label>' +
        '<div class="projects" data-projects>' + (rows || '<div class="empty">No synchronized projects were found.</div>') + '</div>' +
        '<div class="foot" id="status" role="status"><span class="dot" aria-hidden="true"></span><span>Pick here, or reply in chat with an exact project name.</span></div></section>';
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
      app.querySelectorAll("[data-id]").forEach(function (button) {
        const selected = button.getAttribute("data-id") === id;
        button.setAttribute("aria-pressed", selected ? "true" : "false");
        const action = button.querySelector(".action");
        if (action) action.textContent = selected ? "Selected" : "Use project";
      });
    }

    async function selectProject(button) {
      const id = button.getAttribute("data-id") || "";
      const name = button.getAttribute("data-name") || "project";
      if (!id) return;
      setBusy(true);
      setStatus("Binding this chat to " + name + "…", "");
      try {
        if (window.openai && typeof window.openai.callTool === "function") {
          const result = await window.openai.callTool("select_project", { project_id: id });
          const selected = extract(result);
          if (selected && selected.selected === false) throw new Error("The project could not be selected.");
          if (window.openai.setWidgetState) window.openai.setWidgetState({ selectedProjectId: id, selectedProjectName: name });
          markSelected(id);
          setStatus(name + " is selected. Continue in chat with the task.", "good");
        } else if (window.openai && typeof window.openai.sendFollowUpMessage === "function") {
          await window.openai.sendFollowUpMessage({ prompt: "Select the CodexFlow project named " + name + " with project_id " + id + ", then continue my coding task there.", scrollToBottom: true });
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
