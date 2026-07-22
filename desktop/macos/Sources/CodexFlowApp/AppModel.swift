import AppKit
import Combine
import Darwin
import Foundation

@MainActor
final class AppModel: ObservableObject {
    @Published var section: AppSection = .now
    @Published private(set) var state: BrokerViewState = .discovering
    @Published private(set) var runtimes: [RuntimeRecord] = []
    @Published private(set) var overview: Overview?
    @Published private(set) var profile: ProfileResponse?
    @Published private(set) var desktopConfig: DesktopConfig?
    @Published private(set) var selectedRuntimeID: String?
    @Published private(set) var selectedRoot: String?
    @Published var notice: String?
    @Published var showingPolicyEditor = false
    @Published var showingRuntimePicker = false
    @Published private(set) var worktreeBusy = false
    @Published private(set) var environmentBusyAction: String?
    @Published private(set) var changes: ChangesResponse?
    @Published private(set) var changesBusy = false
    @Published private(set) var remotes: RemoteConnectionsResponse?
    @Published private(set) var remoteBusyAlias: String?
    @Published private(set) var computer: ComputerOverview?
    @Published private(set) var computerBusy = false
    @Published private(set) var browser: BrowserOverview?
    @Published private(set) var browserBusy = false
    let browserController = BrowserController()

    private let fileManager = FileManager.default
    private let session: URLSession
    private var pollTask: Task<Void, Never>?
    private var browserPollTask: Task<Void, Never>?
    private var launchedProcess: Process?
    private var didStart = false
    private var fixture: DesktopFixture?
    private let launchAgentLabel = "org.flow7.codexflow.broker"

    private var launchHomeDirectory: URL? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "--home"), arguments.indices.contains(index + 1) else { return nil }
        let value = arguments[index + 1].trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        return URL(fileURLWithPath: value, isDirectory: true)
    }

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 4
        configuration.timeoutIntervalForResource = 6
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        session = URLSession(configuration: configuration)
    }

    deinit {
        pollTask?.cancel()
        browserPollTask?.cancel()
    }

    var selectedRuntime: RuntimeRecord? {
        guard let selectedRuntimeID else { return nil }
        return runtimes.first { $0.id == selectedRuntimeID }
    }

    var isFixture: Bool { fixture != nil }
    var hasRunningProcess: Bool { selectedRuntime?.isAlive == true }
    var hasLiveRuntime: Bool { selectedRuntime?.isAlive == true && overview != nil }
    var workspaceName: String {
        guard let root = overview?.broker.defaultRoot ?? selectedRoot else { return "No project selected" }
        let name = URL(fileURLWithPath: root).lastPathComponent
        return name.isEmpty ? root : name
    }

    var runtimeDirectory: URL {
        homeDirectory.appendingPathComponent("runtime", isDirectory: true)
    }

    var logsDirectory: URL {
        homeDirectory.appendingPathComponent("logs", isDirectory: true)
    }

    private var homeDirectory: URL {
        if let launchHomeDirectory { return launchHomeDirectory }
        if let configured = desktopConfig?.codexflowHome, !configured.isEmpty {
            return URL(fileURLWithPath: configured, isDirectory: true)
        }
        if let environmentHome = ProcessInfo.processInfo.environment["CODEXFLOW_HOME"], !environmentHome.isEmpty {
            return URL(fileURLWithPath: environmentHome, isDirectory: true)
        }
        return fileManager.homeDirectoryForCurrentUser.appendingPathComponent(".codexflow", isDirectory: true)
    }

    func start() async {
        guard !didStart else { return }
        didStart = true
        loadFixtureIfRequested()
        if let fixture {
            let file = URL(fileURLWithPath: "/fixture/runtime.json")
            runtimes = [RuntimeRecord(fileURL: file, payload: fixture.runtime, isAlive: true)]
            selectedRuntimeID = file.path
            selectedRoot = fixture.runtime.root
            overview = fixture.overview
            profile = fixture.profile
            changes = fixture.changes
            remotes = fixture.remotes
            computer = fixture.computer
            browser = fixture.browser
            if let initialSection = fixture.initialSection, let fixtureSection = AppSection(rawValue: initialSection) {
                section = fixtureSection
            }
            state = .ready
            return
        }

        loadDesktopConfig()
        await refresh(forceProjectRefresh: false)
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                guard !Task.isCancelled else { return }
                await self?.refresh(forceProjectRefresh: false)
            }
        }
        browserPollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 450_000_000)
                guard !Task.isCancelled else { return }
                await self?.pollBrowserCommands()
            }
        }
    }

    func refresh(forceProjectRefresh: Bool = true) async {
        guard fixture == nil else { return }
        loadDesktopConfig()
        let records = loadRuntimeRecords()
        runtimes = records

        let previous = selectedRuntimeID
        if let selectedRoot,
           let match = records.first(where: { $0.root == selectedRoot && $0.isAlive }) ?? records.first(where: { $0.root == selectedRoot }) {
            selectedRuntimeID = match.id
        } else if let previous, let match = records.first(where: { $0.id == previous }) {
            selectedRuntimeID = match.id
            selectedRoot = match.root
        } else if let configuredRoot = desktopConfig?.defaultRoot,
                  let match = records.first(where: { $0.root == configuredRoot && $0.isAlive }) ?? records.first(where: { $0.root == configuredRoot }) {
            selectedRuntimeID = match.id
            selectedRoot = match.root
        } else if let first = records.first(where: \.isAlive) ?? records.first {
            selectedRuntimeID = first.id
            selectedRoot = first.root
        } else {
            selectedRuntimeID = nil
            if selectedRoot == nil { selectedRoot = desktopConfig?.defaultRoot }
        }

        guard let runtime = selectedRuntime, runtime.isAlive else {
            overview = nil
            profile = nil
            changes = nil
            remotes = nil
            computer = nil
            browser = nil
            if state != .starting && state != .stopping { state = .offline }
            return
        }

        selectedRoot = runtime.root
        do {
            async let nextOverview: Overview = request(runtime: runtime, path: "/api/overview", query: forceProjectRefresh ? [URLQueryItem(name: "refresh", value: "1")] : [])
            async let nextProfile: ProfileResponse = request(runtime: runtime, path: "/admin/profile")
            overview = try await nextOverview
            profile = try await nextProfile
            remotes = try? await request(runtime: runtime, path: "/admin/remotes")
            computer = try? await request(runtime: runtime, path: "/admin/computer")
            browser = try? await request(runtime: runtime, path: "/admin/browser")
            if let browser { browserController.reconcile(sessionIDs: Set(browser.sessions.map(\.id))) }
            state = .ready
        } catch {
            overview = nil
            profile = nil
            remotes = nil
            computer = nil
            browser = nil
            if state != .starting && state != .stopping {
                state = .degraded(error.localizedDescription)
            }
        }
    }

    func selectRuntime(_ runtime: RuntimeRecord) {
        selectedRuntimeID = runtime.id
        selectedRoot = runtime.root
        UserDefaults.standard.set(runtime.root, forKey: "CodexFlowSelectedRoot")
        showingRuntimePicker = false
        state = runtime.isAlive ? .discovering : .offline
        Task { await refresh(forceProjectRefresh: false) }
    }

    func chooseWorkspace() {
        guard fixture == nil else { return }
        let panel = NSOpenPanel()
        panel.title = "Choose a CodexFlow project"
        panel.message = "Select the project folder this broker should operate in."
        panel.prompt = "Choose Project"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        if let root = selectedRoot { panel.directoryURL = URL(fileURLWithPath: root, isDirectory: true) }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        selectedRoot = url.resolvingSymlinksInPath().path
        selectedRuntimeID = runtimes.first(where: { $0.root == selectedRoot })?.id
        UserDefaults.standard.set(selectedRoot, forKey: "CodexFlowSelectedRoot")
        if selectedRuntime?.isAlive != true {
            overview = nil
            profile = nil
            state = .offline
        }
    }

    func startBroker() {
        guard fixture == nil else { return }
        guard state != .starting else { return }
        guard let config = desktopConfig else {
            state = .degraded(CodexFlowError.missingDesktopConfig.localizedDescription)
            return
        }
        guard let root = selectedRoot ?? nonEmpty(config.defaultRoot) else {
            state = .degraded(CodexFlowError.missingWorkspace.localizedDescription)
            return
        }
        if selectedRuntime?.isAlive == true {
            notice = "A broker process is already running. Reconnecting…"
            Task { await refresh(forceProjectRefresh: true) }
            return
        }

        state = .starting
        notice = "Starting CodexFlow for \(workspaceDisplayName(root))…"
        if startManagedBrokerIfInstalled() {
            notice = "Starting the permanent CodexFlow service…"
            waitForBrokerReadiness()
            return
        }
        do {
            try prepareDirectory(homeDirectory, permissions: 0o700)
            try prepareDirectory(logsDirectory, permissions: 0o700)
            let logURL = logsDirectory.appendingPathComponent("desktop-\(safeLogName(root)).log")
            if !fileManager.fileExists(atPath: logURL.path) {
                fileManager.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
            }
            let logHandle = try FileHandle(forWritingTo: logURL)
            try logHandle.seekToEnd()

            let process = Process()
            process.executableURL = URL(fileURLWithPath: config.nodePath)
            process.arguments = [
                config.launcherPath,
                "start",
                "--root", root,
                "--non-interactive",
                "--no-copy-url",
                "--no-open-app"
            ]
            var environment = ProcessInfo.processInfo.environment
            environment["CODEXFLOW_HOME"] = config.codexflowHome
            environment["PATH"] = config.path
            environment["CODEXFLOW_DESKTOP_PARENT"] = String(ProcessInfo.processInfo.processIdentifier)
            process.environment = environment
            process.standardOutput = logHandle
            process.standardError = logHandle
            process.terminationHandler = { [weak self] process in
                try? logHandle.close()
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if self.state == .starting && process.terminationStatus != 0 {
                        self.state = .degraded("The broker exited before becoming ready. Open the local log for details.")
                        self.notice = "CodexFlow stopped with status \(process.terminationStatus)."
                    }
                    await self.refresh(forceProjectRefresh: false)
                }
            }
            try process.run()
            launchedProcess = process
            waitForBrokerReadiness()
        } catch {
            state = .degraded(CodexFlowError.brokerLaunch(error.localizedDescription).localizedDescription)
            notice = "CodexFlow could not start."
        }
    }

    private func waitForBrokerReadiness() {
        Task { [weak self] in
            for _ in 0..<30 {
                try? await Task.sleep(nanoseconds: 500_000_000)
                await self?.refresh(forceProjectRefresh: false)
                if self?.state == .ready { break }
            }
            if self?.state == .starting {
                self?.state = .degraded("The broker is taking longer than expected. Check the local log or try again.")
            }
        }
    }

    private func startManagedBrokerIfInstalled() -> Bool {
        let plist = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/\(launchAgentLabel).plist")
        guard fileManager.fileExists(atPath: plist.path) else { return false }
        let domain = "gui/\(Darwin.getuid())"
        let service = "\(domain)/\(launchAgentLabel)"
        if runLaunchctl(["kickstart", "-k", service]) { return true }
        guard runLaunchctl(["bootstrap", domain, plist.path]) else { return false }
        return runLaunchctl(["kickstart", "-k", service])
    }

    private func runLaunchctl(_ arguments: [String]) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
        }
    }

    func stopBroker() {
        guard fixture == nil, let runtime = selectedRuntime, let pid = runtime.pid, pid > 1 else { return }
        state = .stopping
        notice = "Stopping CodexFlow for \(runtime.projectName)…"
        if Darwin.kill(pid, SIGTERM) != 0 {
            state = .degraded("The broker process could not be stopped. It may have already exited.")
            return
        }
        Task { [weak self] in
            for _ in 0..<20 {
                try? await Task.sleep(nanoseconds: 250_000_000)
                await self?.refresh(forceProjectRefresh: false)
                if self?.selectedRuntime?.isAlive != true { break }
            }
            if self?.selectedRuntime?.isAlive == true {
                self?.state = .degraded("The broker did not stop within five seconds. You can stop it from its original terminal.")
            } else {
                self?.state = .offline
                self?.notice = "CodexFlow stopped."
            }
        }
    }

    func restartBroker() {
        guard fixture == nil else { return }
        let root = selectedRoot
        guard selectedRuntime?.isAlive == true else {
            startBroker()
            return
        }
        stopBroker()
        Task { [weak self] in
            for _ in 0..<24 {
                try? await Task.sleep(nanoseconds: 250_000_000)
                await self?.refresh(forceProjectRefresh: false)
                if self?.selectedRuntime?.isAlive != true { break }
            }
            self?.selectedRoot = root
            self?.startBroker()
        }
    }

    func forgetStaleRuntime(_ runtime: RuntimeRecord) {
        guard !runtime.isAlive, fixture == nil else { return }
        try? fileManager.removeItem(at: runtime.fileURL)
        if selectedRuntimeID == runtime.id { selectedRuntimeID = nil }
        Task { await refresh(forceProjectRefresh: false) }
    }

    func copyServerURL() {
        guard let runtime = selectedRuntime,
              let endpoint = nonEmpty(runtime.endpoint),
              var components = URLComponents(string: endpoint) else {
            notice = CodexFlowError.invalidRuntime.localizedDescription
            return
        }
        if let token = nonEmpty(runtime.localAuthToken) {
            var items = components.queryItems ?? []
            items.removeAll { $0.name == "codexflow_token" }
            items.append(URLQueryItem(name: "codexflow_token", value: token))
            components.queryItems = items
        }
        guard let privateURL = components.url?.absoluteString else {
            notice = CodexFlowError.invalidRuntime.localizedDescription
            return
        }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(privateURL, forType: .string)
        notice = "Private Server URL copied. Its credential was not displayed."
    }

    func openChatGPTSettings() {
        guard let url = URL(string: "https://chatgpt.com/#settings/Connectors") else { return }
        NSWorkspace.shared.open(url)
    }

    func openBrowserFallback() {
        guard let base = nonEmpty(selectedRuntime?.localBase), var components = URLComponents(string: base) else { return }
        components.path = "/"
        if let token = nonEmpty(selectedRuntime?.localAuthToken) {
            components.queryItems = [URLQueryItem(name: "codexflow_token", value: token)]
        }
        if let url = components.url { NSWorkspace.shared.open(url) }
    }

    func revealLog() {
        let root = selectedRoot ?? "codexflow"
        let url = logsDirectory.appendingPathComponent("desktop-\(safeLogName(root)).log")
        if fileManager.fileExists(atPath: url.path) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } else {
            notice = "No desktop launch log exists for this project yet."
        }
    }

    func saveProfile(_ draft: ProfileDraft) async -> Bool {
        guard fixture == nil, let runtime = selectedRuntime else { return false }
        do {
            let payload = try JSONEncoder().encode(draft)
            profile = try await request(runtime: runtime, path: "/admin/profile", method: "POST", body: payload)
            notice = "Policy saved for the next launch. Restart CodexFlow to apply it."
            await refresh(forceProjectRefresh: false)
            return true
        } catch {
            notice = error.localizedDescription
            return false
        }
    }

    func createManagedWorktree(environmentConfigPath: String? = nil) async {
        guard fixture == nil, let runtime = selectedRuntime, !worktreeBusy else { return }
        worktreeBusy = true
        defer { worktreeBusy = false }
        do {
            let command = WorktreeCommand(
                action: "create",
                worktreeId: nil,
                baseRef: nil,
                includeChanges: true,
                environmentConfigPath: environmentConfigPath,
                setupTimeoutMs: environmentConfigPath == nil ? nil : 600_000
            )
            let payload = try JSONEncoder().encode(command)
            let response: WorktreeMutationResponse = try await request(runtime: runtime, path: "/admin/worktrees", method: "POST", body: payload)
            notice = response.message
            await refresh(forceProjectRefresh: false)
        } catch {
            notice = error.localizedDescription
        }
    }

    func removeManagedWorktree(_ id: String) async {
        guard fixture == nil, let runtime = selectedRuntime, !worktreeBusy else { return }
        worktreeBusy = true
        defer { worktreeBusy = false }
        do {
            let command = WorktreeCommand(
                action: "remove",
                worktreeId: id,
                baseRef: nil,
                includeChanges: nil,
                environmentConfigPath: nil,
                setupTimeoutMs: nil
            )
            let payload = try JSONEncoder().encode(command)
            let response: WorktreeMutationResponse = try await request(runtime: runtime, path: "/admin/worktrees", method: "POST", body: payload)
            notice = response.message
            await refresh(forceProjectRefresh: false)
        } catch {
            notice = error.localizedDescription
        }
    }

    func runEnvironment(_ environment: LocalEnvironmentOverview, action: String, actionName: String? = nil) async {
        guard fixture == nil, let runtime = selectedRuntime, environmentBusyAction == nil else { return }
        let operationID = "\(environment.configPath):\(action):\(actionName ?? "")"
        environmentBusyAction = operationID
        defer { environmentBusyAction = nil }
        do {
            let command = EnvironmentCommand(
                action: action,
                configPath: environment.configPath,
                actionName: actionName,
                background: action == "run" ? true : false,
                timeoutMs: action == "run" ? 180_000 : 600_000
            )
            let payload = try JSONEncoder().encode(command)
            let response: EnvironmentMutationResponse = try await request(runtime: runtime, path: "/admin/environments", method: "POST", body: payload)
            notice = response.message
            await refresh(forceProjectRefresh: false)
        } catch {
            notice = error.localizedDescription
        }
    }

    func stopEnvironmentAction() async {
        guard fixture == nil, let runtime = selectedRuntime else { return }
        do {
            let command = EnvironmentCommand(action: "stop", configPath: nil, actionName: nil, background: nil, timeoutMs: nil)
            let payload = try JSONEncoder().encode(command)
            let response: EnvironmentMutationResponse = try await request(runtime: runtime, path: "/admin/environments", method: "POST", body: payload)
            notice = response.message
        } catch {
            notice = error.localizedDescription
        }
    }

    func updateChat(_ id: String, action: String, title: String? = nil, value: Bool? = nil) async {
        guard fixture == nil, let runtime = selectedRuntime else { return }
        do {
            let command = ChatLifecycleCommand(action: action, chatId: id, title: title, value: value)
            let payload = try JSONEncoder().encode(command)
            let response: ChatLifecycleResponse = try await request(runtime: runtime, path: "/admin/chats", method: "POST", body: payload)
            notice = response.message
            await refresh(forceProjectRefresh: false)
        } catch {
            notice = error.localizedDescription
        }
    }

    func refreshChanges(path: String? = nil, staged: Bool = false) async {
        guard fixture == nil, let runtime = selectedRuntime, runtime.isAlive, !changesBusy else { return }
        changesBusy = true
        defer { changesBusy = false }
        do {
            var query: [URLQueryItem] = []
            if let path, !path.isEmpty {
                query.append(URLQueryItem(name: "path", value: path))
                query.append(URLQueryItem(name: "staged", value: staged ? "true" : "false"))
            }
            changes = try await request(runtime: runtime, path: "/admin/changes", query: query)
        } catch {
            notice = error.localizedDescription
        }
    }

    func mutateChanges(action: String, paths: [String], includeStaged: Bool? = nil) async {
        guard fixture == nil, let runtime = selectedRuntime, runtime.isAlive, !changesBusy, !paths.isEmpty else { return }
        changesBusy = true
        defer { changesBusy = false }
        do {
            let payload = try JSONEncoder().encode(ChangesCommand(
                action: action, paths: paths, includeStaged: includeStaged,
                path: nil, staged: nil, hunkId: nil, line: nil, body: nil, commentId: nil
            ))
            let response: ChangesResponse = try await request(runtime: runtime, path: "/admin/changes", method: "POST", body: payload)
            changes = response
            notice = response.message
            await refresh(forceProjectRefresh: false)
        } catch {
            notice = error.localizedDescription
        }
    }

    func mutateReviewHunk(action: String, selected: SelectedChangeOverview, hunk: ReviewHunkOverview) async {
        await sendReviewCommand(ChangesCommand(
            action: action, paths: nil, includeStaged: nil,
            path: selected.path, staged: selected.staged, hunkId: hunk.id,
            line: nil, body: nil, commentId: nil
        ))
    }

    func addReviewComment(selected: SelectedChangeOverview, hunk: ReviewHunkOverview, line: Int, body: String) async {
        await sendReviewCommand(ChangesCommand(
            action: "comment", paths: nil, includeStaged: nil,
            path: selected.path, staged: selected.staged, hunkId: hunk.id,
            line: line, body: body, commentId: nil
        ))
    }

    func deleteReviewComment(_ comment: ReviewCommentOverview, selected: SelectedChangeOverview) async {
        await sendReviewCommand(ChangesCommand(
            action: "delete_comment", paths: nil, includeStaged: nil,
            path: selected.path, staged: selected.staged, hunkId: nil,
            line: nil, body: nil, commentId: comment.id
        ))
    }

    func requestComputerPermissions() async {
        guard fixture == nil, let runtime = selectedRuntime, runtime.isAlive, !computerBusy else { return }
        computerBusy = true
        defer { computerBusy = false }
        do {
            let command = ComputerCommand(action: "request_permissions", requestId: nil, decision: nil, approve: nil, bundleId: nil)
            let response: ComputerPermissionResponse = try await request(runtime: runtime, path: "/admin/computer", method: "POST", body: try JSONEncoder().encode(command))
            notice = response.message ?? "Review the macOS permission prompts."
            computer = try? await request(runtime: runtime, path: "/admin/computer")
        } catch {
            notice = error.localizedDescription
        }
    }

    func decideComputerAccess(_ requestID: String, decision: String) async {
        await sendComputerCommand(ComputerCommand(action: "decide_access", requestId: requestID, decision: decision, approve: nil, bundleId: nil))
    }

    func decideComputerAction(_ requestID: String, approve: Bool) async {
        await sendComputerCommand(ComputerCommand(action: "decide_action", requestId: requestID, decision: nil, approve: approve, bundleId: nil))
    }

    func revokeComputerApp(_ bundleID: String) async {
        await sendComputerCommand(ComputerCommand(action: "revoke", requestId: nil, decision: nil, approve: nil, bundleId: bundleID))
    }

    private func sendComputerCommand(_ command: ComputerCommand) async {
        guard fixture == nil, let runtime = selectedRuntime, runtime.isAlive, !computerBusy else { return }
        computerBusy = true
        defer { computerBusy = false }
        do {
            let response: ComputerOverview = try await request(runtime: runtime, path: "/admin/computer", method: "POST", body: try JSONEncoder().encode(command))
            computer = response
            notice = response.message
        } catch {
            notice = error.localizedDescription
        }
    }

    func decideBrowserHost(_ requestID: String, decision: String) async {
        await sendBrowserCommand(BrowserCommand(action: "decide_host", requestId: requestID, decision: decision, approve: nil, origin: nil))
    }

    func decideBrowserAction(_ requestID: String, approve: Bool) async {
        await sendBrowserCommand(BrowserCommand(action: "decide_action", requestId: requestID, decision: nil, approve: approve, origin: nil))
    }

    func revokeBrowserOrigin(_ origin: String) async {
        await sendBrowserCommand(BrowserCommand(action: "revoke", requestId: nil, decision: nil, approve: nil, origin: origin))
    }

    func selectBrowserSession(_ sessionID: String) {
        browserController.select(sessionID)
    }

    private func sendBrowserCommand(_ command: BrowserCommand) async {
        guard fixture == nil, let runtime = selectedRuntime, runtime.isAlive, !browserBusy else { return }
        browserBusy = true
        defer { browserBusy = false }
        do {
            let response: BrowserOverview = try await request(runtime: runtime, path: "/admin/browser", method: "POST", body: try JSONEncoder().encode(command))
            browser = response
            browserController.reconcile(sessionIDs: Set(response.sessions.map(\.id)))
            notice = response.message
        } catch {
            notice = error.localizedDescription
        }
    }

    private func pollBrowserCommands() async {
        guard fixture == nil, let runtime = selectedRuntime, runtime.isAlive else { return }
        do {
            let response: BrowserOverview = try await request(runtime: runtime, path: "/admin/browser", query: [URLQueryItem(name: "take", value: "1")])
            browser = response
            browserController.reconcile(sessionIDs: Set(response.sessions.map(\.id)))
            for command in response.commands where browserController.begin(command.id) {
                do {
                    let result = try await browserController.execute(command)
                    try await completeBrowserCommand(runtime: runtime, commandID: command.id, ok: true, result: result, error: nil)
                } catch {
                    try? await completeBrowserCommand(runtime: runtime, commandID: command.id, ok: false, result: nil, error: error.localizedDescription)
                }
                browserController.finish(command.id)
            }
        } catch {
            // The normal broker refresh owns the visible degraded/offline state.
        }
    }

    private func completeBrowserCommand(runtime: RuntimeRecord, commandID: String, ok: Bool, result: [String: Any]?, error: String?) async throws {
        var payload: [String: Any] = ["commandId": commandID, "ok": ok]
        if let result { payload["result"] = result }
        if let error { payload["error"] = error }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let _: BrowserCompletionResponse = try await request(runtime: runtime, path: "/admin/browser/complete", method: "POST", body: body)
    }

    private func sendReviewCommand(_ command: ChangesCommand) async {
        guard fixture == nil, let runtime = selectedRuntime, runtime.isAlive, !changesBusy else { return }
        changesBusy = true
        defer { changesBusy = false }
        do {
            let payload = try JSONEncoder().encode(command)
            let response: ChangesResponse = try await request(runtime: runtime, path: "/admin/changes", method: "POST", body: payload)
            changes = response
            notice = response.message
            await refresh(forceProjectRefresh: false)
        } catch {
            notice = error.localizedDescription
        }
    }

    func refreshRemotes() async {
        guard fixture == nil, let runtime = selectedRuntime, runtime.isAlive, remoteBusyAlias == nil else { return }
        do {
            remotes = try await request(runtime: runtime, path: "/admin/remotes")
        } catch {
            notice = error.localizedDescription
        }
    }

    func mutateRemote(alias: String, action: String) async {
        guard fixture == nil, let runtime = selectedRuntime, runtime.isAlive, remoteBusyAlias == nil else { return }
        remoteBusyAlias = alias
        defer { remoteBusyAlias = nil }
        do {
            let payload = try JSONEncoder().encode(RemoteConnectionCommand(action: action, alias: alias, root: nil, projectId: nil))
            let response: RemoteConnectionsResponse = try await request(runtime: runtime, path: "/admin/remotes", method: "POST", body: payload)
            remotes = response
            notice = response.message
        } catch {
            notice = error.localizedDescription
        }
    }

    func saveRemoteProject(alias: String, root: String) async {
        let trimmed = root.trimmingCharacters(in: .whitespacesAndNewlines)
        guard fixture == nil, let runtime = selectedRuntime, runtime.isAlive, remoteBusyAlias == nil, !trimmed.isEmpty else { return }
        remoteBusyAlias = alias
        defer { remoteBusyAlias = nil }
        do {
            let payload = try JSONEncoder().encode(RemoteConnectionCommand(action: "save_project", alias: alias, root: trimmed, projectId: nil))
            let response: RemoteConnectionsResponse = try await request(runtime: runtime, path: "/admin/remotes", method: "POST", body: payload)
            remotes = response
            notice = response.message
        } catch {
            notice = error.localizedDescription
        }
    }

    func removeRemoteProject(_ project: RemoteProjectOverview) async {
        guard fixture == nil, let runtime = selectedRuntime, runtime.isAlive, remoteBusyAlias == nil else { return }
        remoteBusyAlias = project.id
        defer { remoteBusyAlias = nil }
        do {
            let payload = try JSONEncoder().encode(RemoteConnectionCommand(action: "remove_project", alias: nil, root: nil, projectId: project.id))
            let response: RemoteConnectionsResponse = try await request(runtime: runtime, path: "/admin/remotes", method: "POST", body: payload)
            remotes = response
            notice = response.message
        } catch {
            notice = error.localizedDescription
        }
    }

    func handle(url: URL) {
        guard url.scheme == "codexflow" else { return }
        if let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
           let root = components.queryItems?.first(where: { $0.name == "root" })?.value,
           !root.isEmpty {
            selectedRoot = root
            if let runtime = runtimes.first(where: { $0.root == root }) { selectedRuntimeID = runtime.id }
        }
        NSApp.activate(ignoringOtherApps: true)
        Task { await refresh(forceProjectRefresh: false) }
    }

    private func loadFixtureIfRequested() {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "--fixture"), arguments.indices.contains(index + 1) else { return }
        let url = URL(fileURLWithPath: arguments[index + 1])
        guard let data = try? Data(contentsOf: url) else { return }
        fixture = try? JSONDecoder.codexFlow.decode(DesktopFixture.self, from: data)
    }

    private func loadDesktopConfig() {
        let environmentHome = ProcessInfo.processInfo.environment["CODEXFLOW_HOME"]
        let base = launchHomeDirectory
            ?? environmentHome.map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? fileManager.homeDirectoryForCurrentUser.appendingPathComponent(".codexflow", isDirectory: true)
        let url = base.appendingPathComponent("desktop.json")
        guard let data = try? Data(contentsOf: url), let decoded = try? JSONDecoder().decode(DesktopConfig.self, from: data) else { return }
        desktopConfig = decoded
        if selectedRoot == nil {
            selectedRoot = nonEmpty(UserDefaults.standard.string(forKey: "CodexFlowSelectedRoot")) ?? nonEmpty(decoded.defaultRoot)
        }
    }

    private func loadRuntimeRecords() -> [RuntimeRecord] {
        guard let urls = try? fileManager.contentsOfDirectory(at: runtimeDirectory, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles]) else { return [] }
        return urls
            .filter { $0.pathExtension == "json" }
            .compactMap { url -> RuntimeRecord? in
                guard let data = try? Data(contentsOf: url),
                      let payload = try? JSONDecoder().decode(RuntimeRecordPayload.self, from: data),
                      !payload.root.isEmpty else { return nil }
                return RuntimeRecord(fileURL: url, payload: payload, isAlive: processIsAlive(payload.pid))
            }
            .sorted {
                if $0.isAlive != $1.isAlive { return $0.isAlive && !$1.isAlive }
                return ($0.updatedAt ?? "") > ($1.updatedAt ?? "")
            }
    }

    private func request<T: Decodable>(runtime: RuntimeRecord, path: String, query: [URLQueryItem] = [], method: String = "GET", body: Data? = nil) async throws -> T {
        guard let base = nonEmpty(runtime.localBase), var components = URLComponents(string: base) else { throw CodexFlowError.invalidRuntime }
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else { throw CodexFlowError.invalidRuntime }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = nonEmpty(runtime.localAuthToken) {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw CodexFlowError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let envelope = try? JSONDecoder.codexFlow.decode(APIErrorEnvelope.self, from: data)
            throw CodexFlowError.http(http.statusCode, envelope?.error?.message ?? "")
        }
        do {
            return try JSONDecoder.codexFlow.decode(T.self, from: data)
        } catch {
            throw CodexFlowError.invalidResponse
        }
    }

    private func processIsAlive(_ pid: Int32?) -> Bool {
        guard let pid, pid > 1 else { return false }
        if Darwin.kill(pid, 0) == 0 { return true }
        return errno == EPERM
    }

    private func prepareDirectory(_ url: URL, permissions: NSNumber) throws {
        try fileManager.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: permissions])
        try? fileManager.setAttributes([.posixPermissions: permissions], ofItemAtPath: url.path)
    }

    private func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return value
    }

    private func workspaceDisplayName(_ root: String) -> String {
        let name = URL(fileURLWithPath: root).lastPathComponent
        return name.isEmpty ? root : name
    }

    private func safeLogName(_ root: String) -> String {
        let base = workspaceDisplayName(root).lowercased()
        let safe = base.map { character in
            character.isLetter || character.isNumber || character == "-" || character == "_" ? character : "-"
        }
        return String(safe).prefix(64).description
    }
}
