# Product Build State

Updated: 2026-07-22

## Objective

Build, verify, package, and integrate a production-quality native CodexFlow desktop GUI that runs on the user’s computer as the primary control surface, uses the existing local broker/runtime without Codex CLI execution, and reduces the legacy browser page to a deliberately minimal fallback.

## Specification sources

- User product direction in this Codex task, especially the 2026-07-15 requirement for “an actual gui app that runs on the computer from scratch”.
- `README.md`, `CHATGPT_PROMPT.md`, `CODEX_PROMPT.md`, `FAQ.md`, `SECURITY.md`, `DOMAIN_SETUP.md`, and the existing implementation/tests.
- `design.md`, `FLOW7_ADOPTION.md`, and the complete Flow7 Build Product references.
- Existing broker, runtime API, CLI, and public site as product truth. Existing local browser UI is not a design reference.

## Product thesis

For developers working through a remote AI chat, CodexFlow is the most direct, spatial, and trustworthy way to operate multiple project-scoped coding sessions on their own computer.

## Current phase

The 0.36.0 source, native-app, and public-site release is complete. Approved OpenSSH hosts can now own saved canonical project folders that appear beside local projects in the normal ChatGPT picker. Private chat routes execute bounded file, search, edit, patch, Bash, Git, and change-review operations through an asynchronous CodexFlow-owned SSH helper without invoking Codex. Literal Codex desktop parity is not claimed; remote persistent terminals, environments, worktrees/handoff, repository analysis, workspace-skill discovery, Computer Use, inline comments, and per-hunk operations remain tracked in `CODEX_DESKTOP_PARITY.md`. npm publication and live ChatGPT scheduled/two-chat acceptance remain account-authenticated release checks.

## Product truth

- CodexFlow is an independent local MCP broker that gives a user-owned ChatGPT conversation bounded access to approved repositories.
- One broker discovers local projects, serves one authenticated endpoint, and maintains independent project bindings for concurrent MCP conversations.
- ChatGPT supplies conversation and model reasoning. CodexFlow supplies projects, files, repository analysis, Git, guarded terminal execution, local environments, worktrees, instructions, skills, and handoff/context tools.
- Codex metadata is an optional, read-only project/history source. CodexFlow never starts, resumes, or performs work through the Codex CLI.
- Saved launch profiles persist under `~/.codexflow`; live transport sessions and activity are process-local and content-free.
- The native application controls and observes the local broker. It does not introduce a second chat client, model backend, or execution authority.
- SSH project routing requires a concrete locally approved alias and saved canonical folder. Every call revalidates destination and project fingerprints, root containment, symlinks, blocked paths, limits, secrets, and write/Bash policy; CodexFlow never installs or invokes Codex remotely.

## Interface residue

- The former `o` destination was a large authenticated browser dashboard that duplicated desktop responsibilities and felt like an admin document.
- Its obsolete renderer, browser profile editor, duplicate navigation, and terminal-first workflow were removed.
- Only authenticated API contracts and useful runtime truth were preserved; the replacement is a deliberately small recovery fallback.
- The public site remains an explanation surface and now describes the real native application.

## Requirement ledger

| ID | Requirement | Priority | Status | Implementation | Verification / acceptance |
|---|---|---:|---|---|---|
| PROD-001 | CodexFlow has a real native GUI application that launches as a macOS `.app`; the browser is not the product. | Required | Verified | `desktop/macos/*` | Universal signed bundle built, visually inspected, and exercised against a real broker. |
| PROD-002 | The web/ChatGPT experience behaves as a project-aware coding agent without invoking the Codex CLI. | Required | Verified | `src/server.ts`, operation modules | Existing complete smoke and stress suites remain green. |
| PROD-003 | The native app uses the existing broker as the single execution and runtime authority. | Required | Verified | Authenticated native API client + lifecycle controller | Desktop source has no model/Codex CLI execution path; real temporary-broker test passed. |
| FLOW-001 | `codexflow` remains zero-setup: start the broker, discover projects, open the app, and provide the connector URL. | Required | Verified | `scripts/codexflow.mjs` | CLI smoke covers first launch, live launch, noninteractive/no-open, and fallback behavior. |
| FLOW-002 | `codexflow app`, `gui`, and `open` launch the native app even when the broker is offline. | Required | Verified | Desktop installer, launcher, deep link, and private config | Offline invocation and same-version stale-bundle refresh are tested. |
| FLOW-003 | The app exposes offline, starting, live, degraded, error, recovery, and stopping states without fake data. | Required | Verified | `AppModel`, `RootView`, native views | Fixture QA plus live start/stop/degraded/recovery inspection. |
| FLOW-004 | A user can choose a workspace, start, stop, and restart its broker from the native app. | Required | Verified | Native folder picker and lifecycle controller | Temporary-home broker was stopped, started, and restarted through the signed GUI. |
| FLOW-005 | The app can discover and switch among multiple active/recent workspace runtimes. | Required | Verified | Runtime catalog and switcher | Private runtime records, active-first sorting, stale cleanup, and workspace reconciliation verified. |
| FUNC-001 | Project discovery combines default/allowed roots, nested markers, and optional Codex metadata without per-folder setup. | Required | Verified | `src/projectCatalog.ts`, `src/codexSessions.ts` | Existing catalog, HTTP, and stress tests. |
| FUNC-002 | The broker advertises repository instructions, user/workspace/plugin skills, plugin manifests, and configured MCP names. | Required | Verified | `src/capabilitiesOps.ts`, `src/server.ts` | Existing capability and complete smoke suites. |
| FUNC-003 | Native Now, Projects, Environments, Worktrees, Changes, Chats, Hosts, Connection, and Policy views render real broker/project data. | Required | Verified | Native views + authenticated broker APIs | Fixture and API regression coverage includes all destinations. |
| FUNC-004 | ChatGPT Scheduled can reacquire a stable local project route and optionally use its selected environment in a clean managed worktree. | Required | Verified locally | `prepare_scheduled_task`, private routes, environments, worktrees | MCP regression verifies durable prompt content and route/environment/worktree preparation; live schedule creation requires an authenticated ChatGPT surface. |
| FUNC-005 | Connection URL credentials are never displayed or logged; the complete URL is copied only on explicit action. | Required | Verified | Native clipboard path and redacted UI | UI/source/log checks found no credential; explicit copy is the sole full-URL path. |
| FUNC-006 | Native policy settings save through the authenticated profile API and clearly require a broker restart. | Required | Verified | Native policy editor | Tool-card policy saved, remained inactive, then became effective after native restart. |
| FUNC-007 | Native Git review separates staged/unstaged files, renders bounded diffs, and keeps destructive actions explicit. | Required | Verified | `ChangesView`, `/admin/changes`, guarded Git workflow | HTTP, Git workflow, universal-app build, and visual fixture checks cover tracked/untracked review and policy enforcement. |
| FUNC-008 | SSH hosts are discovered from concrete OpenSSH aliases and require explicit local approval that becomes invalid when routing changes. | Required | Verified | `remoteConnections`, `/admin/remotes`, `HostsView` | Included configs, wildcard rejection, unknown aliases, failed host-key trust, rerouting, revocation, mode-0600 persistence, authenticated API, native build, and visual states pass. |
| FUNC-009 | Approved SSH hosts can expose saved project folders through the normal per-chat picker and route bounded coding tools without blocking other chats or invoking Codex. | Required | Verified | `remoteWorkspace`, remote route records, picker context, native Hosts project controls | Direct containment/trust/concurrency smoke plus end-to-end HTTP/MCP list/select/read/search/write/edit/Bash/Git routing pass. |
| DATA-001 | Launch configuration and runtime records are local, restrictive, and contain no additional persisted chat content. | Required | Verified | Private desktop/runtime/profile files | Temporary-home audit confirmed mode `0600`, non-secret config, and no chat content. |
| DATA-002 | Session/activity telemetry remains memory-only, bounded, expiring, and content-free; transport probes are not presented as user chats. | Required | Verified | `src/runtimeMonitor.ts` | Monitor and HTTP assertions distinguish routed chats, project-selection sessions, and raw connections. |
| AUTH-001 | Native API calls authenticate with the private runtime token; public requests remain fail-closed. | Required | Verified | Native bearer client, `src/http.ts` | Live unauthorized request returned 401; native/authorized request returned 200. |
| AUTH-002 | Workspace file/tool boundaries and transport-session isolation remain unchanged. | Required | Verified | Guard, operations, HTTP transport | Existing complete smoke/stress suites. |
| UI-001 | The native IA is Now / Projects / Environments / Worktrees / Changes / Chats / Hosts / Connection / Policy, composed from first principles for desktop. | Required | Verified | Native navigation shell | All destinations build and fixture/API states are covered by native smoke checks; the navigation remains scrollable at minimum height. |
| UI-002 | The native product uses Flow7 Endorsed expression: Ground, cool Signal, daylight work surface, Geologica, spatial hierarchy, and quiet technical motion. | Required | Verified | Native tokens, fonts, icon, and components | Flow7 adoption audit passed; interface is original and native-first. |
| UI-003 | Keyboard navigation, visible focus, semantic labels, 44px targets, AA contrast, and reduced motion are respected. | Required | Verified | SwiftUI semantics + responsive fallback | Accessibility tree, focus/target source audit, contrast, narrow layout, and reduced-motion rules verified. |
| UI-004 | The browser `o` page is rebuilt as a small branded fallback that explains and opens the native app; it is not a duplicate dashboard. | Required | Verified | `src/localAppPage.ts`, fallback CSS/JS | HTTP smoke plus 1440×900 and 390×844 visual/overflow checks passed. |
| UI-005 | ChatGPT gets a small cache-versioned project picker, while exact-name selection remains a first-class fallback when inline UI cannot load. | Required | Verified | `src/projectPickerWidget.ts`, `src/server.ts` | Picker render/click harness, Apps SDK metadata/schema assertions, and plain-chat routing smoke pass. |
| UI-006 | Model compatibility is stated before connection: ChatGPT Pro model variants do not expose Apps, while a Pro subscription remains supported with compatible models. | Required | Verified | Native Now/Connection views, browser fallback, public site, docs | Native source/build checks and English/Chinese site render tests pass. |
| OPS-001 | The app is universal (`arm64` + `x86_64`), ad-hoc signed, self-contained, and package-shipped. | Required | Verified | Build pipeline, prebuilt app, npm files | `lipo`, `codesign`, plist/resources, exact installer, and 4.2 MB tarball checks passed. |
| OPS-002 | The CLI writes enough non-secret launch metadata for the app to start the broker without manual configuration. | Required | Verified | Mode-0600 `desktop.json` writer | Temporary-home CLI/native lifecycle test passed without setup. |
| OPS-003 | Maintainer/user docs describe the native architecture, lifecycle, fallback, privacy boundary, build, and release flow. | Required | Verified | English/Chinese docs, security, design, checklist, changelog | Documentation and Flow7 contract audit complete. |
| OPS-004 | Public/static product surfaces describe the native app accurately and remain deployable. | Required | Verified | `docs/*`, `website/*` | Lint/build/render and English/Chinese desktop/mobile checks pass; GitHub Pages and Sites production deployments verified. |
| TEST-001 | Root build, smoke, stress, desktop build/smoke, package, audit, accessibility, and visual checks pass. | Required | Verified | Root/website/native test scripts | Full release matrix passes; root and website production dependency audits both report zero known vulnerabilities. |

## Architecture decisions

| Decision | Choice | Rationale | Consequence |
|---|---|---|---|
| Product relationship | Flow7 Endorsed | CodexFlow is an independent technical utility in the Flow7 family. | Flow7 supplies care, rhythm, typography, interaction, and provenance; CodexFlow owns its spatial expression. |
| Existing browser UI | Treat as interface residue | It is an admin-like duplicate of responsibilities that belong in the desktop product. | Rebuild it as a tiny authenticated fallback and deep-link surface. |
| Runtime boundary | Existing CodexFlow broker remains authoritative | The user explicitly rejected Codex CLI execution and does not need another backend. | The app is an authenticated observer/controller over existing local APIs and processes. |
| Native platform | SwiftUI macOS app | The workspace has a complete current macOS/Xcode toolchain and the request is for an actual computer app. | Deliver a fast, native, dependency-light `.app`; retain browser fallback for non-macOS. |
| Installation | Package-shipped universal app copied to `~/Applications` on first launch | Preserves the one-command experience without a separate installer. | CLI compares the complete bundle and atomically refreshes stale copies, including same-version development builds. |
| Startup ownership | Native app may launch the existing Node broker using a non-secret desktop config | Enables useful offline launch and lifecycle controls while keeping one runtime implementation. | App starts `codexflow start --non-interactive --no-open-app`; logs remain local. |
| Runtime discovery | Read all private runtime records under `~/.codexflow/runtime` | Supports multiple projects/brokers and resumption without a registry service. | Tokens are held in memory and never rendered. |
| Native information architecture | Now / Projects / Environments / Worktrees / Changes / Chats / Hosts / Connection / Policy | Maps directly to “what is live, where, how projects initialize, which checkouts exist, what changed, which hosts are trusted, who is connected, how to connect, what is allowed.” | No fake chat composer or redundant model experience. |
| Session observability | Existing memory-only, content-free overview | Operators need route/health visibility without retaining prompts or repository content. | Show fingerprints, project, tool name/status/duration, and timestamps only. |
| Browser fallback | Authenticated status + deep link + emergency connection actions | Non-macOS and recovery paths still need a small local surface. | The `o` key opens native app on macOS; the page remains manually reachable. |

## Verification evidence

- Root TypeScript build, the complete smoke suite, and stress suite pass for 0.36.0.
- The dedicated project picker renders and selects a real project in an isolated browser harness without console errors; `list_projects` uses its cache-versioned resource while `select_project` is usable without an output template.
- Runtime and HTTP regression tests confirm that multiple MCP transports sharing one private route aggregate into one GUI chat, simultaneous routes remain isolated, route-level calls/errors are accumulated correctly, and unbound discovery/picker transports stay hidden from chat telemetry.
- The native app builds for `x86_64 arm64`, passes strict signature/plist/resource checks, launches in fixture mode, and refreshes a deliberately corrupted same-version installation.
- A real private temporary broker was authenticated, stopped, started, policy-edited, restarted, and checked through the signed GUI; unauthorized HTTP remained 401 and the native log contained no credential.
- npm dry-run packaging contains the complete signed 0.36.0 app, remote helper, and required resources in a 2.1 MB tarball; both root and website production audits report zero vulnerabilities.
- The public website passes lint, build, and English/Chinese rendered-output tests locally. GitHub Pages and the Flow7-hosted product site both publicly serve 0.36.0 and the shipped remote-project copy.
- Direct SSH-helper regression proves host/project trust invalidation, blocked-path rejection, bounded reads/writes, search/edit behavior, and genuinely concurrent remote operations. The HTTP/MCP regression proves the saved remote project appears in the ordinary picker, persists its private route, and performs file, Bash, and Git work at the intended root.
- The Flow7 adoption checklist and Full Product Completion Contract were re-read after implementation; every local gate passes.
- The existing public URLs remain `https://tarunspandit.github.io/codexflow/` and `https://codexflow.tarunspandit.chatgpt.site/`; both were verified after the 0.30.4 source release.
- Pull request 14 was squash-merged to `main` at commit `9e95eb0`; the corresponding GitHub Pages deployment completed successfully.
- Pull request 16 was squash-merged to `main` at commit `9c22565`; release `v0.32.0`, GitHub Pages, and Sites version 8 are live.
- Pull request 18 was squash-merged to `main` at commit `33a3148`; release `v0.33.0`, GitHub Pages, and Sites version 9 are live.
- Pull request 20 was squash-merged to `main` at commit `3292e40`; release `v0.34.0`, GitHub Pages, and Sites version 10 are live.
- Pull request 22 was squash-merged to `main` at commit `57cab07`; release `v0.35.0`, GitHub Pages, and Sites version 11 are live.
- Pull request 24 was squash-merged to `main` at commit `b1b8a31`; release `v0.36.0`, GitHub Pages, and Sites version 12 are live. Sites version 12 uses source commit `7102556` and deployment `appgdep_6a60d24d719881919d2db4aeaf4f4dd7` completed successfully.
- The permanent `https://codexflow.flow7.org` tunnel is reachable and correctly returns `401` for unauthenticated root and MCP requests.
- The stale `CodexFlow Local` ChatGPT connector was uninstalled, leaving `CodexFlow` as the current connector.

## External prerequisites

- A configured model/plugin client is needed for real remote model turns. Native app and broker lifecycle behavior must remain testable without transmitting model credentials.

## Open blockers

- npm registry publication requires a refreshed maintainer login (`npm whoami` returned E401 on 2026-07-22). This does not block source, desktop, GitHub Pages, Sites, or permanent-tunnel operation.
- The final live two-chat ChatGPT acceptance pass requires an authenticated ChatGPT browser session. The equivalent broker-level concurrent-route regression test passes.

## Completion record

Every required ledger row remains verified. The full 0.36.0 local release matrix passes, including build, complete smoke, stress, native bundle/signature and Hosts project-management visual checks, package dry-run, website lint/build/render tests, zero-vulnerability production audits, SSH trust and asynchronous remote-routing regressions, scheduled-project prompt durability, environment/worktree interoperability, explicit tracked/untracked Git review, and concurrent-route regression coverage. Source, release, GitHub Pages, the Flow7-hosted site, and the permanent tunnel are live; npm publication and the account-authenticated ChatGPT acceptance passes remain external checks.
