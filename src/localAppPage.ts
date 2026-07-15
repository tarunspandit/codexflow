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

export function renderLocalAppPage(model: LocalAppPageModel): string {
  const endpointBase = model.endpointBase || model.localMcp;
  const endpointDisplay = model.endpointDisplay || model.localMcp;
  const deepLink = `codexflow://open?root=${encodeURIComponent(model.defaultRoot)}`;
  const visibleRoots = model.allowedRoots.slice(0, 8);
  const remainingRoots = Math.max(0, model.allowedRoots.length - visibleRoots.length);
  const roots = visibleRoots
    .map((root) => `<li><span aria-hidden="true"></span><code>${escapeHtml(root)}</code></li>`)
    .concat(remainingRoots ? [`<li class="more-roots"><span aria-hidden="true">+</span><strong>${remainingRoots} more in the desktop app</strong></li>`] : [])
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#08090b">
  <meta name="description" content="The authenticated browser fallback for the native CodexFlow desktop app.">
  <link rel="icon" href="/favicon.ico">
  <link rel="preload" href="/brand/geologica.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/brand/control.css">
  <script src="/brand/control.js" defer></script>
  <title>CodexFlow — Browser fallback</title>
</head>
<body data-version="${escapeHtml(model.version)}" data-auth-enabled="${model.authLabel === "Token protected" ? "true" : "false"}">
  <a class="skip-link" href="#fallback-main">Skip to fallback controls</a>
  <div class="ambient-grid" aria-hidden="true"></div>

  <header class="fallback-header">
    <a class="product-lockup" href="${escapeHtml(model.docsUrl)}" aria-label="CodexFlow product home">
      <span class="product-mark" aria-hidden="true">
        <img src="/brand/flow7-tech-dark.webp" alt="" width="1024" height="1024">
      </span>
      <span class="product-name">Codex<span>Flow</span></span>
    </a>
    <div class="header-status" data-broker-state="loading" aria-live="polite">
      <span class="status-light" aria-hidden="true"></span>
      <span><strong data-state-label>Checking broker</strong><small>Browser fallback</small></span>
    </div>
  </header>

  <main id="fallback-main" tabindex="-1">
    <section class="fallback-card" aria-labelledby="fallback-title">
      <div class="fallback-copy">
        <p class="eyebrow"><span aria-hidden="true">↗</span> Native app is primary</p>
        <h1 id="fallback-title">CodexFlow lives<br>on your <em>desktop.</em></h1>
        <p class="lede">This browser tab is the fallback—not the control surface. Open the native app for workspaces, chats, connection state, policy, and broker controls in one place.</p>
        <div class="primary-actions">
          <a class="button primary" href="${escapeHtml(deepLink)}" data-desktop-deep-link>Open CodexFlow</a>
          <button class="button secondary" type="button" data-copy-server data-endpoint-base="${escapeHtml(endpointBase)}">Copy Server URL</button>
        </div>
        <p class="install-note">If the app does not open, run <code>codexflow app</code> once from Terminal. No additional setup is required.</p>
      </div>

      <aside class="runtime-signal" aria-label="Current broker summary">
        <div class="signal-orbit" aria-hidden="true">
          <span class="orbit orbit-one"></span>
          <span class="orbit orbit-two"></span>
          <img src="/brand/flow7-tech-dark.webp" alt="" width="1024" height="1024">
          <i></i>
        </div>
        <dl>
          <div><dt>State</dt><dd data-summary="state">Checking</dd></div>
          <div><dt>Projects</dt><dd data-summary="projects">—</dd></div>
          <div><dt>Active chats</dt><dd data-summary="sessions">—</dd></div>
          <div><dt>Uptime</dt><dd data-summary="uptime">—</dd></div>
        </dl>
      </aside>
    </section>

    <details class="diagnostics" data-diagnostics>
      <summary>
        <span><strong>Fallback diagnostics</strong><small>Only if the desktop app cannot connect</small></span>
        <span class="summary-action">Show details <b aria-hidden="true">+</b></span>
      </summary>
      <div class="diagnostic-body">
        <section aria-labelledby="connection-heading">
          <p class="section-label">01 / Connection</p>
          <h2 id="connection-heading">Current route</h2>
          <div class="route-card">
            <div><span>Server URL</span><code data-endpoint-display>${escapeHtml(endpointDisplay)}</code></div>
            <button class="text-button" type="button" data-copy-server data-endpoint-base="${escapeHtml(endpointBase)}">Copy private URL</button>
          </div>
          <div class="diagnostic-actions">
            <a class="button small" href="${escapeHtml(model.chatgptUrl)}" target="_blank" rel="noreferrer">Open ChatGPT settings</a>
            <button class="button small" type="button" data-refresh>Refresh state</button>
          </div>
        </section>

        <section aria-labelledby="policy-heading">
          <p class="section-label">02 / Effective policy</p>
          <h2 id="policy-heading">This broker run</h2>
          <dl class="policy-list">
            <div><dt>Mode</dt><dd>${escapeHtml(model.mode)}</dd></div>
            <div><dt>Workspace write</dt><dd>${escapeHtml(model.writeMode)}</dd></div>
            <div><dt>Terminal</dt><dd>${escapeHtml(`${model.bashMode} / ${model.bashTranscript}`)}</dd></div>
            <div><dt>Tool surface</dt><dd>${escapeHtml(model.toolMode)}</dd></div>
            <div><dt>Authentication</dt><dd>${escapeHtml(model.authLabel)}</dd></div>
          </dl>
        </section>

        <section class="roots-section" aria-labelledby="roots-heading">
          <p class="section-label">03 / Filesystem scope</p>
          <h2 id="roots-heading">Allowed roots</h2>
          <ul class="root-list">${roots}</ul>
        </section>
      </div>
    </details>
  </main>

  <footer class="fallback-footer">
    <p><span>CodexFlow ${escapeHtml(model.version)}</span> Independent, local-first, and open source.</p>
    <nav aria-label="Resources">
      <a href="${escapeHtml(model.githubUrl)}" target="_blank" rel="noreferrer">GitHub</a>
      <a href="${escapeHtml(model.npmUrl)}" target="_blank" rel="noreferrer">npm</a>
      <a href="${escapeHtml(model.docsUrl)}" target="_blank" rel="noreferrer">Docs</a>
    </nav>
    <img src="/brand/flow7-parent-dark.webp" alt="Flow7" width="1024" height="1024">
  </footer>

  <div class="toast" data-toast role="status" aria-live="polite" aria-atomic="true"></div>
  <noscript><div class="noscript">JavaScript is required to read live broker state. Run <code>codexflow app</code> to use the native application.</div></noscript>
</body>
</html>`;
}
