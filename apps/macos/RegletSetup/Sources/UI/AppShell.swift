import SwiftUI

@main
struct RegletSetupApp: App {
  @StateObject private var model = SetupModel()

  init() {
    Theme.FontRegistrar.register()
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(model)
        .frame(minWidth: 880, minHeight: 620)
        .background(Theme.Colors.voidBlack)
        .preferredColorScheme(.dark)
        .environment(\.colorScheme, .dark)
        .tint(Theme.Colors.mist)
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
  @FocusState private var focusedSection: ManagerSection?
  @State private var showsOnboarding = false

  var body: some View {
    NavigationSplitView {
      ManagerSidebar(
        selection: $selection,
        focusedSection: $focusedSection,
        showsOnboarding: $showsOnboarding
      )
    } detail: {
      ManagerDetail(section: selection ?? .providers, showsOnboarding: $showsOnboarding)
    }
    .navigationSplitViewStyle(.balanced)
    .background(Theme.Colors.voidBlack)
    .preferredColorScheme(.dark)
    .environment(\.colorScheme, .dark)
    .tint(Theme.Colors.mist)
    .toolbarBackground(Theme.Colors.voidBlack, for: .windowToolbar)
    .toolbarColorScheme(.dark, for: .windowToolbar)
    .onAppear {
      if selection == nil {
        selection = .providers
      }
      focusedSection = selection ?? .providers
    }
    .sheet(isPresented: $showsOnboarding) {
      OnboardingView()
        .environmentObject(model)
        .frame(minWidth: 880, minHeight: 620)
    }
    .overlay(alignment: .bottom) {
      if model.isWorking {
        HStack(spacing: 10) {
          ProgressView()
            .controlSize(.small)
            .tint(Theme.Colors.mist)

          Text("Working")
            .font(Theme.Fonts.body)
            .foregroundStyle(Theme.Colors.mist)
        }
          .padding(.horizontal, 14)
          .padding(.vertical, 10)
          .cardSurface()
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

private struct ManagerSidebar: View {
  @Environment(\.colorSchemeContrast) private var contrast
  @Binding var selection: ManagerSection?
  var focusedSection: FocusState<ManagerSection?>.Binding
  @Binding var showsOnboarding: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
        HStack(spacing: 10) {
          BrandMark()

          Text("Reglet")
            .font(Theme.Fonts.subheading)
            .foregroundStyle(Theme.Colors.mist)
        }
        .padding(.horizontal, Theme.Spacing.sm)
        .padding(.top, 18)

        ScrollView {
          LazyVStack(alignment: .leading, spacing: 4) {
            ForEach(ManagerSection.allCases) { section in
              ManagerSidebarRow(
                section: section,
                isSelected: activeSelection == section,
                action: {
                  selection = section
                  focusedSection.wrappedValue = section
                }
              )
              .focused(focusedSection, equals: section)
            }
          }
          .padding(.horizontal, 10)
          .padding(.vertical, 2)
        }
        .scrollContentBackground(.hidden)
        .onMoveCommand(perform: moveSelection)
      }

      Spacer(minLength: Theme.Spacing.sm)

      Button {
        showsOnboarding = true
      } label: {
        Label("Set Up Providers", systemImage: "plus.circle")
          .font(Theme.Fonts.body)
          .foregroundStyle(contrast == .increased ? Theme.Colors.mist : Theme.Colors.ash)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .buttonStyle(.regletSecondary)
      .accessibilityHint("Opens provider setup")
      .padding(.horizontal, 10)
      .padding(.bottom, 14)
    }
    .frame(minWidth: 220, idealWidth: 240, maxWidth: 280)
    .background(Theme.Colors.voidBlack)
    .overlay(alignment: .trailing) {
      Rectangle()
        .fill(Theme.Colors.slate.opacity(contrast == .increased ? 0.70 : 0.38))
        .frame(width: 1)
    }
    .navigationTitle("Reglet")
    .toolbarBackground(Theme.Colors.voidBlack, for: .windowToolbar)
  }

  private var activeSelection: ManagerSection {
    selection ?? .providers
  }

  private func moveSelection(_ direction: MoveCommandDirection) {
    let sections = ManagerSection.allCases
    guard let currentIndex = sections.firstIndex(of: activeSelection) else {
      selection = .providers
      focusedSection.wrappedValue = .providers
      return
    }

    let nextIndex: Int
    switch direction {
    case .up:
      nextIndex = max(sections.startIndex, currentIndex - 1)
    case .down:
      nextIndex = min(sections.index(before: sections.endIndex), currentIndex + 1)
    default:
      return
    }

    let nextSection = sections[nextIndex]
    selection = nextSection
    focusedSection.wrappedValue = nextSection
  }
}

private struct BrandMark: View {
  var body: some View {
    ZStack {
      Circle()
        .fill(Theme.Colors.coral)
        .frame(width: 10, height: 10)

      Circle()
        .strokeBorder(Theme.Colors.coral.opacity(0.45), lineWidth: 1)
        .frame(width: 18, height: 18)
    }
    .frame(width: 22, height: 22)
    .accessibilityHidden(true)
  }
}

private struct ManagerSidebarRow: View {
  @Environment(\.colorSchemeContrast) private var contrast
  let section: ManagerSection
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 10) {
        Image(systemName: section.symbol)
          .font(Theme.Fonts.body)
          .foregroundStyle(iconColor)
          .frame(width: 18, height: 18)

        Text(section.title)
          .font(Theme.Fonts.body)
          .foregroundStyle(titleColor)
          .lineLimit(1)

        Spacer(minLength: 0)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
      .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
      .background(selectionBackground)
      .overlay(selectionBorder)
      .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(section.title)
    .accessibilityValue(isSelected ? "Selected" : "")
    .accessibilityAddTraits(.isButton)
    .accessibilityAddTraits(isSelected ? .isSelected : [])
  }

  private var selectionBackground: some View {
    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
      .fill(isSelected ? Theme.Colors.obsidian : Theme.Colors.voidBlack)
  }

  private var selectionBorder: some View {
    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
      .strokeBorder(borderColor, lineWidth: isSelected ? 1 : 0)
  }

  private var borderColor: Color {
    contrast == .increased ? Theme.Colors.mist.opacity(0.42) : Theme.Colors.slate.opacity(0.55)
  }

  private var iconColor: Color {
    if isSelected {
      return contrast == .increased ? Theme.Colors.white : Theme.Colors.mist
    }
    return contrast == .increased ? Theme.Colors.ash : Theme.Colors.smoke
  }

  private var titleColor: Color {
    if isSelected {
      return contrast == .increased ? Theme.Colors.white : Theme.Colors.mist
    }
    return contrast == .increased ? Theme.Colors.mist : Theme.Colors.ash
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
    .background(Theme.Colors.voidBlack)
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
