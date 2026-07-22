# CodexFlow × Flow7 adoption

Updated: 2026-07-15

## Product thesis

For developers working through a remote AI chat, CodexFlow is the most direct,
spatial, and trustworthy way to operate multiple project-scoped coding sessions
on their own computer.

CodexFlow uses the **Flow7 Endorsed** relationship mode. It is an independent
open-source technical utility with its own product expression, while adopting
Flow7's standards of care, spatial rhythm, interaction clarity, accessibility,
and provenance.

## Product truth

- CodexFlow is an independent local MCP broker, not the Codex CLI and not a
  hosted model service.
- One process discovers user-approved projects and serves one authenticated
  endpoint to many independently routed ChatGPT conversations.
- ChatGPT owns conversation and model reasoning. CodexFlow owns bounded local
  files, repository analysis, git, optional terminal execution, instructions,
  skills, and handoff/context tools.
- When ChatGPT Work creates subagents, CodexFlow gives each child an isolated,
  revocable project route and stores only its bounded role, state, and result.
  It never starts, impersonates, or proxies the model agent.
- The native app observes and controls that existing broker. It introduces no
  second execution authority, hidden model, or chat composer.
- Codex project metadata is an optional read-only discovery/history source.
  CodexFlow never starts, resumes, or performs work through the Codex CLI.
- Profiles and restrictive runtime records persist locally. Activity telemetry
  remains process-local, content-free, bounded, and short-lived.

## Surface hierarchy

### 1. Native desktop app — primary product

The SwiftUI macOS application is organized around real user jobs:

1. **Now** — understand broker health, current workspace, active tasks, and
   recent content-free activity.
2. **Projects / Environments / Worktrees** — choose where work happens, inspect
   shared setup, and manage isolated checkouts.
3. **Changes / Tasks** — review bounded diffs and supervise parent plans plus
   nested Active/Done web agents.
4. **Hosts / Computer / Browser** — approve remote machines, native apps, and
   ephemeral website origins through explicit local boundaries.
5. **Connection / Policy** — control runtime lifecycle, copy the private Server
   URL, and inspect or save next-launch limits.

It can launch while the broker is offline, choose a workspace with the native
folder picker, start the existing Node broker, reconnect from private runtime
records, and switch among active or recent workspaces. It never renders or logs
the authentication token.

### 2. ChatGPT inline surface — focused remote interaction

The embedded MCP App follows the host surface. The project picker asks one
focused question, filters larger catalogs, persists the selected project in
widget state, routes through `select_project`, and announces selection or
recovery. Tool results use bounded summaries and native disclosure controls.

### 3. Authenticated browser fallback — recovery only

The former browser dashboard is interface residue, not a second product. Its
replacement explains that the native app is primary, deep-links into it,
provides explicit connection copying, and shows only compact authenticated
diagnostics. It does not reproduce the native navigation or profile editor.

### 4. Public website — explanation, not simulation

The public English and Chinese editions explain the native application and show
a clearly labelled representative preview. They contain no private runtime data
and do not pretend to be an interactive local control surface.

## Design system

### Identity and foundations

- System: Flow7 Luminous Orbit.
- Domain expression: Tech.
- Typeface: locally bundled static Geologica weights in the native app and the
  existing local web font family on public/fallback surfaces.
- Primary palette: Ground `#08090B`, daylight paper `#EFEBE4`, raised light
  `#FFFDF8`, cool Signal `#79B5DC`, and precise ink `#151517`.
- Spatial cadence: `7 / 14 / 21 / 28 / 42 / 56 / 84`.
- Monospace is restricted to paths, commands, identifiers, and telemetry.

The native application uses a deep Luminous Orbit rail against a warm daylight
work surface. Signal blue indicates focus, selection, and operational state.
Depth comes from tone, scale, spacing, and sparse hairlines—not glass stacks,
generic gradients, or ornamental cards.

### Product character

- Technical without hacker theater.
- Cinematic in proportion, not decorative spectacle.
- Spatial, calm, and exact under operational density.
- Candid about local authority, limits, and failure.
- Designed around true lifecycle and routing states rather than invented
  metrics, fake terminal output, or fake model interactions.

### Interaction and motion

- Native controls expose hover, pressed, focus, disabled, loading, success,
  error, and recovery states with text plus color/shape cues.
- Minimum targets are 44px; navigation and controls are keyboard reachable and
  carry semantic accessibility labels.
- Structural motion is restrained and honors macOS Reduce Motion. Browser
  surfaces collapse transitions under `prefers-reduced-motion`.
- The full Server URL reaches the clipboard only after an explicit action;
  visible UI uses a redacted endpoint.
- Destructive lifecycle actions remain explicit and recoverable.

## Accessibility and trust

- Native views expose meaningful button, navigation, status, and content labels
  to macOS accessibility APIs.
- Text/background pairings meet WCAG AA; state is never encoded through color
  alone, and the web fallback includes forced-color handling.
- Layouts remain usable from the minimum native window through wide desktop, and
  the fallback is verified without horizontal overflow at 320px and desktop.
- The local HTTP shell uses a strict same-origin CSP, denies framing, suppresses
  referrers, disables unused browser capabilities, and never renders its token.
- Runtime activity omits prompts, tool arguments, file contents, command output,
  transport IDs, child route IDs, and credentials. Bounded agent roles, states,
  and results are owner-only and deliberately reported through `agent_progress`.

## Adoption checklist and evidence

| Area | Result | Evidence |
|---|---|---|
| Product understanding | Pass | `PRODUCT_BUILD_STATE.md`; broker remains sole execution authority; native-first surface hierarchy |
| Foundations | Pass | `desktop/macos/Sources/CodexFlowApp/DesignSystem.swift`; bundled Geologica; Ground/Light/Signal/Ink and seven-point cadence |
| Identity | Pass | custom application icon; Flow7 Tech public assets; restrained product-name treatment |
| Layout and depth | Pass | native Now/Projects/Environments/Worktrees/Changes/Tasks/Hosts/Computer/Browser/Connection/Policy; spatial rail/work-surface composition; compact fallback |
| Interaction and motion | Pass | native lifecycle and workspace controls; loading/disabled/error/recovery states; reduced-motion behavior |
| Content | Pass | repository-specific connection, routing, policy, recovery, and privacy copy; no generic AI claims |
| Accessibility | Pass | semantic SwiftUI controls and labels; visible focus; 44px targets; contrast and narrow-width verification |
| Family resemblance | Pass | Flow7 rhythm, type, care, motion, provenance, and judgment without copying the parent homepage |

## Verification contract

Release evidence must include the native universal architecture and signature,
fixture and live-broker lifecycle smoke tests, root build/smoke/stress suites,
package inspection, dependency audit, browser desktop/mobile visual checks,
website lint/build/render checks, and a check of the deployed public source.

The 0.43.0 native Active/Done agent surface has passed signed universal build,
launch, accessibility-tree, production-size visual, route-isolation, restart,
secret-refusal, and credential-leakage checks. Public deployment evidence is
recorded in `PRODUCT_BUILD_STATE.md` as each release target completes.

The final platform-hosted golden path still requires a configured ChatGPT Work
account: spawn two children, give each its allocated route, verify independent
project/worktree access, steer from the parent, and observe native Active/Done
state. This external account prerequisite is not replaced with fabricated local
success state.
