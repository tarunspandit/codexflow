import SwiftUI

@main
struct CodexFlowDesktopApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        Window("CodexFlow", id: "main") {
            RootView()
                .environmentObject(model)
                .frame(minWidth: 960, minHeight: 660)
                .task { await model.start() }
                .onOpenURL { model.handle(url: $0) }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1240, height: 790)
        .commands {
            CommandMenu("CodexFlow") {
                Button("Now") { model.section = .now }.keyboardShortcut("1", modifiers: .command)
                Button("Projects") { model.section = .projects }.keyboardShortcut("2", modifiers: .command)
                Button("Environments") { model.section = .environments }.keyboardShortcut("3", modifiers: .command)
                Button("Worktrees") { model.section = .worktrees }.keyboardShortcut("4", modifiers: .command)
                Button("Changes") { model.section = .changes }.keyboardShortcut("5", modifiers: .command)
                Button("Tasks") { model.section = .chats }.keyboardShortcut("6", modifiers: .command)
                Button("Hosts") { model.section = .hosts }.keyboardShortcut("7", modifiers: .command)
                Button("Computer") { model.section = .computer }.keyboardShortcut("8", modifiers: .command)
                Button("Browser") { model.section = .browser }.keyboardShortcut("9", modifiers: .command)
                Button("Connection") { model.section = .connection }.keyboardShortcut("0", modifiers: .command)
                Button("Policy") { model.section = .policy }
                Divider()
                Button("Refresh") { Task { await model.refresh() } }.keyboardShortcut("r", modifiers: .command)
                Button("Start Broker") { model.startBroker() }.keyboardShortcut("s", modifiers: [.command, .shift])
                Button("Copy Server URL") { model.copyServerURL() }.keyboardShortcut("c", modifiers: [.command, .shift])
            }
        }
    }
}
