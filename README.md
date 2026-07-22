<p align="center">
  <a href="https://tarunspandit.github.io/codexflow/"><img src="docs/og.png" width="900" alt="CodexFlow — One command. Every project. Any chat."></a>
</p>

<h1 align="center">CodexFlow</h1>

<p align="center">
  One command turns ChatGPT on the web into a project-aware coding agent for your local machine.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tarunspandit/codexflow"><img alt="npm" src="https://img.shields.io/npm/v/@tarunspandit/codexflow?style=flat-square"></a>
  <a href="https://github.com/tarunspandit/codexflow/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/tarunspandit/codexflow/ci.yml?branch=main&style=flat-square"></a>
  <a href="https://github.com/tarunspandit/codexflow/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/tarunspandit/codexflow?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://tarunspandit.github.io/codexflow/">Website</a> ·
  <a href="https://www.npmjs.com/package/@tarunspandit/codexflow">npm</a> ·
  <a href="FAQ.md">FAQ</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="README_ZH.md">中文</a>
</p>

CodexFlow is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by OpenAI. Codex, ChatGPT, and OpenAI are referenced only to explain compatibility and remain the property of their respective owner.

## Install

Requirements:

- Node.js 20+
- A ChatGPT account with Apps / Developer Mode access
- One HTTPS route to your local machine when connecting ChatGPT from the web

> **Model compatibility:** use Extra High or another non-Pro model. ChatGPT's
> Pro model variants do not expose Apps, even though a Pro subscription can use
> Apps with supported models. If CodexFlow is absent from a reply, switch the
> model—not the local broker.

> **New chats:** the first app row under `+` is a ranked subset, not the complete
> plugin catalog. Choose `+` → More and search for `CodexFlow`. The same app can
> be active in multiple conversations at once; each conversation receives its
> own private project route through the shared broker.

Install the CLI:

```bash
npm install -g @tarunspandit/codexflow
```

Then run exactly one command from anywhere:

```bash
codexflow
```

CodexFlow discovers project folders from local Codex metadata, starts the local broker and Cloudflare tunnel, then prints and copies the Server URL. In ChatGPT, open:

```text
Settings -> Security and login -> Developer mode: on
Settings -> Plugins -> Create
```

Paste the Server URL and choose `Authentication: No Authentication / None`.
CodexFlow uses its own URL token.

## What It Does

CodexFlow starts one local MCP server for all discovered projects. Each ChatGPT conversation chooses its own project and can then:

- read files and inspect the repo
- search code
- make scoped edits with `write`, `edit`, or guarded `apply_patch`
- run safe verification commands through `bash`
- keep per-chat shell state and interactive/background processes through `terminal`
- reuse Codex-compatible `.codex/environments/*.toml` setup, cleanup, and project actions
- review changed files with `show_changes`
- create isolated managed worktrees, hydrate selected ignored setup files through `.worktreeinclude`, and hand changes between local and parallel checkouts
- prepare recurring local-project runs for ChatGPT Scheduled without adding another model backend
- stage, unstage, discard explicit paths, branch, commit, push, and open pull requests through approval-visible Git actions
- approve named SSH hosts, save canonical remote project folders, and route bounded file, search, edit, patch, Bash, persistent terminal, environment, skill, analysis, Git review, and managed-worktree tools to them from the same project picker
- write handoff plans under `.ai-bridge`
- export a selected context bundle for model surfaces that cannot call tools

CodexFlow is not a hosted service, model proxy, quota bypass, account pool, or OS sandbox.
It connects your own ChatGPT session to your own local repo through the official Developer Mode / MCP app path.

## Native Desktop App

On macOS 14 or newer, the first `codexflow` launch installs the bundled native
app into `~/Applications` and opens it automatically. Press `o` in the CodexFlow
terminal to bring it forward, or open it directly at any time—even before the
broker is running:

```bash
codexflow app
```

The app is not a second chat or model client. ChatGPT still owns the
conversation. The native app makes the broker legible and controllable:

- **Now** shows connection health, project count, active chats, and recent activity.
- **Projects** shows the folders CodexFlow discovered automatically.
- **Environments** shows the project’s shared Codex environment definitions and runs setup, cleanup, or named actions.
- **Worktrees** creates, reveals, audits, and safely removes isolated checkouts.
- **Changes** separates staged and unstaged files, renders bounded color-coded diffs, stages/unstages/reverts individual hunks, and keeps line-anchored review notes visible to `show_changes` in the web chat.
- **Chats** shows independent project routing for real tool-using conversations, with local search, rename, pin, archive, and restore controls; background MCP discovery and component-fetch connections are deliberately hidden.
- **Hosts** discovers concrete aliases from `~/.ssh/config`, requires bounded local OpenSSH verification, saves canonical remote project folders, and revokes routing automatically if an alias resolves to a different destination.
- **Connection** provides the private Server URL without displaying its credential.
- **Policy** shows the effective boundary and edits protected next-launch defaults.

The app can choose a workspace, start, stop, and restart its broker, and switch
among multiple local runtimes. It calls the existing CodexFlow broker and never
uses the Codex CLI as an execution backend. The authenticated browser page is a
small recovery fallback only; it no longer duplicates the application.

Remote projects use CodexFlow's own ephemeral Node helper over non-interactive
OpenSSH; Codex and the Codex CLI are never installed or invoked on the host.
Only concrete aliases already present in SSH config can be approved. Every call
rechecks the destination fingerprint, canonical project root, blocked paths,
symlink containment, size limits, and the current write/Bash policy. Remote
persistent terminals keep cwd, environment, background process, input, and
transcript state private to one chat. The same route discovers and executes
host-platform Codex environment files, advertises guarded remote workspace
skills, and builds bounded repository analysis. Remote managed worktrees and
source/worktree handoff use the same private route: creation registers the
isolated checkout in the picker, environment setup follows the route, guarded
handoff refuses an independently changed destination, and removal runs cleanup
before saving a bounded dirty-state snapshot. Cross-machine transfer is not
implicit; each managed pair remains on its approved host.

Operational session telemetry stays in process memory, is bounded, and expires
shortly after a chat closes. It contains only a non-actionable display
fingerprint, selected project, tool name, outcome, and duration. Explicit local
rename/pin/archive choices and native review notes are persisted separately in
owner-only metadata files so the native app can restore them and `show_changes`
can receive deliberate review feedback. CodexFlow never stores prompts, tool
arguments, file contents, command output, tokens, or usable MCP transport IDs.

## Repository Analysis

CodexFlow builds a bounded repository map from local manifests, source declarations, imports, tests, and Git state. It provides:

- `inspect_workspace` for languages, project types, entrypoints, areas, symbols, and relationships
- optional structured `search` intents: `text`, `symbol`, `references`, and `impact`
- affected-area, risk, related-test, and focused-command recommendations in `show_changes`
- matching read-only terminal views:

```bash
codexflow inspect --root /path/to/repo
codexflow review --root /path/to/repo
codexflow inspect --root /path/to/repo --json
```

The analysis is deterministic and local. It uses confidence labels instead of claiming compiler precision, stays within configured file/byte/symbol limits, and falls back to normal lexical search and Git review when analysis is incomplete.

Set `CODEXFLOW_ANALYSIS=0` to disable repository analysis without changing the rest of the connector.

## Shared Local Environments

CodexFlow reads the same checked-in local environment format as the Codex desktop app. Put one or more version-1 TOML files in `.codex/environments/`; nested projects can also inherit definitions from an allowed parent root.

```toml
version = 1
name = "Local development"

[setup]
script = "npm install"

[cleanup]
script = "npm run clean"

[[actions]]
name = "Tests"
icon = "test"
command = "npm test"
```

Select an environment from ChatGPT or the native app. New managed worktrees run its setup automatically and receive `CODEX_SOURCE_TREE_PATH` and `CODEX_WORKTREE_PATH`. Add gitignored files such as local fixtures to `.worktreeinclude` when they should be copied into new worktrees. No Codex process is started.

## Scheduled Project Work

ChatGPT web already owns scheduling, model selection, cadence, and run history. When a recurring task needs this computer, ask ChatGPT to use CodexFlow and schedule it. CodexFlow’s `prepare_scheduled_task` tool produces the durable run prompt: every run gets a fresh private route, selects the project by stable ID, restores the chosen local environment, and can create a clean managed worktree before doing the work.

The default prompt verifies changes, calls `show_changes`, leaves the worktree available for review, and does not push or publish. The computer must stay awake, CodexFlow must stay running, and the ChatGPT plugin must use a stable URL. CodexFlow does not create a cron job, invoke Codex, or run a model itself.

## Native Computer Use

When structured project tools are not enough, a web chat can request one exact running macOS app through `computer_use`. Open the native **Computer** workspace to allow it once or persist access, then approve each press or text/key action locally. Observations are fresh, route-bound window captures plus bounded accessibility elements; actions never use arbitrary model-supplied coordinates.

Approvals are tied to the app’s validated code-signing identity, and a replaced binary must be approved again. Terminal apps, ChatGPT/CodexFlow, System Settings, browser apps, secure fields, and secret-looking text are blocked from this generic app-control path.

## Native Browser Use

Website work uses the separate `browser_use` boundary. A routed chat requests one exact HTTP(S) origin; the native **Browser** workspace lets you deny it, allow it for that chat for ten minutes, or persist the origin until revocation. Approved pages open in visible WebKit tabs backed by a non-persistent profile, never in Safari, Chrome, or your personal browser session.

The chat receives a fresh screenshot and bounded semantic DOM targets rather than cookies or arbitrary coordinates. Clicks, text entry, and consequential keys require a local confirmation sealed to one route, tab, snapshot, element, operation, and value. Cross-origin navigation, popup windows, downloads, browser permission prompts, authentication/account-security/payment pages, password values, embedded URL credentials, and secret-looking input fail closed.

## Normal Commands

```bash
codexflow
codexflow --root /path/to/repo
codexflow status
codexflow status --json
codexflow app
codexflow doctor
codexflow connection-test --root /path/to/repo
codexflow settings
codexflow inspect
codexflow review
```

Useful modes:

```bash
codexflow --no-bash
codexflow --tool-mode minimal
codexflow --tool-mode full
codexflow --mode handoff
codexflow --mode pro
```

If ChatGPT cannot create the plugin, run `codexflow connection-test`. It keeps
the normal read, tree, search, and skill tools, disables writes, bash, and tool
cards, and logs whether a request reached the local MCP endpoint.

Rich result cards are opt in. The small project picker remains available, but it
is never a prerequisite: if a client cannot render it, reply with the exact
project name and CodexFlow routes the chat through the same `select_project` tool.

```bash
CODEXFLOW_TOOL_CARDS=1 codexflow
```

## Public URL Options

ChatGPT web needs a public HTTPS Server URL. CodexFlow supports:

- Fast demo URL: `codexflow --tunnel cloudflare`
- Stable ngrok domain: `codexflow ngrok --hostname your-domain.ngrok-free.dev`
- Stable Cloudflare route: `codexflow stable --hostname codexflow.example.com --tunnel-name codexflow`
- Tailscale Funnel: `codexflow tailscale --hostname your-device.your-tailnet.ts.net`
- Local only: `codexflow --tunnel none`

Cloudflare quick tunnels honor `HTTPS_PROXY`, `ALL_PROXY`, or `HTTP_PROXY` when those env vars are set.

Stable modes should use a stable CodexFlow token:

```bash
codexflow tailscale \
  --hostname your-device.your-tailnet.ts.net \
  --token keep-this-token-stable
```

Tailscale Funnel must already be allowed for your tailnet. It requires MagicDNS, HTTPS certificates, and Funnel policy support. CodexFlow runs:

```bash
tailscale funnel http://127.0.0.1:8787
```

Then ChatGPT uses:

```text
https://your-device.your-tailnet.ts.net/mcp?codexflow_token=keep-this-token-stable
```

## Safety Defaults

- Public tunnel mode requires a CodexFlow HTTP token.
- Generic writes are hidden unless `CODEXFLOW_WRITE_MODE=workspace`.
- Safe bash blocks broad shell patterns and secret/build/cache paths.
- Persistent terminals are isolated by private chat route; interactive input requires full bash mode.
- Local-environment scripts are trusted project code and run only when workspace writes and shell execution are enabled.
- Managed handoff fingerprints both checkouts and refuses to overwrite a destination that changed independently.
- Git commits reject staged files outside the selected project; discard always requires explicit paths.
- `apply_patch` is workspace-scoped and rejects blocked paths, symlink patches, and secret-looking patch content.
- `show_changes` keeps a review checkpoint so repeated unchanged reviews collapse.
- Tool-card metadata is off unless `CODEXFLOW_TOOL_CARDS=1`.

Read [SECURITY.md](SECURITY.md) before exposing CodexFlow through any tunnel.

## RAM And ChatGPT Memory

codexflow can reduce what it sends to ChatGPT. Current local fixes:

- binary-file checks scan with a reusable 64 KiB buffer instead of allocating the whole file
- ChatGPT tool-card structured payloads are compacted only for card output, not for normal tool data
- bash chat transcripts stay compact by default
- local companion activity is memory-only, bounded, and content-free

That helps avoid oversized MCP/card payloads. It does not force Chrome, ChatGPT, or an old browser iframe to release memory that the client already holds. If the browser tab has already grown, reload the ChatGPT page or restart the browser.

## Repo Context

codexflow uses explicit files, not hidden chat memory:

```text
AGENTS.md
.ai-bridge/current-plan.md
.ai-bridge/agent-status.md
.ai-bridge/decisions.md
.ai-bridge/open-questions.md
.ai-bridge/execution-log.jsonl
```

For non-tool model surfaces:

```bash
codexflow --mode pro
```

Or from a local checkout:

```bash
codexflow pro-bundle --root /path/to/repo --copy
codexflow pro-apply --root /path/to/repo --file plan.md
```

## Handoff

ChatGPT can write a plan without executing a local agent:

```bash
codexflow --mode handoff
```

For scripts, CI, or a terminal without interactive controls, keep the server running with signals instead of the keyboard panel:

```bash
codexflow --non-interactive
codexflow status --json
```

Then you run execution locally:

```bash
codexflow execute-handoff --agent codex --yes
codexflow watch-handoff --agent codex --yes
```

`handoff_to_agent` is planning-only over MCP. CodexFlow does not expose arbitrary local agent execution as a remote ChatGPT tool.

## Codex-style web chats across projects

One CodexFlow process and one tunnel can route many ChatGPT conversations to different local projects. ChatGPT supplies the model; CodexFlow supplies the repository, file, git, terminal, instructions, and skill tools. It never starts or resumes the Codex CLI.

```bash
codexflow --tool-mode full \
  --root /path/to/default-repo --allow-root /path/to/projects
```

When CodexFlow is activated in a new ChatGPT conversation, `list_projects` opens a picker. It combines the default project, projects found below configured allowed roots, and recent project folders recorded in local Codex metadata. Choosing one creates an opaque private `route_id`, binds that route to the folder, and publishes the exact route into the chat's model context. Every later file, search, edit, Git, worktree, and terminal call carries the route, even when ChatGPT opens a new MCP transport for the call. Other conversations receive different route IDs through the same tunnel, and owner-only local route state restores those bindings after broker restarts.

Project selection also advertises repository instructions, workspace/user/plugin skills, and configured MCP server names. The model can load applicable skills with `load_skill`. CodexFlow does not execute the Codex CLI or claim that these ChatGPT conversations are native Codex sessions.

No project registration is required. Local Codex session metadata supplies the project directories automatically; `--root` and `--allow-root` remain optional overrides.

## Troubleshooting

Run:

```bash
codexflow doctor
```

Common fixes:

- CodexFlow is missing from a new chat's first app row: choose `+` → More and search for `CodexFlow`; the suggestion row is not the full plugin list.
- Two CodexFlow entries appear: keep the entry connected to the current Server URL and remove the stale duplicate under ChatGPT Settings → Plugins.
- Quick tunnel URL changed: rerun `codexflow` and update the ChatGPT app Server URL.
- Stable URL does not respond: check the tunnel provider first, then the CodexFlow token.
- ChatGPT cannot call tools in one model/chat: switch to a ChatGPT surface that supports Developer Mode app actions.
- Local port is busy: start another repo with `--port 8788`.
- Tool list looks stale: create a new ChatGPT app entry or change the connector URL token.
- Check whether the launcher is still running with `codexflow status`; a stale runtime record means the original process exited.
- Reopen the native desktop app with `codexflow app`; it can start the workspace broker if it is offline.
- If the native app is unavailable, open the authenticated local browser URL shown by the running broker for compact fallback diagnostics.

## Development

```bash
npm install
npm run build
npm run desktop:build
npm run smoke
npm run stress
```

Useful release checks:

```bash
npm run build
npm run smoke
CODEXFLOW_TOOL_CARDS=1 npm run smoke
npm audit --audit-level=high
npm pack --dry-run
git diff --check
```

## Docs

- [Product website](https://tarunspandit.github.io/codexflow/)
- [GitHub repository](https://github.com/tarunspandit/codexflow)
- [FAQ](FAQ.md)
- [Security](SECURITY.md)
- [Stable URL guide](DOMAIN_SETUP.md)
- [Codex desktop parity matrix](CODEX_DESKTOP_PARITY.md)
- [Changelog](CHANGELOG.md)
