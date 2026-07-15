export interface LocalAppPageModel {
  version: string;
  defaultRoot: string;
  localMcp: string;
  endpointBase: string;
  endpointDisplay: string;
  authLabel: string;
  mode: string;
  writeMode: string;
  bashMode: string;
  bashTranscript: string;
  toolMode: string;
  codexSessions: string;
  widgetDomain: string;
  allowedRoots: string[];
  profileHtml: string;
  controlsHtml: string;
  chatgptUrl: string;
  githubUrl: string;
  npmUrl: string;
  docsUrl: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function policyRow(label: string, value: string, tone = ""): string {
  return `<div class="policy-row">
    <span>${escapeHtml(label)}</span>
    <strong${tone ? ` data-tone="${escapeHtml(tone)}"` : ""}>${escapeHtml(value)}</strong>
  </div>`;
}

export function renderLocalAppPage(model: LocalAppPageModel): string {
  const allowedRoots = model.allowedRoots
    .map((root, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span><code>${escapeHtml(root)}</code></li>`)
    .join("");
  const endpointBase = model.endpointBase || model.localMcp;
  const endpointDisplay = model.endpointDisplay || model.localMcp;
  const copyEndpoint = `data-copy-kind="server-url" data-copy-base="${escapeHtml(endpointBase)}"`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#08090b">
  <meta name="description" content="The local CodexFlow companion for projects, ChatGPT sessions, connection health, and runtime policy.">
  <link rel="icon" href="/favicon.ico">
  <link rel="preload" href="/brand/geologica.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/brand/flow7-tech-dark.webp" as="image" type="image/webp">
  <link rel="stylesheet" href="/brand/control.css">
  <script src="/brand/control.js" defer></script>
  <title>CodexFlow — Local companion</title>
</head>
<body data-view="now" data-version="${escapeHtml(model.version)}" data-auth-enabled="${model.authLabel === "Token protected" ? "true" : "false"}">
  <a class="skip-link" href="#main-content">Skip to content</a>
  <div class="app-shell">
    <aside class="app-rail" aria-label="CodexFlow application navigation">
      <a class="product-lockup" href="#now" data-view-target="now" aria-label="CodexFlow home">
        <span class="product-mark" aria-hidden="true"><img src="/brand/flow7-tech-dark.webp" alt="" width="1024" height="1024"></span>
        <span class="product-name" aria-label="CodexFlow"><span aria-hidden="true">Codex<span>Flow</span></span><small>local companion</small></span>
      </a>

      <div class="rail-state" data-connection-state="ready">
        <span class="state-light" aria-hidden="true"></span>
        <span><strong>Broker ready</strong><small>On this computer</small></span>
      </div>

      <nav class="product-nav" aria-label="Product">
        <a href="#now" data-view-target="now" aria-current="page"><span>01</span>Now</a>
        <a href="#projects" data-view-target="projects"><span>02</span>Projects <b data-nav-count="projects">—</b></a>
        <a href="#chats" data-view-target="chats"><span>03</span>Chats <b data-nav-count="sessions">0</b></a>
        <a href="#connection" data-view-target="connection"><span>04</span>Connection</a>
        <a href="#policy" data-view-target="policy"><span>05</span>Policy</a>
      </nav>

      <div class="rail-foot">
        <img src="/brand/flow7-parent-dark.webp" alt="" width="1024" height="1024" aria-hidden="true">
        <p>Endorsed by Flow7<br><span>Version ${escapeHtml(model.version)}</span></p>
      </div>
    </aside>

    <div class="app-stage">
      <header class="command-bar">
        <div class="command-context">
          <span>CodexFlow / <strong data-current-view-label>Now</strong></span>
          <small data-sync-label>Waiting for live state</small>
        </div>
        <div class="command-actions">
          <button class="button quiet" type="button" ${copyEndpoint}>Copy Server URL</button>
          <a class="button primary" href="${escapeHtml(model.chatgptUrl)}" target="_blank" rel="noreferrer">Open ChatGPT</a>
        </div>
      </header>

      <main id="main-content" tabindex="-1">
        <section class="app-view" id="now" data-view-group="now" aria-labelledby="now-title">
          <header class="view-header reveal">
            <div>
              <p class="eyebrow">Current run</p>
              <h1 id="now-title" tabindex="-1">Your machine.<br><em>In clear view.</em></h1>
            </div>
            <p>See where every web coding chat is working, what the broker is doing, and which boundaries are active—without retaining the conversation itself.</p>
          </header>

          <section class="live-field reveal" aria-labelledby="broker-title">
            <div class="live-field-copy">
              <p class="signal-label"><span></span> Live on this computer</p>
              <h2 id="broker-title">Broker ready</h2>
              <p>One authenticated endpoint is routing independent ChatGPT conversations across your discovered projects.</p>
            </div>
            <div class="live-orbit" aria-hidden="true">
              <img src="/brand/flow7-tech-dark.webp" alt="" width="1024" height="1024">
            </div>
            <dl class="live-metrics">
              <div><dt>Projects</dt><dd data-summary="projects">—</dd></div>
              <div><dt>Active chats</dt><dd data-summary="active_sessions">0</dd></div>
              <div><dt>Policy</dt><dd>${escapeHtml(`${model.writeMode} / ${model.bashMode}`)}</dd></div>
              <div><dt>Uptime</dt><dd data-summary="uptime">—</dd></div>
            </dl>
          </section>

          <div class="overview-grid reveal">
            <section class="surface session-surface" aria-labelledby="live-chats-title">
              <div class="surface-head">
                <div><p class="section-index">01 / Live routing</p><h2 id="live-chats-title">Chats in motion</h2></div>
                <a href="#chats" data-view-target="chats" class="signal-link">View all</a>
              </div>
              <div class="session-ledger" data-session-list="compact" aria-live="polite">
                <div class="loading-state"><span></span><span></span><span></span></div>
              </div>
            </section>

            <aside class="surface connection-surface" aria-labelledby="current-connection-title">
              <div class="surface-head"><div><p class="section-index">02 / Connection</p><h2 id="current-connection-title">Ready for ChatGPT</h2></div></div>
              <p class="connection-description">The private token stays in the copied URL. No second authentication field is required in ChatGPT.</p>
              <div class="endpoint-block">
                <span>Current Server URL</span>
                <code data-current-endpoint>${escapeHtml(endpointDisplay)}</code>
              </div>
              <div class="button-row">
                <button class="button primary" type="button" ${copyEndpoint}>Copy URL</button>
                <a class="button quiet" href="#connection" data-view-target="connection">Connection details</a>
              </div>
            </aside>
          </div>

          <section class="ledger-section reveal" aria-labelledby="activity-title">
            <div class="surface-head">
              <div><p class="section-index">03 / Content-free telemetry</p><h2 id="activity-title">Recent activity</h2></div>
              <p>Tool, outcome, duration. Never prompts or file contents.</p>
            </div>
            <div class="activity-ledger" data-activity-list="compact" aria-live="polite">
              <div class="empty-state"><strong>No tool calls yet</strong><p>Activity appears here after a connected ChatGPT conversation uses CodexFlow.</p></div>
            </div>
          </section>
        </section>

        <section class="app-view" id="projects" data-view-group="projects" aria-labelledby="projects-title">
          <header class="view-header compact reveal">
            <div><p class="eyebrow">Synchronized locally</p><h1 id="projects-title" tabindex="-1">Projects,<br><em>already here.</em></h1></div>
            <p>CodexFlow combines your default workspace, allowed roots, recognizable repositories, and recent Codex project metadata. Nothing needs to be registered folder by folder.</p>
          </header>
          <div class="index-toolbar reveal">
            <label class="search-field"><span class="sr-only">Filter projects</span><input type="search" placeholder="Filter by project or path" data-project-search autocomplete="off"><kbd>/</kbd></label>
            <button class="button quiet" type="button" data-refresh-projects>Refresh projects</button>
          </div>
          <section class="project-index reveal" aria-label="Discovered projects">
            <div class="index-head" aria-hidden="true"><span>Project</span><span>Source</span><span>Last active</span></div>
            <div data-project-list aria-live="polite"><div class="loading-state"><span></span><span></span><span></span></div></div>
          </section>
          <aside class="boundary-note reveal">
            <span>Selection happens in ChatGPT</span>
            <p>This companion observes routing but cannot silently move a live conversation to another folder. Each chat chooses its own project through the CodexFlow picker.</p>
          </aside>
        </section>

        <section class="app-view" id="chats" data-view-group="chats" aria-labelledby="chats-title">
          <header class="view-header compact reveal">
            <div><p class="eyebrow">Independent routing</p><h1 id="chats-title" tabindex="-1">One broker.<br><em>Many threads.</em></h1></div>
            <p>Each MCP conversation gets its own random transport session and selected project. Display identifiers here are fingerprints only; they cannot be used to access a chat.</p>
          </header>
          <section class="surface reveal" aria-labelledby="session-index-title">
            <div class="surface-head"><div><p class="section-index">01 / Current process</p><h2 id="session-index-title">Chat sessions</h2></div><span class="count-label" data-session-count>0 active</span></div>
            <div class="session-ledger detailed" data-session-list="all" aria-live="polite"><div class="loading-state"><span></span><span></span><span></span></div></div>
          </section>
          <section class="ledger-section reveal" aria-labelledby="all-activity-title">
            <div class="surface-head"><div><p class="section-index">02 / Activity</p><h2 id="all-activity-title">Runtime ledger</h2></div><p>Memory-only and bounded to this process.</p></div>
            <div class="activity-ledger" data-activity-list="all" aria-live="polite"></div>
          </section>
        </section>

        <section class="app-view" id="connection" data-view-group="connection" aria-labelledby="connection-title">
          <header class="view-header compact reveal">
            <div><p class="eyebrow">One-time bridge</p><h1 id="connection-title" tabindex="-1">Connect once.<br><em>Then just work.</em></h1></div>
            <p>The bare command discovers your projects and starts the broker. Add the copied Server URL to ChatGPT once; stable tunnels can keep it unchanged across restarts.</p>
          </header>

          <section class="connection-runway reveal" aria-labelledby="runway-title">
            <div class="runway-intro">
              <p class="signal-label"><span></span> ${escapeHtml(model.authLabel)}</p>
              <h2 id="runway-title">Current connection</h2>
              <code>${escapeHtml(endpointDisplay)}</code>
              <div class="button-row"><button class="button primary" type="button" ${copyEndpoint}>Copy Server URL</button><a class="button inverse" href="${escapeHtml(model.chatgptUrl)}" target="_blank" rel="noreferrer">Open ChatGPT settings</a></div>
            </div>
            <ol class="runway-steps">
              <li><span>01</span><div><strong>Developer mode on</strong><p>Open ChatGPT’s app/plugin settings.</p></div></li>
              <li><span>02</span><div><strong>Create CodexFlow</strong><p>Choose a Server URL connection.</p></div></li>
              <li><span>03</span><div><strong>Paste and connect</strong><p>Use no extra authentication; the URL is already protected.</p></div></li>
            </ol>
          </section>

          <div class="reveal">${model.profileHtml}</div>
        </section>

        <section class="app-view" id="policy" data-view-group="policy" aria-labelledby="policy-title">
          <header class="view-header compact reveal">
            <div><p class="eyebrow">Local trust boundary</p><h1 id="policy-title" tabindex="-1">Capability,<br><em>made legible.</em></h1></div>
            <p>These are the rules active for this process. Saved profile changes take effect only after restart, so a browser action cannot silently widen a live ChatGPT session.</p>
          </header>

          <div class="policy-grid reveal">
            <section class="surface policy-surface" aria-labelledby="runtime-policy-title">
              <div class="surface-head"><div><p class="section-index">01 / This run</p><h2 id="runtime-policy-title">Runtime policy</h2></div><span class="status-chip">active</span></div>
              <div class="policy-ledger">
                ${policyRow("Workspace write", model.writeMode, model.writeMode === "workspace" ? "signal" : "quiet")}
                ${policyRow("Terminal", `${model.bashMode} / ${model.bashTranscript}`, model.bashMode === "full" ? "warn" : "signal")}
                ${policyRow("Tool surface", model.toolMode)}
                ${policyRow("Codex history", model.codexSessions, model.codexSessions === "off" ? "quiet" : "warn")}
                ${policyRow("Authentication", model.authLabel, "signal")}
                ${policyRow("Widget origin", model.widgetDomain)}
              </div>
            </section>

            <aside class="surface data-surface" aria-labelledby="data-boundary-title">
              <div class="surface-head"><div><p class="section-index">02 / Telemetry</p><h2 id="data-boundary-title">What this app remembers</h2></div></div>
              <ul class="data-boundary">
                <li data-state="yes"><span>Retained briefly</span><strong>Project, tool name, outcome, duration</strong></li>
                <li data-state="no"><span>Never retained</span><strong>Prompts, arguments, source, command output, tokens</strong></li>
                <li data-state="no"><span>Never exposed</span><strong>Actionable MCP transport identifiers</strong></li>
              </ul>
            </aside>
          </div>

          <section class="root-ledger reveal" aria-labelledby="roots-title">
            <div class="surface-head"><div><p class="section-index">03 / Filesystem scope</p><h2 id="roots-title">Allowed roots</h2></div><span class="count-label">${model.allowedRoots.length} root${model.allowedRoots.length === 1 ? "" : "s"}</span></div>
            <ol>${allowedRoots}</ol>
          </section>

          <section class="surface cli-surface reveal" aria-labelledby="cli-title">
            <div class="surface-head"><div><p class="section-index">04 / Restart controls</p><h2 id="cli-title">CLI recipes</h2><p>Copy a command when you intentionally want a different policy on the next run.</p></div></div>
            <div class="controls">${model.controlsHtml}</div>
          </section>
        </section>
      </main>

      <footer class="app-footer">
        <p>CodexFlow is an independent open-source local workspace bridge. It does not run Codex, proxy models, or bypass account limits.</p>
        <nav aria-label="Resources"><a href="${escapeHtml(model.githubUrl)}" target="_blank" rel="noreferrer">GitHub</a><a href="${escapeHtml(model.npmUrl)}" target="_blank" rel="noreferrer">npm</a><a href="${escapeHtml(model.docsUrl)}" target="_blank" rel="noreferrer">Docs</a></nav>
      </footer>
    </div>
  </div>

  <div class="toast" data-toast role="status" aria-live="polite" aria-atomic="true"></div>
  <noscript><div class="noscript">Live projects and chat telemetry require JavaScript. The connection profile remains available further down this page.</div></noscript>
</body>
</html>`;
}
