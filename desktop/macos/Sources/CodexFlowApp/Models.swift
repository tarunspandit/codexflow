import Foundation

enum AppSection: String, CaseIterable, Identifiable {
    case now
    case projects
    case environments
    case worktrees
    case changes
    case chats
    case hosts
    case computer
    case browser
    case connection
    case policy

    var id: String { rawValue }

    var title: String {
        switch self {
        case .now: "Now"
        case .projects: "Projects"
        case .environments: "Environments"
        case .worktrees: "Worktrees"
        case .changes: "Changes"
        case .chats: "Tasks"
        case .hosts: "Hosts"
        case .computer: "Computer"
        case .browser: "Browser"
        case .connection: "Connection"
        case .policy: "Policy"
        }
    }

    var symbol: String {
        switch self {
        case .now: "sparkles"
        case .projects: "square.stack.3d.up"
        case .environments: "shippingbox.and.arrow.backward"
        case .worktrees: "arrow.triangle.branch"
        case .changes: "plus.forwardslash.minus"
        case .chats: "checklist"
        case .hosts: "server.rack"
        case .computer: "macwindow.on.rectangle"
        case .browser: "safari"
        case .connection: "point.3.connected.trianglepath.dotted"
        case .policy: "slider.horizontal.3"
        }
    }
}

enum BrokerViewState: Equatable {
    case discovering
    case offline
    case starting
    case ready
    case degraded(String)
    case stopping

    var title: String {
        switch self {
        case .discovering: "Finding CodexFlow"
        case .offline: "Ready to start"
        case .starting: "Starting broker"
        case .ready: "Live"
        case .degraded: "Needs attention"
        case .stopping: "Stopping broker"
        }
    }

    var detail: String {
        switch self {
        case .discovering: "Looking for local workspace runtimes."
        case .offline: "Choose a project and start its local coding bridge."
        case .starting: "Preparing the project catalog and secure local endpoint."
        case .ready: "The local broker is available to your connected chats."
        case .degraded(let message): message
        case .stopping: "Closing the local endpoint and active transport sessions."
        }
    }

    var isBusy: Bool {
        self == .discovering || self == .starting || self == .stopping
    }
}

struct DesktopConfig: Codable {
    let version: Int
    let nodePath: String
    let launcherPath: String
    let defaultRoot: String
    let codexflowHome: String
    let path: String
    let packageVersion: String
    let updatedAt: String
}

struct RuntimeRecordPayload: Decodable {
    let version: Int?
    let root: String
    let pid: Int32?
    let updatedAt: String?
    let endpoint: String?
    let localAuthToken: String?
    let localBase: String?
    let localStatusUrl: String?
    let tunnel: String?
    let mode: String?
    let bash: String?
    let bashTranscript: String?
    let codexSessions: String?
    let bashSession: String?
    let requireBashSession: Bool?
    let write: String?
    let toolMode: String?
    let toolCards: Bool?
}

struct RuntimeRecord: Identifiable, Hashable {
    let fileURL: URL
    let root: String
    let pid: Int32?
    let updatedAt: String?
    let endpoint: String?
    let localAuthToken: String?
    let localBase: String?
    let localStatusUrl: String?
    let tunnel: String?
    let mode: String?
    let bash: String?
    let bashTranscript: String?
    let codexSessions: String?
    let bashSession: String?
    let requireBashSession: Bool
    let write: String?
    let toolMode: String?
    let toolCards: Bool
    let isAlive: Bool

    var id: String { fileURL.path }
    var projectName: String { URL(fileURLWithPath: root).lastPathComponent.isEmpty ? root : URL(fileURLWithPath: root).lastPathComponent }

    init(fileURL: URL, payload: RuntimeRecordPayload, isAlive: Bool) {
        self.fileURL = fileURL
        root = payload.root
        pid = payload.pid
        updatedAt = payload.updatedAt
        endpoint = payload.endpoint
        localAuthToken = payload.localAuthToken
        localBase = payload.localBase
        localStatusUrl = payload.localStatusUrl
        tunnel = payload.tunnel
        mode = payload.mode
        bash = payload.bash
        bashTranscript = payload.bashTranscript
        codexSessions = payload.codexSessions
        bashSession = payload.bashSession
        requireBashSession = payload.requireBashSession ?? false
        write = payload.write
        toolMode = payload.toolMode
        toolCards = payload.toolCards ?? false
        self.isAlive = isAlive
    }
}

struct Overview: Decodable {
    let ok: Bool
    let generatedAt: String
    let broker: BrokerOverview
    let projects: [ProjectOverview]
    let environments: [LocalEnvironmentOverview]?
    let worktrees: [ManagedWorktreeOverview]?
    let sessions: [SessionOverview]
    let activity: [ActivityOverview]
    let summary: OverviewSummary
    let savedProfile: SavedProfileOverview
}

struct BrokerOverview: Decodable {
    let state: String
    let version: String
    let startedAt: String
    let uptimeMs: Int
    let defaultRoot: String
    let allowedRoots: [String]
    let localBase: String
    let endpoint: String
    let publicEndpoint: String?
    let tunnel: String?
    let mode: String
    let authEnabled: Bool
    let writeMode: String
    let bashMode: String
    let bashTranscript: String
    let toolMode: String
    let toolCards: Bool
    let codexSessions: String
    let analysisEnabled: Bool
    let maxSessions: Int
    let sessionTtlMs: Int
}

struct ProjectOverview: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let root: String
    let sources: [String]
    let lastActiveAt: String?
    let isDefault: Bool
}

struct RuntimeProject: Decodable, Hashable {
    let id: String
    let name: String
    let root: String
}

struct LocalEnvironmentActionOverview: Decodable, Identifiable, Hashable {
    let name: String
    let icon: String
    let platform: String

    var id: String { "\(name):\(platform)" }
}

struct LocalEnvironmentOverview: Decodable, Identifiable, Hashable {
    let configPath: String
    let sourceRoot: String
    let inherited: Bool
    let version: Int
    let name: String
    let platform: String
    let hasSetup: Bool
    let hasCleanup: Bool
    let actions: [LocalEnvironmentActionOverview]

    var id: String { configPath }
}

struct ManagedWorktreeOverview: Decodable, Identifiable, Hashable {
    let id: String
    let localRoot: String
    let repositoryRoot: String
    let checkoutRoot: String
    let projectRoot: String
    let projectRelativePath: String
    let baseRef: String
    let createdAt: String
    let updatedAt: String
    let exists: Bool
    let branch: String?
    let dirty: Bool
    let environmentConfigPath: String?
    let environmentName: String?
    let setupCompletedAt: String?
}

struct SessionOverview: Decodable, Identifiable, Hashable {
    let id: String
    let state: String
    let createdAt: String
    let lastSeenAt: String
    let closedAt: String?
    let project: RuntimeProject?
    let toolCalls: Int
    let errors: Int
    let lastTool: String?
    let lastToolStatus: String?
    let title: String?
    let pinned: Bool?
    let archived: Bool?
    let task: TaskProgressOverview?
}

struct TaskProgressOverview: Decodable, Hashable {
    let title: String
    let status: String
    let detail: String?
    let steps: [TaskProgressStepOverview]
    let updatedAt: String
}

struct TaskProgressStepOverview: Decodable, Identifiable, Hashable {
    let title: String
    let status: String

    var id: String { "\(title):\(status)" }
}

struct ActivityOverview: Decodable, Identifiable, Hashable {
    let id: String
    let sessionId: String
    let tool: String
    let status: String
    let durationMs: Int
    let at: String
    let project: RuntimeProject?
}

struct OverviewSummary: Decodable {
    let projects: Int
    let activeSessions: Int
    let pendingSessions: Int
    let openConnections: Int
    let recentSessions: Int
    let activityEvents: Int
    let managedWorktrees: Int?
    let localEnvironments: Int?
}

struct ChangedFileOverview: Decodable, Identifiable, Hashable {
    let path: String
    let status: String
    let staged: Bool
    let previousPath: String?

    var id: String { "\(staged ? "staged" : "unstaged"):\(path)" }
}

struct SelectedChangeOverview: Decodable, Hashable {
    let path: String
    let staged: Bool
    let diff: String
    let additions: Int
    let deletions: Int
    let truncated: Bool
    let hunks: [ReviewHunkOverview]
    let comments: [ReviewCommentOverview]
}

struct ReviewHunkOverview: Decodable, Identifiable, Hashable {
    let id: String
    let header: String
    let startLine: Int
    let endLine: Int
    let oldStart: Int
    let oldCount: Int
    let newStart: Int
    let newCount: Int
    let additions: Int
    let deletions: Int
    let actionable: Bool
}

struct ReviewCommentOverview: Decodable, Identifiable, Hashable {
    let id: String
    let path: String
    let staged: Bool
    let hunkId: String
    let line: Int
    let body: String
    let createdAt: String
    let updatedAt: String
    let outdated: Bool?
}

struct ChangesSummary: Decodable, Hashable {
    let staged: Int
    let unstaged: Int
    let files: Int
}

struct ChangesResponse: Decodable {
    let ok: Bool
    let root: String
    let isGit: Bool
    let branch: String
    let canWrite: Bool
    let staged: [ChangedFileOverview]
    let unstaged: [ChangedFileOverview]
    let summary: ChangesSummary
    let selected: SelectedChangeOverview?
    let message: String?
    let action: String?
}

struct ChangesCommand: Encodable {
    let action: String
    let paths: [String]?
    let includeStaged: Bool?
    let path: String?
    let staged: Bool?
    let hunkId: String?
    let line: Int?
    let body: String?
    let commentId: String?
}

struct RemoteHostOverview: Decodable, Identifiable, Hashable {
    let alias: String
    let hostname: String
    let user: String
    let port: Int
    let source: String
    let approved: Bool
    let status: String
    let verifiedAt: String?
    let platform: String?
    let home: String?
    let hasNode: Bool?
    let hasGit: Bool?
    let projectCount: Int

    var id: String { alias }
}

struct ComputerOverview: Decodable {
    let ok: Bool
    let status: ComputerPermissionStatus
    let apps: [ComputerAppOverview]
    let alwaysAllowed: [ComputerAllowedApp]
    let accessRequests: [ComputerAccessRequest]
    let actionRequests: [ComputerActionRequest]
    let recentActivity: [ComputerActivity]
    let message: String?
}

struct ComputerPermissionStatus: Decodable {
    let available: Bool
    let platform: String
    let screenRecording: Bool
    let accessibility: Bool
    let error: String?
}

struct ComputerPermissionResponse: Decodable {
    let available: Bool
    let platform: String
    let screenRecording: Bool
    let accessibility: Bool
    let message: String?
}

struct ComputerAppOverview: Decodable, Identifiable, Hashable {
    let bundleId: String
    let name: String
    let pid: Int32
    let active: Bool
    let prohibited: Bool
    let prohibitedReason: String?
    var id: String { bundleId }
}

struct ComputerAllowedApp: Decodable, Identifiable, Hashable {
    let bundleId: String
    let appName: String
    let approvedAt: String
    var id: String { bundleId }
}

struct ComputerAccessRequest: Decodable, Identifiable, Hashable {
    let id: String
    let bundleId: String
    let appName: String
    let reason: String
    let routeDisplay: String
    let createdAt: String
    let expiresAt: String
}

struct ComputerActionRequest: Decodable, Identifiable, Hashable {
    let id: String
    let bundleId: String
    let appName: String
    let operation: String
    let target: String
    let valuePreview: String?
    let routeDisplay: String
    let createdAt: String
    let expiresAt: String
}

struct ComputerActivity: Decodable, Identifiable, Hashable {
    let at: String
    let routeDisplay: String
    let appName: String
    let operation: String
    let outcome: String
    var id: String { "\(at):\(routeDisplay):\(operation)" }
}

struct ComputerCommand: Encodable {
    let action: String
    let requestId: String?
    let decision: String?
    let approve: Bool?
    let bundleId: String?
}

struct BrowserOverview: Decodable {
    let ok: Bool
    let status: BrowserStatus
    let alwaysAllowed: [BrowserAllowedOrigin]
    let hostRequests: [BrowserHostRequest]
    let actionRequests: [BrowserActionRequest]
    let sessions: [BrowserSessionOverview]
    let recentActivity: [BrowserActivity]
    let commands: [BrowserNativeCommand]
    let message: String?
}

struct BrowserStatus: Decodable {
    let available: Bool
    let profile: String
    let engine: String
    let nativeConnected: Bool
}

struct BrowserAllowedOrigin: Decodable, Identifiable, Hashable {
    let origin: String
    let approvedAt: String
    var id: String { origin }
}

struct BrowserHostRequest: Decodable, Identifiable, Hashable {
    let id: String
    let origin: String
    let reason: String
    let routeDisplay: String
    let createdAt: String
    let expiresAt: String
}

struct BrowserActionRequest: Decodable, Identifiable, Hashable {
    let id: String
    let sessionId: String
    let origin: String
    let operation: String
    let target: String
    let valuePreview: String?
    let routeDisplay: String
    let createdAt: String
    let expiresAt: String
}

struct BrowserSessionOverview: Decodable, Identifiable, Hashable {
    let id: String
    let origin: String
    let currentUrl: String
    let title: String
}

struct BrowserActivity: Decodable, Identifiable, Hashable {
    let at: String
    let routeDisplay: String
    let origin: String
    let operation: String
    let outcome: String
    var id: String { "\(at):\(routeDisplay):\(operation)" }
}

struct BrowserNativeCommand: Decodable, Identifiable {
    let id: String
    let action: String
    let sessionId: String
    let url: String?
    let allowedOrigins: [String]?
    let snapshotId: String?
    let elementId: String?
    let operation: String?
    let value: String?
    let key: String?
}

struct BrowserCommand: Encodable {
    let action: String
    let requestId: String?
    let decision: String?
    let approve: Bool?
    let origin: String?
}

struct BrowserCompletionResponse: Decodable {
    let ok: Bool
}

struct RemoteProjectOverview: Decodable, Identifiable, Hashable {
    let id: String
    let hostAlias: String
    let root: String
    let name: String
    let status: String
    let available: Bool
    let createdAt: String
    let updatedAt: String
    let gitRoot: String?
    let gitRelativePath: String?
}

struct RemoteConnectionsResponse: Decodable {
    let ok: Bool
    let configPath: String
    let hosts: [RemoteHostOverview]
    let projects: [RemoteProjectOverview]
    let approved: Int
    let discovered: Int
    let message: String?
    let verifiedAlias: String?
}

struct RemoteConnectionCommand: Encodable {
    let action: String
    let alias: String?
    let root: String?
    let projectId: String?
}

struct WorktreeCommand: Encodable {
    let action: String
    let worktreeId: String?
    let baseRef: String?
    let includeChanges: Bool?
    let environmentConfigPath: String?
    let setupTimeoutMs: Int?
}

struct WorktreeMutationResponse: Decodable {
    let ok: Bool
    let message: String
    let worktrees: [ManagedWorktreeOverview]
}

struct EnvironmentCommand: Encodable {
    let action: String
    let configPath: String?
    let actionName: String?
    let background: Bool?
    let timeoutMs: Int?
}

struct EnvironmentMutationResponse: Decodable {
    let ok: Bool
    let message: String
}

struct ChatLifecycleCommand: Encodable {
    let action: String
    let chatId: String
    let title: String?
    let value: Bool?
}

struct ChatLifecycleResponse: Decodable {
    let ok: Bool
    let message: String
    let session: SessionOverview
}

struct SavedProfileOverview: Decodable {
    let exists: Bool
    let tunnel: String?
    let hostname: String?
    let mode: String?
    let updatedAt: String?
}

struct ProfileResponse: Decodable {
    let ok: Bool
    let profilePath: String
    let exists: Bool
    let effective: ProfileEffective
}

struct ProfileEffective: Decodable {
    let port: String
    let mode: String
    let tunnel: String
    let hostname: String
    let tunnelName: String
    let ngrokConfig: String
    let cloudflareConfig: String
    let cloudflareTokenFile: String
    let bash: String
    let bashTranscript: String
    let codexSessions: String
    let codexDir: String
    let bashSession: String
    let requireBashSession: Bool
    let write: String
    let toolMode: String
    let toolCards: Bool
    let widgetDomain: String
    let noInstallCloudflared: Bool
}

struct ProfileDraft: Codable, Equatable {
    var tunnel: String
    var hostname: String
    var mode: String
    var bash: String
    var bashTranscript: String
    var codexSessions: String
    var write: String
    var toolMode: String
    var toolCards: Bool

    init(effective: ProfileEffective) {
        tunnel = effective.tunnel
        hostname = effective.hostname
        mode = effective.mode
        bash = effective.bash
        bashTranscript = effective.bashTranscript
        codexSessions = effective.codexSessions
        write = effective.write
        toolMode = effective.toolMode
        toolCards = effective.toolCards
    }
}

struct DesktopFixture: Decodable {
    let runtime: RuntimeRecordPayload
    let overview: Overview
    let profile: ProfileResponse?
    let changes: ChangesResponse?
    let remotes: RemoteConnectionsResponse?
    let computer: ComputerOverview?
    let browser: BrowserOverview?
    let initialSection: String?
}

struct APIErrorEnvelope: Decodable {
    struct Body: Decodable {
        let code: String?
        let message: String?
    }
    let ok: Bool?
    let error: Body?
}

enum CodexFlowError: LocalizedError {
    case missingDesktopConfig
    case missingWorkspace
    case invalidRuntime
    case brokerLaunch(String)
    case http(Int, String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .missingDesktopConfig:
            "Launch CodexFlow once from Terminal so the desktop app can locate the installed broker."
        case .missingWorkspace:
            "Choose a project folder before starting CodexFlow."
        case .invalidRuntime:
            "The saved runtime record is incomplete or no longer reachable."
        case .brokerLaunch(let detail):
            "The broker could not start. \(detail)"
        case .http(let status, let message):
            "Local broker returned HTTP \(status). \(message)"
        case .invalidResponse:
            "The local broker returned an unexpected response."
        }
    }
}

extension JSONDecoder {
    static var codexFlow: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

extension String {
    var codexFlowTitle: String {
        replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }
}
