# CodexFlow for macOS

CodexFlow’s primary local interface is a native SwiftUI app. It discovers private runtime records under `~/.codexflow/runtime`, authenticates to the existing local broker, and renders projects, shared `.codex/environments` definitions, managed worktrees, sessions, activity, connection state, and launch policy without retaining conversation content.

The app does not run Codex or supply a second model client. Broker start, stop, and restart actions operate the package’s existing Node launcher. When `~/Library/LaunchAgents/org.flow7.codexflow.broker.plist` is installed, the same controls operate that login service through `launchctl`, preserving crash recovery without turning an intentional Stop into an automatic restart. The CLI writes `~/.codexflow/desktop.json` with non-secret launcher metadata so a later app launch can start the correct installed package.

Build the universal ad-hoc-signed bundle on macOS:

```sh
npm run desktop:build
```

The build creates `desktop/prebuilt/CodexFlow.app` for `arm64` and `x86_64`, bundles the Flow7 visual resources and licensed Geologica fonts, validates the property list, and verifies the signature.

For local visual QA without a broker:

```sh
open -n desktop/prebuilt/CodexFlow.app --args --fixture "$(pwd)/desktop/macos/Fixtures/overview.json"
```

Fixture mode is preview-only. Release integration tests start the real broker in a temporary home and verify the authenticated API/lifecycle path.
