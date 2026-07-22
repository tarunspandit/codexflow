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

struct EnvironmentsView: View {
    @EnvironmentObject private var model: AppModel

    private var environments: [LocalEnvironmentOverview] { model.overview?.environments ?? [] }
    private var actionsEnabled: Bool {
        model.overview?.broker.writeMode == "workspace" && model.overview?.broker.bashMode != "off"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 21) {
                HStack(alignment: .bottom) {
                    SectionHeading(
                        eyebrow: "Shared project runtime",
                        title: "Environments",
                        detail: "The same .codex environment files used by Codex Desktop. Setup new worktrees automatically and keep project actions one click away."
                    )
                    Spacer()
                    Button {
                        Task { await model.stopEnvironmentAction() }
                    } label: {
                        Label("Stop action", systemImage: "stop.fill")
                    }
                    .buttonStyle(FlowButtonStyle(kind: .danger))
                    .disabled(!model.hasLiveRuntime || !actionsEnabled)
                }

                HStack(spacing: 11) {
                    Image(systemName: "arrow.triangle.2.circlepath").foregroundStyle(FlowColor.signal)
                    Text("Portable by design: edit an environment once in .codex/environments, then use it from Codex Desktop or CodexFlow without conversion.")
                        .font(FlowType.body(11)).foregroundStyle(FlowColor.inkMuted)
                    Spacer()
                    Text("CODEX NATIVE FORMAT").font(FlowType.label(8)).tracking(1.1).foregroundStyle(FlowColor.signal)
                }
                .padding(.horizontal, 15)
                .frame(minHeight: 47)
                .background(FlowColor.signalWash.opacity(0.7))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(FlowColor.signal.opacity(0.17), lineWidth: 1))

                if !model.hasLiveRuntime {
                    OfflineInlineCard(title: "Start a workspace to load its environments.", detail: "CodexFlow reads project-owned configuration through the local broker.")
                } else if !actionsEnabled {
                    OfflineInlineCard(title: "Environment actions need workspace execution.", detail: "Set Write access to Workspace and keep Bash enabled in Policy, then restart the broker.")
                } else if environments.isEmpty {
                    PaperCard {
                        EmptyState(
                            symbol: "shippingbox",
                            title: "No local environments yet",
                            detail: "Create one from Codex Desktop settings or add a version 1 TOML file under .codex/environments. It will appear here automatically."
                        )
                    }
                } else {
                    LazyVStack(spacing: 11) {
                        ForEach(environments) { environment in
                            EnvironmentCard(environment: environment)
                        }
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

private struct EnvironmentCard: View {
    @EnvironmentObject private var model: AppModel
    let environment: LocalEnvironmentOverview

    private var busy: Bool { model.environmentBusyAction != nil || model.worktreeBusy }

    var body: some View {
        PaperCard(padding: 18) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 15) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12).fill(FlowColor.signalWash)
                        Image(systemName: "shippingbox.and.arrow.backward")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(FlowColor.signal)
                    }
                    .frame(width: 48, height: 48)

                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 8) {
                            Text(environment.name).font(FlowType.title(14)).foregroundStyle(FlowColor.ink)
                            if environment.inherited {
                                Text("INHERITED").font(FlowType.label(8)).tracking(1).foregroundStyle(FlowColor.signal)
                                    .padding(.horizontal, 7).frame(minHeight: 21).background(FlowColor.signalWash).clipShape(Capsule())
                            }
                        }
                        Text(environment.configPath)
                            .font(FlowType.mono(10)).foregroundStyle(FlowColor.inkMuted)
                            .lineLimit(1).truncationMode(.middle)
                    }
                    Spacer()
                    InfoPair(label: "PLATFORM", value: environment.platform.codexFlowTitle)
                    InfoPair(label: "SETUP", value: environment.hasSetup ? "Configured" : "None")
                    InfoPair(label: "ACTIONS", value: "\(environment.actions.count)")
                    Button("Reveal") {
                        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: environment.configPath)])
                    }
                    .buttonStyle(FlowButtonStyle(kind: .secondary))
                }

                FlowDivider()

                HStack(spacing: 9) {
                    if environment.actions.isEmpty {
                        Text("No toolbar actions configured.")
                            .font(FlowType.body(11)).foregroundStyle(FlowColor.inkMuted)
                    } else {
                        ForEach(environment.actions) { action in
                            Button {
                                Task { await model.runEnvironment(environment, action: "run", actionName: action.name) }
                            } label: {
                                Label(action.name, systemImage: action.symbol)
                            }
                            .buttonStyle(FlowButtonStyle(kind: .primary))
                            .disabled(busy)
                        }
                    }
                    Spacer()
                    if environment.hasSetup {
                        Button("Run setup") {
                            Task { await model.runEnvironment(environment, action: "setup") }
                        }
                        .buttonStyle(FlowButtonStyle(kind: .quiet))
                        .disabled(busy)
                    }
                    if environment.hasCleanup {
                        Button("Run cleanup") {
                            Task { await model.runEnvironment(environment, action: "cleanup") }
                        }
                        .buttonStyle(FlowButtonStyle(kind: .quiet))
                        .disabled(busy)
                    }
                    Button {
                        Task {
                            await model.createManagedWorktree(environmentConfigPath: environment.configPath)
                            model.section = .worktrees
                        }
                    } label: {
                        Label("New worktree", systemImage: "arrow.triangle.branch")
                    }
                    .buttonStyle(FlowButtonStyle(kind: .secondary))
                    .disabled(busy)
                }
            }
        }
    }
}

private extension LocalEnvironmentActionOverview {
    var symbol: String {
        switch icon {
        case "run": "play.fill"
        case "debug": "ladybug"
        case "test": "checkmark.seal"
        default: "wrench.and.screwdriver"
        }
    }
}

struct WorktreesView: View {
    @EnvironmentObject private var model: AppModel
    @State private var removalCandidate: ManagedWorktreeOverview?

    private var worktrees: [ManagedWorktreeOverview] { model.overview?.worktrees ?? [] }
    private var worktreesEnabled: Bool { model.overview?.broker.writeMode == "workspace" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 21) {
                HStack(alignment: .bottom) {
                    SectionHeading(
                        eyebrow: "Parallel execution",
                        title: "Worktrees",
                        detail: "Give a coding chat an isolated checkout without duplicating the repository. Each route can work independently, then hand changes back deliberately."
                    )
                    Spacer()
                    Button {
                        Task { await model.createManagedWorktree() }
                    } label: {
                        Label(model.worktreeBusy ? "Working…" : "New worktree", systemImage: "plus")
                    }
                    .buttonStyle(FlowButtonStyle(kind: .primary))
                    .disabled(!model.hasLiveRuntime || !worktreesEnabled || model.worktreeBusy)
                }

                HStack(spacing: 11) {
                    Image(systemName: "shield.lefthalf.filled").foregroundStyle(FlowColor.signal)
                    Text("Transfers are project-scoped. CodexFlow fingerprints both checkouts and refuses to overwrite independently changed work.")
                        .font(FlowType.body(11)).foregroundStyle(FlowColor.inkMuted)
                    Spacer()
                    Text("GUARDED HANDOFF").font(FlowType.label(8)).tracking(1.1).foregroundStyle(FlowColor.signal)
                }
                .padding(.horizontal, 15)
                .frame(minHeight: 47)
                .background(FlowColor.signalWash.opacity(0.7))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(FlowColor.signal.opacity(0.17), lineWidth: 1))

                if !model.hasLiveRuntime {
                    OfflineInlineCard(title: "Start a workspace to manage worktrees.", detail: "Managed checkouts belong to the selected broker and remain available across chat reconnects.")
                } else if !worktreesEnabled {
                    OfflineInlineCard(title: "Worktrees need workspace write access.", detail: "Change Write access to Workspace in Policy, then restart the broker.")
                } else if worktrees.isEmpty {
                    PaperCard {
                        EmptyState(symbol: "arrow.triangle.branch", title: "No managed worktrees", detail: "Create one here or let a connected coding chat create one before it begins a parallel task.")
                    }
                } else {
                    LazyVStack(spacing: 11) {
                        ForEach(worktrees) { worktree in
                            WorktreeCard(worktree: worktree) { removalCandidate = worktree }
                        }
                    }
                }
            }
            .padding(.horizontal, 25)
            .padding(.top, 25)
            .padding(.bottom, 42)
            .frame(maxWidth: 1160, alignment: .leading)
        }
        .confirmationDialog(
            "Remove this managed worktree?",
            isPresented: Binding(
                get: { removalCandidate != nil },
                set: { if !$0 { removalCandidate = nil } }
            ),
            presenting: removalCandidate
        ) { worktree in
            Button("Remove worktree", role: .destructive) {
                removalCandidate = nil
                Task { await model.removeManagedWorktree(worktree.id) }
            }
            Button("Cancel", role: .cancel) { removalCandidate = nil }
        } message: { worktree in
            Text(worktree.dirty ? "Tracked changes will be saved as a local patch snapshot before removal." : "The isolated checkout will be removed. Your original project is untouched.")
        }
    }
}

private struct WorktreeCard: View {
    let worktree: ManagedWorktreeOverview
    let remove: () -> Void

    var body: some View {
        PaperCard(padding: 18) {
            HStack(spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(worktree.dirty ? FlowColor.warning.opacity(0.11) : FlowColor.signalWash)
                    Image(systemName: "arrow.triangle.branch")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(worktree.dirty ? FlowColor.warning : FlowColor.signal)
                }
                .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text(worktree.id).font(FlowType.mono(12)).foregroundStyle(FlowColor.ink)
                        StatusPill(label: worktree.dirty ? "Uncommitted changes" : "Clean", color: worktree.dirty ? FlowColor.warning : FlowColor.success)
                        if let environmentName = worktree.environmentName {
                            StatusPill(label: environmentName, color: FlowColor.signal)
                        }
                        if !worktree.exists { StatusPill(label: "Missing", color: FlowColor.danger) }
                    }
                    Text(worktree.projectRoot)
                        .font(FlowType.mono(10)).foregroundStyle(FlowColor.inkMuted)
                        .lineLimit(1).truncationMode(.middle)
                }

                Spacer()
                InfoPair(label: "BRANCH", value: worktree.branch ?? "Detached")
                InfoPair(label: "BASE", value: worktree.baseRef)
                InfoPair(label: "UPDATED", value: Format.relative(worktree.updatedAt))

                Button("Reveal") {
                    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: worktree.projectRoot)])
                }
                .buttonStyle(FlowButtonStyle(kind: .secondary))
                .disabled(!worktree.exists)

                Button("Remove", action: remove)
                    .buttonStyle(FlowButtonStyle(kind: .danger))
            }
        }
    }
}

struct ChangesView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selectedID: String?
    @State private var discardCandidate: ChangedFileOverview?
    @State private var discardHunkCandidate: ReviewHunkDiscardCandidate?
    @State private var commentAnchor: ReviewCommentAnchor?
    @State private var commentBody = ""

    private var response: ChangesResponse? { model.changes }
    private var selectedFile: ChangedFileOverview? {
        guard let selectedID else { return nil }
        return (response?.staged ?? []).first { $0.id == selectedID }
            ?? (response?.unstaged ?? []).first { $0.id == selectedID }
    }

    var body: some View {
        VStack(spacing: 0) {
            changesHeader
            FlowDivider()
            if !model.hasLiveRuntime {
                OfflineInlineCard(
                    title: "Start a workspace to review changes.",
                    detail: "The Changes workspace reads Git state from the authenticated local broker."
                )
                .padding(25)
                Spacer()
            } else if let response {
                if response.isGit {
                    HStack(spacing: 0) {
                        changesSidebar(response)
                            .frame(width: 300)
                        Rectangle()
                            .fill(FlowColor.line)
                            .frame(width: 1)
                        diffPane(response)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    }
                } else {
                    OfflineInlineCard(
                        title: "This project is not a Git repository.",
                        detail: "Initialize Git in the selected project to use staged review, diffs, and deliberate file actions."
                    )
                    .padding(25)
                    Spacer()
                }
            } else {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Reading project changes…")
                        .font(FlowType.body(11))
                        .foregroundStyle(FlowColor.inkMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: model.selectedRuntimeID) { await loadChanges() }
        .confirmationDialog(
            "Discard this file’s changes?",
            isPresented: Binding(
                get: { discardCandidate != nil },
                set: { if !$0 { discardCandidate = nil } }
            ),
            presenting: discardCandidate
        ) { file in
            Button("Discard changes", role: .destructive) {
                discardCandidate = nil
                Task { await mutate(action: "discard", file: file, includeStaged: file.staged) }
            }
            Button("Cancel", role: .cancel) { discardCandidate = nil }
        } message: { file in
            Text(file.staged
                ? "This restores \(file.path) in both the index and working tree to HEAD. It cannot be undone by CodexFlow."
                : "This restores \(file.path) in the working tree. It cannot be undone by CodexFlow.")
        }
        .confirmationDialog(
            "Revert this hunk?",
            isPresented: Binding(
                get: { discardHunkCandidate != nil },
                set: { if !$0 { discardHunkCandidate = nil } }
            ),
            presenting: discardHunkCandidate
        ) { candidate in
            Button("Revert hunk", role: .destructive) {
                discardHunkCandidate = nil
                Task { await mutateHunk(action: "discard_hunk", selected: candidate.selected, hunk: candidate.hunk) }
            }
            Button("Cancel", role: .cancel) { discardHunkCandidate = nil }
        } message: { candidate in
            Text("Only \(candidate.hunk.header) in \(candidate.selected.path) will be reverted from the working tree. This cannot be undone by CodexFlow.")
        }
        .sheet(item: $commentAnchor) { anchor in
            ReviewCommentComposer(
                anchor: anchor,
                commentText: $commentBody,
                cancel: {
                    commentAnchor = nil
                    commentBody = ""
                },
                save: {
                    let body = commentBody
                    commentAnchor = nil
                    commentBody = ""
                    Task { await addComment(anchor: anchor, body: body) }
                }
            )
        }
    }

    private var changesHeader: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 9) {
                    Text("Changes")
                        .font(FlowType.title(18))
                        .foregroundStyle(FlowColor.ink)
                    if let response {
                        StatusPill(label: "\(response.summary.files) files", color: response.summary.files == 0 ? FlowColor.success : FlowColor.signal)
                    }
                }
                Text(response?.branch.isEmpty == false ? response!.branch : "Review the selected project before committing.")
                    .font(FlowType.mono(10))
                    .foregroundStyle(FlowColor.inkMuted)
                    .lineLimit(1)
            }
            Spacer()
            if let file = selectedFile {
                if file.staged {
                    Button("Unstage") { Task { await mutate(action: "unstage", file: file) } }
                        .buttonStyle(FlowButtonStyle(kind: .secondary))
                        .disabled(response?.canWrite != true || model.changesBusy)
                } else {
                    Button("Stage") { Task { await mutate(action: "stage", file: file) } }
                        .buttonStyle(FlowButtonStyle(kind: .primary))
                        .disabled(response?.canWrite != true || model.changesBusy)
                }
                Button("Discard") { discardCandidate = file }
                    .buttonStyle(FlowButtonStyle(kind: .danger))
                    .disabled(response?.canWrite != true || model.changesBusy)
            }
            Button {
                Task { await reloadSelection() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(FlowButtonStyle(kind: .secondary))
            .disabled(model.changesBusy)
            .help("Refresh changes")
        }
        .padding(.horizontal, 22)
        .frame(minHeight: 72)
        .background(FlowColor.paper)
    }

    private func changesSidebar(_ response: ChangesResponse) -> some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ChangeGroup(
                        title: "STAGED",
                        files: response.staged,
                        selectedID: selectedID,
                        disabled: model.changesBusy,
                        select: select
                    )
                    ChangeGroup(
                        title: "CHANGES",
                        files: response.unstaged,
                        selectedID: selectedID,
                        disabled: model.changesBusy,
                        select: select
                    )
                    if response.summary.files == 0 {
                        EmptyState(
                            symbol: "checkmark.circle",
                            title: "Working tree clean",
                            detail: "There are no staged, modified, or untracked files in this project."
                        )
                        .padding(.top, 55)
                    }
                }
                .padding(12)
            }
            if response.canWrite && response.summary.files > 0 {
                FlowDivider()
                HStack(spacing: 8) {
                    if !response.unstaged.isEmpty {
                        Button("Stage all") {
                            Task { await mutate(action: "stage", files: response.unstaged) }
                        }
                        .buttonStyle(FlowButtonStyle(kind: .primary))
                        .disabled(model.changesBusy)
                    }
                    if !response.staged.isEmpty {
                        Button("Unstage all") {
                            Task { await mutate(action: "unstage", files: response.staged) }
                        }
                        .buttonStyle(FlowButtonStyle(kind: .secondary))
                        .disabled(model.changesBusy)
                    }
                    Spacer()
                }
                .padding(12)
            }
        }
        .background(FlowColor.paperMuted.opacity(0.4))
    }

    @ViewBuilder
    private func diffPane(_ response: ChangesResponse) -> some View {
        if let selected = response.selected, selectedID == "\(selected.staged ? "staged" : "unstaged"):\(selected.path)" {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "doc.text")
                        .foregroundStyle(FlowColor.signal)
                    Text(selected.path)
                        .font(FlowType.mono(11))
                        .foregroundStyle(FlowColor.ink)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer()
                    Text("+\(selected.additions)")
                        .font(FlowType.mono(10))
                        .foregroundStyle(FlowColor.success)
                    Text("−\(selected.deletions)")
                        .font(FlowType.mono(10))
                        .foregroundStyle(FlowColor.danger)
                    if selected.truncated {
                        StatusPill(label: "Preview limited", color: FlowColor.warning)
                    }
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 47)
                .background(FlowColor.paper)
                FlowDivider()
                if selected.diff.isEmpty {
                    EmptyState(symbol: "doc", title: "No textual diff", detail: "The file may be binary, deleted, or unchanged in this Git lane.")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    DiffReader(
                        selected: selected,
                        busy: model.changesBusy,
                        stageHunk: { hunk in Task { await mutateHunk(action: "stage_hunk", selected: selected, hunk: hunk) } },
                        unstageHunk: { hunk in Task { await mutateHunk(action: "unstage_hunk", selected: selected, hunk: hunk) } },
                        discardHunk: { hunk in discardHunkCandidate = ReviewHunkDiscardCandidate(selected: selected, hunk: hunk) },
                        addComment: { hunk, line, text in
                            commentBody = ""
                            commentAnchor = ReviewCommentAnchor(selected: selected, hunk: hunk, line: line, lineText: text)
                        },
                        deleteComment: { comment in Task { await deleteComment(comment, selected: selected) } }
                    )
                }
            }
        } else if model.changesBusy {
            ProgressView("Loading diff…")
                .font(FlowType.body(11))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            EmptyState(symbol: "plus.forwardslash.minus", title: "Select a changed file", detail: "Review staged and unstaged changes without leaving the project context.")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func loadChanges() async {
        await model.refreshChanges()
        await selectFirstIfNeeded()
    }

    private func reloadSelection() async {
        if let file = selectedFile {
            await model.refreshChanges(path: file.path, staged: file.staged)
        } else {
            await loadChanges()
        }
    }

    private func select(_ file: ChangedFileOverview) {
        selectedID = file.id
        Task { await model.refreshChanges(path: file.path, staged: file.staged) }
    }

    private func selectFirstIfNeeded() async {
        guard selectedFile == nil,
              let file = (model.changes?.unstaged.first ?? model.changes?.staged.first) else { return }
        selectedID = file.id
        await model.refreshChanges(path: file.path, staged: file.staged)
    }

    private func mutate(action: String, file: ChangedFileOverview, includeStaged: Bool? = nil) async {
        await mutate(action: action, files: [file], includeStaged: includeStaged)
    }

    private func mutate(action: String, files: [ChangedFileOverview], includeStaged: Bool? = nil) async {
        await model.mutateChanges(action: action, paths: Array(Set(files.map(\.path))).sorted(), includeStaged: includeStaged)
        selectedID = nil
        await selectFirstIfNeeded()
    }

    private func mutateHunk(action: String, selected: SelectedChangeOverview, hunk: ReviewHunkOverview) async {
        await model.mutateReviewHunk(action: action, selected: selected, hunk: hunk)
        await reconcileSelection()
    }

    private func addComment(anchor: ReviewCommentAnchor, body: String) async {
        await model.addReviewComment(selected: anchor.selected, hunk: anchor.hunk, line: anchor.line, body: body)
        await reconcileSelection()
    }

    private func deleteComment(_ comment: ReviewCommentOverview, selected: SelectedChangeOverview) async {
        await model.deleteReviewComment(comment, selected: selected)
        await reconcileSelection()
    }

    private func reconcileSelection() async {
        if let selected = model.changes?.selected {
            selectedID = "\(selected.staged ? "staged" : "unstaged"):\(selected.path)"
        } else {
            selectedID = nil
            await selectFirstIfNeeded()
        }
    }
}

private struct ReviewHunkDiscardCandidate: Identifiable {
    let selected: SelectedChangeOverview
    let hunk: ReviewHunkOverview
    var id: String { hunk.id }
}

private struct ReviewCommentAnchor: Identifiable {
    let selected: SelectedChangeOverview
    let hunk: ReviewHunkOverview
    let line: Int
    let lineText: String
    var id: String { "\(hunk.id):\(line)" }
}

private struct ReviewCommentComposer: View {
    let anchor: ReviewCommentAnchor
    @Binding var commentText: String
    let cancel: () -> Void
    let save: () -> Void

    var bodyView: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Inline review note").font(FlowType.title(17)).foregroundStyle(FlowColor.ink)
                Text(anchor.selected.path).font(FlowType.mono(10)).foregroundStyle(FlowColor.inkMuted).lineLimit(1)
            }
            Text(anchor.lineText.isEmpty ? "Blank diff line" : anchor.lineText)
                .font(FlowType.mono(10)).foregroundStyle(FlowColor.ink)
                .padding(11).frame(maxWidth: .infinity, alignment: .leading)
                .background(FlowColor.paperMuted).clipShape(RoundedRectangle(cornerRadius: 9))
            TextEditor(text: $commentText)
                .font(FlowType.body(12))
                .frame(minHeight: 110)
                .padding(7)
                .background(FlowColor.paper)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(FlowColor.line, lineWidth: 1))
            Text("Stored only in this computer’s owner-only CodexFlow review state.")
                .font(FlowType.body(10)).foregroundStyle(FlowColor.inkMuted)
            HStack {
                Spacer()
                Button("Cancel", action: cancel).buttonStyle(FlowButtonStyle(kind: .secondary))
                Button("Add note", action: save)
                    .buttonStyle(FlowButtonStyle(kind: .primary))
                    .disabled(commentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || commentText.count > 2000)
            }
        }
        .padding(22)
        .frame(width: 480)
        .background(FlowColor.ground)
    }

    var body: some View { bodyView }
}

private struct ChangeGroup: View {
    let title: String
    let files: [ChangedFileOverview]
    let selectedID: String?
    let disabled: Bool
    let select: (ChangedFileOverview) -> Void

    var body: some View {
        if !files.isEmpty {
            Text("\(title)  \(files.count)")
                .font(FlowType.label(8))
                .tracking(1.25)
                .foregroundStyle(FlowColor.inkMuted)
                .padding(.horizontal, 8)
                .padding(.top, 9)
                .padding(.bottom, 5)
            ForEach(files) { file in
                Button { select(file) } label: {
                    HStack(spacing: 10) {
                        Text(file.status.codexFlowGitBadge)
                            .font(FlowType.mono(10))
                            .foregroundStyle(file.status.codexFlowGitColor)
                            .frame(width: 17)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(URL(fileURLWithPath: file.path).lastPathComponent)
                                .font(FlowType.label(11))
                                .foregroundStyle(FlowColor.ink)
                                .lineLimit(1)
                            let parent = (file.path as NSString).deletingLastPathComponent
                            if !parent.isEmpty {
                                Text(parent)
                                    .font(FlowType.mono(9))
                                    .foregroundStyle(FlowColor.inkMuted)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                        }
                        Spacer(minLength: 3)
                    }
                    .padding(.horizontal, 9)
                    .frame(maxWidth: .infinity, minHeight: 45, alignment: .leading)
                    .background(selectedID == file.id ? FlowColor.signalWash : Color.clear)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(disabled)
            }
        }
    }
}

private struct DiffReader: View {
    let selected: SelectedChangeOverview
    let busy: Bool
    let stageHunk: (ReviewHunkOverview) -> Void
    let unstageHunk: (ReviewHunkOverview) -> Void
    let discardHunk: (ReviewHunkOverview) -> Void
    let addComment: (ReviewHunkOverview, Int, String) -> Void
    let deleteComment: (ReviewCommentOverview) -> Void

    private var lines: [String] { selected.diff.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) }
    private var outdatedComments: [ReviewCommentOverview] { selected.comments.filter { $0.outdated == true } }
    private func hunk(at line: Int) -> ReviewHunkOverview? {
        selected.hunks.first { line >= $0.startLine && line <= $0.endLine }
    }
    private func comments(at line: Int) -> [ReviewCommentOverview] {
        selected.comments.filter { $0.outdated != true && $0.line == line }
    }

    var body: some View {
        GeometryReader { proxy in
            ScrollView([.horizontal, .vertical]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if !outdatedComments.isEmpty {
                        HStack(spacing: 8) {
                            Image(systemName: "clock.badge.exclamationmark").foregroundStyle(FlowColor.warning)
                            Text("\(outdatedComments.count) review note\(outdatedComments.count == 1 ? "" : "s") belong to hunks that changed. Delete them here or refresh the review context.")
                                .font(FlowType.body(10)).foregroundStyle(FlowColor.inkMuted)
                            Spacer()
                            ForEach(outdatedComments) { comment in
                                Button { deleteComment(comment) } label: { Image(systemName: "trash") }
                                    .buttonStyle(.plain).help("Delete outdated note").accessibilityLabel("Delete outdated review note")
                            }
                        }
                        .padding(11).frame(maxWidth: .infinity, alignment: .leading)
                        .background(FlowColor.warning.opacity(0.08))
                    }
                    ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                        if let hunk = selected.hunks.first(where: { $0.startLine == index }) {
                            HunkReviewBar(
                                hunk: hunk, staged: selected.staged, busy: busy,
                                stage: { stageHunk(hunk) }, unstage: { unstageHunk(hunk) }, discard: { discardHunk(hunk) }
                            )
                        }
                        if hunk(at: index)?.startLine != index {
                            HStack(spacing: 0) {
                                Text("\(index + 1)")
                                    .font(FlowType.mono(9)).foregroundStyle(FlowColor.inkMuted.opacity(0.7))
                                    .frame(width: 42, alignment: .trailing).padding(.trailing, 9)
                                Text(line.isEmpty ? " " : line)
                                    .font(FlowType.mono(11))
                                    .foregroundStyle(line.codexFlowDiffForeground)
                                    .padding(.leading, 4)
                                    .frame(maxWidth: .infinity, minHeight: 22, alignment: .leading)
                                    .textSelection(.enabled)
                                if let hunk = hunk(at: index) {
                                    Button { addComment(hunk, index, line) } label: {
                                        Image(systemName: "text.bubble").font(.system(size: 10, weight: .medium)).frame(width: 28, height: 22)
                                    }
                                    .buttonStyle(.plain).foregroundStyle(FlowColor.signal.opacity(0.46)).disabled(busy).help("Add inline review note")
                                    .accessibilityLabel("Add inline review note for diff line \(index + 1)")
                                }
                            }
                            .padding(.horizontal, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(line.codexFlowDiffBackground)
                            ForEach(comments(at: index)) { comment in
                                HStack(alignment: .top, spacing: 9) {
                                    Image(systemName: "text.bubble.fill").font(.system(size: 11)).foregroundStyle(FlowColor.signal)
                                    Text(comment.body).font(FlowType.body(11)).foregroundStyle(FlowColor.ink).textSelection(.enabled)
                                    Spacer()
                                    Button { deleteComment(comment) } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)) }
                                        .buttonStyle(.plain).foregroundStyle(FlowColor.inkMuted).disabled(busy).help("Delete review note")
                                        .accessibilityLabel("Delete inline review note")
                                }
                                .padding(.horizontal, 14).padding(.vertical, 10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(FlowColor.signalWash.opacity(0.72))
                                .overlay(alignment: .leading) { Rectangle().fill(FlowColor.signal).frame(width: 3) }
                            }
                        }
                    }
                }
                .frame(minWidth: proxy.size.width, alignment: .leading)
                .padding(.vertical, 8)
            }
        }
        .background(Color(hex: 0xFBF9F5))
    }
}

private struct HunkReviewBar: View {
    let hunk: ReviewHunkOverview
    let staged: Bool
    let busy: Bool
    let stage: () -> Void
    let unstage: () -> Void
    let discard: () -> Void

    var body: some View {
        HStack(spacing: 9) {
            Text(hunk.header).font(FlowType.mono(10)).foregroundStyle(FlowColor.signal).lineLimit(1)
            Text("+\(hunk.additions) −\(hunk.deletions)").font(FlowType.mono(9)).foregroundStyle(FlowColor.inkMuted)
            Spacer()
            if hunk.actionable {
                if staged {
                    Button("Unstage hunk", action: unstage).buttonStyle(FlowButtonStyle(kind: .secondary))
                } else {
                    Button("Stage hunk", action: stage).buttonStyle(FlowButtonStyle(kind: .primary))
                    Button("Revert hunk", action: discard).buttonStyle(FlowButtonStyle(kind: .danger))
                }
            } else {
                Text("Use file action").font(FlowType.label(8)).tracking(0.8).foregroundStyle(FlowColor.inkMuted)
            }
        }
        .padding(.horizontal, 12).frame(minHeight: 43)
        .background(FlowColor.signalWash.opacity(0.52))
        .overlay(alignment: .bottom) { Rectangle().fill(FlowColor.signal.opacity(0.2)).frame(height: 1) }
        .disabled(busy)
    }
}

private extension String {
    var codexFlowGitBadge: String {
        switch self {
        case "added", "untracked": "A"
        case "deleted": "D"
        case "renamed": "R"
        case "copied": "C"
        default: "M"
        }
    }

    var codexFlowGitColor: Color {
        switch self {
        case "added", "untracked": FlowColor.success
        case "deleted": FlowColor.danger
        case "renamed", "copied": FlowColor.signal
        default: FlowColor.warning
        }
    }

    var codexFlowDiffForeground: Color {
        if hasPrefix("+") && !hasPrefix("+++") { return Color(hex: 0x1F6A4A) }
        if hasPrefix("-") && !hasPrefix("---") { return Color(hex: 0x9E3E3A) }
        if hasPrefix("@@") { return FlowColor.signal }
        if hasPrefix("diff ") || hasPrefix("index ") || hasPrefix("+++") || hasPrefix("---") { return FlowColor.inkMuted }
        return FlowColor.ink
    }

    var codexFlowDiffBackground: Color {
        if hasPrefix("+") && !hasPrefix("+++") { return FlowColor.success.opacity(0.09) }
        if hasPrefix("-") && !hasPrefix("---") { return FlowColor.danger.opacity(0.08) }
        if hasPrefix("@@") { return FlowColor.signalWash.opacity(0.72) }
        return Color.clear
    }
}

struct ChatsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var scope = "all"
    @State private var query = ""
    @State private var renameCandidate: SessionOverview?
    @State private var renameTitle = ""

    private var sessions: [SessionOverview] {
        let all = model.overview?.sessions ?? []
        let scoped: [SessionOverview]
        switch scope {
        case "active": scoped = all.filter { $0.state != "closed" && $0.archived != true }
        case "closed": scoped = all.filter { $0.state == "closed" && $0.archived != true }
        case "archived": scoped = all.filter { $0.archived == true }
        default: scoped = all.filter { $0.archived != true }
        }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return scoped }
        return scoped.filter {
            $0.id.lowercased().contains(needle) ||
            ($0.title?.lowercased().contains(needle) ?? false) ||
            ($0.project?.name.lowercased().contains(needle) ?? false)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 21) {
                HStack(alignment: .bottom) {
                    SectionHeading(eyebrow: "Independent routes", title: "Chats", detail: "A content-free view of the web conversations currently using this broker and the project each one selected.")
                    Spacer()
                    TextField("Search chats", text: $query)
                        .textFieldStyle(.roundedBorder)
                        .font(FlowType.body(12))
                        .frame(width: 190)
                    Picker("Chat scope", selection: $scope) {
                        Text("All").tag("all")
                        Text("Active").tag("active")
                        Text("Closed").tag("closed")
                        Text("Archived").tag("archived")
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 310)
                }

                PrivacyStrip()
                if !model.hasLiveRuntime {
                    OfflineInlineCard(title: "No live broker to observe.", detail: "Start CodexFlow, then activate the plugin in one or more web chats. Each conversation gets its own isolated project route.")
                } else if sessions.isEmpty {
                    PaperCard { EmptyState(symbol: "bubble.left.and.bubble.right", title: scope == "all" ? "No chats routed yet" : "No \(scope) chats", detail: "A chat appears after it selects a project. Discovery and picker connections stay hidden, and conversation text is never stored.") }
                } else {
                    LazyVStack(spacing: 11) {
                        ForEach(sessions) { session in
                            SessionDetailCard(
                                session: session,
                                rename: {
                                    renameTitle = session.title ?? session.project?.name ?? session.id
                                    renameCandidate = session
                                },
                                togglePin: { Task { await model.updateChat(session.id, action: "pin", value: session.pinned != true) } },
                                toggleArchive: { Task { await model.updateChat(session.id, action: "archive", value: session.archived != true) } }
                            )
                        }
                    }
                }
            }
            .padding(.horizontal, 25)
            .padding(.top, 25)
            .padding(.bottom, 42)
            .frame(maxWidth: 1160, alignment: .leading)
        }
        .alert("Rename chat", isPresented: Binding(
            get: { renameCandidate != nil },
            set: { if !$0 { renameCandidate = nil } }
        )) {
            TextField("Chat name", text: $renameTitle)
            Button("Save") {
                guard let chat = renameCandidate else { return }
                let title = renameTitle
                renameCandidate = nil
                Task { await model.updateChat(chat.id, action: "rename", title: title) }
            }
            Button("Cancel", role: .cancel) { renameCandidate = nil }
        } message: {
            Text("This local label is stored by CodexFlow; conversation text is not.")
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
    let rename: () -> Void
    let togglePin: () -> Void
    let toggleArchive: () -> Void
    var body: some View {
        PaperCard(padding: 18) {
            HStack(spacing: 16) {
                ZStack {
                    Circle().fill(session.state == "closed" ? FlowColor.paperMuted : FlowColor.signalWash).frame(width: 46, height: 46)
                    Image(systemName: "bubble.left.fill").foregroundStyle(session.state == "closed" ? FlowColor.inkMuted : FlowColor.signal)
                }
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text(session.title ?? session.id).font(FlowType.title(13)).foregroundStyle(FlowColor.ink)
                        if session.pinned == true { Image(systemName: "pin.fill").font(.system(size: 10)).foregroundStyle(FlowColor.signal) }
                        StatusPill(label: session.project == nil && session.state != "closed" ? "Choosing project" : session.state.codexFlowTitle, color: session.state == "closed" ? FlowColor.inkMuted : session.project == nil ? FlowColor.warning : FlowColor.success)
                    }
                    Text([session.project?.name ?? "Project not selected yet", session.title == nil ? nil : session.id].compactMap { $0 }.joined(separator: " · "))
                        .font(FlowType.label(11)).foregroundStyle(session.project == nil ? FlowColor.warning : FlowColor.inkMuted)
                }
                Spacer()
                InfoPair(label: "LAST SEEN", value: Format.relative(session.lastSeenAt))
                InfoPair(label: "TOOL CALLS", value: "\(session.toolCalls)")
                InfoPair(label: "ERRORS", value: "\(session.errors)", warning: session.errors > 0)
                InfoPair(label: "LAST TOOL", value: session.lastTool?.codexFlowTitle ?? "—")
                Button(action: togglePin) {
                    Image(systemName: session.pinned == true ? "pin.slash" : "pin")
                        .frame(width: 18)
                }
                .buttonStyle(FlowButtonStyle(kind: .quiet))
                .help(session.pinned == true ? "Unpin chat" : "Pin chat")
                Menu {
                    Button("Rename…", action: rename)
                    Button(session.archived == true ? "Restore from archive" : "Archive", action: toggleArchive)
                } label: {
                    Image(systemName: "ellipsis").frame(width: 18)
                }
                .menuStyle(.borderlessButton)
                .frame(width: 38)
            }
        }
    }
}

struct HostsView: View {
    @EnvironmentObject private var model: AppModel

    private var hosts: [RemoteHostOverview] { model.remotes?.hosts ?? [] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 21) {
                HStack(alignment: .bottom) {
                    SectionHeading(
                        eyebrow: "Execution, where the code lives",
                        title: "Hosts",
                        detail: "Approve an SSH host once, save the folders you work in, then choose local and remote projects from the same chat picker."
                    )
                    Spacer()
                    Button {
                        Task { await model.refreshRemotes() }
                    } label: {
                        Label("Rescan", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(FlowButtonStyle(kind: .secondary))
                    .disabled(!model.hasLiveRuntime || model.remoteBusyAlias != nil)
                }

                HStack(spacing: 11) {
                    Image(systemName: "lock.shield").foregroundStyle(FlowColor.success)
                    Text("CodexFlow uses OpenSSH trust exactly as configured on this computer. It never installs or invokes Codex on the remote machine.")
                        .font(FlowType.body(11)).foregroundStyle(FlowColor.inkMuted)
                    Spacer()
                    Text("LOCAL APPROVAL REQUIRED").font(FlowType.label(8)).tracking(1.1).foregroundStyle(FlowColor.success)
                }
                .padding(.horizontal, 15)
                .frame(minHeight: 47)
                .background(FlowColor.success.opacity(0.07))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(FlowColor.success.opacity(0.18), lineWidth: 1))

                if !model.hasLiveRuntime {
                    OfflineInlineCard(title: "Start the local broker to discover hosts.", detail: "SSH discovery and approval happen on the computer running CodexFlow, never through the public endpoint alone.")
                } else if model.remotes == nil {
                    PaperCard { EmptyState(symbol: "server.rack", title: "Host discovery is loading", detail: "Rescan after the broker is ready. Only concrete Host aliases are eligible.") }
                } else if hosts.isEmpty {
                    PaperCard {
                        EmptyState(
                            symbol: "network.slash",
                            title: "No concrete SSH hosts found",
                            detail: "Add a named Host block to ~/.ssh/config and confirm normal SSH access first. Wildcard-only entries are intentionally ignored."
                        )
                    }
                } else {
                    HStack(spacing: 11) {
                        HostMetric(value: model.remotes?.approved ?? 0, label: "APPROVED", tint: FlowColor.success)
                        HostMetric(value: model.remotes?.discovered ?? 0, label: "DISCOVERED", tint: FlowColor.signal)
                        PaperCard(padding: 15) {
                            VStack(alignment: .leading, spacing: 5) {
                                Text("SSH CONFIG").font(FlowType.label(8)).tracking(1).foregroundStyle(FlowColor.inkMuted)
                                Text(model.remotes?.configPath ?? "~/.ssh/config")
                                    .font(FlowType.mono(10)).foregroundStyle(FlowColor.ink).lineLimit(1).truncationMode(.middle)
                            }
                        }
                    }
                    LazyVStack(spacing: 11) {
                        ForEach(hosts) { host in RemoteHostCard(host: host) }
                    }
                }
            }
            .padding(.horizontal, 25)
            .padding(.top, 25)
            .padding(.bottom, 42)
            .frame(maxWidth: 1160, alignment: .leading)
        }
        .task(id: model.selectedRuntimeID) { await model.refreshRemotes() }
    }
}

private struct HostMetric: View {
    let value: Int
    let label: String
    let tint: Color

    var body: some View {
        PaperCard(padding: 15) {
            HStack(spacing: 11) {
                Text("\(value)").font(FlowType.display(27)).foregroundStyle(FlowColor.ink)
                Text(label).font(FlowType.label(8)).tracking(1).foregroundStyle(tint)
            }
        }
        .frame(width: 160)
    }
}

private struct RemoteHostCard: View {
    @EnvironmentObject private var model: AppModel
    let host: RemoteHostOverview
    @State private var projectPath = ""

    private var busy: Bool { model.remoteBusyAlias != nil }
    private var projects: [RemoteProjectOverview] {
        (model.remotes?.projects ?? []).filter { $0.hostAlias == host.alias }
    }
    private var statusColor: Color {
        switch host.status {
        case "approved": FlowColor.success
        case "config_changed": FlowColor.warning
        case "unresolved": FlowColor.danger
        default: FlowColor.signal
        }
    }

    var body: some View {
        PaperCard(padding: 17) {
            VStack(alignment: .leading, spacing: 15) {
                HStack(spacing: 15) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12).fill(statusColor.opacity(0.1))
                        Image(systemName: host.approved ? "server.rack" : "network")
                            .font(.system(size: 19, weight: .medium)).foregroundStyle(statusColor)
                    }
                    .frame(width: 48, height: 48)

                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 8) {
                            Text(host.alias).font(FlowType.title(14)).foregroundStyle(FlowColor.ink)
                            HStack(spacing: 5) {
                                StateDot(color: statusColor)
                                Text(host.status.replacingOccurrences(of: "_", with: " ").uppercased())
                            }
                            .font(FlowType.label(8)).tracking(0.8).foregroundStyle(statusColor)
                            .padding(.horizontal, 7).frame(minHeight: 21).background(statusColor.opacity(0.09)).clipShape(Capsule())
                        }
                        Text(host.hostname.isEmpty ? "OpenSSH could not resolve this alias" : "\(host.user)@\(host.hostname):\(String(host.port))")
                            .font(FlowType.mono(10)).foregroundStyle(FlowColor.inkMuted).lineLimit(1)
                    }

                    Spacer()

                    if host.approved {
                        InfoPair(label: "PROJECTS", value: String(host.projectCount))
                        InfoPair(label: "NODE", value: host.hasNode == true ? "Ready" : "Missing")
                        InfoPair(label: "GIT", value: host.hasGit == true ? "Ready" : "Missing")
                        Button("Disconnect") {
                            Task { await model.mutateRemote(alias: host.alias, action: "disconnect") }
                        }
                        .buttonStyle(FlowButtonStyle(kind: .danger))
                        .disabled(busy)
                    } else {
                        Text(host.status == "config_changed" ? "SSH routing changed. Verify again before use." : "Uses your existing SSH key and known-host trust.")
                            .font(FlowType.body(10)).foregroundStyle(FlowColor.inkMuted).frame(maxWidth: 210, alignment: .trailing)
                        Button(model.remoteBusyAlias == host.alias ? "Verifying…" : "Verify host") {
                            Task { await model.mutateRemote(alias: host.alias, action: "verify") }
                        }
                        .buttonStyle(FlowButtonStyle(kind: .primary))
                        .disabled(busy || host.status == "unresolved")
                    }
                }

                if host.approved {
                    Divider().overlay(FlowColor.line)
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("REMOTE PROJECTS").font(FlowType.label(8)).tracking(1).foregroundStyle(FlowColor.inkMuted)
                            Spacer()
                            Text("AVAILABLE IN EVERY CHAT PICKER").font(FlowType.label(8)).tracking(0.8).foregroundStyle(FlowColor.success)
                        }
                        ForEach(projects) { project in
                            HStack(spacing: 10) {
                                Image(systemName: project.available ? "folder.fill" : "exclamationmark.triangle.fill")
                                    .foregroundStyle(project.available ? FlowColor.signal : FlowColor.warning)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(project.name).font(FlowType.body(11)).foregroundStyle(FlowColor.ink)
                                    Text(project.root).font(FlowType.mono(9)).foregroundStyle(FlowColor.inkMuted).lineLimit(1).truncationMode(.middle)
                                }
                                Spacer()
                                Button {
                                    Task { await model.removeRemoteProject(project) }
                                } label: {
                                    Image(systemName: "xmark")
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(FlowColor.inkMuted)
                                .disabled(busy)
                            }
                            .padding(.horizontal, 12).frame(minHeight: 45)
                            .background(FlowColor.paperMuted.opacity(0.55)).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        HStack(spacing: 9) {
                            TextField(
                                "",
                                text: $projectPath,
                                prompt: Text("Remote folder, for example ~/src/product").foregroundStyle(FlowColor.inkMuted.opacity(0.72))
                            )
                                .textFieldStyle(.plain)
                                .font(FlowType.mono(10))
                                .foregroundStyle(FlowColor.ink)
                                .tint(FlowColor.signal)
                                .padding(.horizontal, 12).frame(height: 38)
                                .background(FlowColor.paperMuted.opacity(0.55)).clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                            Button(model.remoteBusyAlias == host.alias ? "Saving…" : "Add project") {
                                let root = projectPath
                                Task {
                                    await model.saveRemoteProject(alias: host.alias, root: root)
                                    if model.remoteBusyAlias == nil { projectPath = "" }
                                }
                            }
                            .buttonStyle(FlowButtonStyle(kind: .primary))
                            .disabled(busy || host.hasNode != true || projectPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                }
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
