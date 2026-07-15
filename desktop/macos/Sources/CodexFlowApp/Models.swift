import Foundation

enum AppSection: String, CaseIterable, Identifiable {
    case now
    case projects
    case chats
    case connection
    case policy

    var id: String { rawValue }

    var title: String {
        switch self {
        case .now: "Now"
        case .projects: "Projects"
        case .chats: "Chats"
        case .connection: "Connection"
        case .policy: "Policy"
        }
    }

    var symbol: String {
        switch self {
        case .now: "sparkles"
        case .projects: "square.stack.3d.up"
        case .chats: "bubble.left.and.bubble.right"
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
    let recentSessions: Int
    let activityEvents: Int
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
