import AppKit
import SwiftUI

struct NowView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 21) {
                SectionHeading(
                    eyebrow: "Local coding bridge",
                    title: model.state == .ready ? "Everything in motion." : "Your workspace, ready when you are.",
                    detail: model.state.detail
                )

                HeroStatusCard()
                ModelCompatibilityStrip()

                if let overview = model.overview {
                    MetricStrip(overview: overview)
                    HStack(alignment: .top, spacing: 17) {
                        RecentChatsCard(sessions: Array(overview.sessions.prefix(4)))
                            .frame(maxWidth: .infinity)
                        ActivityCard(activity: Array(overview.activity.prefix(6)))
                            .frame(maxWidth: .infinity)
                    }
                } else if case .degraded = model.state {
                    RecoveryCard()
                }
            }
            .padding(.horizontal, 25)
            .padding(.top, 25)
            .padding(.bottom, 42)
            .frame(maxWidth: 1160, alignment: .leading)
        }
    }
}

private struct HeroStatusCard: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack(alignment: .topTrailing) {
            LinearGradient(
                colors: [FlowColor.groundRaised, Color(hex: 0x132230)],
                startPoint: .leading,
                endPoint: .trailing
            )
            GeometryReader { proxy in
                Path { path in
                    let step: CGFloat = 42
                    for x in stride(from: 0, through: proxy.size.width, by: step) {
                        path.move(to: CGPoint(x: x, y: 0))
                        path.addLine(to: CGPoint(x: x, y: proxy.size.height))
                    }
                    for y in stride(from: 0, through: proxy.size.height, by: step) {
                        path.move(to: CGPoint(x: 0, y: y))
                        path.addLine(to: CGPoint(x: proxy.size.width, y: y))
                    }
                }
                .stroke(Color.white.opacity(0.035), lineWidth: 1)
            }
            .allowsHitTesting(false)

            Circle()
                .fill(FlowColor.signal.opacity(0.18))
                .frame(width: 250, height: 250)
                .blur(radius: 54)
                .offset(x: 64, y: -75)

            HStack(alignment: .center, spacing: 28) {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 9) {
                        StateDot(color: stateColor, pulse: model.state.isBusy)
                        Text(model.state.title.uppercased())
                            .font(FlowType.label(10))
                            .tracking(1.5)
                            .foregroundStyle(stateColor)
                    }
                    Text(heroTitle)
                        .font(FlowType.display(25))
                        .foregroundStyle(Color.white)
                    Text(heroDetail)
                        .font(FlowType.body(13))
                        .foregroundStyle(Color.white.opacity(0.6))
                        .lineSpacing(3)
                        .frame(maxWidth: 540, alignment: .leading)

                    HStack(spacing: 10) {
                        if model.hasLiveRuntime {
                            Button("Copy Server URL") { model.copyServerURL() }
                                .buttonStyle(DarkButtonStyle(primary: true))
                            Button("Open ChatGPT") { model.openChatGPTSettings() }
                                .buttonStyle(DarkButtonStyle(primary: false))
                        } else if model.hasRunningProcess {
                            Button("Reconnect") { Task { await model.refresh() } }
                                .buttonStyle(DarkButtonStyle(primary: true))
                                .disabled(model.state.isBusy || model.isFixture)
                            Button("Browser fallback") { model.openBrowserFallback() }
                                .buttonStyle(DarkButtonStyle(primary: false))
                        } else {
                            Button("Choose Project") { model.chooseWorkspace() }
                                .buttonStyle(DarkButtonStyle(primary: false))
                            Button("Start CodexFlow") { model.startBroker() }
                                .buttonStyle(DarkButtonStyle(primary: true))
                                .disabled(model.state.isBusy || model.isFixture)
                        }
                    }
                }
                Spacer(minLength: 14)
                RuntimeGlyph(live: model.hasLiveRuntime, busy: model.state.isBusy)
            }
            .padding(27)
        }
        .frame(minHeight: 242)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color.white.opacity(0.08), lineWidth: 1))
        .shadow(color: FlowColor.ground.opacity(0.16), radius: 25, y: 12)
    }

    private var heroTitle: String {
        if model.hasLiveRuntime { return "\(model.workspaceName) is connected." }
        switch model.state {
        case .starting: return "Building the local route."
        case .degraded: return "The route needs attention."
        default: return model.selectedRoot == nil ? "Choose where CodexFlow should work." : "Start \(model.workspaceName)."
        }
    }

    private var heroDetail: String {
        if let overview = model.overview {
            let publicState = overview.broker.publicEndpoint == nil ? "local-only" : "publicly reachable through \(overview.broker.tunnel ?? "a tunnel")"
            return "Broker \(overview.broker.version) is \(publicState). It is routing \(overview.summary.activeSessions) active chat\(overview.summary.activeSessions == 1 ? "" : "s") across \(overview.summary.projects) discovered project\(overview.summary.projects == 1 ? "" : "s")."
        }
        return model.state.detail
    }

    private var stateColor: Color {
        switch model.state {
        case .ready: FlowColor.success
        case .degraded: FlowColor.danger
        case .offline: Color.white.opacity(0.45)
        default: FlowColor.signalBright
        }
    }
}

private struct DarkButtonStyle: ButtonStyle {
    let primary: Bool
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(FlowType.label(12))
            .foregroundStyle(primary ? FlowColor.ground : Color.white.opacity(0.84))
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(primary ? FlowColor.signalBright.opacity(configuration.isPressed ? 0.75 : 1) : Color.white.opacity(configuration.isPressed ? 0.12 : 0.07))
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 11).stroke(primary ? FlowColor.signal.opacity(0.5) : Color.white.opacity(0.13), lineWidth: 1))
            .opacity(isEnabled ? 1 : 0.42)
    }
}

private struct RuntimeGlyph: View {
    let live: Bool
    let busy: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var turn = false

    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.08), lineWidth: 1).frame(width: 150, height: 150)
            Circle()
                .trim(from: 0.07, to: 0.77)
                .stroke(FlowColor.signal.opacity(live || busy ? 0.7 : 0.22), style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [5, 8]))
                .frame(width: 116, height: 116)
                .rotationEffect(.degrees(turn ? 360 : 0))
            Circle().fill(FlowColor.ground).frame(width: 76, height: 76)
                .overlay(Circle().stroke(FlowColor.signal.opacity(0.3), lineWidth: 1))
            Image(systemName: live ? "point.3.filled.connected.trianglepath.dotted" : "point.3.connected.trianglepath.dotted")
                .font(.system(size: 31, weight: .light))
                .foregroundStyle(live ? FlowColor.signalBright : Color.white.opacity(0.34))
            Circle()
                .fill(live ? FlowColor.success : FlowColor.signal)
                .frame(width: 10, height: 10)
                .offset(x: 56, y: -40)
        }
        .frame(width: 170, height: 170)
        .onAppear {
            guard busy && !reduceMotion else { return }
            withAnimation(.linear(duration: 12).repeatForever(autoreverses: false)) { turn = true }
        }
        .accessibilityHidden(true)
    }
}

private struct MetricStrip: View {
    let overview: Overview
    private let columns = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 13) {
            MetricCard(value: "\(overview.summary.projects)", label: "Projects", detail: "discovered locally", symbol: "square.stack.3d.up")
            MetricCard(value: "\(overview.summary.activeSessions)", label: "Active chats", detail: "private project routes", symbol: "bubble.left.and.bubble.right")
            MetricCard(value: "\(overview.summary.activityEvents)", label: "Recent actions", detail: "content-free events", symbol: "waveform.path.ecg")
            MetricCard(value: Format.duration(ms: overview.broker.uptimeMs), label: "Uptime", detail: "broker available", symbol: "clock")
        }
    }
}

private struct ModelCompatibilityStrip: View {
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles.rectangle.stack")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(FlowColor.signal)
                .frame(width: 34, height: 34)
                .background(FlowColor.signalWash)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text("Use Extra High, then search for CodexFlow")
                    .font(FlowType.label(11))
                    .foregroundStyle(FlowColor.ink)
                Text("ChatGPT’s first app row is a ranked subset. In every new chat, choose + → More and search CodexFlow. Multiple chats can use the same broker at once; Pro model variants do not expose Apps.")
                    .font(FlowType.body(10))
                    .foregroundStyle(FlowColor.inkMuted)
            }
            Spacer(minLength: 8)
            Text("MODEL COMPATIBILITY")
                .font(FlowType.label(8))
                .tracking(1.1)
                .foregroundStyle(FlowColor.signal)
        }
        .padding(.horizontal, 15)
        .frame(minHeight: 58)
        .background(FlowColor.signalWash.opacity(0.72))
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 13).stroke(FlowColor.signal.opacity(0.18), lineWidth: 1))
    }
}

private struct MetricCard: View {
    let value: String
    let label: String
    let detail: String
    let symbol: String

    var body: some View {
        PaperCard(padding: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(value).font(FlowType.title(23)).foregroundStyle(FlowColor.ink)
                    Text(label).font(FlowType.label(11)).foregroundStyle(FlowColor.ink)
                    Text(detail).font(FlowType.body(10)).foregroundStyle(FlowColor.inkMuted)
                }
                Spacer()
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(FlowColor.signal)
                    .frame(width: 34, height: 34)
                    .background(FlowColor.signalWash)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
        }
    }
}

private struct RecentChatsCard: View {
    let sessions: [SessionOverview]

    var body: some View {
        PaperCard {
            CardHeading(title: "Recent chats", detail: "Durable project routes", symbol: "bubble.left.and.bubble.right")
            FlowDivider().padding(.vertical, 14)
            if sessions.isEmpty {
                EmptyState(symbol: "bubble.left", title: "No chats yet", detail: "Search for CodexFlow in a supported ChatGPT chat and choose a project. It will appear here without storing its content.")
                    .frame(minHeight: 210)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(sessions.enumerated()), id: \.element.id) { index, session in
                        SessionRow(session: session)
                        if index < sessions.count - 1 { FlowDivider().padding(.leading, 31) }
                    }
                }
            }
        }
    }
}

private struct ActivityCard: View {
    let activity: [ActivityOverview]

    var body: some View {
        PaperCard {
            CardHeading(title: "Live activity", detail: "Bounded operational telemetry", symbol: "waveform.path.ecg")
            FlowDivider().padding(.vertical, 14)
            if activity.isEmpty {
                EmptyState(symbol: "waveform.path", title: "Quiet for now", detail: "Tool names, status, duration, and project routing appear here. Prompts and file contents never do.")
                    .frame(minHeight: 210)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(activity.enumerated()), id: \.element.id) { index, event in
                        ActivityRow(event: event)
                        if index < activity.count - 1 { FlowDivider().padding(.leading, 31) }
                    }
                }
            }
        }
    }
}

private struct RecoveryCard: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        PaperCard {
            HStack(alignment: .top, spacing: 15) {
                Image(systemName: "wrench.and.screwdriver")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(FlowColor.warning)
                    .frame(width: 44, height: 44)
                    .background(FlowColor.warning.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 7) {
                    Text("A local recovery path, not a dead end.").font(FlowType.title(15)).foregroundStyle(FlowColor.ink)
                    Text(model.state.detail).font(FlowType.body(12)).foregroundStyle(FlowColor.inkMuted)
                    HStack(spacing: 8) {
                        Button("Try again") { Task { await model.refresh() } }.buttonStyle(FlowButtonStyle(kind: .primary))
                        Button("Open launch log") { model.revealLog() }.buttonStyle(FlowButtonStyle(kind: .secondary))
                        if model.selectedRuntime != nil {
                            Button("Browser fallback") { model.openBrowserFallback() }.buttonStyle(FlowButtonStyle(kind: .quiet))
                        }
                    }
                    .padding(.top, 5)
                }
            }
        }
    }
}

struct ProjectsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var query = ""

    private var projects: [ProjectOverview] {
        guard let projects = model.overview?.projects else { return [] }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return projects }
        return projects.filter { $0.name.lowercased().contains(needle) || $0.root.lowercased().contains(needle) || $0.sources.joined(separator: " ").lowercased().contains(needle) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 21) {
                HStack(alignment: .bottom) {
                    SectionHeading(eyebrow: "Synchronized locally", title: "Projects", detail: "Folders CodexFlow can route a chat into, discovered from roots, repository markers, and optional Codex metadata.")
                    Spacer()
                    TextField("Filter projects", text: $query)
                        .textFieldStyle(.roundedBorder)
                        .font(FlowType.body(12))
                        .frame(width: 230)
                        .accessibilityLabel("Filter projects")
                }

                if !model.hasLiveRuntime {
                    OfflineInlineCard(title: "Start a workspace to discover projects.", detail: "CodexFlow performs discovery inside the local broker so the same catalog is used by every connected chat.")
                } else if projects.isEmpty {
                    PaperCard { EmptyState(symbol: "folder.badge.questionmark", title: query.isEmpty ? "No additional projects found" : "No matching projects", detail: query.isEmpty ? "Add an allowed root or open a repository beneath the current workspace, then refresh." : "Try a project name, path, or discovery source.") }
                } else {
                    LazyVStack(spacing: 11) {
                        ForEach(projects) { project in ProjectRow(project: project) }
                    }
                }
            }
            .padding(.horizontal, 25)
            .padding(.top, 25)
            .padding(.bottom, 42)
            .frame(maxWidth: 1160, alignment: .leading)
        }
    }
}

private struct ProjectRow: View {
    let project: ProjectOverview

    var body: some View {
        PaperCard(padding: 16) {
            HStack(spacing: 15) {
                ZStack {
                    RoundedRectangle(cornerRadius: 11).fill(project.isDefault ? FlowColor.signalWash : FlowColor.paperMuted.opacity(0.68))
                    Image(systemName: project.isDefault ? "folder.fill.badge.gearshape" : "folder")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(project.isDefault ? FlowColor.signal : FlowColor.inkMuted)
                }
                .frame(width: 45, height: 45)
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text(project.name).font(FlowType.title(14)).foregroundStyle(FlowColor.ink)
                        if project.isDefault {
                            Text("DEFAULT").font(FlowType.label(8)).tracking(1).foregroundStyle(FlowColor.signal).padding(.horizontal, 7).frame(minHeight: 21).background(FlowColor.signalWash).clipShape(Capsule())
                        }
                    }
                    Text(project.root).font(FlowType.mono(10)).foregroundStyle(FlowColor.inkMuted).lineLimit(1).truncationMode(.middle)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 5) {
                    Text(project.sources.map(\.codexFlowTitle).joined(separator: " · "))
                        .font(FlowType.label(9)).foregroundStyle(FlowColor.inkMuted)
                    Text(project.lastActiveAt.map { Format.relative($0) } ?? "No recent activity")
                        .font(FlowType.body(10)).foregroundStyle(FlowColor.inkMuted)
                }
                Button("Reveal") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: project.root)]) }
                    .buttonStyle(FlowButtonStyle(kind: .secondary))
            }
        }
    }
}

struct ChatsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var scope = "all"

    private var sessions: [SessionOverview] {
        let all = model.overview?.sessions ?? []
        switch scope {
        case "active": return all.filter { $0.state != "closed" }
        case "closed": return all.filter { $0.state == "closed" }
        default: return all
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 21) {
                HStack(alignment: .bottom) {
                    SectionHeading(eyebrow: "Independent routes", title: "Chats", detail: "A content-free view of the web conversations currently using this broker and the project each one selected.")
                    Spacer()
                    Picker("Chat scope", selection: $scope) {
                        Text("All").tag("all")
                        Text("Active").tag("active")
                        Text("Closed").tag("closed")
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 230)
                }

                PrivacyStrip()
                if !model.hasLiveRuntime {
                    OfflineInlineCard(title: "No live broker to observe.", detail: "Start CodexFlow, then activate the plugin in one or more web chats. Each conversation gets its own isolated project route.")
                } else if sessions.isEmpty {
                    PaperCard { EmptyState(symbol: "bubble.left.and.bubble.right", title: scope == "all" ? "No chats routed yet" : "No \(scope) chats", detail: "A chat appears after it selects a project. Discovery and picker connections stay hidden, and conversation text is never stored.") }
                } else {
                    LazyVStack(spacing: 11) {
                        ForEach(sessions) { session in SessionDetailCard(session: session) }
                    }
                }
            }
            .padding(.horizontal, 25)
            .padding(.top, 25)
            .padding(.bottom, 42)
            .frame(maxWidth: 1160, alignment: .leading)
        }
    }
}

private struct PrivacyStrip: View {
    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: "eye.slash.fill").foregroundStyle(FlowColor.success)
            Text("Prompts, tool arguments, file contents, command output, and credentials are never recorded here.")
                .font(FlowType.body(11)).foregroundStyle(FlowColor.inkMuted)
            Spacer()
            Text("CONTENT-FREE TELEMETRY").font(FlowType.label(8)).tracking(1.1).foregroundStyle(FlowColor.success)
        }
        .padding(.horizontal, 15)
        .frame(minHeight: 47)
        .background(FlowColor.success.opacity(0.07))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(FlowColor.success.opacity(0.18), lineWidth: 1))
    }
}

private struct SessionDetailCard: View {
    let session: SessionOverview
    var body: some View {
        PaperCard(padding: 18) {
            HStack(spacing: 16) {
                ZStack {
                    Circle().fill(session.state == "closed" ? FlowColor.paperMuted : FlowColor.signalWash).frame(width: 46, height: 46)
                    Image(systemName: "bubble.left.fill").foregroundStyle(session.state == "closed" ? FlowColor.inkMuted : FlowColor.signal)
                }
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text(session.id).font(FlowType.mono(12)).foregroundStyle(FlowColor.ink)
                        StatusPill(label: session.project == nil && session.state != "closed" ? "Choosing project" : session.state.codexFlowTitle, color: session.state == "closed" ? FlowColor.inkMuted : session.project == nil ? FlowColor.warning : FlowColor.success)
                    }
                    Text(session.project?.name ?? "Project not selected yet")
                        .font(FlowType.label(11)).foregroundStyle(session.project == nil ? FlowColor.warning : FlowColor.inkMuted)
                }
                Spacer()
                InfoPair(label: "LAST SEEN", value: Format.relative(session.lastSeenAt))
                InfoPair(label: "TOOL CALLS", value: "\(session.toolCalls)")
                InfoPair(label: "ERRORS", value: "\(session.errors)", warning: session.errors > 0)
                InfoPair(label: "LAST TOOL", value: session.lastTool?.codexFlowTitle ?? "—")
            }
        }
    }
}

struct ConnectionView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 21) {
                SectionHeading(eyebrow: "One endpoint", title: "Connection", detail: "Connect ChatGPT once, then route every conversation to the project it chooses through this broker.")

                if let overview = model.overview, let runtime = model.selectedRuntime {
                    ConnectionHero(overview: overview, runtime: runtime)
                    ModelCompatibilityStrip()
                    HStack(alignment: .top, spacing: 17) {
                        SetupSteps().frame(maxWidth: .infinity)
                        RuntimeDetails(overview: overview, runtime: runtime).frame(maxWidth: .infinity)
                    }
                } else {
                    OfflineInlineCard(title: "The connection appears when the broker starts.", detail: "Your private credential is generated locally. The full Server URL is only placed on the clipboard after you ask for it.")
                    SetupSteps()
                }
            }
            .padding(.horizontal, 25)
            .padding(.top, 25)
            .padding(.bottom, 42)
            .frame(maxWidth: 1160, alignment: .leading)
        }
    }
}

private struct ConnectionHero: View {
    @EnvironmentObject private var model: AppModel
    let overview: Overview
    let runtime: RuntimeRecord

    var body: some View {
        PaperCard(padding: 22) {
            HStack(spacing: 19) {
                ZStack {
                    RoundedRectangle(cornerRadius: 15).fill(FlowColor.ground)
                    Image(systemName: overview.broker.publicEndpoint == nil ? "lock.laptopcomputer" : "network.badge.shield.half.filled")
                        .font(.system(size: 25, weight: .light)).foregroundStyle(FlowColor.signalBright)
                }
                .frame(width: 60, height: 60)
                VStack(alignment: .leading, spacing: 6) {
                    Text(overview.broker.publicEndpoint == nil ? "Local endpoint ready" : "Secure route ready")
                        .font(FlowType.title(17)).foregroundStyle(FlowColor.ink)
                    Text(redactedEndpoint)
                        .font(FlowType.mono(11)).foregroundStyle(FlowColor.inkMuted).lineLimit(1).truncationMode(.middle)
                    Text("Authentication is \(overview.broker.authEnabled ? "on" : "off") · \((runtime.tunnel ?? "none").codexFlowTitle) · credentials hidden")
                        .font(FlowType.body(10)).foregroundStyle(FlowColor.inkMuted)
                }
                Spacer()
                Button("Open ChatGPT") { model.openChatGPTSettings() }.buttonStyle(FlowButtonStyle(kind: .secondary))
                Button("Copy Server URL") { model.copyServerURL() }.buttonStyle(FlowButtonStyle(kind: .primary))
            }
        }
    }

    private var redactedEndpoint: String {
        guard var components = URLComponents(string: overview.broker.endpoint) else { return "Private endpoint" }
        components.query = nil
        return components.string ?? "Private endpoint"
    }
}

private struct SetupSteps: View {
    var body: some View {
        PaperCard {
            CardHeading(title: "Connect once", detail: "No per-project setup", symbol: "link")
            FlowDivider().padding(.vertical, 14)
            VStack(spacing: 16) {
                StepRow(number: "01", title: "Copy", detail: "Copy the private Server URL from CodexFlow.")
                StepRow(number: "02", title: "Create", detail: "In ChatGPT Settings → Plugins, create CodexFlow with Server URL and no separate authentication.")
                StepRow(number: "03", title: "Search", detail: "In each new chat, choose + → More, search CodexFlow, then select that conversation’s project.")
            }
        }
    }
}

private struct RuntimeDetails: View {
    @EnvironmentObject private var model: AppModel
    let overview: Overview
    let runtime: RuntimeRecord

    var body: some View {
        PaperCard {
            CardHeading(title: "Runtime", detail: "Current process", symbol: "cpu")
            FlowDivider().padding(.vertical, 14)
            VStack(spacing: 12) {
                DetailLine(label: "Version", value: overview.broker.version)
                DetailLine(label: "Process", value: runtime.pid.map(String.init) ?? "—")
                DetailLine(label: "Tunnel", value: (runtime.tunnel ?? "none").codexFlowTitle)
                DetailLine(label: "Started", value: Format.relative(overview.broker.startedAt))
                DetailLine(label: "Transport limit", value: "\(overview.broker.maxSessions) sessions")
            }
            FlowDivider().padding(.vertical, 14)
            HStack {
                Button("Open fallback") { model.openBrowserFallback() }.buttonStyle(FlowButtonStyle(kind: .quiet))
                Button("Reveal log") { model.revealLog() }.buttonStyle(FlowButtonStyle(kind: .quiet))
            }
        }
    }
}

struct PolicyView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 21) {
                HStack(alignment: .bottom) {
                    SectionHeading(eyebrow: "Boundaries first", title: "Policy", detail: "See exactly what connected chats may do. Changes are saved for the next broker launch and never mutate an active session silently.")
                    Spacer()
                    Button("Edit next launch…") { model.showingPolicyEditor = true }
                        .buttonStyle(FlowButtonStyle(kind: .primary))
                        .disabled(model.profile == nil)
                }

                if let overview = model.overview {
                    PolicyGrid(overview: overview)
                    GuardrailCard(overview: overview)
                } else {
                    OfflineInlineCard(title: "Start CodexFlow to inspect effective policy.", detail: "The native editor reads and writes the same protected launch profile used by the CLI. No browser settings page is required.")
                }
            }
            .padding(.horizontal, 25)
            .padding(.top, 25)
            .padding(.bottom, 42)
            .frame(maxWidth: 1160, alignment: .leading)
        }
    }
}

private struct PolicyGrid: View {
    let overview: Overview
    private let columns = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 13) {
            PolicyCard(symbol: "pencil.and.outline", label: "Write access", value: overview.broker.writeMode.codexFlowTitle, detail: overview.broker.writeMode == "workspace" ? "Edits stay inside approved roots." : "Generic workspace edits are restricted.", color: overview.broker.writeMode == "workspace" ? FlowColor.signal : FlowColor.inkMuted)
            PolicyCard(symbol: "terminal", label: "Terminal", value: overview.broker.bashMode.codexFlowTitle, detail: overview.broker.bashMode == "safe" ? "Guarded command policy is active." : "Shell commands follow the selected mode.", color: overview.broker.bashMode == "full" ? FlowColor.warning : FlowColor.signal)
            PolicyCard(symbol: "shippingbox", label: "Tool surface", value: overview.broker.toolMode.codexFlowTitle, detail: "Controls the capabilities advertised to chats.", color: FlowColor.signal)
            PolicyCard(symbol: "text.bubble", label: "Bash transcript", value: overview.broker.bashTranscript.codexFlowTitle, detail: "Controls shell result detail returned to chat.", color: FlowColor.inkMuted)
            PolicyCard(symbol: "clock.arrow.circlepath", label: "Codex metadata", value: overview.broker.codexSessions.codexFlowTitle, detail: "Optional read-only compatibility source.", color: overview.broker.codexSessions == "off" ? FlowColor.inkMuted : FlowColor.warning)
            PolicyCard(symbol: "rectangle.on.rectangle", label: "Tool cards", value: overview.broker.toolCards ? "On" : "Off", detail: "Optional host-native inline result presentation.", color: overview.broker.toolCards ? FlowColor.signal : FlowColor.inkMuted)
        }
    }
}

private struct PolicyCard: View {
    let symbol: String
    let label: String
    let value: String
    let detail: String
    let color: Color
    var body: some View {
        PaperCard(padding: 17) {
            VStack(alignment: .leading, spacing: 11) {
                HStack {
                    Image(systemName: symbol).font(.system(size: 15, weight: .medium)).foregroundStyle(color)
                    Spacer()
                    Text(value.uppercased()).font(FlowType.label(9)).tracking(1).foregroundStyle(color)
                }
                Text(label).font(FlowType.title(14)).foregroundStyle(FlowColor.ink)
                Text(detail).font(FlowType.body(11)).foregroundStyle(FlowColor.inkMuted).lineSpacing(2).frame(minHeight: 34, alignment: .top)
            }
        }
    }
}

private struct GuardrailCard: View {
    let overview: Overview
    var body: some View {
        PaperCard {
            HStack(alignment: .top, spacing: 17) {
                Image(systemName: "shield.lefthalf.filled")
                    .font(.system(size: 23, weight: .medium)).foregroundStyle(FlowColor.success)
                    .frame(width: 49, height: 49).background(FlowColor.success.opacity(0.09)).clipShape(RoundedRectangle(cornerRadius: 13))
                VStack(alignment: .leading, spacing: 8) {
                    Text("The filesystem boundary is always on.").font(FlowType.title(16)).foregroundStyle(FlowColor.ink)
                    Text("Files, patches, search, git, and terminal operations remain constrained to approved roots and blocked-path rules regardless of tool mode. CodexFlow is a local broker—not an operating-system sandbox—and it says so plainly.")
                        .font(FlowType.body(12)).foregroundStyle(FlowColor.inkMuted).lineSpacing(3)
                    Text("\(overview.broker.allowedRoots.count) approved root\(overview.broker.allowedRoots.count == 1 ? "" : "s") · authentication \(overview.broker.authEnabled ? "enabled" : "disabled") · repository analysis \(overview.broker.analysisEnabled ? "enabled" : "disabled")")
                        .font(FlowType.mono(10)).foregroundStyle(FlowColor.success).padding(.top, 3)
                }
            }
        }
    }
}

struct PolicyEditorView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ProfileDraft
    @State private var saving = false

    init(profile: ProfileResponse) {
        _draft = State(initialValue: ProfileDraft(effective: profile.effective))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Next-launch policy").font(FlowType.title(22)).foregroundStyle(FlowColor.ink)
                    Text("Saved changes apply after CodexFlow restarts.").font(FlowType.body(12)).foregroundStyle(FlowColor.inkMuted)
                }
                Spacer()
                Button("Cancel") { dismiss() }.buttonStyle(FlowButtonStyle(kind: .quiet))
            }
            .padding(24)
            FlowDivider()
            ScrollView {
                VStack(spacing: 14) {
                    EditorGroup(title: "Connection", detail: "How this workspace reaches ChatGPT.") {
                        FieldRow(label: "Tunnel") {
                            Picker("Tunnel", selection: $draft.tunnel) {
                                Text("Cloudflare quick").tag("cloudflare")
                                Text("Cloudflare named").tag("cloudflare-named")
                                Text("ngrok").tag("ngrok")
                                Text("Tailscale Funnel").tag("tailscale")
                                Text("Local only").tag("none")
                            }.labelsHidden().frame(width: 210)
                        }
                        if ["cloudflare-named", "ngrok", "tailscale"].contains(draft.tunnel) {
                            FieldRow(label: "Hostname") {
                                TextField("codexflow.example.com", text: $draft.hostname).textFieldStyle(.roundedBorder).frame(width: 280)
                            }
                        }
                    }
                    EditorGroup(title: "Agent behavior", detail: "The capability envelope advertised to each chat.") {
                        FieldRow(label: "Mode") { optionPicker(selection: $draft.mode, values: ["agent", "handoff", "pro"]) }
                        FieldRow(label: "Write") { optionPicker(selection: $draft.write, values: ["workspace", "handoff", "off"]) }
                        FieldRow(label: "Terminal") { optionPicker(selection: $draft.bash, values: ["safe", "off", "full"]) }
                        FieldRow(label: "Tool surface") { optionPicker(selection: $draft.toolMode, values: ["minimal", "standard", "full"]) }
                    }
                    EditorGroup(title: "Context", detail: "Optional metadata and result presentation.") {
                        FieldRow(label: "Bash transcript") { optionPicker(selection: $draft.bashTranscript, values: ["compact", "full"]) }
                        FieldRow(label: "Codex sessions") { optionPicker(selection: $draft.codexSessions, values: ["off", "metadata", "read"]) }
                        FieldRow(label: "Tool cards") { Toggle("Use host-native tool cards", isOn: $draft.toolCards).toggleStyle(.switch) }
                    }
                }
                .padding(24)
            }
            FlowDivider()
            HStack {
                Image(systemName: "arrow.clockwise.circle").foregroundStyle(FlowColor.warning)
                Text("These settings do not silently change the active broker.").font(FlowType.body(11)).foregroundStyle(FlowColor.inkMuted)
                Spacer()
                Button("Save for next launch") {
                    saving = true
                    Task {
                        if await model.saveProfile(draft) { dismiss() }
                        saving = false
                    }
                }
                .buttonStyle(FlowButtonStyle(kind: .primary))
                .disabled(saving || hostnameMissing || model.isFixture)
            }
            .padding(18)
        }
        .frame(width: 690, height: 670)
        .background(FlowColor.paper)
    }

    @ViewBuilder
    private func optionPicker(selection: Binding<String>, values: [String]) -> some View {
        Picker("", selection: selection) {
            ForEach(values, id: \.self) { Text($0.codexFlowTitle).tag($0) }
        }
        .labelsHidden()
        .frame(width: 210)
    }

    private var hostnameMissing: Bool {
        ["cloudflare-named", "ngrok", "tailscale"].contains(draft.tunnel) && draft.hostname.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct MissingPolicyView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 18) {
            EmptyState(symbol: "slider.horizontal.3", title: "Policy is available when the broker is live", detail: "Start CodexFlow, then return here to edit the protected next-launch profile.")
            HStack {
                Button("Close") { dismiss() }.buttonStyle(FlowButtonStyle(kind: .secondary))
                Button("Start CodexFlow") { dismiss(); model.startBroker() }.buttonStyle(FlowButtonStyle(kind: .primary))
            }
        }
        .padding(30).frame(width: 480, height: 320).background(FlowColor.paper)
    }
}

private struct EditorGroup<Content: View>: View {
    let title: String
    let detail: String
    @ViewBuilder let content: Content
    init(title: String, detail: String, @ViewBuilder content: () -> Content) {
        self.title = title; self.detail = detail; self.content = content()
    }
    var body: some View {
        PaperCard(padding: 17) {
            VStack(alignment: .leading, spacing: 13) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(FlowType.title(14)).foregroundStyle(FlowColor.ink)
                    Text(detail).font(FlowType.body(10)).foregroundStyle(FlowColor.inkMuted)
                }
                FlowDivider()
                content
            }
        }
    }
}

private struct FieldRow<Content: View>: View {
    let label: String
    @ViewBuilder let content: Content
    init(label: String, @ViewBuilder content: () -> Content) { self.label = label; self.content = content() }
    var body: some View {
        HStack {
            Text(label).font(FlowType.label(11)).foregroundStyle(FlowColor.inkMuted).frame(width: 125, alignment: .leading)
            content
            Spacer()
        }
        .frame(minHeight: 36)
    }
}

private struct CardHeading: View {
    let title: String
    let detail: String
    let symbol: String
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(FlowType.title(14)).foregroundStyle(FlowColor.ink)
                Text(detail).font(FlowType.body(10)).foregroundStyle(FlowColor.inkMuted)
            }
            Spacer()
            Image(systemName: symbol).font(.system(size: 14, weight: .medium)).foregroundStyle(FlowColor.signal)
        }
    }
}

private struct SessionRow: View {
    let session: SessionOverview
    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(session.state == "closed" ? FlowColor.inkMuted : session.project == nil ? FlowColor.warning : FlowColor.success).frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 3) {
                Text(session.project?.name ?? "Choosing a project").font(FlowType.label(11)).foregroundStyle(FlowColor.ink)
                Text("\(session.id) · \(session.toolCalls) calls").font(FlowType.mono(9)).foregroundStyle(FlowColor.inkMuted)
            }
            Spacer()
            Text(Format.relative(session.lastSeenAt)).font(FlowType.body(9)).foregroundStyle(FlowColor.inkMuted)
        }
        .frame(minHeight: 48)
    }
}

private struct ActivityRow: View {
    let event: ActivityOverview
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: event.status == "ok" ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                .foregroundStyle(event.status == "ok" ? FlowColor.success : FlowColor.danger)
                .font(.system(size: 13))
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 3) {
                Text(event.tool.codexFlowTitle).font(FlowType.label(11)).foregroundStyle(FlowColor.ink)
                Text(event.project?.name ?? event.sessionId).font(FlowType.mono(9)).foregroundStyle(FlowColor.inkMuted)
            }
            Spacer()
            Text("\(event.durationMs) ms").font(FlowType.mono(9)).foregroundStyle(FlowColor.inkMuted)
        }
        .frame(minHeight: 48)
    }
}

private struct InfoPair: View {
    let label: String
    let value: String
    var warning = false
    var body: some View {
        VStack(alignment: .trailing, spacing: 5) {
            Text(label).font(FlowType.label(8)).tracking(1).foregroundStyle(FlowColor.inkMuted)
            Text(value).font(FlowType.mono(10)).foregroundStyle(warning ? FlowColor.danger : FlowColor.ink).lineLimit(1)
        }
        .frame(minWidth: 70, alignment: .trailing)
    }
}

private struct StepRow: View {
    let number: String
    let title: String
    let detail: String
    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            Text(number).font(FlowType.mono(10)).foregroundStyle(FlowColor.signal)
                .frame(width: 34, height: 34).background(FlowColor.signalWash).clipShape(Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(FlowType.title(12)).foregroundStyle(FlowColor.ink)
                Text(detail).font(FlowType.body(11)).foregroundStyle(FlowColor.inkMuted).lineSpacing(2)
            }
            Spacer()
        }
    }
}

private struct DetailLine: View {
    let label: String
    let value: String
    var body: some View {
        HStack {
            Text(label).font(FlowType.body(11)).foregroundStyle(FlowColor.inkMuted)
            Spacer()
            Text(value).font(FlowType.mono(10)).foregroundStyle(FlowColor.ink)
        }
    }
}

private struct OfflineInlineCard: View {
    @EnvironmentObject private var model: AppModel
    let title: String
    let detail: String
    var body: some View {
        PaperCard {
            HStack(spacing: 15) {
                Image(systemName: "power").font(.system(size: 18, weight: .medium)).foregroundStyle(FlowColor.signal)
                    .frame(width: 44, height: 44).background(FlowColor.signalWash).clipShape(RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 5) {
                    Text(title).font(FlowType.title(14)).foregroundStyle(FlowColor.ink)
                    Text(detail).font(FlowType.body(11)).foregroundStyle(FlowColor.inkMuted)
                }
                Spacer()
                Button("Choose Project") { model.chooseWorkspace() }.buttonStyle(FlowButtonStyle(kind: .secondary))
                Button("Start") { model.startBroker() }.buttonStyle(FlowButtonStyle(kind: .primary)).disabled(model.state.isBusy || model.isFixture)
            }
        }
    }
}

private enum Format {
    static func relative(_ iso: String) -> String {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        guard let date = fractional.date(from: iso) ?? plain.date(from: iso) else { return "—" }
        let seconds = max(0, Int(Date().timeIntervalSince(date)))
        if seconds < 45 { return "just now" }
        if seconds < 3_600 { return "\(max(1, seconds / 60))m ago" }
        if seconds < 86_400 { return "\(seconds / 3_600)h ago" }
        return "\(seconds / 86_400)d ago"
    }

    static func duration(ms: Int) -> String {
        let seconds = ms / 1_000
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 48 { return "\(hours)h" }
        return "\(hours / 24)d"
    }
}
