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
- review changed files with `show_changes`
- write handoff plans under `.ai-bridge`
- export a selected context bundle for model surfaces that cannot call tools

CodexFlow is not a hosted service, model proxy, quota bypass, account pool, or OS sandbox.
It connects your own ChatGPT session to your own local repo through the official Developer Mode / MCP app path.

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

## Normal Commands

```bash
codexflow
codexflow --root /path/to/repo
codexflow status
codexflow status --json
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

Tool cards are opt in:

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
- `apply_patch` is workspace-scoped and rejects blocked paths, symlink patches, and secret-looking patch content.
- `show_changes` keeps a review checkpoint so repeated unchanged reviews collapse.
- Tool-card metadata is off unless `CODEXFLOW_TOOL_CARDS=1`.

Read [SECURITY.md](SECURITY.md) before exposing CodexFlow through any tunnel.

## RAM And ChatGPT Memory

codexflow can reduce what it sends to ChatGPT. Current local fixes:

- binary-file checks scan with a reusable 64 KiB buffer instead of allocating the whole file
- ChatGPT tool-card structured payloads are compacted only for card output, not for normal tool data
- bash chat transcripts stay compact by default

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

When CodexFlow is activated in a new ChatGPT conversation, `list_projects` opens a picker. It combines the default project, projects found below configured allowed roots, and recent project folders recorded in local Codex metadata. Choosing one calls `select_project` and binds that MCP conversation to the folder. Later file, search, edit, git, and bash calls can omit `workspace_id`; they route to the selected project. Other ChatGPT conversations keep independent selections through the same tunnel.

Project selection also advertises repository instructions, workspace/user/plugin skills, and configured MCP server names. The model can load applicable skills with `load_skill`. CodexFlow does not execute the Codex CLI or claim that these ChatGPT conversations are native Codex sessions.

No project registration is required. Local Codex session metadata supplies the project directories automatically; `--root` and `--allow-root` remain optional overrides.

## Troubleshooting

Run:

```bash
codexflow doctor
```

Common fixes:

- Quick tunnel URL changed: rerun `codexflow` and update the ChatGPT app Server URL.
- Stable URL does not respond: check the tunnel provider first, then the CodexFlow token.
- ChatGPT cannot call tools in one model/chat: switch to a ChatGPT surface that supports Developer Mode app actions.
- Local port is busy: start another repo with `--port 8788`.
- Tool list looks stale: create a new ChatGPT app entry or change the connector URL token.
- Check whether the launcher is still running with `codexflow status`; a stale runtime record means the original process exited.

## Development

```bash
npm install
npm run build
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
- [Changelog](CHANGELOG.md)
