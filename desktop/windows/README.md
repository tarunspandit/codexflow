# CodexFlow for Windows

CodexFlow for Windows is a native WPF management and approval client. It uses the same private runtime records and authenticated broker administration APIs as the macOS app, and adds Windows-native integrations:

- Windows UI Automation with per-app and per-action approval boundaries.
- An ephemeral Microsoft Edge WebView2 browser with origin approvals, action confirmation, bounded DOM snapshots, screenshots, comments, and diagnostics.
- Broker lifecycle, project discovery, environments, worktrees, Git review, task lifecycle, SSH hosts, connection, and policy management.

The release build is self-contained. End users do not install .NET: `codexflow` downloads the matching verified release asset on first launch and opens it from `%LOCALAPPDATA%\CodexFlow`.

Build on Windows:

```powershell
.\desktop\windows\build.ps1 -Architecture x64
```

The output includes a ZIP and adjacent SHA-256 file under `desktop\windows\dist\win-x64`.
