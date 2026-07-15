# CodexFlow × Flow7 adoption

Updated: 2026-07-15

## Product thesis

For developers working through a remote AI chat, CodexFlow is the most direct,
spatial, and trustworthy way to operate multiple project-scoped coding sessions
on their own computer.

The primary audience is a developer who wants ChatGPT to work against local
repositories without opening one broker per folder, handing repository access to
a hosted code service, or using the Codex CLI as a hidden execution layer. Their
core job is simple: run one local process, connect one authenticated Server URL,
choose a project for each conversation, and continue coding through bounded
repository tools.

CodexFlow uses the **Flow7 Endorsed** relationship mode. It retains its identity
as a precise, open-source technical utility while adopting Flow7's standards of
care, spatial rhythm, interaction clarity, accessibility, and provenance.

## Product truth and product character

Product truth:

- CodexFlow is an independent local MCP broker, not the Codex CLI and not a
  hosted model service.
- One process discovers user-approved projects and serves one authenticated
  endpoint to many independently routed MCP conversations.
- ChatGPT owns the conversation, model, approvals, and account. CodexFlow owns
  guarded files, repository analysis, git, optional terminal execution,
  instructions, skills, and handoff/context tools.
- A project's binding belongs to its MCP conversation. The local companion can
  observe that binding but cannot silently move a live chat to another folder.
- Profiles persist locally for the next launch. Live session telemetry is
  process-local, content-free, bounded, and short-lived.

Product character:

- Technical without hacker theater.
- Cinematic in proportion, not decorative spectacle.
- Spatial, calm, and exact under operational density.
- Candid about local authority, limits, and failure.
- Capable enough to expose paths and policy without pretending complexity is
  magic.

The legacy status/settings page was treated as interface residue. Its working
routes, profile fields, broker state, and safety constraints were preserved;
its backend-led information architecture and document-like presentation were
not.

## Information architecture

The application is split across two complementary surfaces.

### Local companion

The token-protected local app is organized around user jobs:

1. **Now** — understand broker health, active chats, routing, and recent activity.
2. **Projects** — find the synchronized local repositories available to chats.
3. **Chats** — inspect independent live and recently closed runtime sessions.
4. **Connection** — copy the current Server URL and edit next-launch settings.
5. **Policy** — inspect the effective write, bash, history, tool, root, and data
   boundaries.

Settings are intentionally secondary to current operating state. There is no
model selector or composer because the model conversation belongs to ChatGPT.

### ChatGPT inline surface

The embedded MCP App follows the host surface. The project picker asks one
focused question, shows at most eight project choices at once, filters larger
catalogs, persists the selected project in widget state, routes through the
`select_project` tool, and reports selection or recovery through an announced
status. Tool result cards use bounded summaries and native disclosure controls
instead of an internally scrolling dashboard.

## Design system

### Identity

- System: Flow7 Luminous Orbit.
- Domain expression: Tech.
- Primary product mark: `docs/assets/brand/flow7-tech-{dark,light}.webp`.
- Parent endorsement: `docs/assets/brand/flow7-parent-{dark,light}.webp`.
- Typeface: the locally shipped Geologica variable font.
- Name gesture: the full accessible name is “CodexFlow”; “Flow” receives the
  cool-blue signal treatment where the surrounding surface supports it.

The mark keeps its source proportions and negative space. The application uses
one small identity mark and one operational focal mark; the parent mark appears
once as provenance rather than decorative repetition.

### Foundations

The local companion maps the Flow7 foundations into named application tokens:

| Foundation | Tokens | Values |
|---|---|---|
| Ground | `--field`, `--field-deep`, `--field-raised` | `#08090B`, `#050608`, `#111419` |
| Light | `--paper`, `--surface`, `--surface-high` | `#EFEBE4`, `#F8F5EF`, `#FFFDF8` |
| Signal | `--signal`, `--signal-deep`, `--signal-wash` | `#79B5DC`, `#315F7D`, `#DCEAF2` |
| Ink | `--ink`, `--ink-soft`, `--muted` | `#151517`, `#474449`, `#625E5B` |

The default operational surface is warm daylight rather than a dark parent-site
copy. Deep blue-black material is reserved for the navigation rail, current
connection, live-state focal area, and data-boundary moments.

Spatial tokens use the seven-point cadence: `7 / 14 / 21 / 28 / 42 / 56 / 84`.
Radii use `7 / 14 / 21`. Geologica carries interface and display roles;
monospace is restricted to commands, paths, identifiers, and comparable
telemetry.

The ChatGPT widget deliberately uses host-native system typography and adaptive
host-like light/dark colors. Flow7 appears there through editing, hierarchy,
state legibility, and a restrained blue signal—not through a transplanted
branded background.

### Layout and depth

- Every destination has one clear reading and one operational purpose.
- Dense state is expressed with ledgers and runways rather than a bento-card
  wall.
- Tone, scale, and spacing establish depth before borders.
- Hairlines structure comparable data; they are not decorative grids.
- Glow, glass, generic AI nodes, fake terminals, invented metrics, and purple
  gradients are absent.
- Responsive rules cover the rail, navigation, project index, session ledger,
  connection runway, profile editor, policy view, and footer from wide desktop
  down to a 320px minimum viewport.

### Interaction and motion

- Navigation supports hash URLs, browser history, keyboard focus transfer, and a
  skip link.
- Projects support keyboard search, refresh, empty/error states, and a copyable
  conversation starter.
- Sessions and activity support loading, live, idle, closed, success, and error
  states using text plus shape/color cues.
- Profile saving validates on the server, rate-limits writes, disables the
  submitting action, reports errors, and explains that changes apply after
  restart.
- Copy actions have immediate toast feedback and a non-Clipboard-API fallback.
- Interactive targets are at least 44px on both local and embedded surfaces.
- Micro feedback uses roughly 140–220ms transitions. Structural reveal uses the
  Flow7 ease `cubic-bezier(.22, 1, .36, 1)`.
- No orbit or decoration spins indefinitely. Loading indicators communicate an
  active wait, and reduced-motion media rules collapse all motion.

## Accessibility and trust

- Semantic `aside`, `nav`, `header`, `main`, `section`, and `footer` landmarks
  organize the companion.
- Headings are destination-labelled and receive focus after navigation.
- Keyboard focus is visible, the project picker uses `aria-pressed`, and changing
  runtime state is announced through polite live regions.
- State is never encoded through color alone: labels, counts, status text, and
  shapes remain present.
- The palette provides high-contrast dark-on-light and light-on-dark text pairs,
  with higher-contrast and forced-color media rules.
- The UI remains usable at narrow widths and honors reduced motion.
- The local page uses a strict same-origin content security policy, denies
  framing, suppresses referrers, disables browser capabilities it does not need,
  and never renders the local authentication token.
- Runtime activity stores tool name, status, duration, timestamps, and selected
  project only. It does not store prompts, tool arguments, file contents,
  terminal output, transport IDs, or credentials.

## Adoption checklist and evidence

| Area | Result | Evidence |
|---|---|---|
| Product understanding | Pass | `PRODUCT_BUILD_STATE.md`; job-led IA; preserved broker and policy contracts |
| Foundations | Pass | `docs/assets/brand/control.css`; local Geologica; Ground/Light/Signal/Ink and 7-point tokens |
| Identity | Pass | official raster assets; accessible full-name lockup; single provenance treatment |
| Layout and depth | Pass | Now/Projects/Chats/Connection/Policy; ledger/runway composition; responsive rules |
| Interaction and motion | Pass | hover/pressed/focus/loading/disabled/empty/error/success states; reduced motion; 44px targets |
| Content | Pass | repository-specific setup, routing, security, and recovery copy; no generic AI claims |
| Accessibility | Pass | landmarks, heading/focus management, live regions, labels, contrast states, keyboard flows |
| Family resemblance | Pass | Flow7 rhythm, care, type, motion, provenance, and judgment without copying the parent homepage |

## Verification

- Root TypeScript build and the complete smoke suite cover broker behavior,
  runtime monitoring, HTTP authentication, project routing, profile persistence,
  widget resources, CLI app opening, and negative secret-retention assertions.
- HTTP tests verify the app shell, all five destinations, real overview data,
  content-free SSE events, strict security headers, and no raw token rendering.
- Website lint, production build, and English/Chinese rendered-output tests cover
  the public explanation of the local companion.
- Package inspection verifies that the application HTML runtime and local CSS,
  JavaScript, type, and identity assets ship with the command-line package.
- The exact validated public source is deployed at
  `https://codexflow.tarunspandit.chatgpt.site`.

## External release prerequisite

A live configured ChatGPT connection is required for the final platform-hosted
golden path: open the project picker, bind one conversation, invoke repository
tools, and verify a second concurrent conversation retains its own project.
This depends on the user's ChatGPT account and public tunnel; it is not replaced
with a fabricated local success state.
