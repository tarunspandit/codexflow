# Codex Desktop Parity

Updated: 2026-07-22

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
| Native management app | Available on macOS | Broker lifecycle, projects, environments, worktrees, chats, connection, and policy are first-class SwiftUI views. |
| Chat lifecycle | Available locally | Search, local rename, pin, archive, restore, and project-route resumption without storing prompts or tool contents. |
| Scheduled/background agent tasks | Not yet | CodexFlow can keep local processes alive, but it has no independent model runtime that can create a future model turn after the initiating ChatGPT conversation ends. |
| Remote/cloud/SSH environments | Not yet | The current execution target is the user’s local allowed roots; there is no Codex-style local/cloud target switch or remote environment catalog. |
| Computer Use and browser control | Not yet | CodexFlow does not capture or operate arbitrary desktop applications, Chrome, or an embedded browser. |
| Rich native diff/review workspace | Partial | Diff and Git actions exist, but the Mac app does not yet match Codex’s full visual diff inspection, inline comment, and per-hunk interaction experience. |
| Multi-agent orchestration | Partial | Parallel chats and worktrees are independent, but CodexFlow itself does not run a model task queue or spawn model agents. |
| Cross-platform native desktop app | Partial | The broker is cross-platform; the first-class native GUI currently targets macOS 14 or newer. |

## Shared environment contract

CodexFlow intentionally interoperates through repository files rather than private Codex state. A checked-in `.codex/environments/*.toml` can be used by both products. CodexFlow parses and executes the configuration itself; it never invokes Codex to do the work.

Managed worktrees also honor `.worktreeinclude` for selected gitignored setup files. Files are copied only when they are regular, non-symlink files and the destination does not already exist.

## What remains for literal parity

Literal parity requires capabilities outside a request/response MCP broker:

1. A durable model-task runtime for schedules, queues, retries, notifications, and unattended continuation.
2. Remote execution targets with explicit local/cloud/SSH selection, provisioning, secrets, and lifecycle policy.
3. Computer Use and browser-control permissions, capture, confirmation, and audit UX.
4. A richer native coding workspace for diff review, inline comments, hunk operations, plans, and task progress.
5. Equivalent native clients beyond macOS.

Those additions must preserve the product boundary: no Codex CLI execution, no quota proxying, and no hidden automation of the ChatGPT website.

## Official comparison references

- [Codex local environments](https://learn.chatgpt.com/docs/environments/local-environment)
- [Codex Git worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)
- [Codex integrated terminal](https://learn.chatgpt.com/docs/integrated-terminal)
- [Codex scheduled tasks](https://learn.chatgpt.com/docs/automations)
- [Codex Computer Use](https://learn.chatgpt.com/docs/computer-use)
