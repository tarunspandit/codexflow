(() => {
  "use strict";

  const body = document.body;
  const views = ["now", "projects", "chats", "connection", "policy"];
  const viewLabels = {
    now: "Now",
    projects: "Projects",
    chats: "Chats",
    connection: "Connection",
    policy: "Policy"
  };
  const state = {
    overview: null,
    projectQuery: "",
    eventTimer: 0,
    uptimeTimer: 0,
    fetchedAt: 0
  };
  const initialUrl = new URL(window.location.href);
  let authToken = initialUrl.searchParams.get("codexflow_token") || initialUrl.searchParams.get("token") || "";
  try {
    if (authToken) window.sessionStorage.setItem("codexflow.localAuthToken", authToken);
    else authToken = window.sessionStorage.getItem("codexflow.localAuthToken") || "";
  } catch {
    // The in-memory value still authenticates this tab when session storage is unavailable.
  }
  if (initialUrl.searchParams.has("codexflow_token") || initialUrl.searchParams.has("token")) {
    initialUrl.searchParams.delete("codexflow_token");
    initialUrl.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", `${initialUrl.pathname}${initialUrl.search}${initialUrl.hash}`);
  }

  const one = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const html = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function apiUrl(pathname, additions = {}) {
    const url = new URL(pathname, window.location.href);
    if (authToken) url.searchParams.set("codexflow_token", authToken);
    Object.entries(additions).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    return url.toString();
  }

  function endpointWithToken(base) {
    if (!base) return "";
    const url = new URL(base, window.location.href);
    if (authToken) url.searchParams.set("codexflow_token", authToken);
    return url.toString();
  }

  function announce(message, tone = "") {
    const toast = one("[data-toast]");
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.classList.add("is-visible");
    window.clearTimeout(announce.timer);
    announce.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.className = "clipboard-proxy";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("Clipboard unavailable");
  }

  function currentView() {
    const hash = window.location.hash.slice(1);
    return views.includes(hash) ? hash : "now";
  }

  function showView(name, options = {}) {
    const next = views.includes(name) ? name : "now";
    body.dataset.view = next;
    all("[data-view-group]").forEach((section) => {
      section.hidden = section.dataset.viewGroup !== next;
    });
    all("[data-view-target]").forEach((link) => {
      if (link.closest(".product-nav")) {
        if (link.dataset.viewTarget === next) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
    });
    const label = one("[data-current-view-label]");
    if (label) label.textContent = viewLabels[next];
    if (options.history === "push") window.history.pushState({ view: next }, "", `#${next}`);
    if (options.focus) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      window.requestAnimationFrame(() => one(`[data-view-group="${next}"] h1`)?.focus({ preventScroll: true }));
    }
  }

  function relativeTime(value) {
    const time = Date.parse(value || "");
    if (!Number.isFinite(time)) return "—";
    const seconds = Math.round((time - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    if (abs < 60) return formatter.format(seconds, "second");
    if (abs < 3600) return formatter.format(Math.round(seconds / 60), "minute");
    if (abs < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
    return formatter.format(Math.round(seconds / 86400), "day");
  }

  function duration(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms)) return "—";
    return ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  }

  function uptime(value) {
    const total = Math.max(0, Math.floor(Number(value) / 1000));
    if (!Number.isFinite(total)) return "—";
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function projectSource(sources) {
    const source = Array.isArray(sources) ? sources : [];
    if (source.includes("default")) return "Current workspace";
    if (source.includes("codex")) return "Recent project";
    if (source.includes("allowed-root")) return "Allowed root";
    return "Discovered locally";
  }

  function emptyState(title, copy) {
    return `<div class="empty-state"><strong>${html(title)}</strong><p>${html(copy)}</p></div>`;
  }

  function renderProjects() {
    if (!state.overview) return;
    const list = one("[data-project-list]");
    if (!list) return;
    const query = state.projectQuery.trim().toLowerCase();
    const projects = (state.overview.projects || []).filter((project) => {
      if (!query) return true;
      return `${project.name} ${project.root} ${(project.sources || []).join(" ")}`.toLowerCase().includes(query);
    });
    if (!projects.length) {
      list.innerHTML = emptyState(
        query ? "No matching projects" : "No projects discovered",
        query ? "Try a project name, folder, or discovery source." : "Confirm the allowed roots in Policy, then refresh discovery."
      );
      return;
    }
    list.innerHTML = projects.map((project, index) => {
      const prompt = `Use CodexFlow with the project “${project.name}” at ${project.root}. Confirm the selected project, then help me with: `;
      return `<article class="project-row${project.is_default ? " is-default" : ""}">
        <div class="project-identity"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${html(project.name)}</strong><code>${html(project.root)}</code></div></div>
        <div class="project-source">${html(projectSource(project.sources))}${project.is_default ? "<small>Default</small>" : ""}</div>
        <time datetime="${html(project.last_active_at || "")}">${project.last_active_at ? html(relativeTime(project.last_active_at)) : "Local"}</time>
        <button class="row-action" type="button" data-project-prompt="${html(prompt)}">Copy starter</button>
      </article>`;
    }).join("");
  }

  function sessionMarkup(session, detailed = false) {
    const project = session.project;
    const stateLabel = session.state === "closed" ? "Recently closed" : session.state === "initializing" ? "Connecting" : "Live";
    const statusClass = session.state === "closed" ? "closed" : session.last_tool_status === "error" ? "error" : "live";
    const lastTool = session.last_tool ? session.last_tool.replaceAll("_", " ") : "Waiting for first tool";
    return `<article class="session-row" data-state="${html(statusClass)}">
      <div class="session-state"><span aria-hidden="true"></span><small>${html(stateLabel)}</small></div>
      <div class="session-project"><strong>${html(project?.name || "Choosing a project")}</strong><code>${html(session.id)}</code></div>
      <div class="session-tool"><span>${html(lastTool)}</span>${detailed ? `<small>${Number(session.tool_calls || 0)} calls · ${Number(session.errors || 0)} errors</small>` : ""}</div>
      <time datetime="${html(session.last_seen_at)}">${html(relativeTime(session.last_seen_at))}</time>
    </article>`;
  }

  function renderSessions() {
    if (!state.overview) return;
    const sessions = state.overview.sessions || [];
    all("[data-session-list]").forEach((list) => {
      const detailed = list.dataset.sessionList === "all";
      const shown = detailed ? sessions : sessions.slice(0, 4);
      list.innerHTML = shown.length
        ? shown.map((session) => sessionMarkup(session, detailed)).join("")
        : emptyState("No connected chats", "Open ChatGPT, activate CodexFlow, and choose a project. Each conversation will appear here independently.");
    });
    const active = Number(state.overview.summary?.active_sessions || 0);
    const count = one("[data-session-count]");
    if (count) count.textContent = `${active} active`;
  }

  function activityMarkup(event) {
    const safeStatus = event.status === "error" ? "error" : "ok";
    return `<article class="activity-row" data-status="${safeStatus}">
      <time datetime="${html(event.at)}">${html(relativeTime(event.at))}</time>
      <div><strong>${html(String(event.tool || "tool").replaceAll("_", " "))}</strong><small>${html(event.session_id || "")}</small></div>
      <span>${html(event.project?.name || "No project yet")}</span>
      <b>${safeStatus === "ok" ? "Completed" : "Error"}</b>
      <code>${html(duration(event.duration_ms))}</code>
    </article>`;
  }

  function renderActivity() {
    if (!state.overview) return;
    const activity = state.overview.activity || [];
    all("[data-activity-list]").forEach((list) => {
      const shown = list.dataset.activityList === "all" ? activity : activity.slice(0, 6);
      list.innerHTML = shown.length
        ? shown.map(activityMarkup).join("")
        : emptyState("No tool calls yet", "Only tool name, outcome, duration, project, and display fingerprint appear here.");
    });
  }

  function renderOverview() {
    const overview = state.overview;
    if (!overview) return;
    const broker = overview.broker || {};
    const summary = overview.summary || {};
    all('[data-summary="projects"]').forEach((node) => { node.textContent = String(summary.projects ?? "—"); });
    all('[data-summary="active_sessions"]').forEach((node) => { node.textContent = String(summary.active_sessions ?? 0); });
    all('[data-nav-count="projects"]').forEach((node) => { node.textContent = String(summary.projects ?? "—"); });
    all('[data-nav-count="sessions"]').forEach((node) => { node.textContent = String(summary.active_sessions ?? 0); });
    const endpointDisplay = `${broker.endpoint || ""}${broker.auth_enabled ? "?codexflow_token=<redacted>" : ""}`;
    all("[data-current-endpoint]").forEach((node) => { node.textContent = endpointDisplay || "Unavailable"; });
    renderProjects();
    renderSessions();
    renderActivity();
    updateUptime();
  }

  function updateUptime() {
    if (!state.overview) return;
    const elapsed = Date.now() - state.fetchedAt;
    const current = Number(state.overview.broker?.uptime_ms || 0) + elapsed;
    all('[data-summary="uptime"]').forEach((node) => { node.textContent = uptime(current); });
  }

  function setConnection(status, detail) {
    const rail = one("[data-connection-state]");
    if (rail) {
      rail.dataset.connectionState = status;
      const strong = one("strong", rail);
      const small = one("small", rail);
      if (strong) strong.textContent = status === "ready" ? "Broker ready" : status === "loading" ? "Syncing" : "Broker unavailable";
      if (small) small.textContent = detail;
    }
    const label = one("[data-sync-label]");
    if (label) label.textContent = detail;
  }

  async function loadOverview(options = {}) {
    setConnection("loading", options.refresh ? "Refreshing projects" : "Reading local state");
    try {
      const response = await fetch(apiUrl("/api/overview", options.refresh ? { refresh: 1 } : {}), {
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.message || `Local broker returned ${response.status}`);
      state.overview = result;
      state.fetchedAt = Date.now();
      renderOverview();
      setConnection("ready", `Synced ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date())}`);
      return true;
    } catch (error) {
      setConnection("error", "Live state unavailable");
      const message = error instanceof Error ? error.message : "Could not read local state";
      all("[data-project-list], [data-session-list], [data-activity-list]").forEach((list) => {
        if (!state.overview) list.innerHTML = emptyState("Could not reach the broker", message);
      });
      return false;
    }
  }

  function connectEventStream() {
    if (!("EventSource" in window)) return;
    const source = new EventSource(apiUrl("/api/events"));
    source.addEventListener("update", () => {
      window.clearTimeout(state.eventTimer);
      state.eventTimer = window.setTimeout(() => loadOverview(), 180);
    });
    source.addEventListener("open", () => setConnection("ready", "Live updates connected"));
    source.addEventListener("error", () => {
      if (source.readyState === EventSource.CLOSED) setConnection("error", "Live updates reconnecting");
    });
  }

  function serverPreviewFor(hostname, tokenEnabled) {
    const clean = String(hostname || "").trim().replace(/^https?:\/\//, "").replace(/\/mcp\/?$/, "").replace(/\/+$/, "");
    if (!clean) return "";
    return `https://${clean}/mcp${tokenEnabled ? "?codexflow_token=<redacted>" : ""}`;
  }

  function initializeProfileForm() {
    const form = one("[data-profile-form]");
    if (!form) return;
    const tunnel = one("[data-tunnel-select]", form);
    const hostname = one("[data-hostname-input]", form);
    const help = one("[data-hostname-help]", form);
    const tokenEnabled = body.dataset.authEnabled === "true";

    function updateTunnelHelp() {
      if (!tunnel || !hostname || !help) return;
      const ngrokHost = tunnel.dataset.ngrokHostname || "";
      const cloudflareHost = tunnel.dataset.cloudflareHostname || "";
      if (tunnel.value === "ngrok" && !hostname.value && ngrokHost) {
        hostname.value = ngrokHost;
        hostname.dataset.autofilled = "1";
      }
      if (tunnel.value === "cloudflare-named" && !hostname.value && cloudflareHost) {
        hostname.value = cloudflareHost;
        hostname.dataset.autofilled = "1";
      }
      if (["cloudflare", "none"].includes(tunnel.value) && hostname.dataset.autofilled === "1") {
        hostname.value = "";
        hostname.dataset.autofilled = "0";
      }
      const preview = serverPreviewFor(hostname.value, tokenEnabled);
      const messages = {
        cloudflare: "Quick tunnel URLs are generated at launch and appear as the current connection above.",
        ngrok: preview ? `Next Server URL preview: ${preview}` : "Enter the reserved ngrok domain from your local ngrok setup.",
        "cloudflare-named": preview ? `Next Server URL preview: ${preview}` : "Enter the hostname routed to your named Cloudflare tunnel.",
        tailscale: preview ? `Next Server URL preview: ${preview}` : "Enter this device’s Tailscale Funnel hostname.",
        none: "Local-only mode does not expose a public ChatGPT Server URL."
      };
      help.textContent = messages[tunnel.value] || "";
    }

    tunnel?.addEventListener("change", updateTunnelHelp);
    hostname?.addEventListener("input", () => {
      hostname.dataset.autofilled = "0";
      updateTunnelHelp();
    });
    updateTunnelHelp();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = one('button[type="submit"]', form);
      const status = one("[data-profile-status]", form);
      const formData = new FormData(form);
      const value = (name) => formData.get(name) || "";
      const checked = (name) => Boolean(form.elements.namedItem(name)?.checked);
      const payload = {
        tunnel: value("tunnel"), hostname: value("hostname"), tunnelName: value("tunnelName"),
        ngrokConfig: value("ngrokConfig"), cloudflareConfig: value("cloudflareConfig"), cloudflareTokenFile: value("cloudflareTokenFile"),
        port: Number(value("port")), mode: value("mode"), bash: value("bash"), write: value("write"), toolMode: value("toolMode"),
        toolCards: checked("toolCards"), codexSessions: value("codexSessions"), codexDir: value("codexDir"), bashSession: value("bashSession"),
        requireBashSession: checked("requireBashSession"), noInstallCloudflared: checked("noInstallCloudflared")
      };
      if (submit) submit.disabled = true;
      if (status) status.textContent = "Saving next-launch profile…";
      try {
        const response = await fetch(apiUrl("/admin/profile"), {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error?.message || "Profile could not be saved");
        if (status) status.textContent = "Saved. Restart CodexFlow whenever you want these defaults to take effect.";
        announce("Next-launch profile saved");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Profile could not be saved";
        if (status) status.textContent = message;
        announce(message, "error");
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  body.classList.add("app-enhanced");
  showView(currentView());
  all("[data-view-target]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = link.dataset.viewTarget;
      if (!views.includes(target)) return;
      event.preventDefault();
      showView(target, { history: "push", focus: true });
    });
  });
  window.addEventListener("popstate", () => showView(currentView()));
  window.addEventListener("hashchange", () => showView(currentView()));

  document.addEventListener("click", async (event) => {
    const copy = event.target.closest("[data-copy], [data-copy-kind]");
    if (copy) {
      const original = copy.textContent;
      let value = copy.dataset.copy || "";
      if (copy.dataset.copyKind) value = endpointWithToken(copy.dataset.copyBase || value);
      try {
        await copyText(value);
        copy.textContent = "Copied";
        announce("Copied to clipboard");
      } catch {
        announce("Clipboard access is unavailable", "error");
      } finally {
        window.setTimeout(() => { copy.textContent = original; }, 1400);
      }
      return;
    }
    const starter = event.target.closest("[data-project-prompt]");
    if (starter) {
      try {
        await copyText(starter.dataset.projectPrompt || "");
        announce("Starter prompt copied");
      } catch {
        announce("Clipboard access is unavailable", "error");
      }
    }
  });

  one("[data-project-search]")?.addEventListener("input", (event) => {
    state.projectQuery = event.currentTarget.value;
    renderProjects();
  });
  one("[data-refresh-projects]")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    const ok = await loadOverview({ refresh: true });
    event.currentTarget.disabled = false;
    announce(ok ? "Project index refreshed" : "Project refresh failed", ok ? "" : "error");
  });
  document.addEventListener("keydown", (event) => {
    const editable = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
    if (event.key === "/" && !editable) {
      event.preventDefault();
      showView("projects", { history: "push" });
      one("[data-project-search]")?.focus();
    }
  });

  initializeProfileForm();
  loadOverview().then(connectEventStream);
  state.uptimeTimer = window.setInterval(updateUptime, 30_000);
  window.setInterval(() => loadOverview(), 20_000);
})();
