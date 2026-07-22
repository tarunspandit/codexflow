# Public Launch Checklist

codexflow is a local developer bridge. Treat public launch readiness as two separate gates:

1. The npm package is safe and understandable for local developers.
2. The ChatGPT app surface is stable enough for users to connect through Developer Mode.

Do not present CodexFlow as a fully reviewed public ChatGPT app until it has gone through the current app review flow.

## Release Gate

Run these before tagging a release:

```bash
npm install --package-lock-only
npm run build
npm run desktop:build
npm run smoke
npm run stress
npm pack --dry-run
codexflow doctor --tunnel none
npm view CodexFlow version dist-tags --json
```

After publishing, do not announce npm availability until the `latest` dist-tag matches `package.json`.

The tarball must not include:

```text
.env files
local tunnel URLs
codexflow tokens
Cloudflare or ngrok tokens
.ai-bridge runtime files
node_modules
local screenshots or reports
```

## ChatGPT App Gate

Before announcing broadly:

- Test in ChatGPT Developer Mode with a fresh app install.
- Test quick tunnel, saved ngrok domain, and local-only mode.
- Refresh actions after widget URI or metadata changes.
- Confirm CSP stays enabled in Developer Mode.
- Capture screenshots for:
  - native desktop Now, Projects, Environments, Worktrees, Chats, Connection, and Policy views
  - native desktop offline, starting, live, degraded, error, and stopping states
  - native app connection screen and workspace picker
  - compact browser fallback at desktop and 320px widths
  - `server_config`
  - `open_current_workspace`
  - one `write`
  - one `edit`
  - one `search`
  - one failure state
- Run the same golden prompts on each release and compare behavior.

Suggested golden prompts:

```text
Use CodexFlow. Call server_config, then open_current_workspace with include_tree=false. Read README.md and summarize the project without editing files.
```

```text
Use CodexFlow. Create a small static site from PRODUCT.md by writing index.html, styles.css, and README.md. Verify with one targeted search.
```

```text
Use CodexFlow. Try to read .env. Explain why the request is blocked.
```

```text
Use CodexFlow. Run bash with pwd, then run bash with a blocked command. Report both outcomes.
```

## Security Gate

- Keep auth enabled for public tunnels.
- Keep `CODEXFLOW_BASH_MODE=safe` by default.
- Keep `CODEXFLOW_WRITE_MODE=workspace` only for agent mode.
- Keep blocked path tests for `.env`, `.git`, `node_modules`, private keys, and symlink escapes.
- Do not broaden allowed roots during setup unless the user explicitly asks.
- Do not log query strings, tokens, file contents, prompts, or full command output by default.
- Confirm `/api/overview` and `/api/events` require auth and never expose prompts, arguments, source, command output, URL tokens, or actionable transport IDs.
- Confirm the bundled app is universal, ad-hoc signed, self-contained, and contains no host-specific build metadata.
- Confirm `codexflow app` opens the native app while the broker is offline or live without printing its private URL.
- Confirm the native app can start, stop, restart, and reconnect to a broker in a temporary home.
- Confirm the complete Server URL is only copied after an explicit action and is never rendered or logged.

## Onboarding Gate

Fresh-user setup should work with:

```bash
npx codexflow@latest
```

The terminal must clearly show:

- workspace root
- current mode
- public URL strategy
- that the Server URL is copied
- that Enter opens ChatGPT connector settings
- that `o` or `codexflow app` opens the native desktop app
- how to stop the process

For stable URLs, `codexflow` must save enough profile state so future starts from the same workspace only need:

```bash
codexflow
```

On macOS 14 or newer this same command must install or refresh the bundled app in
`~/Applications`, open it automatically in an interactive terminal, and require
no additional desktop setup. The authenticated browser page is a recovery
fallback, not an onboarding destination.

## Known Non-Goals For The Current Local Package

- CodexFlow is not an OS sandbox.
- CodexFlow does not guarantee a ChatGPT model can call MCP tools.
- CodexFlow does not change ChatGPT, Codex, or OpenAI quota behavior.
- Quick Cloudflare tunnels are not permanent URLs.
- A single shared public URL for every user requires a hosted relay architecture, not only a local npm package.
