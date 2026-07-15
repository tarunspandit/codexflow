# Product Build State

Updated: 2026-07-15

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

Complete: native application, broker integration, browser fallback, packaging, documentation, and public deployment are verified.

## Product truth

- CodexFlow is an independent local MCP broker that gives a user-owned ChatGPT conversation bounded access to approved repositories.
- One broker discovers local projects, serves one authenticated endpoint, and maintains independent project bindings for concurrent MCP conversations.
- ChatGPT supplies conversation and model reasoning. CodexFlow supplies projects, files, repository analysis, git, guarded terminal execution, instructions, skills, and handoff/context tools.
- Codex metadata is an optional, read-only project/history source. CodexFlow never starts, resumes, or performs work through the Codex CLI.
- Saved launch profiles persist under `~/.codexflow`; live transport sessions and activity are process-local and content-free.
- The native application controls and observes the local broker. It does not introduce a second chat client, model backend, or execution authority.

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
| FUNC-003 | Native Now, Projects, Chats, Connection, and Policy views render real overview/profile data. | Required | Verified | Native views + `/api/overview`, `/admin/profile` | Live decoding/UI inspection covered all destinations. |
| FUNC-004 | Connection URL credentials are never displayed or logged; the complete URL is copied only on explicit action. | Required | Verified | Native clipboard path and redacted UI | UI/source/log checks found no credential; explicit copy is the sole full-URL path. |
| FUNC-005 | Native policy settings save through the authenticated profile API and clearly require a broker restart. | Required | Verified | Native policy editor | Tool-card policy saved, remained inactive, then became effective after native restart. |
| DATA-001 | Launch configuration and runtime records are local, restrictive, and contain no additional persisted chat content. | Required | Verified | Private desktop/runtime/profile files | Temporary-home audit confirmed mode `0600`, non-secret config, and no chat content. |
| DATA-002 | Session/activity telemetry remains memory-only, bounded, expiring, and content-free. | Required | Verified | `src/runtimeMonitor.ts` | Existing monitor and HTTP negative-content assertions. |
| AUTH-001 | Native API calls authenticate with the private runtime token; public requests remain fail-closed. | Required | Verified | Native bearer client, `src/http.ts` | Live unauthorized request returned 401; native/authorized request returned 200. |
| AUTH-002 | Workspace file/tool boundaries and transport-session isolation remain unchanged. | Required | Verified | Guard, operations, HTTP transport | Existing complete smoke/stress suites. |
| UI-001 | The native IA is Now / Projects / Chats / Connection / Policy, composed from first principles for desktop. | Required | Verified | Native navigation shell | All destinations and fixture/live states visually inspected in the native app. |
| UI-002 | The native product uses Flow7 Endorsed expression: Ground, cool Signal, daylight work surface, Geologica, spatial hierarchy, and quiet technical motion. | Required | Verified | Native tokens, fonts, icon, and components | Flow7 adoption audit passed; interface is original and native-first. |
| UI-003 | Keyboard navigation, visible focus, semantic labels, 44px targets, AA contrast, and reduced motion are respected. | Required | Verified | SwiftUI semantics + responsive fallback | Accessibility tree, focus/target source audit, contrast, narrow layout, and reduced-motion rules verified. |
| UI-004 | The browser `o` page is rebuilt as a small branded fallback that explains and opens the native app; it is not a duplicate dashboard. | Required | Verified | `src/localAppPage.ts`, fallback CSS/JS | HTTP smoke plus 1440×900 and 390×844 visual/overflow checks passed. |
| UI-005 | ChatGPT’s inline project picker remains host-native and focused on selecting a project. | Required | Verified | `src/toolCardWidget.ts` | Existing widget and project-routing smoke. |
| OPS-001 | The app is universal (`arm64` + `x86_64`), ad-hoc signed, self-contained, and package-shipped. | Required | Verified | Build pipeline, prebuilt app, npm files | `lipo`, `codesign`, plist/resources, exact installer, and 4.2 MB tarball checks passed. |
| OPS-002 | The CLI writes enough non-secret launch metadata for the app to start the broker without manual configuration. | Required | Verified | Mode-0600 `desktop.json` writer | Temporary-home CLI/native lifecycle test passed without setup. |
| OPS-003 | Maintainer/user docs describe the native architecture, lifecycle, fallback, privacy boundary, build, and release flow. | Required | Verified | English/Chinese docs, security, design, checklist, changelog | Documentation and Flow7 contract audit complete. |
| OPS-004 | Public/static product surfaces describe the native app accurately and remain deployable. | Required | Verified | `docs/*`, `website/*` | Lint/build/render and English/Chinese desktop/mobile checks pass; GitHub Pages and Sites production deployments verified. |
| TEST-001 | Root build, smoke, stress, desktop build/smoke, package, audit, accessibility, and visual checks pass. | Required | Verified | Root/website/native test scripts | Full release matrix passed; both dependency trees report zero vulnerabilities. |

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
| Native information architecture | Now / Projects / Chats / Connection / Policy | Maps directly to “what is live, where, who is connected, how to connect, what is allowed.” | No fake chat composer or redundant model experience. |
| Session observability | Existing memory-only, content-free overview | Operators need route/health visibility without retaining prompts or repository content. | Show fingerprints, project, tool name/status/duration, and timestamps only. |
| Browser fallback | Authenticated status + deep link + emergency connection actions | Non-macOS and recovery paths still need a small local surface. | The `o` key opens native app on macOS; the page remains manually reachable. |

## Verification evidence

- Root TypeScript build, the complete smoke suite, and stress suite pass.
- The native app builds for `x86_64 arm64`, passes strict signature/plist/resource checks, launches in fixture mode, and refreshes a deliberately corrupted same-version installation.
- A real private temporary broker was authenticated, stopped, started, policy-edited, restarted, and checked through the signed GUI; unauthorized HTTP remained 401 and the native log contained no credential.
- npm dry-run packaging contains the complete signed app and required resources in a 4.2 MB tarball; root and website audits report zero vulnerabilities.
- The production website passes lint, build, and English/Chinese render tests. Static and production-rendered editions were visually checked at 1440×900 and 390×844 without horizontal overflow.
- The Flow7 adoption checklist and Full Product Completion Contract were re-read after implementation; every local gate passes.
- The merged source is live at `https://tarunspandit.github.io/codexflow/`; the exact validated hosted build is also deployed at `https://codexflow.tarunspandit.chatgpt.site/`. Both returned the native-app release copy in production.

## External prerequisites

- A configured model/plugin client is needed for real remote model turns. Native app and broker lifecycle behavior must remain testable without transmitting model credentials.

## Open blockers

- None.

## Completion record

Every required ledger row is verified. The Flow7 adoption checklist and completion contract were re-read, the full release matrix passed, the signed app was installed into `~/Applications`, and both changed public surfaces were deployed and checked.
