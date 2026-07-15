(() => {
  "use strict";

  const initialUrl = new URL(window.location.href);
  let authToken = initialUrl.searchParams.get("codexflow_token") || initialUrl.searchParams.get("token") || "";
  try {
    if (authToken) window.sessionStorage.setItem("codexflow.localAuthToken", authToken);
    else authToken = window.sessionStorage.getItem("codexflow.localAuthToken") || "";
  } catch {
    // The in-memory value still authenticates this tab if session storage is unavailable.
  }
  if (initialUrl.searchParams.has("codexflow_token") || initialUrl.searchParams.has("token")) {
    initialUrl.searchParams.delete("codexflow_token");
    initialUrl.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", `${initialUrl.pathname}${initialUrl.search}${initialUrl.hash}`);
  }

  const one = (selector) => document.querySelector(selector);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const state = { overview: null, fetchedAt: 0, reconnectTimer: 0 };

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
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("Clipboard unavailable");
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

  function setState(kind, label) {
    const status = one("[data-broker-state]");
    if (status) status.dataset.brokerState = kind;
    const stateLabel = one("[data-state-label]");
    if (stateLabel) stateLabel.textContent = label;
    const summary = one('[data-summary="state"]');
    if (summary) summary.textContent = kind === "ready" ? "Live" : kind === "error" ? "Unavailable" : "Checking";
  }

  function render() {
    const overview = state.overview;
    if (!overview) return;
    const broker = overview.broker || {};
    const summary = overview.summary || {};
    all('[data-summary="projects"]').forEach((node) => { node.textContent = String(summary.projects ?? "—"); });
    all('[data-summary="sessions"]').forEach((node) => { node.textContent = String(summary.active_sessions ?? 0); });
    all('[data-summary="uptime"]').forEach((node) => {
      node.textContent = uptime(Number(broker.uptime_ms || 0) + Date.now() - state.fetchedAt);
    });
    const display = `${broker.endpoint || ""}${broker.auth_enabled ? "?codexflow_token=<redacted>" : ""}`;
    all("[data-endpoint-display]").forEach((node) => { node.textContent = display || "Unavailable"; });
  }

  async function loadOverview(refresh = false) {
    setState("loading", refresh ? "Refreshing broker" : "Checking broker");
    try {
      const response = await fetch(apiUrl("/api/overview", refresh ? { refresh: 1 } : {}), {
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.message || `Local broker returned ${response.status}`);
      state.overview = result;
      state.fetchedAt = Date.now();
      render();
      setState("ready", "Broker live");
      return true;
    } catch (error) {
      setState("error", "Broker unavailable");
      announce(error instanceof Error ? error.message : "Could not read local broker state", "error");
      return false;
    }
  }

  function connectEvents() {
    if (!("EventSource" in window)) return;
    const source = new EventSource(apiUrl("/api/events"));
    source.addEventListener("update", () => {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = window.setTimeout(() => loadOverview(), 180);
    });
    source.addEventListener("open", () => setState("ready", "Broker live"));
  }

  document.addEventListener("click", async (event) => {
    const copy = event.target.closest("[data-copy-server]");
    if (copy) {
      const original = copy.textContent;
      try {
        await copyText(endpointWithToken(copy.dataset.endpointBase || ""));
        copy.textContent = "Copied";
        announce("Private Server URL copied");
      } catch {
        announce("Clipboard access is unavailable", "error");
      } finally {
        window.setTimeout(() => { copy.textContent = original; }, 1400);
      }
      return;
    }
    const refresh = event.target.closest("[data-refresh]");
    if (refresh) {
      refresh.disabled = true;
      const ok = await loadOverview(true);
      refresh.disabled = false;
      announce(ok ? "Broker state refreshed" : "Refresh failed", ok ? "" : "error");
    }
  });

  loadOverview().then(connectEvents);
  window.setInterval(render, 30_000);
  window.setInterval(() => loadOverview(), 30_000);
})();
