import SwiftUI

@main
struct RegletSetupApp: App {
  @StateObject private var model = SetupModel()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(model)
        .frame(minWidth: 880, minHeight: 620)
        .task {
          model.load()
        }
    }
    .windowStyle(.titleBar)
    .windowToolbarStyle(.unified)
    .commands {
      CommandGroup(after: .appInfo) {
        Button("Check for Updates...") {
          Task { await model.checkForUpdates() }
        }
        .disabled(model.isCheckingForUpdates)

        Toggle("Automatically check for updates", isOn: Binding(
          get: { model.automaticUpdateChecks },
          set: { model.setAutomaticUpdateChecks($0) }
        ))
      }
    }
  }
}

struct ContentView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var selection: ManagerSection? = .providers
  @State private var showsOnboarding = false

  var body: some View {
    NavigationSplitView {
      List(ManagerSection.allCases, selection: $selection) { section in
        Label(section.title, systemImage: section.symbol)
          .tag(section)
      }
      .navigationTitle("Reglet")
      .safeAreaInset(edge: .bottom) {
        Button {
          showsOnboarding = true
        } label: {
          Label("Set Up Providers", systemImage: "plus.circle")
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .padding()
      }
    } detail: {
      ManagerDetail(section: selection ?? .providers, showsOnboarding: $showsOnboarding)
    }
    .sheet(isPresented: $showsOnboarding) {
      OnboardingView()
        .environmentObject(model)
        .frame(minWidth: 880, minHeight: 620)
    }
    .overlay(alignment: .bottom) {
      if model.isWorking {
        ProgressView()
          .controlSize(.small)
          .padding(12)
          .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
          .padding()
      }
    }
    .alert("Reglet command failed", isPresented: Binding(
      get: { model.errorMessage != nil },
      set: { if !$0 { model.errorMessage = nil } }
    )) {
      Button("OK") { model.errorMessage = nil }
    } message: {
      Text(model.errorMessage ?? "")
    }
    .alert("Update Available", isPresented: Binding(
      get: { model.update != nil },
      set: { if !$0 { model.dismissUpdate() } }
    )) {
      Button("Open Release") {
        model.openLatestRelease()
      }
      Button("Not Now", role: .cancel) {
        model.dismissUpdate()
      }
    } message: {
      Text("Reglet \(model.update?.version ?? "") is available.")
    }
    .alert("Reglet Updates", isPresented: Binding(
      get: { model.updateMessage != nil },
      set: { if !$0 { model.updateMessage = nil } }
    )) {
      Button("OK") { model.updateMessage = nil }
    } message: {
      Text(model.updateMessage ?? "")
    }
  }
}

enum ManagerSection: String, CaseIterable, Identifiable {
  case providers, rules, skills, mcp, activity, recovery

  var id: String { rawValue }
  var title: String {
    switch self {
    case .providers: "Providers"
    case .rules: "Rules"
    case .skills: "Skills"
    case .mcp: "MCP"
    case .activity: "Activity & Drift"
    case .recovery: "Recovery"
    }
  }
  var symbol: String {
    switch self {
    case .providers: "macwindow.on.rectangle"
    case .rules: "doc.text"
    case .skills: "hammer"
    case .mcp: "server.rack"
    case .activity: "waveform.path.ecg"
    case .recovery: "clock.arrow.circlepath"
    }
  }
}

struct ManagerDetail: View {
  @EnvironmentObject private var model: SetupModel
  let section: ManagerSection
  @Binding var showsOnboarding: Bool

  var body: some View {
    Group {
      switch section {
      case .providers: ProvidersManagerView(showsOnboarding: $showsOnboarding)
      case .skills: SkillsManagerView()
      case .recovery: RecoveryManagerView()
      case .rules: RulesManagerView()
      case .mcp: McpManagerView()
      case .activity: ActivityDriftManagerView()
      }
    }
    .navigationTitle(section.title)
    .toolbar {
      ToolbarItem {
        Button {
          Task { await model.refreshScan() }
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .keyboardShortcut("r", modifiers: .command)
        .disabled(model.isWorking)
      }
    }
  }
}

struct EmptyManagerView: View {
  let title: String
  let symbol: String
  let message: String
  var body: some View {
    ContentUnavailableView(title, systemImage: symbol, description: Text(message))
  }
}
