# Codex Desktop Parity

Updated: 2026-07-23

CodexFlow gives a ChatGPT web conversation a Codex-like local coding surface without starting, resuming, or delegating work to the Codex CLI. ChatGPT supplies the model and conversation; the local CodexFlow broker supplies bounded project, file, Git, worktree, terminal, environment, instruction, skill, and MCP context.

The honest status is **strong local workflow parity, not literal Codex desktop parity**.

## Capability matrix

| Capability | Status | CodexFlow implementation |
|---|---|---|
| Local project discovery and switching | Available | One broker discovers allowed and recent local projects; every web chat gets a private, persistent route to one project. |
| Concurrent project chats | Available | Multiple ChatGPT conversations can use one tunnel simultaneously without sharing route, workspace, or terminal state. |
| Repository instructions, skills, plugins, and MCP inventory | Available | Project selection advertises `AGENTS.md`, workspace/user/plugin skills, plugin manifests, and configured MCP server names. |
| Read, search, edit, patch, analyze, and review | Available | Root-guarded local tools provide the ordinary coding loop and bounded change review. |
| Persistent integrated terminal | Available | Each private chat route owns persistent cwd, environment, foreground/background process, input, transcript cursor, and timeout state. |
| Git workflow | Available | Status/diff, stage/unstage, explicit-path discard, branches, commits, pushes, and pull-request creation are project-scoped and approval-visible. |
| Managed Git worktrees | Available | Create/remove, dirty-state transfer, guarded handoff, owner-only metadata, destination fingerprints, and `.worktreeinclude` hydration. |
| Codex local environments | Available | Reads the same version-1 `.codex/environments/*.toml`, including OS-specific setup/cleanup and named actions; exposes the same source-tree/worktree variables. |
| Native management app | Available on macOS | Broker lifecycle, projects, environments, worktrees, changes, tasks, hosts, Computer Use, Browser, connection, and policy are first-class SwiftUI views. |
| Chat lifecycle | Available locally | Search, local rename, pin, archive, restore, and project-route resumption without storing prompts or tool contents. |
| Scheduled/background agent tasks | Available through ChatGPT Scheduled | `prepare_scheduled_task` creates a durable local-project prompt for same-chat or standalone schedules. ChatGPT owns future model turns and run history; each run reacquires its CodexFlow route and can use a clean managed worktree. |
| Remote/cloud/SSH environments | Available | The native Hosts workspace approves concrete OpenSSH aliases and saves canonical project folders. The ordinary chat picker routes bounded files, search, edits, patches, Bash, persistent per-chat terminals, Codex environment setup/actions, workspace skills, repository inspection, Git review, and managed Git worktrees through a CodexFlow-owned SSH helper. Remote worktree creation, source/worktree handoff, environment continuity, conflict refusal, dirty snapshots, removal, and picker registration share the private chat route. Every call revalidates host identity, root containment, blocked paths, limits, and policy. |
| Computer Use | Available on macOS | A routed chat can request one running native app, receive a fresh window capture and bounded accessibility tree, and perform an element-targeted action. Access and sensitive actions are approved on the Mac; approvals bind to the chat and validated code-signing identity. Terminal, ChatGPT/CodexFlow, System Settings, secure fields, secrets, and browser apps are refused. |
| Browser control | Available on macOS | A routed chat requests an exact origin and operates a visible, ephemeral WebKit tab through fresh screenshots and semantic DOM targets. Route-private or owner-persistent origin grants, cross-origin blocking, sealed action confirmations, password/secret refusal, and content-free activity are native. Personal browser profiles, downloads, authentication/account-security/payment pages, and arbitrary coordinates remain intentionally out of scope. |
| Rich native diff/review workspace | Available | The Mac app provides staged/unstaged file lanes, bounded color-coded diffs, stats, file actions, content-derived per-hunk stage/unstage/revert, and line-anchored review notes. Stale hunk IDs fail closed; notes persist owner-only and are included in the web chat’s next `show_changes` review. |
| Native task progress and supervision | Available | `task_progress` lets each project-routed web chat publish a bounded plan, focus, blocker, review state, and completion snapshot. The native Tasks workspace aggregates parallel routes and persists only that explicit owner-private snapshot. |
| Multi-agent orchestration | Partial by product boundary | Parallel web chats, worktrees, task boards, handoff, and scheduled prompts are independent, but CodexFlow does not run a model queue, spawn hidden agents, proxy Codex, or automate the ChatGPT website. |
| Cross-platform native desktop app | Partial | The broker is cross-platform; the first-class native GUI currently targets macOS 14 or newer, while the Codex app is also available on Windows. |

## Shared environment contract

CodexFlow intentionally interoperates through repository files rather than private Codex state. A checked-in `.codex/environments/*.toml` can be used by both products. CodexFlow parses and executes the configuration itself; it never invokes Codex to do the work.

Managed worktrees also honor `.worktreeinclude` for selected gitignored setup files. Files are copied only when they are regular, non-symlink files and the destination does not already exist.

## What remains for literal parity

Literal parity still requires capabilities outside the current local MCP surface:

1. A Windows-native CodexFlow management and approval client equivalent to the macOS app.
2. Model-agent spawning and direct in-app conversation control, if ever pursued, would require a separate explicit product and authorization boundary; the current web-first architecture intentionally leaves model execution and conversation ownership with ChatGPT.

Those additions must preserve the product boundary: no Codex CLI execution, no quota proxying, and no hidden automation of the ChatGPT website.

## Official comparison references

- [Codex local environments](https://learn.chatgpt.com/docs/environments/local-environment)
- [Codex Git worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)
- [Codex integrated terminal](https://learn.chatgpt.com/docs/integrated-terminal)
- [Codex scheduled tasks](https://learn.chatgpt.com/docs/automations)
- [Codex remote connections](https://learn.chatgpt.com/docs/remote-connections)
- [Codex Computer Use](https://learn.chatgpt.com/docs/computer-use)
