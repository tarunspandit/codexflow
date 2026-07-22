# Changelog

## Unreleased

## 0.42.0 (2026-07-23)

- Added the route-scoped `task_progress` tool so a web chat can publish a bounded title, current focus, task state, and complete plan snapshot to the local native app without starting another model or agent.
- Rebuilt the native Chats surface as Tasks: parallel routed work now shows live progress, completed/active/blocked steps, review and waiting states, local lifecycle controls, and clear project ownership in one supervision view.
- Persisted only the explicitly reported bounded progress snapshot in the existing owner-only chat metadata file; prompts, general tool arguments, file contents, command output, credentials, and MCP transport identifiers remain excluded.
- Added broker/runtime/API persistence coverage, independent-route HTTP regression, native fixture coverage, signed universal-app compilation, and Computer Use visual QA for the task board.
- Updated the parity boundary: local task progress and parallel supervision are available; CodexFlow still does not spawn model agents, proxy Codex, automate ChatGPT, or provide a Windows-native client.

## 0.41.0 (2026-07-23)

- Added a dedicated native Browser workspace and `browser_use` tool. Routed chats can request one exact HTTP(S) origin, open a visible WebKit tab, observe a fresh screenshot plus bounded semantic DOM targets, and operate the page without touching Safari, Chrome, or personal browser profiles.
- Added local origin approval with route-private ten-minute access or explicit owner-persistent grants, plus revocation and a bounded content-free browser activity ledger.
- Sealed sensitive DOM actions to one route, tab, short-lived snapshot, element, operation, and value. Clicks, text entry, and consequential keys require native approval; stale targets fail closed after each action.
- Enforced a separate non-persistent WebKit data store for every tab, cross-origin redirect refusal, and hard blocking for downloads, popups, JavaScript dialogs, authentication challenges, URL credentials, secret-looking query/input values, password contents/input, and authentication, account-security, billing, checkout, and payment pages.
- Added mocked broker regressions and a real signed-app integration test covering native page open, screenshot capture, semantic targeting, confirmation, click effects, text input, populated password redaction, and close.
- Visually inspected the bilingual Flow7-native Browser approval surface and updated public English/Chinese product surfaces and parity documentation.

## 0.40.1 (2026-07-23)

- Rebuilt the signed native app after the package-version bump so the bundle, packaged build marker, launcher fingerprint, public surfaces, and release all advertise 0.40.1 and existing 0.39 installations refresh automatically.

## 0.40.0 (2026-07-23)

- Added permissioned native macOS Computer Use for the cases where project, terminal, Git, and review tools are insufficient: a routed web chat can request one exact running app, observe its focused window, and address bounded accessibility elements without receiving arbitrary coordinate control.
- Built the approval surface into the native Computer workspace. Access is decided locally as route-private ten-minute access or explicit persistent access; presses and text/key entry are separately sealed to one chat, app, snapshot, element, operation, and value before approval.
- Bound app grants and every later observation/action to the target’s validated code-signing identifier, team, and code-directory hash, so a replaced binary cannot inherit approval from a matching bundle identifier.
- Added Screen Recording and Accessibility readiness UX, expiring route-bound snapshots, post-action invalidation, content-free activity, owner-only approval persistence, secret-aware text refusal, secure-field refusal, and explicit revocation.
- Kept the hard boundaries explicit: Terminal apps, ChatGPT/CodexFlow, System Settings, and browser apps cannot be reached through generic desktop control. Browser automation remains a separate future surface with per-host permissions.
- Added universal signed helper packaging, native fixture/visual verification, and end-to-end regressions for permission state, route isolation, action confirmation, stale snapshots, identity replacement, prohibited apps, secret refusal, persistence permissions, and revocation.

## 0.39.0 (2026-07-23)

- Rebuilt the native Changes diff reader around first-class unified-diff hunks with one-click stage, unstage, and explicitly confirmed working-tree revert actions.
- Added stable content-derived hunk identifiers and server-side patch reconstruction, so the app never submits an arbitrary patch and stale hunk actions fail closed after the underlying diff changes.
- Added line-anchored native review comments with a focused composer, inline rendering, stale-anchor warnings, owner-only mode-0600 persistence, secret detection, and explicit deletion.
- Surfaced native review notes through `show_changes`, allowing the active web chat to receive the user’s local review feedback without adding a second chat composer or storing prompts and tool transcripts.
- Kept untracked files on explicit file-level stage/discard actions and added end-to-end regression coverage for two-hunk stage/unstage/revert, comments, stale IDs, model-visible notes, and untracked refusal.
- Visually verified the signed universal macOS app in fixture mode after removing duplicate hunk headers and reducing inline-control noise.
- Kept the parity claim honest: Computer Use/browser control, richer native plan/task orchestration, and equivalent native clients beyond macOS remain unfinished.

## 0.38.0 (2026-07-23)

- Added CodexFlow-managed Git worktrees on approved SSH projects. A web chat can create a detached remote checkout, carry bounded tracked and untracked project changes into it, and immediately continue on the new saved project route.
- Added guarded remote source/worktree handoff with repository identity, HEAD, and destination-state fingerprints. Independently changed destinations are refused before any files are replaced.
- Added remote environment continuity across worktree route switches: selected Codex environment setup runs after creation, cleanup runs before removal, and failed setup rolls the route, saved project, manifest, and Git checkout back to the source project.
- Added owner-only remote worktree manifests, bounded dirty-state snapshots, automatic project-picker registration/removal, unavailable-checkout reporting, canonical macOS path handling, and transactional registration cleanup.
- Extended end-to-end SSH regression coverage through create, environment setup, edit, handoff, conflict refusal, environment cleanup, dirty snapshot, removal, picker cleanup, mode-0600 metadata, and failed-setup orphan prevention.
- Kept the parity claim honest: Computer Use/browser control, inline review comments, per-hunk actions, richer native task progress, and equivalent native clients beyond macOS remain unfinished.

## 0.37.0 (2026-07-22)

- Added persistent terminals for approved SSH projects with per-chat cwd/environment/process state, concurrent route isolation, bounded transcript cursors, background commands, full-mode input, timeouts, and host/project revalidation on every action.
- Added remote Codex-compatible project environments: version-1 `.codex/environments/*.toml` discovery, route-persisted selection, host-platform setup/cleanup, and named actions execute in the route's persistent remote terminal.
- Added guarded remote workspace-skill discovery and loading. Saved SSH projects now advertise their own `.codex`, `.agents`, and project skill folders alongside local user/plugin capabilities.
- Added bounded remote repository inspection for languages, project types, entrypoints, areas, files, source symbols, internal imports, and explicit coverage warnings.
- Extended the end-to-end SSH regression to prove two simultaneous route terminals do not share state, interactive input works, explicit cwd escapes fail, environment scripts execute on the host, and remote skills/analysis resolve against the selected project.
- Kept the parity claim honest: remote managed worktrees and local/remote handoff remain unfinished, along with Computer Use/browser control and richer per-hunk/inline review.

## 0.36.0 (2026-07-22)

- Added saved remote projects on approved OpenSSH hosts. Canonical remote folders now appear beside local projects in the ordinary ChatGPT picker and bind to the same private per-chat route contract.
- Added asynchronous CodexFlow-owned remote execution for bounded tree, read, search, write, edit, patch, safe/full Bash, Git status/diff, and `show_changes` operations without installing, starting, or invoking Codex on the host or blocking unrelated chats.
- Enforced host approval and destination fingerprints on every routed call, plus remote root containment, symlink escape rejection, blocked globs, read/write/output limits, secret-aware writes, non-interactive SSH, and bounded operation timeouts.
- Rebuilt the native Hosts workspace around usage: approve a host, save or remove remote project folders, see availability/config-change state, and make those projects immediately selectable from web chats.
- Added direct helper and end-to-end HTTP/MCP regression coverage proving that a saved remote folder appears in `list_projects`, binds with `select_project`, and executes file, search, shell, and Git work on the intended host route.
- Kept the parity claim honest: remote persistent terminals, environments, worktrees, handoff, repository analysis, and remote workspace skill discovery remain unfinished.

## 0.35.0 (2026-07-22)

- Added a first-class native Hosts workspace that discovers concrete aliases from the local OpenSSH config, resolves them through OpenSSH, and makes verification or revocation explicit without invoking the Codex CLI.
- Added an authenticated remote-host lifecycle API with bounded non-interactive verification, strict existing-host-key trust, owner-only approval records, no key-path exposure, and automatic invalidation when an alias resolves to a different user, host, or port.
- Added regression coverage for included SSH config files, wildcard rejection, unknown aliases, failed host-key verification, destination changes, private state permissions, authenticated host administration, and universal native-app compilation.
- Kept the parity claim honest: remote project selection and remote file, Git, shell, terminal, worktree, and handoff routing remain unfinished.

## 0.34.0 (2026-07-22)

- Added a first-class native Changes workspace with separate staged and unstaged lanes, changed-file navigation, branch context, selectable color-coded diffs, addition/deletion counts, and explicit file-level stage, unstage, and discard actions.
- Added an authenticated, project-scoped desktop review API that renders bounded previews for untracked text files, reports non-Git projects honestly, honors workspace write policy, and never accepts implicit whole-workspace discard.
- Extended guarded Git discard to remove only explicitly selected untracked files, with regression coverage alongside tracked-file restore behavior.
- Replaced the restorable SwiftUI window group with one durable primary management window, preventing duplicate control windows without limiting concurrent ChatGPT routes, projects, worktrees, or terminals.

## 0.33.0 (2026-07-22)

- Added `prepare_scheduled_task`, which turns concrete local-project work into a durable ChatGPT Scheduled prompt that reacquires a fresh private route, selects the stable project ID, restores the selected local environment, and optionally creates a clean managed worktree for every run.
- Kept scheduling, model execution, cadence, and run history in ChatGPT Scheduled rather than introducing a second model backend, Codex CLI process, local cron daemon, API key, or separate usage bill.
- Added explicit unattended-run boundaries: focused verification and `show_changes` are on by default, publishing is off by default, missing projects/tools fail closed, and the prompt reminds users that the computer, broker, and stable plugin URL must remain available.

## 0.32.0 (2026-07-22)

- Added native Codex local-environment compatibility: CodexFlow discovers the same version-1 `.codex/environments/*.toml` files, honors platform-specific setup and cleanup scripts, exposes named actions, and supplies `CODEX_SOURCE_TREE_PATH` plus `CODEX_WORKTREE_PATH` without invoking the Codex CLI.
- Added route-private environment selection and a first-class native Environments view for inspecting inherited configurations, running setup/cleanup or named actions, stopping background actions, and creating a worktree with its selected environment.
- Made managed worktrees run the selected environment setup automatically, run cleanup before removal, and hydrate gitignored files matched by `.worktreeinclude` without following symlinks or overwriting destination files.
- Added bounded config parsing, trusted-project script gates, project-switch reset behavior, owner-only environment metadata, and end-to-end smoke coverage across MCP, HTTP, worktree, and native surfaces.

## 0.31.0 (2026-07-22)

- Added guarded, project-scoped Git workflow actions for staging, unstaging, explicit-path discard, branch creation/switching, commits, pushes, and GitHub pull requests; commits refuse staged files outside a selected nested project.
- Added CodexFlow-managed detached worktrees with tracked/untracked change transfer, private-route handoff, owner-only manifests, dirty-removal snapshots, and destination fingerprints that reject independently changed checkouts.
- Added a persistent per-chat terminal keyed by private route, including cwd/environment continuity, background commands, bounded cursor-based transcript reads, full-mode interactive input, timeouts, route isolation, and pseudo-terminal support.
- Added native Worktrees navigation and authenticated local worktree controls, plus chat search, rename, pin, archive, and restore controls backed by owner-only lifecycle metadata.
- Expanded regression coverage for worktree transfer/divergence, nested-project Git scope, commit/push workflows, terminal persistence/interactivity/isolation, chat lifecycle persistence, and authenticated lifecycle APIs.

## 0.30.4 (2026-07-18)

- Reworked native chat telemetry around durable private routes instead of raw MCP transports, so one ChatGPT conversation remains one GUI chat even when ChatGPT opens a fresh connection for every tool call.
- Hid unbound discovery, metadata, and project-picker attempts from the Chats view while retaining their raw connection count for operational diagnostics.
- Added regression coverage for multiple transports sharing one route, multiple simultaneous conversation routes, route-level call/error aggregation, connection close behavior, and transport/route identifier redaction.
- Clarified the new-chat workflow in the native app and docs: ChatGPT's initial app row is ranked rather than exhaustive, so use `+` → More and search for CodexFlow on a supported non-Pro model.
- Refreshed the public site's Next, vinext, Cloudflare, Wrangler, and transitive image/URI dependencies to clear newly disclosed high-severity advisories without changing the rendered product surface.

## 0.30.3 (2026-07-15)

- Replaced transport-local project selection with opaque private `route_id` capabilities that remain stable across ChatGPT's separate model and widget MCP transports.
- Persisted chat-to-project routes in the local CodexFlow state directory with owner-only permissions so existing web chats resume on the same project after broker restarts.
- Updated every project-scoped tool to advertise `route_id`, reject workspace IDs from another route, and resolve the route before any file, git, search, edit, or terminal operation.
- Upgraded the project picker to the standard MCP Apps `ui/update-model-context` bridge plus structured ChatGPT widget state, making the selected route and workspace visible to later model turns without posting a synthetic chat message.
- Cache-busted the picker to `ui://widget/codexflow-project-picker-v3.html`, preserved selected-state UI across host refresh events, and added cross-transport, route-isolation, persistence, and permission regression coverage.
- Taught the native app to start an installed launchd-managed broker and made `SIGTERM` an intentional clean stop, so a permanent service can recover from crashes without fighting the app’s Stop and Restart controls.

## 0.30.2 (2026-07-15)

- Fixed `list_projects` output validation by serializing project activity timestamps as ISO strings and returning only fields declared by its strict output schema.
- Completed the `select_project` output schema so project instructions, tree and git context, skill/plugin inventory, MCP servers, and operating modes validate in strict Apps SDK clients.
- Rebuilt the project-picker bridge around `openai:set_globals` with bounded late-hydration polling and removed the rejected raw frame-message fallback.
- Cache-busted the project picker to `ui://widget/codexflow-project-picker-v2.html` so ChatGPT cannot retain the broken v1 app shell.
- Added AJV contract checks to both stdio and public HTTP smoke suites for the project-list and project-selection tool results.

## 0.30.1 (2026-07-15)

- Replaced the oversized required result card with a dedicated, cache-busted project picker resource and made `select_project` independent of any result template.
- Added explicit output schemas and modern app-call visibility metadata to project discovery and selection while retaining ChatGPT compatibility metadata.
- Made project routing resilient when component rendering fails: every project list now carries a plain-chat fallback, and server instructions forbid referring only to a missing picker.
- Removed the shared GitHub Pages iframe origin from zero-configuration launches; components now use ChatGPT's isolated sandbox unless a unique dedicated HTTPS origin is explicitly configured.
- Corrected runtime telemetry so background MCP discovery and component-fetch transports are reported as connections rather than user chats; active-chat counts now require an actual project route.
- Added visible model-compatibility guidance across the native app, website, README, and FAQ: ChatGPT's Pro model variants do not expose Apps, while a Pro subscription remains compatible through supported non-Pro models.
- Bumped the optional general result card to `ui://widget/codexflow-tool-card-v12.html`, preserving v11/v10/v9/v8 compatibility resources.

## 0.30.0 (2026-07-15)

- Added a from-scratch native SwiftUI macOS application with Now, Projects, Chats, Connection, and Policy views, real broker discovery and lifecycle controls, workspace switching, authenticated runtime data, and no duplicate model composer or Codex CLI execution path.
- Added a universal, ad-hoc-signed, self-contained `CodexFlow.app` to the npm package; first launch installs or refreshes it in `~/Applications`, while `codexflow app`, `gui`, `open`, and the terminal `o` control launch it even when the broker is offline.
- Rebuilt the token-protected browser page as a deliberately compact recovery fallback that opens the native app and exposes only essential connection actions and bounded diagnostics.
- Added authenticated `/api/overview` and `/api/events` runtime surfaces plus bounded, memory-only session telemetry that records only non-actionable chat fingerprints, selected projects, tool names, outcomes, and durations.
- Added restrictive non-secret desktop launch metadata and private runtime discovery so the app can start, stop, restart, and reconnect to the existing broker without persisting chat content or rendering credentials.
- Reworked the required ChatGPT project picker and optional tool cards into host-native, non-scrolling inline UI, added project filtering, and bumped the resource to `ui://widget/codexflow-tool-card-v11.html` while preserving v10/v9/v8 aliases.
- Updated both hosted public editions and the static GitHub Pages mirror around the native desktop product, with a representative preview explicitly separated from private local runtime data.
- Added runtime monitor, independent-session telemetry, native app lifecycle, bundle/signature/architecture, secret-key redaction, public-site render, and packaged asset coverage to the release tests.
- Unified CLI, stdio MCP, HTTP broker, native app, and package version reporting through the release manifest.

## 0.29.0 (2026-07-13)

- Launched the redesigned English and Chinese CodexFlow website, social card, public npm identity, and renamed GitHub repository.
- Added `codexflow status` with human-readable and `--json` runtime/process/health reporting, plus `--non-interactive` / `--no-control-panel` for script and CI launches.
- Added a synchronized project picker and per-ChatGPT-session project binding, allowing one broker and tunnel to route concurrent web coding chats to different local repositories without invoking the Codex CLI.
- Project selection now advertises repository instructions, workspace/user/plugin skills, locally available plugin manifests, and configured MCP server names.
- Renamed the product, npm package, executable, MCP identity, environment namespace, local state directory, widgets, and documentation from CodexPro/codeXchat to CodexFlow/`codexflow`.
- Removed first-run setup from the normal path: bare `codexflow` discovers project directories from local Codex metadata, chooses the most recent project as the default, starts the broker and quick tunnel, and copies the ChatGPT connection URL.
- Bumped the interactive tool resource to `ui://widget/codexflow-tool-card-v10.html` while retaining v9/v8 compatibility aliases, preventing stale ChatGPT widget caches from hiding the project picker.

## 0.29.0-beta.1 (npm beta, 2026-07-11)

- Added bounded multi-language repository analysis, grouped search results, change-impact and test recommendations, `codexflow inspect` / `codexflow review` CLI commands, and compact opt-in tool cards.
- Added `codexflow connection-test`, a read-only connector profile with no bash or tool cards, plus request-arrival logging and current ChatGPT Plugins troubleshooting.
- Added Tailscale Funnel as a saved tunnel/profile option, including `codexflow tailscale --hostname ...`, launcher support, admin profile support, and settings smoke coverage.
- Added proxy-aware Cloudflare quick tunnels: when proxy env vars are set, CodexFlow requests quick-tunnel credentials through `curl --proxy`, runs `cloudflared` with a temporary credentials file, ignores Cloudflare API URLs, and cleans the credentials file after shutdown.
- Hardened Codex handoff execution on Windows by resolving spawnable Codex shims, asking Codex to read the plan file instead of argv-passing the whole plan, and recording git status in handoff artifacts.
- Added concise connector-creation troubleshooting to the English and Chinese FAQs.
- Bounded browser-facing tool-card structured payloads and binary-file text checks so CodexFlow emits less data without reducing normal tool-result or binary-detection quality.
- Allowed targeted line-range reads and search matches in text files slightly above `maxReadBytes`, while keeping full-file reads and very large scans bounded.
- Replaced the overlong README with a shorter install, tunnel, safety, RAM-boundary, and development guide.
- Added a guarded `apply_patch` MCP tool for unified-diff edits inside workspace write mode, with blocked-path and secret-content checks before patches are applied.
- Added last-shown review checkpoints to `show_changes`, so repeated unchanged reviews collapse while new workspace changes still produce a fresh diff.
- Fixed checkpoint-hit `show_changes` responses so repeated unchanged reviews report zero new diff stats instead of carrying stale addition/deletion counts.
- Scoped `apply_patch` result diffs to the applied patch, so unrelated dirty tracked files are not folded into the patch card.
- Hardened safe bash filtering, path canonicalization, binary-file checks, ripgrep truncation reporting, and supertool argument validation around edge-case bypasses found by stress testing.
- Redacted child tunnel process output before logging or surfacing startup failures so Cloudflare `TUNNEL_TOKEN` values cannot leak from failed named-tunnel launches.
- Kept `codex_sessions` metadata mode from returning transcript-tail summaries, skipped unreadable stale history files, and accepted source paths under symlink-resolved Codex history roots.
- Hardened search, context export, path blocking, skill loading, and change summaries around hidden files, colon-containing paths, `.env` descendants, large-file limits, user skills, and diff stats.
- Blocked raw newline and carriage-return command separators in safe bash mode before whitespace normalization, including through the stable `codexflow` supertool wrapper.
- Corrected docs to describe Developer Mode account eligibility as broader than Plus/Pro while keeping the model/tool-surface limitation explicit.

## 0.28.6 (main, pending npm latest)

- Added the stable `codexflow` supertool wrapper for advanced connector-cache/custom workflows, while preserving tool/write/bash mode gates.
- Hardened direct HTTP auth defaults, local `--no-auth`, token redaction, search parsing, selected-path Pro exports, and handoff polling state.
- Added `npm run stress` to cover full-mode MCP behavior, supertool dispatch, skill caps, card payloads, search edge cases, Pro export, and handoff polling.
- Fixed CLI env precedence so `CODEXFLOW_HOST` / `CODEXFLOW_PORT` override generic `HOST` / `PORT`, preventing ambient process env from widening a launcher-validated bind.
- Normalized stable public hostnames in CLI settings/setup/start flows and accepted common `--flag=value` syntax.

- Made ChatGPT tool-card descriptor metadata opt-in with `CODEXFLOW_TOOL_CARDS=1`, so default `tools/list` responses stay plain MCP and avoid fragile widget metadata during tool discovery.
- Added `codexflow loop-handoff` for bounded local execute/review loops over `.ai-bridge/current-plan.md`, with a required local `--review-command`, `--max-iters`, dry-run preview, optional test command capture, and stop conditions for no diff, repeated diff, missing follow-up plans, reviewer errors, and human cancellation.
- Hardened `loop-handoff` external-command boundaries: commands are preflighted before execution, reviewer verdicts require explicit `CODEXFLOW_REVIEW=...` assignment lines by default, and reviewer `PASS` no longer masks failed executor/test/reviewer commands unless the user opts into the supported override behavior.
- Fixed loop change detection so `--stop-if-no-files-changed` and `--stop-if-same-diff` compare each iteration against a pre-execution baseline and count unstaged diffs, staged diffs, and untracked file fingerprints outside `.ai-bridge`.
- Switched loop guard decisions to an uncapped git-state fingerprint instead of hashing or vetoing on the trimmed reviewer diff artifact.
- Kept handoff plan hashing on the handoff read-size budget instead of `--max-output-bytes`, so valid plans larger than captured output excerpts do not abort the loop after execution.
- Made loop change fingerprints content/status based instead of timestamp based, so repeated identical tracked-file writes stop as no new changes instead of looking different because of volatile mtimes.
- Normalized Git porcelain paths back to workspace-relative paths before loop clean-start filtering and change fingerprinting, with path-scoped status and untracked-file scans so nested workspaces inside larger Git repos are handled correctly.
- Bounded untracked file fingerprinting so symlinks are reported via `readlink` and regular files hash only a capped prefix instead of following arbitrary paths or reading entire generated artifacts.
- Tightened `--require-clean-git-start` so staged renames are treated as handoff-only only when both rename endpoints are inside `.ai-bridge`.
- Stopped reviewer `FAIL` and implicit review verdicts from continuing when the reviewer deletes, empties, or restores `.ai-bridge/current-plan.md` to the scaffold instead of writing a usable follow-up plan.
- Kept the autonomous handoff loop CLI-only and local-terminal-owned; it does not expose agent execution as a remote MCP tool, automate ChatGPT Web, approve product prompts, proxy models, or bypass limits.
- Extended handoff smoke coverage with a fake reviewer that fails once by writing a follow-up plan, then passes on the second local executor iteration, plus failed executor, failed reviewer, bare `PASS`, staged-only, untracked-file, bounded-untracked, dirty-baseline, repeated-identical-write, nested-workspace, nested-untracked-workspace, outside-untracked-nested-workspace, large-dirty-baseline, unavailable-diff-artifact, large-plan-over-output-cap, staged-rename, deleted-follow-up-plan, and implicit-deleted-plan cases.

## 0.28.5

- Added a compatibility alias for stale ChatGPT descriptors that still request `ui://widget/codexflow-tool-card-v8.html`, while keeping `ui://widget/codexflow-tool-card-v9.html` as the current advertised widget.
- Stopped advertising the `bash` MCP tool when `CODEXFLOW_BASH_MODE=off` / `codexflow --no-bash` is active, so ChatGPT has less opportunity to attempt a shell tool call in no-bash sessions.
- Stopped advertising direct `write` and `edit` tools unless `CODEXFLOW_WRITE_MODE=workspace`; handoff/off modes keep handoff planning tools available for bounded `.ai-bridge` plan files without exposing generic source edit actions.
- Added smoke coverage that compares `codexflow_self_test` expected tools against the actually registered MCP tool set, so disabled tools cannot silently remain visible in ChatGPT's tool list.
- Tightened `CODEXFLOW_CONTEXT_DIR` to workspace-relative hidden directories such as `.ai-bridge`, rejecting source/build/dependency/credential directories and absolute paths.
- Made saved profile handling stricter: non-agent modes cannot inherit `write=workspace`, relative tunnel config/token paths resolve from the workspace, and `settings set` refuses to persist raw Cloudflare tunnel tokens.
- Completed the local admin profile form for named Cloudflare/ngrok settings, including tunnel name, config paths, token-file path, and cloudflared auto-install preference.
- Fixed path-scoped `show_changes` so unrelated workspace status is not reported for a clean requested path.
- Kept duplicate `load_skill` matches ambiguous until the caller supplies the exact displayed skill path.
- Added `codexflow_self_test`, a local-only diagnostic that checks modes, expected tools, safe bash policy, selected-only Pro context, and an optional `.ai-bridge/codexflow-self-test.md` write/edit probe without touching source files.
- Upgraded ChatGPT cards to `ui://widget/codexflow-tool-card-v9.html` and attached compact card metadata to every CodexFlow tool, with large git/tree/context/bash payloads folded or bounded instead of printed as a giant chat block.
- Added `include_important_files` and `include_changed_files` controls to `export_pro_context` plus CLI smoke coverage for exact selected-only bundles.
- Added a dedicated compact `server_config` renderer and accepted model-friendly aliases `workspace_snapshot.max_files` plus `git_diff.include_diff=false` to reduce avoidable retry/error loops in ChatGPT.
- Reconfirmed the compliance boundary in runtime diagnostics and docs: CodexFlow is a local workspace MCP bridge, not a model provider, model proxy, quota bypass, resale layer, or remote executor.
- Added `codexflow --no-bash` and documented that CodexFlow does not bind MCP bash to a Codex app conversation id.
- Added an optional bash session guard with `--bash-session <id> --require-bash-session`; guarded `bash` calls must include the matching `session_id` before any shell command runs.
- Made bash chat transcripts compact by default, with `--bash-transcript full` for the old raw stdout/stderr chat output.
- Added opt-in local Codex session discovery with `--codex-sessions metadata|read`, including session ids, titles, cwd paths, source files, resume commands, and bounded transcript reads only in explicit `read` mode.
- Added a token-protected local profile editor at `/admin/profile` and the setup page so users can save tunnel, hostname, port, mode, bash, Codex session, write/tool mode, widget origin, and tunnel config defaults for the next `codexflow` without exposing raw tokens in the browser.

## 0.28.4

- Made workspace cards compact by default, moving git details, discovered skills, and optional file tree output behind collapsible disclosure rows.
- Changed workspace open skill discovery to include workspace, user, and plugin skills by default while still exposing a focused `standard` tool surface.
- Added read-only `load_skill` so ChatGPT can load bounded `SKILL.md` instructions for discovered workspace, user, or plugin skills without exposing arbitrary path reads.
- Kept AGENTS detection in the workspace open result but stopped embedding the full AGENTS file in the open response; agents can read it explicitly when needed.
- Fixed setup propagation for `--widget-domain` and corrected workspace-card git status splitting for multi-file diffs.

## 0.28.3

- Added `CODEXFLOW_WIDGET_DOMAIN` and the Apps SDK resource metadata keys `_meta.ui.domain` plus `_meta["openai/widgetDomain"]` so ChatGPT no longer reports that the widget domain is missing.
- Surfaced the widget domain in server config, HTTP status output, docs, env examples, and smoke tests.

## 0.28.2

- Moved ChatGPT visual cards from `bash` to the workspace open tools so the first call gives a compact project orientation instead of noisy terminal cards.
- Kept `bash` data-only for focused verification commands and strengthened server instructions to prefer `tree`, `search`, `read`, and `show_changes` for inspection/review.
- Upgraded the widget to v8 with a workspace summary renderer and a neutral waiting state instead of a stale-looking running card.

## 0.28.1

- Added `CODEXFLOW_TOOL_MODE=minimal|standard|full`, with `standard` as the default focused ChatGPT tool surface and `full` preserving the previous advanced toolbox.
- Added `show_changes` as a review-oriented visual card for git status, diff stats, and optional diff while keeping raw `git_diff` data-only.
- Upgraded the ChatGPT widget to v7 with compact bash execution summaries, review cards, and cleaner handoff cards.
- Allowed `open_workspace` to accept `path` as an alias for `root` to reduce client argument mismatch failures.
- Allowed safe package scripts with colon suffixes such as `npm run build:clients` for build/test verification.
- Surfaced tool mode in server config, local status, workspace/context exports, launcher output, setup profiles, and docs.

## 0.28.0

- Added `codexflow execute-handoff` as an opt-in local executor for `.ai-bridge/current-plan.md`.
- Added `codexflow watch-handoff` as an opt-in local watcher that executes new handoff plans by content hash without exposing execution as a remote MCP tool.
- Added built-in local adapters for `opencode`, `pi`, and `codex`, plus a restricted `--command` template path for custom agents.
- Added `--dry-run`, `--yes`, timeout handling, stdout/stderr capture, `agent-status.md`, `implementation-diff.patch`, and `execution-log.jsonl` output.
- Kept `handoff_to_agent` planning-only; local execution is not exposed as a remote MCP tool.
- Fixed Windows release-gate coverage for symlink-escape smoke tests, Bash lookup, and custom executor paths containing spaces.
- Added smoke coverage for dry-run previews, custom command validation, execution status, diff collection, duplicate watch-plan skipping, and structured execution logging.
- Clarified that CodexFlow is an official Developer Mode/MCP workflow, not a rate-limit bypass or model access provider.

## 0.27.2

- Added `handoff_to_agent` for file-based handoffs to Codex, OpenCode, Pi, or custom local implementation agents without executing local commands.
- Extended `.ai-bridge` with generic `agent-status.md`, `implementation-diff.patch`, and `execution-log.jsonl` files.
- Updated `read_handoff`, `codex_context`, Pro apply logging, docs, and smoke coverage for generic agent handoffs.
- Fixed secret detection so benign env-var references like `process.env.TOKEN` are not blocked or redacted as literal secrets.
- Shell-quoted generated agent command hints so model names cannot inject extra shell tokens.
- Bounded append-mode handoff reads with the configured text-file size guard.

## 0.27.1

- Fail closed when HTTP MCP auth is required but `CODEXFLOW_HTTP_TOKEN` is missing, including public tunnel mode and non-loopback binds.
- Block additional safe-bash bypass paths for absolute paths, parent paths, environment expansion, sensitive paths, and `find` write/action flags.
- Added smoke coverage for the missing-token HTTP startup failure and safe-bash blocked command cases.

## 0.27.0

- Kept terminal startup focused on only the connector URL and essential controls; usage prompts now belong in README/docs only.
- Made `git_diff` data-only instead of a widget-rendered tool. This reduces noisy ChatGPT cards and avoids template fetch failures for empty/no-op diffs.
- Kept visual cards scoped to high-signal outputs: source writes, exact edits, Pro context exports, and Codex handoffs.
- Updated smoke coverage so routine inspection tools stay compact.

## 0.26.0

- Removed prompt management from the terminal control panel.
- Removed the `s` hotkey and all launcher-side suggested prompt generation.
- Kept usage prompts and workflow examples in documentation instead of runtime UI.

## 0.25.0

- Simplified the ready screen so startup shows one compact status block instead of a long boxed next-step panel.
- Reduced visible controls to the common actions: open ChatGPT, copy URL, open status, copy prompt, help, and quit.
- Changed the `s` control to copy the suggested ChatGPT prompt instead of printing the full prompt repeatedly.
- Cleaned up saved setup list formatting so reused ngrok/Cloudflare profiles are easier to scan in narrow terminals.

## 0.24.0

- Added `codexflow settings list` to show all saved workspace tunnel profiles.
- Added `codexflow settings use` and `--from-root` to copy a saved setup from one workspace to another.
- Improved first-run `codexflow` behavior: if the current workspace has no settings but other saved setups exist, CodexFlow shows them as a numbered list so users can reuse an existing ngrok or Cloudflare setup instead of retyping hostnames.
- Expanded settings smoke coverage for profile listing and reuse.

## 0.23.0

- Added a compact first-run tunnel picker to `codexflow` when no workspace settings exist, so users can choose Cloudflare quick, ngrok, Cloudflare stable, or local mode without running the full setup wizard.
- Added `codexflow settings` with `show`, `set`, and `delete --yes` actions for persistent per-workspace tunnel preferences.
- Persisted the selected tunnel provider, hostname, port, mode, and CodexFlow token until the user changes or deletes the workspace settings.
- Added `scripts/settings-smoke.mjs` and included it in `npm run smoke`.

## 0.22.0

- Added the v5 Apps SDK widget resource at `ui://widget/codexflow-tool-card-v5.html` with cleaner pending states and more polished diff/search/code cards.
- Added a token-protected local admin dashboard at `/` and `/setup` for workspace, mode, allowed-root, setup, profile, and ChatGPT connection visibility.
- Added the terminal `o` control to open the local admin dashboard while CodexFlow is running.
- Updated HTTP smoke coverage to verify the onboarding page and v5 widget resource.

## 0.21.0

- Added `codexflow doctor` as a read-only setup diagnostic for Node, build artifacts, workspace profiles, port availability, tunnel prerequisites, clipboard support, and browser-open support.
- Added `scripts/doctor-smoke.mjs` and included it in `npm run smoke`.
- Added `PUBLIC_LAUNCH_CHECKLIST.md` with release gates, ChatGPT Developer Mode golden prompts, security checks, onboarding expectations, and current non-goals.
- Added `npm run doctor` and included the public launch checklist in the npm package surface.

## 0.20.0

- Made `codexflow` prompts clearer with a dim "Enter to proceed with default" hint before each defaulted input.
- Simplified the ready screen: the Server URL is described as already copied, and Enter is clearly labeled as opening ChatGPT connector settings.
- Added saved-profile hints so ngrok/Cloudflare stable setups tell users that future launches from the same workspace only need `codexflow`.
- Added a local port preflight with clear guidance for running two repositories at the same time.
- Documented the multi-repo rule: each concurrent repo needs its own local port, and stable public tunnels need separate hostnames.

## 0.19.0

- Added per-workspace saved profiles under `~/.codexflow/profiles/`.
- `codexflow` now saves tunnel provider, hostname, port, mode, and a generated reusable CodexFlow auth token by default.
- `codexflow` now loads the saved profile for the current workspace unless `--no-profile` is passed.
- Added `--save-config`, `--no-save-config`, and `--no-profile` launcher flags.

## 0.18.0

- Added ngrok as a first-class tunnel mode with `codexflow ngrok --hostname <domain>` and `--tunnel ngrok`.
- Added ngrok support to the interactive `codexflow` public URL choices.
- Added ngrok executable/config resolution with clear setup errors for missing auth or unavailable domains.
- Documented reserved ngrok domains as a stable ChatGPT connector URL option.

## 0.17.0

- Added `codexflow` / `codexflow onboard` as an interactive onboarding wizard for workspace, port, mode, and public URL strategy.
- Reworked the launcher startup and ready screens into compact framed panels with status lines instead of long setup text.
- Added `npm run connect:setup` for source checkouts.
- Documented the guided onboarding path next to the one-command `codexflow` flow.

## 0.16.0

- Reworked the widget pre-result state so in-progress tool calls show a compact running card instead of raw placeholder JSON.
- Added `codexflow stable` and `--stable` as shortcuts for Cloudflare named-tunnel mode.
- Added `codexflow stable-help` and friendlier missing-hostname guidance for fixed ChatGPT app URLs.
- Updated setup docs around stable URLs for users who cannot edit an existing ChatGPT app connector URL.

## 0.15.0

- Changed `codexflow` to default to agent mode with workspace writes enabled.
- Added `--mode agent`, `--mode handoff`, `--mode pro`, plus shortcut flags `--agent`, `--handoff`, and `--pro-planning`.
- Reworked the terminal startup panel to copy the Server URL, hide long setup details by default, and expose details through controls.
- Updated the default suggested ChatGPT prompt so ChatGPT edits/writes/verifies directly instead of creating a handoff plan.
- Kept handoff and Pro-context workflows as explicit modes for planning-only use.

## 0.14.0

- Added cross-platform `cloudflared` bootstrap for macOS, Windows, and Linux.
- CodexFlow now reuses `cloudflared` from PATH first, then `~/.codexflow/bin`, then downloads the official Cloudflare release into `~/.codexflow/bin` when needed.
- Changed `--install-cloudflared` to force a user-local reinstall instead of using Homebrew.
- Added `codexflow install-cloudflared` for stable-domain setup without starting the MCP server.
- Kept `--no-install-cloudflared` as the opt-out for locked-down or manually managed machines.
- Updated setup docs with OS-specific notes for clipboard, browser opening, and Cloudflare Tunnel.

## 0.13.0

- Added an interactive CodexFlow terminal control panel after startup.
- Added Enter-to-open ChatGPT connector settings, `c` to copy URL, `p` to print app fields, `s` to print the suggested prompt, and `q` to stop.
- Quieted local MCP and Cloudflare logs by default so startup reads like a product flow.
- Made macOS/Homebrew `cloudflared` installation automatic by default when missing.
- Added `--no-install-cloudflared` to opt out of automatic installation.
- Changed the default user-facing start command to `npx codexflow@latest start`.

## 0.12.0

- Added clipboard-first `codexflow Start` flow for ChatGPT Developer Mode.
- Public HTTPS connector URLs are copied automatically when clipboard support is available.
- Added `--open-chatgpt`, `--copy-url`, and `--no-copy-url` launcher flags.
- Added opt-in `--install-cloudflared` for macOS/Homebrew users.
- Added `npm run connect:chatgpt` for source checkouts.
- Updated README setup path around one command: `npx codexflow@latest start --open-chatgpt`.

## 0.11.0

- Renamed the package, CLI, app labels, widget metadata, and environment variables to CodexFlow.
- Removed the duplicate CLI binary entry from `package.json`.
- Added `DOMAIN_SETUP.md` with Namecheap, Cloudflare, stable tunnel, and future hosted-relay guidance.
- Changed the generated model fallback bundle title to `codexflow Context Bundle`.
- Regenerated build output and package lock metadata for the CodexFlow package name.

## 0.10.0

- Prepared the project for public open-source use.
- Added npm package metadata, keywords, engine requirements, public package files, and `prepack`.
- Added `codexflow` as a package-name binary so `npx codexflow@latest ...` works.
- Added `codexflow pro-bundle` and `codexflow pro-apply` CLI subcommands.
- Added `LICENSE`, `SECURITY.md`, and `CONTRIBUTING.md`.
- Removed local runtime reports from the public package surface.
- Reworked docs to avoid private local paths and product-specific model claims.

## 0.9.0

- Added stable Cloudflare named-tunnel mode with `--tunnel cloudflare-named`.
- Added `npm run connect:stable`.
- Added support for existing tunnel names, Cloudflare dashboard tunnel tokens, token files, and cloudflared config files.
- Added stable-host health checks before printing the ChatGPT connector URL.

## 0.8.2

- Fixed duplicate `AGENTS.md` loading on case-insensitive filesystems.
- Kept `codex_context` data-only so it does not create noisy widget cards.

## 0.8.1

- Added `codex_context` for AGENTS-style instructions, `.ai-bridge` handoff files, git status, and optional git diff.

## 0.8.0

- Made widget rendering quieter by attaching visual cards only to high-signal change tools.
- Added request and tool-call logging without printing prompts, file contents, or tokens.

## 0.7.0

- Reworked the Apps SDK widget into compact developer cards.
- Kept widget CSP strict with no external fetches, fonts, scripts, images, or iframes.

## 0.6.0

- Added CSP metadata for ChatGPT Developer Mode widget rendering.
- Added `codexflow_inventory` for sanitized skill and MCP server names.

## 0.5.0

- Added Apps SDK widget resources for selected tool outputs.

## 0.4.x

- Added `export_pro_context`.
- Added terminal helpers for creating and applying planning-context bundles.
- Added `open_current_workspace` for safer first calls from ChatGPT.
