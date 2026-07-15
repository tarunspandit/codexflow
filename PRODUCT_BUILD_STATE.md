# Product Build State

Updated: 2026-07-15

## Objective

Build and verify the complete production-quality CodexFlow GUI and application: a Flow7-endorsed, setup-free local-first web experience for project-scoped multi-session AI coding, backed by the existing broker/runtime rather than the Codex CLI, with real project discovery, session routing, chat workflows, status/settings, security, responsive accessibility, documentation, and deployable packaging.

## Specification sources

- User product direction in the Codex task, including the 2026-07-15 request to build “the gui, and app”.
- `README.md`, `CHATGPT_PROMPT.md`, `CODEX_PROMPT.md`, `FAQ.md`, `SECURITY.md`, `DOMAIN_SETUP.md`, and repository implementation/tests.
- `design.md` and the Flow7 Build Product design-system references.
- Existing public website and local broker/status implementation as evidence of product behavior, not as binding interface structure.

## Product thesis

For developers working through a remote AI chat, CodexFlow is the most direct, spatial, and trustworthy way to operate multiple project-scoped coding sessions on their own computer.

## Current phase

Complete: implementation, verification, production publication, and handoff.

## Product truth

- CodexFlow is an independent local MCP broker that gives a user-owned ChatGPT conversation bounded access to user-approved repositories.
- One `codexflow` process discovers local projects, serves one authenticated endpoint, and maintains independent project bindings for concurrent MCP conversations.
- ChatGPT supplies conversation and model reasoning. CodexFlow supplies projects, files, repository analysis, git, guarded terminal execution, instructions, skills, and handoff/context tools.
- Codex metadata is an optional, read-only source for recently used project folders and explicitly enabled history metadata. CodexFlow never starts, resumes, or performs work through the Codex CLI.
- The local process is not an OS sandbox, hosted model service, account pool, quota bypass, or hidden-memory bridge.
- Saved launch profiles persist under `~/.codexflow`; live transport sessions and activity are process-local and must not retain prompts, file contents, command output, or tokens.

## Interface residue

- The current local page is a long status/settings document organized around implementation fields rather than the jobs “see what is live,” “find my projects,” “understand each chat,” and “connect safely.”
- The current ChatGPT widget renders every result through one dark developer-card treatment, uses internal scrolling, and gives tool output equal visual weight regardless of the current conversational decision.
- The existing public site is a product explanation and remains separate from the authenticated local application.
- Existing routes, selectors, profile persistence, runtime guards, and tool contracts are preserved only where they support the new journeys.

## Requirement ledger

| ID | Source | Requirement | Priority | Dependencies | Status | Implementation | Verification | Notes |
|---|---|---|---|---|---|---|---|---|
| PROD-001 | User direction | CodexFlow provides a complete functional GUI spanning the ChatGPT app surface and a token-protected local companion, not only a landing page or settings form. | Required | — | Implemented | `src/localAppPage.ts`, `src/http.ts`, `src/toolCardWidget.ts` | HTTP and MCP widget smoke | ChatGPT owns the conversation; the local companion owns operational visibility. |
| PROD-002 | User direction; README “Codex-style web chats” | The web experience behaves as a capable project-aware coding agent without invoking the Codex CLI to perform work. | Required | Runtime/tool boundary | Verified | `src/server.ts`, `src/fsOps.ts`, `src/bashOps.ts`, `src/gitOps.ts` | Complete smoke and stress suites | Codex history remains optional read-only compatibility. |
| PROD-003 | README “What It Does” | ChatGPT can inspect, search, edit, verify, review changes, load instructions/skills, and produce handoff or Pro context through bounded tools. | Required | Tool modes and guards | Verified | `src/server.ts`, `src/analysis/*`, `src/capabilitiesOps.ts`, `src/proContext.ts` | Complete smoke and stress suites | — |
| FLOW-001 | README install loop | A fresh user runs `codexflow`, receives a copied Server URL, creates one ChatGPT app, and can begin without per-folder registration. | Required | CLI, tunnel, project discovery | Verified | `scripts/codexflow.mjs` | CLI and HTTP smoke suites | One-time ChatGPT app creation is an external platform step. |
| FLOW-002 | User direction | A new ChatGPT conversation presents synchronized local projects and binds the chosen project before repository work. | Required | Project discovery, widget bridge | Implemented | `src/projectCatalog.ts`, `src/server.ts`, `src/toolCardWidget.ts` | Project routing smoke; widget integration tests to expand | — |
| FLOW-003 | User direction | Multiple concurrent ChatGPT conversations keep independent project bindings through one broker and tunnel. | Required | MCP transport isolation | Verified | `src/http.ts`, `src/server.ts` | Parallel HTTP client routing and isolation smoke | — |
| FLOW-004 | User direction | The local companion shows the real active/recent chat sessions, their selected projects, and bounded activity without inventing a second model chat. | Required | Runtime observability | Implemented | `src/runtimeMonitor.ts`, `src/http.ts`, `src/localAppPage.ts` | Runtime monitor and parallel HTTP smoke | Session telemetry is process-local and content-free. |
| FLOW-005 | README normal workflow | Within a selected project, the user can move from orientation to edits, verification, and change review with loading, clean, changed, error, and recovery states. | Required | PROD-003 | Implemented | `src/server.ts`, `src/toolCardWidget.ts` | Smoke/stress plus widget state checks | UI hierarchy will be redesigned. |
| FUNC-001 | User direction | Project discovery combines the default root, allowed roots, nested project markers, and recent Codex metadata without manual setup. | Required | Local filesystem, optional Codex metadata | Verified | `src/projectCatalog.ts`, `src/codexSessions.ts` | Project catalog, HTTP, and stress suites | — |
| FUNC-002 | README “advertises” | Project selection advertises repository instructions, workspace/user/plugin skills, plugin manifests, and configured MCP server names. | Required | Capabilities discovery | Verified | `src/capabilitiesOps.ts`, `src/server.ts` | Capability inventory and complete smoke suites | Names/metadata only until explicitly loaded. |
| FUNC-003 | Security boundary | Runtime policy keeps bash, write, tool-card, history, and handoff controls independent and applies saved changes only after restart. | Required | Config/profile model | Verified | `src/config.ts`, `src/profileStore.ts`, `src/http.ts` | Settings and HTTP smoke suites | Live browser changes must not silently mutate an active session. |
| FUNC-004 | User request “gui, and app” | `codexflow app` or an equivalent obvious action opens the running local companion without requiring a copied token or manual URL reconstruction. | Required | Runtime record, CLI browser opener | Implemented | `scripts/codexflow.mjs` | CLI smoke with private fake browser target | `gui` and `open` aliases are included; credentials are not printed. |
| DATA-001 | README saved settings | Launch profiles persist locally with restrictive permissions and redact stored tokens when displayed. | Required | Filesystem | Verified | `src/profileStore.ts`, `scripts/codexflow.mjs` | Settings and CLI smoke suites | — |
| DATA-002 | Security/Flow7 care | Runtime session/activity telemetry is memory-only, bounded, expires promptly, and stores no prompts, arguments, file contents, command output, or tokens. | Required | Runtime observability | Implemented | `src/runtimeMonitor.ts` | Dedicated monitor smoke and HTTP negative-content assertions | Default activity cap 120; closed session retention 5 minutes. |
| AUTH-001 | User direction; SECURITY failure model | Every public/non-loopback request requires the CodexFlow token; bearer and URL-token paths use constant-time comparison. | Required | HTTP server | Verified | `src/http.ts` | HTTP auth, CSP, no-leak, and fail-closed smoke assertions | Static brand assets may remain public and content-free. |
| AUTH-002 | User direction | MCP transport identifiers are cryptographically random, independently bound, validated, bounded by count/TTL, and unknown identifiers cannot access another session. | Required | Streamable HTTP transport | Implemented | `src/http.ts`, `src/server.ts` | Unknown/stale/parallel-session HTTP smoke | Local UI will expose only non-actionable display fingerprints. |
| AUTH-003 | SECURITY failure model | Files, writes, patches, search, and terminal operations cannot escape allowed roots or blocked/symlink-sensitive paths. | Required | Guard and operation layers | Verified | `src/guard.ts`, `src/fsOps.ts`, `src/searchOps.ts`, `src/bashOps.ts` | Complete smoke and stress suites | CodexFlow is not an OS sandbox. |
| UI-001 | User direction | The local companion has task-led destinations for Now, Projects, Chats, Connection, and Policy, with status integrated into the product rather than a separate generic admin page. | Required | Runtime overview API | Implemented | `src/localAppPage.ts`, `docs/assets/brand/control.{css,js}` | HTTP shell/API smoke | — |
| UI-002 | OpenAI Apps UX principles | The always-on ChatGPT project picker is a focused inline decision with no nested navigation/scrolling, persistent selection state, clear recovery, and at most the actions needed for project choice. | Required | FLOW-002 | Implemented | `src/toolCardWidget.ts` | Widget resource and project-routing smoke | Uses system typography/colors and restrained blue signal. |
| UI-003 | Completion contract | Empty, loading, live, stale/closed, success, error, disabled, and recovery states exist for projects, sessions, connection, profile save, activity, and widget actions. | Required | UI-001, UI-002 | Verified | Local shell/widget CSS and JS | HTTP source/state assertions and complete static state audit | — |
| UI-004 | User + current docs | The public site remains a clear explanation and links the user into the real one-command/local-app workflow without presenting a fake hosted coding dashboard. | Required | Documentation | Implemented | `docs/*`, `website/app/*` | Public lint/build/render tests | Preview explicitly says the public site cannot see local data. |
| BRAND-001 | Flow7 matrix | CodexFlow uses the Endorsed relationship mode: technical, spatial, capable; deep blue-black Ground; cool-blue Signal; Codex**Flow** name gesture. | Required | — | Verified | `design.md`, `FLOW7_ADOPTION.md`, brand assets, application shell | Complete Flow7 adoption checklist | Preserve local-first tooling and open-source utility. |
| BRAND-002 | Flow7 design system | The local companion uses Geologica, deliberate 7-point rhythm, technical ledgers, calm state motion, and restrained parent provenance without copying the Flow7 parent homepage. | Required | UI-001 | Verified | `docs/assets/brand/control.css`, `src/localAppPage.ts` | Token, type, identity, layout, motion, and family-resemblance audit | ChatGPT widgets follow host type/color rules instead of forcing the local brand system. |
| A11Y-001 | Flow7 completion contract | All meaningful workflows support keyboard operation, visible focus, semantic landmarks/headings, AA contrast, 44px targets, and reduced motion. | Required | UI breadth | Verified | Local app, widget, public site CSS/markup | Semantic/static audit, contrast calculation, source assertions, responsive build tests | — |
| PERF-001 | Existing limits; completion contract | Project discovery, session telemetry, activity, payloads, and UI rendering remain bounded and responsive on large local catalogs. | Required | DATA-002 | Verified | `src/projectCatalog.ts`, `src/runtimeMonitor.ts`, widget filtering | Limits, HTTP, runtime monitor, and stress suites | Catalog max 250; picker shows 8 filtered rows; activity max 120; runtime sessions max 256. |
| INT-001 | OpenAI Apps SDK | Widget tools use supported MCP Apps result notifications and feature-detected `window.openai` APIs for tool calls, state, and follow-up messages. | Required | UI-002 | Implemented | `src/toolCardWidget.ts` | Widget source assertions and ChatGPT golden test prerequisite | Official docs reviewed 2026-07-15. |
| INT-002 | README tunnel modes | Local-only, Cloudflare quick/named, ngrok, and Tailscale modes continue to produce the same MCP/app experience. | Required | CLI launcher | Implemented | `scripts/codexflow.mjs` | CLI/doctor/settings smoke; external provider live checks remain release gate | — |
| OPS-001 | User direction | Package-shipped application assets are included in the npm tarball and require no separate local frontend install or dev server. | Required | Build/package files | Verified | `src/localAppPage.ts`, `docs/assets/brand/control.{css,js}` | `npm pack --dry-run --json` includes compiled app and all local assets | — |
| OPS-002 | Sites metadata | The public React site and static GitHub Pages mirror remain buildable and deployable from repository source. | Required | Website | Verified | `docs/*`, `website/*` | Website lint, production build, bilingual render tests, Sites package/publish workflow | Production: `https://codexflow.tarunspandit.chatgpt.site`. |
| OPS-003 | Completion contract | Maintainer documentation explains the product thesis, architecture, runtime data boundaries, app surfaces, setup, tests, and release operation. | Required | Completed implementation | Verified | `README.md`, `FLOW7_ADOPTION.md`, `SECURITY.md`, `design.md` | Documentation and adoption-checklist audit | — |
| TEST-001 | PUBLIC_LAUNCH_CHECKLIST | Root build, smoke, stress-relevant paths, package inspection, audits, widget checks, responsive/static accessibility checks, and website build/render checks pass. | Required | All required implementation | Verified | Root and website suites | Build, smoke, stress, package, audit, lint, production build, rendered HTML, syntax, and whitespace checks pass | Live ChatGPT golden test is an external release prerequisite, not fabricated locally. |

## Architecture decisions

| Decision | Choice | Rationale | Consequence |
|---|---|---|---|
| Product relationship | Flow7 Endorsed | CodexFlow already has a credible utility identity and is explicitly listed in the Flow7 matrix. | Flow7 supplies care, rhythm, typography, interaction, and provenance; the technical application owns its spatial expression. |
| Existing UI | Treat as interface residue | The current local surface is an operational form, not the complete multi-session application requested. | Preserve selectors, routes, and broker behavior only where they fit the redesigned journeys. |
| Runtime boundary | CodexFlow broker remains the execution authority | The user explicitly rejected using the Codex CLI to perform work. | GUI actions must use native broker/tool APIs and project-scoped runtime state. |
| Application surfaces | ChatGPT inline UI + authenticated local companion | ChatGPT owns conversation/model state; the local process owns projects, sessions, health, activity, connection, and policy. | No fake composer or second model client; both surfaces share one runtime truth. |
| Local information architecture | Now / Projects / Chats / Connection / Policy | These destinations map to frequent user jobs and separate live state from next-launch configuration. | The status page becomes the application home rather than a document of settings. |
| Session observability | Memory-only, content-free event monitor | Operators need to see routing and health without retaining user prompts or repository content. | Store tool name/status/duration and selected project only; expose non-actionable session fingerprints. |
| Browser mutation | Profile writes only; session/project routing remains conversation-owned | Changing a live chat binding from an admin browser would violate the documented runtime boundary. | Local app observes sessions; project selection occurs through the ChatGPT tool/widget. |
| ChatGPT visual system | Host-native inline cards with CodexFlow signal accents | OpenAI UI guidance requires system typography/colors and discourages deep card navigation, nested scroll, and brand-heavy backgrounds. | Flow7 character appears through hierarchy, restraint, state clarity, and a cool-blue accent rather than a pasted local-app theme. |
| Local delivery | Package-served HTML/CSS/JS and JSON/SSE APIs | A compiled SPA stack would add setup and package weight without improving this process-local control surface. | The app ships with `codexflow`, uses no CDN/runtime dependency, and remains CSP-simple. |

## Verified commands and scenarios

- Repository inventory and clean `main` worktree confirmed on 2026-07-15.
- All supplied repository product, safety, setup, launch, design, and bilingual documentation was read to EOF and classified.
- Current Apps SDK component bridge, inline-card, accessibility, and security guidance was checked against official OpenAI documentation on 2026-07-15.
- Root TypeScript build, all ten smoke groups, stress suite, local companion HTTP/auth/security checks, private `codexflow app` CLI checks, widget syntax checks, and git whitespace checks pass after implementation.
- Root `npm audit --audit-level=high` reports zero known vulnerabilities.
- `npm pack --dry-run --json` includes `dist/localAppPage.js`, `dist/runtimeMonitor.js`, `docs/assets/brand/control.{css,js}`, Geologica, and all required identity assets.
- Hosted website lint, production build, English render test, Chinese render test, and absolute social metadata test pass with the local-companion preview.
- Website dependency overrides remove the transitive PostCSS advisory; `npm audit --audit-level=high` reports zero known vulnerabilities after a successful production rebuild.
- Static accessibility checks confirm semantic landmarks, keyboard focus paths, 44px interactive targets, reduced motion, announced status states, and a minimum 4.85:1 muted-text contrast on the deepest daylight surface.
- The exact validated `website/` source was pushed to its Sites source repository, saved as production version 1, and successfully deployed to `https://codexflow.tarunspandit.chatgpt.site`.

## External prerequisites

- A configured model/plugin client is needed for real remote model turns; local GUI and broker behavior must remain testable without transmitting credentials.

## Open blockers

- None.

## Remaining external release check

Use a configured ChatGPT account and public CodexFlow tunnel to run the documented
two-conversation golden path. No local implementation or deployment work remains.
