import AppKit
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 0) {
            NavigationRail()
                .frame(width: 226)
            ZStack(alignment: .topTrailing) {
                FlowColor.paper.ignoresSafeArea()
                VStack(spacing: 0) {
                    AppTopBar()
                    content
                }
                if let notice = model.notice {
                    NoticeToast(message: notice) { model.notice = nil }
                        .padding(.top, 74)
                        .padding(.trailing, 24)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .zIndex(10)
                }
            }
        }
        .background(FlowColor.ground)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.22), value: model.section)
        .sheet(isPresented: $model.showingRuntimePicker) { RuntimePickerView() }
        .sheet(isPresented: $model.showingPolicyEditor) {
            if let profile = model.profile {
                PolicyEditorView(profile: profile)
            } else {
                MissingPolicyView()
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.section {
        case .now: NowView()
        case .projects: ProjectsView()
        case .environments: EnvironmentsView()
        case .worktrees: WorktreesView()
        case .changes: ChangesView()
        case .chats: ChatsView()
        case .connection: ConnectionView()
        case .policy: PolicyView()
        }
    }
}

private struct NavigationRail: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BrandLockup()
                .padding(.top, 31)
                .padding(.horizontal, 21)
                .padding(.bottom, 31)

            Text("WORKSPACE")
                .font(FlowType.label(9))
                .tracking(1.6)
                .foregroundStyle(Color.white.opacity(0.44))
                .padding(.horizontal, 21)
                .padding(.bottom, 9)

            VStack(spacing: 4) {
                ForEach(AppSection.allCases) { section in
                    Button {
                        model.section = section
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: section.symbol)
                                .font(.system(size: 14, weight: .medium))
                                .frame(width: 20)
                            Text(section.title)
                                .font(FlowType.label(13))
                            Spacer()
                            if section == .chats, let summary = model.overview?.summary, summary.activeSessions + summary.pendingSessions > 0 {
                                let count = summary.activeSessions + summary.pendingSessions
                                Text("\(count)")
                                    .font(FlowType.mono(10))
                                    .foregroundStyle(FlowColor.signalBright)
                                    .padding(.horizontal, 7)
                                    .frame(minHeight: 22)
                                    .background(FlowColor.signal.opacity(0.14))
                                    .clipShape(Capsule())
                            }
                        }
                        .foregroundStyle(model.section == section ? Color.white : Color.white.opacity(0.62))
                        .padding(.horizontal, 13)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .background(model.section == section ? Color.white.opacity(0.09) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(alignment: .leading) {
                            if model.section == section {
                                Capsule().fill(FlowColor.signalBright).frame(width: 3, height: 22).offset(x: -1)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(section.title)
                }
            }
            .padding(.horizontal, 8)

            Spacer(minLength: 21)

            VStack(alignment: .leading, spacing: 13) {
                HStack(spacing: 9) {
                    StateDot(color: stateColor, pulse: model.state.isBusy)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.state.title)
                            .font(FlowType.label(11))
                            .foregroundStyle(Color.white.opacity(0.88))
                        Text(model.workspaceName)
                            .font(FlowType.body(11))
                            .foregroundStyle(Color.white.opacity(0.45))
                            .lineLimit(1)
                    }
                }

                Button {
                    model.showingRuntimePicker = true
                } label: {
                    HStack {
                        Image(systemName: "rectangle.stack")
                        Text("Switch workspace")
                        Spacer()
                        Text("\(model.runtimes.filter(\.isAlive).count)")
                            .font(FlowType.mono(10))
                    }
                    .font(FlowType.label(11))
                    .foregroundStyle(Color.white.opacity(0.68))
                    .frame(maxWidth: .infinity, minHeight: 38)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(15)
            .background(Color.white.opacity(0.045))
            .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 13).stroke(FlowColor.lineDark, lineWidth: 1))
            .padding(.horizontal, 13)
            .padding(.bottom, 14)

            HStack(spacing: 7) {
                Image(systemName: "7.circle")
                Text("A Flow7 product")
            }
            .font(FlowType.label(9))
            .tracking(0.5)
            .foregroundStyle(Color.white.opacity(0.32))
            .padding(.horizontal, 21)
            .padding(.bottom, 18)
        }
        .background(
            LinearGradient(colors: [FlowColor.ground, Color(hex: 0x0D1218)], startPoint: .top, endPoint: .bottom)
        )
    }

    private var stateColor: Color {
        switch model.state {
        case .ready: FlowColor.success
        case .starting, .discovering, .stopping: FlowColor.signalBright
        case .degraded: FlowColor.danger
        case .offline: Color.white.opacity(0.38)
        }
    }
}

private struct BrandLockup: View {
    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(FlowColor.signal.opacity(0.12))
                Image(systemName: "point.3.filled.connected.trianglepath.dotted")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(FlowColor.signalBright)
            }
            .frame(width: 37, height: 37)
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(FlowColor.signal.opacity(0.28), lineWidth: 1))
            Text("Codex")
                .font(FlowType.title(17))
                .foregroundStyle(Color.white)
            + Text("Flow")
                .font(FlowType.title(17))
                .foregroundStyle(FlowColor.signalBright)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("CodexFlow")
    }
}

private struct AppTopBar: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(model.workspaceName)
                    .font(FlowType.title(14))
                    .foregroundStyle(FlowColor.ink)
                Text(model.overview?.broker.defaultRoot ?? model.selectedRoot ?? "Choose a project to begin")
                    .font(FlowType.mono(10))
                    .foregroundStyle(FlowColor.inkMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            StatusPill(label: model.state.title, color: stateColor, pulse: model.state.isBusy)

            Button {
                Task { await model.refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 13, weight: .medium))
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(FlowButtonStyle(kind: .secondary))
            .help("Refresh projects and runtime state")
            .accessibilityLabel("Refresh")

            if model.hasLiveRuntime {
                Button("Restart") { model.restartBroker() }
                    .buttonStyle(FlowButtonStyle(kind: .secondary))
                    .disabled(model.isFixture)
                Button("Stop") { model.stopBroker() }
                    .buttonStyle(FlowButtonStyle(kind: .danger))
                    .disabled(model.isFixture)
            } else if model.hasRunningProcess {
                Button("Reconnect") { Task { await model.refresh() } }
                    .buttonStyle(FlowButtonStyle(kind: .primary))
                    .disabled(model.state.isBusy || model.isFixture)
            } else {
                Button("Start CodexFlow") { model.startBroker() }
                    .buttonStyle(FlowButtonStyle(kind: .primary))
                    .disabled(model.state.isBusy || model.isFixture)
            }
        }
        .padding(.leading, 25)
        .padding(.trailing, 23)
        .padding(.top, 24)
        .padding(.bottom, 13)
        .background(FlowColor.paper.opacity(0.97))
        .overlay(alignment: .bottom) { Rectangle().fill(FlowColor.line.opacity(0.66)).frame(height: 1) }
    }

    private var stateColor: Color {
        switch model.state {
        case .ready: FlowColor.success
        case .starting, .discovering, .stopping: FlowColor.signal
        case .degraded: FlowColor.danger
        case .offline: FlowColor.inkMuted
        }
    }
}

private struct NoticeToast: View {
    let message: String
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "info.circle.fill").foregroundStyle(FlowColor.signal)
            Text(message)
                .font(FlowType.body(12))
                .foregroundStyle(FlowColor.ink)
                .lineLimit(3)
            Button(action: dismiss) {
                Image(systemName: "xmark").font(.system(size: 10, weight: .semibold))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
        .padding(.leading, 14)
        .padding(.trailing, 11)
        .frame(minHeight: 48)
        .background(FlowColor.paperBright)
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 13).stroke(FlowColor.signal.opacity(0.28), lineWidth: 1))
        .shadow(color: FlowColor.ground.opacity(0.12), radius: 22, y: 9)
        .frame(maxWidth: 410)
        .accessibilityElement(children: .combine)
    }
}

struct RuntimePickerView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Workspaces").font(FlowType.title(22)).foregroundStyle(FlowColor.ink)
                    Text("Every local CodexFlow broker, in one place.").font(FlowType.body(12)).foregroundStyle(FlowColor.inkMuted)
                }
                Spacer()
                Button("Done") { dismiss() }.buttonStyle(FlowButtonStyle(kind: .quiet))
            }
            .padding(24)
            FlowDivider()

            ScrollView {
                LazyVStack(spacing: 10) {
                    if model.runtimes.isEmpty {
                        EmptyState(symbol: "rectangle.stack.badge.plus", title: "No saved runtimes yet", detail: "Choose a project and start CodexFlow. It will appear here automatically.")
                    }
                    ForEach(model.runtimes) { runtime in
                        HStack(spacing: 14) {
                            StateDot(color: runtime.isAlive ? FlowColor.success : FlowColor.inkMuted)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(runtime.projectName).font(FlowType.title(14)).foregroundStyle(FlowColor.ink)
                                Text(runtime.root).font(FlowType.mono(10)).foregroundStyle(FlowColor.inkMuted).lineLimit(1).truncationMode(.middle)
                            }
                            Spacer()
                            Text(runtime.isAlive ? "LIVE" : "STALE")
                                .font(FlowType.label(9)).tracking(1)
                                .foregroundStyle(runtime.isAlive ? FlowColor.success : FlowColor.inkMuted)
                            if !runtime.isAlive {
                                Button { model.forgetStaleRuntime(runtime) } label: { Image(systemName: "trash") }
                                    .buttonStyle(FlowButtonStyle(kind: .quiet))
                                    .help("Forget stale runtime")
                            }
                            Button("Open") { model.selectRuntime(runtime) }
                                .buttonStyle(FlowButtonStyle(kind: model.selectedRuntimeID == runtime.id ? .primary : .secondary))
                        }
                        .padding(15)
                        .background(FlowColor.paperBright)
                        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 13).stroke(FlowColor.line, lineWidth: 1))
                    }
                }
                .padding(24)
            }
            FlowDivider()
            HStack {
                Button("Choose another project…") {
                    dismiss()
                    model.chooseWorkspace()
                }
                .buttonStyle(FlowButtonStyle(kind: .secondary))
                Spacer()
                Text("Credentials stay on this Mac.").font(FlowType.body(11)).foregroundStyle(FlowColor.inkMuted)
            }
            .padding(18)
        }
        .frame(width: 620, height: 520)
        .background(FlowColor.paper)
    }
}
