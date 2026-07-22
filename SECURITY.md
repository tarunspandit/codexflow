# Security Policy

codexflow exposes a local workspace to an MCP client. Treat it like a developer tool with access to your source tree, not like a hosted SaaS app.

## Supported Version

Security fixes target the latest published version only until the project reaches `1.0.0`.

Feature-specific notes follow GitHub `main`; npm users should check the published version before relying on a new command.

## Reporting

Please report security issues privately before opening a public issue. If the repository has GitHub private vulnerability reporting enabled, use that. Otherwise contact the maintainer listed by the project owner.

Do not include secrets, private repository contents, tunnel tokens, or `.env` values in reports.

## Terms Boundary

codexflow is not designed to bypass, avoid, pool, resell, or modify ChatGPT, Codex, OpenAI, or third-party model limits. Do not market, deploy, or configure it that way.

Each user should connect their own ChatGPT account, use only product surfaces available to that account, and follow the limits, safety rules, and terms for ChatGPT, Codex, OpenAI, and any third-party model provider they connect.

## Threat Model

codexflow can expose:

- file metadata and selected file contents from allowed workspaces
- git status and diffs
- explicit line-anchored review comments written in the native app and returned to the selected project’s `show_changes` calls
- bounded task titles, current-focus text, status, and plan steps explicitly reported by a routed web chat through `task_progress`
- `.ai-bridge` planning files
- optional shell command execution through the `bash` tool, hidden when bash mode is off
- optional write/edit/apply_patch capability depending on `CODEXFLOW_WRITE_MODE`, advertised only in workspace write mode
- optional native macOS Computer Use for one explicitly approved, code-signing-bound app, with fresh window captures and bounded accessibility metadata
- optional native browser use for one explicitly approved HTTP(S) origin, with an ephemeral WebKit profile, fresh screenshots, and bounded semantic DOM metadata
- optional local handoff execution through `codexflow execute-handoff`, run from the user's terminal only
- optional local execute/review looping through `codexflow loop-handoff`, run from the user's terminal only with a user-provided reviewer command and iteration limit

## Failure Model

Review changes against these failure modes before release:

| Failure mode | Expected control |
| --- | --- |
| Public tunnel reachable without a secret | Public/non-loopback HTTP fails closed unless a CodexFlow token is configured. |
| Raw CodexFlow or Cloudflare token appears in UI, logs, docs, or package output | Tokens are redacted in profile/status output and tunnel tokens use local files for persistence. |
| ChatGPT can edit outside the intended repo | Allowed roots are explicit; path resolution rejects escapes, blocked globs, and symlink traversal. |
| ChatGPT can run arbitrary shell by default | Bash defaults to safe mode, can be disabled, and full mode is a trusted-local-only choice. Safe mode can still run repo package scripts, so use `--no-bash` for untrusted repos. |
| Handoff mode still exposes generic writes | Handoff/pro modes do not advertise generic `write`/`edit`/`apply_patch`; bounded handoff tools write `.ai-bridge` files only. |
| Local Codex history is treated as ChatGPT memory | Codex session access is opt-in metadata/read mode and never attaches to a live Codex app session. |
| Desktop or browser controls mutate live runtime unexpectedly | Profile changes apply on restart; active runtime policy stays stable for the current session. |
| Native app becomes a prompt or source-content log | Session/activity telemetry is memory-only, bounded, expires shortly after close, and records only display fingerprints, project, tool name, outcome, and duration. |
| A web request introduces an arbitrary SSH destination | Host administration accepts only concrete aliases already present in the computer's SSH config; wildcard-only and unknown aliases are rejected. |
| An approved SSH alias is silently rerouted | Approval is tied to the resolved alias, host, user, and port fingerprint and becomes invalid when any of them changes. Verification is non-interactive, bounded, and requires an already trusted host key. |
| SSH administration exposes private keys | CodexFlow never returns or stores identity-file paths or key material; the owner-only approval record contains only alias trust metadata and a one-way destination fingerprint. |
| A remote project path escapes its saved folder | The remote helper canonicalizes the saved root on every call, rejects absolute/parent-relative tool paths, checks the closest existing parent for writes, blocks symlink traversal outside the root, and applies the same blocked-glob and byte limits as local tools. |
| A stale approval keeps routing after SSH config changes | Every project call resolves the concrete alias again and requires the saved host and project fingerprints to match before the helper starts. Disconnecting a host also removes its saved projects. |
| Remote shell input becomes an SSH command injection | Tool requests travel as JSON on SSH stdin; only a static CodexFlow-owned Node launcher is placed in the remote command. Bash commands are independently checked by the configured off/safe/full policy before transport. |
| One remote terminal leaks state into another chat | Persistent SSH shells are keyed by private route and approved project identity. Host/project fingerprints are revalidated before every run/read/write/stop action; transcripts are bounded and redacted, and route sessions never share shell processes. |
| A remote environment or skill escapes its project | Environment and skill discovery only traverses fixed project-owned roots, skips symlinks, limits file count and bytes, requires regular files, and resolves every returned path beneath the canonical saved project. Environment scripts require workspace write and Bash policy to be enabled. |
| Remote worktree handoff overwrites independent work | Source and destination must share one Git common directory and HEAD. Owner-only manifests retain both state fingerprints; handoff refuses a changed destination, transfer is byte-bounded, symlinks/non-files are rejected, and removal snapshots dirty tracked and untracked project state before deleting the checkout. |
| A stale or forged hunk action applies an unintended patch | The native app submits only a content-derived hunk ID. The authenticated broker resolves the guarded project path, regenerates the current raw Git diff, reconstructs the matching patch locally, checks it with `git apply --check`, and refuses missing, stale, staged-lane, or untracked-file mismatches. |
| Task supervision silently becomes prompt logging | Only the bounded fields deliberately sent through `task_progress` are written to the owner-only chat metadata file: title, optional focus detail, explicit status, and up to twelve short steps. General prompts, tool arguments, file contents, command output, and transport IDs remain excluded. |
| Native review notes leak into content-free telemetry | Review comments are deliberate user-authored project content stored separately in an owner-only mode-0600 file. They never enter runtime session/activity telemetry; they are returned only by authenticated Changes responses and the selected local project’s `show_changes`. Secret-looking comments are rejected. |
| A chat silently captures or controls an arbitrary app | Computer Use requires Screen Recording and Accessibility permission on the Mac, then a second CodexFlow-native app grant. Allow-once grants are route-private and expire; persistent grants are stored owner-only and can be revoked. |
| A different binary reuses an approved bundle identifier | Every app listing, snapshot, and action validates the executable signature and binds approval to its signing identifier, team, and code-directory hash. An identity change fails closed and requires fresh approval. |
| A stale or altered desktop action executes | Snapshots are route-bound and short-lived. Sensitive actions require a local confirmation sealed to the chat, app, snapshot, element, operation, and value; a successful action invalidates the snapshot. |
| Computer Use bypasses another safety boundary | Generic desktop control blocks terminals, ChatGPT/CodexFlow, System Settings, and browser apps. It refuses secure fields and secret-looking text. Website work is available only through the separate origin-scoped browser boundary. |
| A chat silently opens or controls an arbitrary website | Browser origins require a native grant. Allow-once grants are route-private and expire; persistent origins are owner-only and revocable. Cross-origin redirects are blocked until separately approved. |
| Browser state leaks personal sessions or credentials | Every tab uses a non-persistent WebKit data store rather than Safari/Chrome state. URL credentials, secret-looking query values, password contents/input, authentication hosts, and account-security, billing, checkout, and payment paths fail closed. |
| A stale or altered browser action executes | DOM snapshots are route/tab-bound and short-lived. Meaningful actions require local confirmation sealed to the route, tab, snapshot, DOM element, operation, and value; successful actions invalidate the snapshot. Downloads, popups, JavaScript dialogs, authentication challenges, and browser permission prompts are refused. |
| A displayed chat identifier can be replayed against MCP | The app exposes a one-way display fingerprint, never the random transport identifier used by the MCP endpoint. |
| Remote MCP tool runs Codex/OpenCode/Pi directly | Agent execution remains a user-started CLI/watch process on the local machine. |
| Autonomous loop drives ChatGPT Web or bypasses approvals | `loop-handoff` only runs local terminal commands over `.ai-bridge` files; it does not resume browser sessions, approve prompts, or expose a remote MCP executor. |
| Reviewer masks a failed external command | `loop-handoff` requires explicit reviewer verdict assignments and rejects reviewer `PASS` after failed executor, test, or reviewer commands unless the user opts into the supported executor/test override behavior. |

The main risks are:

- connecting an untrusted MCP client
- exposing the server through a public tunnel without auth
- running with `CODEXFLOW_BASH_MODE=full`
- running with `CODEXFLOW_WRITE_MODE=workspace` on an important repo
- executing an untrusted `.ai-bridge/current-plan.md` or custom `execute-handoff --command`
- running `loop-handoff` with an untrusted reviewer command or without a small `--max-iters`
- adding overly broad allowed roots
- leaking a `codexflow_token` or Cloudflare tunnel token
- sharing the authenticated browser-fallback URL, which initially carries the same CodexFlow URL token used for local authentication
- trusting a downloaded `cloudflared` binary without understanding where it came from
- approving an SSH alias whose OpenSSH configuration, proxy command, or destination you do not control
- saving a remote project owned by another user or enabling full Bash/workspace writes on an untrusted remote checkout
- granting persistent Computer Use access to an app you do not trust
- granting persistent Browser access to a website origin you do not trust

## Safer Defaults

Default daily mode:

```bash
codexflow \
  --root /path/to/repo \
  --bash safe \
  --tunnel cloudflare
```

Safer planning-only mode:

```bash
codexflow \
  --root /path/to/repo \
  --mode handoff \
  --bash safe \
  --tunnel cloudflare
```

For stable public hostnames, keep the CodexFlow auth token stable but private:

```bash
codexflow \
  --root /path/to/repo \
  --tunnel cloudflare-named \
  --hostname codexflow.example.com \
  --tunnel-name codexflow \
  --token <long-random-token> \
  --bash safe
```

## Hard Rules

- Do not run public tunnels with `--no-auth`.
- Public tunnel mode and non-loopback binds fail closed if `CODEXFLOW_HTTP_TOKEN` is missing.
- Do not commit printed connector URLs that include `codexflow_token`.
- Do not share, screenshot, or log an authenticated browser-fallback URL; it initially contains the local CodexFlow credential. The page removes that query value from the address bar and retains it in tab-scoped session memory after loading.
- Do not commit Cloudflare tunnel tokens.
- Do not paste raw Cloudflare tunnel tokens into browser pages or screenshots. Use `--cloudflare-token-file`; the desktop policy editor never asks for or displays that secret.
- Use `--mode handoff` for planning workflows where ChatGPT should not edit source files. Handoff mode does not advertise generic `write`/`edit` tools.
- Preview local handoff execution with `codexflow execute-handoff --dry-run` before running an unfamiliar adapter or custom command.
- Preview autonomous local loops with `codexflow loop-handoff --dry-run`, keep `--max-iters` small, and prefer `--require-human-confirmation` until you trust the reviewer command.
- Keep `execute-handoff` local. Do not wrap it in a remote MCP tool unless you add a stronger approval and sandbox story.
- Keep `loop-handoff` local. Do not use it to automate ChatGPT Web, Codex approvals, account access, third-party Pro sites, quota limits, or product safety prompts.
- Use default agent mode only with trusted ChatGPT sessions and repo-specific roots.
- Use `--no-bash` when ChatGPT should never trigger shell commands in the workspace.
- Use `--bash-session <id> --require-bash-session` when bash should be enabled only for calls that explicitly target this local CodexFlow terminal label.
- Keep Codex session history access off unless needed. `--codex-sessions metadata` only lists local Codex JSONL metadata; `--codex-sessions read` allows bounded transcript reads.
- Keep `CODEXFLOW_CONTEXT_DIR` as a workspace-relative hidden directory such as `.ai-bridge`; CodexFlow rejects source, build, dependency, credential, and absolute context directories.
- Use `--bash full` only for trusted local repos.
- Do not treat MCP session ids or bash session labels as Codex conversation ids. CodexFlow does not execute inside a Codex app session.
- Do not place credentials in native review comments; they are intentionally shared with authenticated `show_changes` calls for that project.
- Prefer a repo-specific `--root` instead of `--allow-home`.
- Use `--no-install-cloudflared --cloudflared <path>` if your organization requires a managed Cloudflare Tunnel binary.
- Verify SSH hosts only after normal `ssh <alias>` access works and the destination fingerprint is expected. Remove approval in the native Hosts view before changing an alias to a different machine.
- Grant Computer Use only for the named app and task you expect. Prefer Allow Once, review every action confirmation, and revoke persistent access from the native Computer view when it is no longer needed.
- Grant Browser access only to the exact origin the task needs. Prefer Allow Once, inspect each semantic target before approval, and revoke persistent origins from the native Browser view when they are no longer needed.

## Cloudflare Binary Install

For the one-command public tunnel flow, CodexFlow can download the official Cloudflare `cloudflared` release into `~/.codexflow/bin` on supported macOS, Windows, and Linux systems. It does not install a system service, does not use sudo/admin rights, and does not modify shell startup files.

Resolution order:

```text
1. explicit --cloudflared path or CLOUDFLARED_BIN
2. cloudflared already available in PATH
3. ~/.codexflow/bin/cloudflared or cloudflared.exe
4. download official Cloudflare latest release unless --no-install-cloudflared is set
```

Use `--install-cloudflared` to refresh the local binary. Use `--no-install-cloudflared` to disable downloads.

## Built-In Guards

codexflow blocks common sensitive paths by default:

- `.env` and `.env.*`
- `.git` internals
- `node_modules`
- common private key names
- build/cache folders such as `dist`, `build`, `.next`, `coverage`, `.cache`
- symlinks that resolve outside the workspace or into blocked paths

These guards reduce risk. They are not an OS sandbox.
