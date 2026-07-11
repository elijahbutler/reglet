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
  }
}

enum ManagerSection: String, CaseIterable, Identifiable {
  case providers, rules, skills, mcp, sync, activity, recovery

  var id: String { rawValue }
  var title: String {
    switch self {
    case .providers: "Providers"
    case .rules: "Rules"
    case .skills: "Skills"
    case .mcp: "MCP"
    case .sync: "Sync"
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
    case .sync: "arrow.triangle.2.circlepath"
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
      case .rules: InventoryManagerView(kind: .rules)
      case .mcp: InventoryManagerView(kind: .mcp)
      case .sync: EmptyManagerView(title: "Sync", symbol: section.symbol, message: "Not configured")
      case .activity: EmptyManagerView(title: "Activity & Drift", symbol: section.symbol, message: "No pending activity")
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
        .disabled(model.isWorking)
      }
    }
  }
}

struct ProvidersManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @Binding var showsOnboarding: Bool

  var body: some View {
    List {
      Section("Installed Providers") {
        ForEach(model.scan?.providers ?? []) { provider in
          HStack(spacing: 12) {
            Image(systemName: provider.detected ? "checkmark.circle.fill" : "circle.dashed")
              .foregroundStyle(provider.detected ? Color.green : Color.secondary)
              .accessibilityLabel(provider.detected ? "Detected" : "Not detected")
            VStack(alignment: .leading, spacing: 3) {
              Text(provider.displayName)
              Text(provider.enabled ? "Managed" : (provider.detected ? "Available" : "Not installed"))
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            if provider.enabled {
              Text([provider.contents.rules ? "Rules" : nil, provider.contents.skills ? "Skills" : nil, provider.contents.mcp ? "MCP" : nil].compactMap { $0 }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(.secondary)
            }
          }
          .padding(.vertical, 4)
        }
      }
    }
    .overlay {
      if model.scan == nil && !model.isWorking {
        ContentUnavailableView("Provider status unavailable", systemImage: "macwindow", description: Text("Refresh to scan this Mac."))
      }
    }
    .safeAreaInset(edge: .bottom) {
      HStack {
        Spacer()
        Button {
          showsOnboarding = true
        } label: {
          Label("Configure Providers", systemImage: "slider.horizontal.3")
        }
        .buttonStyle(.borderedProminent)
      }
      .padding()
      .background(.regularMaterial)
    }
  }
}

struct SkillsManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var selectedSkill: UnmanagedSkill?

  var body: some View {
    List {
      Section("Provider-local skills") {
        ForEach(model.unmanagedSkills) { skill in
          Button {
            selectedSkill = skill
          } label: {
            HStack {
              VStack(alignment: .leading, spacing: 3) {
                Text(skill.name).foregroundStyle(.primary)
                Text(skill.provider).font(.caption).foregroundStyle(.secondary)
              }
              Spacer()
              Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .padding(.vertical, 4)
        }
      }
    }
    .overlay {
      if model.unmanagedSkills.isEmpty && !model.isWorking {
        ContentUnavailableView("No local skills to review", systemImage: "checkmark.circle", description: Text("Provider-local skills remain untouched until adopted."))
      }
    }
    .sheet(item: $selectedSkill) { skill in
      SkillAdoptionView(skill: skill)
        .environmentObject(model)
    }
  }
}

struct SkillAdoptionView: View {
  @EnvironmentObject private var model: SetupModel
  @Environment(\.dismiss) private var dismiss
  let skill: UnmanagedSkill

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      Label(skill.name, systemImage: "hammer")
        .font(.title2.weight(.semibold))
      PathSummary(label: "Source", value: skill.sourcePath)
      Divider()
      PathSummary(label: "Shared destination", value: skill.sharedDestination)
      Text(skill.sharedConflict == "none" ? "No conflict" : "Destination already exists")
        .font(.caption).foregroundStyle(skill.sharedConflict == "none" ? Color.secondary : Color.red)
      Text("Affects: \(skill.affectedProviders.isEmpty ? "No enrolled providers" : skill.affectedProviders.joined(separator: ", "))")
        .font(.caption).foregroundStyle(.secondary)
      PathSummary(label: "Provider destination", value: skill.providerDestination)
      Text(skill.providerConflict == "none" ? "No conflict" : "Destination already exists")
        .font(.caption).foregroundStyle(skill.providerConflict == "none" ? Color.secondary : Color.red)
      Spacer()
      HStack {
        Button("Keep Local Only") { dismiss() }
        Spacer()
        Button("This Provider") {
          Task { await model.adoptSkill(skill, scope: .provider); dismiss() }
        }
        .disabled(skill.providerConflict != "none" || model.isWorking)
        Button("Share With All") {
          Task { await model.adoptSkill(skill, scope: .shared); dismiss() }
        }
        .buttonStyle(.borderedProminent)
        .disabled(skill.sharedConflict != "none" || model.isWorking)
      }
    }
    .padding(24)
    .frame(width: 620, height: 480)
  }
}

struct PathSummary: View {
  let label: String
  let value: String
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(label).font(.caption).foregroundStyle(.secondary)
      Text(value).font(.system(.body, design: .monospaced)).textSelection(.enabled)
    }
  }
}

struct InventoryManagerView: View {
  @EnvironmentObject private var model: SetupModel
  let kind: ContentKind
  var body: some View {
    List(model.scan?.providers.filter { $0.enabled } ?? []) { provider in
      VStack(alignment: .leading, spacing: 4) {
        Text(provider.displayName)
        Text(kind == .rules ? (provider.inventory.rulesPath ?? "Unsupported") : (provider.inventory.mcpPath ?? "Unsupported"))
          .font(.system(.caption, design: .monospaced))
          .foregroundStyle(.secondary)
          .textSelection(.enabled)
      }
      .padding(.vertical, 4)
    }
  }
}

struct RecoveryManagerView: View {
  @EnvironmentObject private var model: SetupModel
  var body: some View {
    List(model.scan?.providers.filter { $0.enabled } ?? []) { provider in
      HStack {
        Text(provider.displayName)
        Spacer()
        Button { Task { await model.restore(provider: provider.id) } } label: {
          Label("Restore", systemImage: "clock.arrow.circlepath")
        }
        Button { Task { await model.revert(provider: provider.id) } } label: {
          Label("Revert", systemImage: "arrow.uturn.backward")
        }
      }
      .padding(.vertical, 4)
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

struct OnboardingView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var step = 0

  var body: some View {
    VStack(spacing: 0) {
      HeaderView(step: step)
      Divider()
      Group {
        switch step {
        case 0:
          SafetyView {
            step = 1
          }
        case 1:
          SelectionView {
            Task {
              await model.refreshPlan()
              step = 2
            }
          }
        case 2:
          PreviewView(
            back: { step = 1 },
            apply: {
              Task {
                await model.applySelection()
                step = 3
              }
            }
          )
        default:
          StatusView(startOver: {
            step = 1
          })
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .overlay(alignment: .bottom) {
      if model.isWorking {
        ProgressView()
          .controlSize(.small)
          .padding(12)
      }
    }
    .alert("Reglet command failed", isPresented: Binding(
      get: { model.errorMessage != nil },
      set: { if !$0 { model.errorMessage = nil } }
    )) {
      Button("OK") {
        model.errorMessage = nil
      }
    } message: {
      Text(model.errorMessage ?? "")
    }
  }
}

struct HeaderView: View {
  let step: Int

  private let steps = ["Safety", "Choose", "Preview", "Done"]

  var body: some View {
    HStack(spacing: 16) {
      Image(systemName: "slider.horizontal.3")
        .font(.title2)
        .symbolRenderingMode(.hierarchical)
      VStack(alignment: .leading, spacing: 2) {
        Text("Reglet Setup")
          .font(.headline)
        Text("One source of truth for local agent configuration")
          .foregroundStyle(.secondary)
          .font(.subheadline)
      }
      Spacer()
      Picker("Step", selection: .constant(step)) {
        ForEach(steps.indices, id: \.self) { index in
          Text(steps[index]).tag(index)
        }
      }
      .pickerStyle(.segmented)
      .frame(width: 360)
      .disabled(true)
    }
    .padding(20)
    .background(.regularMaterial)
  }
}

struct SafetyView: View {
  let continueAction: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      Spacer()
      VStack(alignment: .leading, spacing: 10) {
        Text("Set up Reglet without surprises.")
          .font(.system(size: 32, weight: .semibold))
        Text("Reglet will scan local agent configuration, show the exact files involved, and wait for confirmation before writing provider files.")
          .font(.title3)
          .foregroundStyle(.secondary)
          .frame(maxWidth: 680, alignment: .leading)
      }

      VStack(alignment: .leading, spacing: 12) {
        SafetyRow(symbol: "checkmark.shield", title: "No daemon starts during setup")
        SafetyRow(symbol: "arrow.triangle.2.circlepath", title: "No sync is configured unless you enable it later")
        SafetyRow(symbol: "doc.badge.gearshape", title: "Provider writes are previewed before backup and apply")
        SafetyRow(symbol: "clock.arrow.circlepath", title: "Restore and revert remain available after onboarding")
      }

      Button {
        continueAction()
      } label: {
        Label("Continue", systemImage: "arrow.right")
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.large)

      Spacer()
    }
    .padding(40)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct SafetyRow: View {
  let symbol: String
  let title: String

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: symbol)
        .frame(width: 24)
        .foregroundStyle(.tint)
      Text(title)
    }
    .font(.body)
  }
}

struct SelectionView: View {
  @EnvironmentObject private var model: SetupModel
  let continueAction: () -> Void

  var body: some View {
    HSplitView {
      VStack(alignment: .leading, spacing: 12) {
        Label("Providers", systemImage: "macwindow")
          .font(.headline)
        ScrollView {
          VStack(alignment: .leading, spacing: 8) {
            ForEach(model.scan?.providers ?? []) { provider in
              Toggle(isOn: providerBinding(provider.id)) {
                VStack(alignment: .leading, spacing: 2) {
                  Text(provider.displayName)
                  Text(provider.detected ? "Detected" : "Not found")
                    .font(.caption)
                    .foregroundStyle(provider.detected ? .secondary : .tertiary)
                }
              }
              .disabled(!provider.detected)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      .padding(24)
      .frame(minWidth: 320)

      VStack(alignment: .leading, spacing: 18) {
        Label("Content", systemImage: "checklist")
          .font(.headline)
        VStack(alignment: .leading, spacing: 12) {
          ForEach(ContentKind.allCases) { content in
            Toggle(isOn: contentBinding(content)) {
              Text(content.label)
            }
          }
        }
        Spacer()
        HStack {
          Button {
            Task {
              await model.refreshScan()
            }
          } label: {
            Label("Rescan", systemImage: "arrow.clockwise")
          }
          Spacer()
          Button {
            continueAction()
          } label: {
            Label("Preview Files", systemImage: "doc.text.magnifyingglass")
          }
          .buttonStyle(.borderedProminent)
          .disabled(!model.canContinue)
        }
      }
      .padding(24)
      .frame(minWidth: 420)
    }
  }

  private func providerBinding(_ provider: String) -> Binding<Bool> {
    Binding(
      get: { model.selectedProviders.contains(provider) },
      set: { isSelected in
        if isSelected {
          model.selectedProviders.insert(provider)
        } else {
          model.selectedProviders.remove(provider)
        }
      }
    )
  }

  private func contentBinding(_ content: ContentKind) -> Binding<Bool> {
    Binding(
      get: { model.selectedContents.contains(content) },
      set: { isSelected in
        if isSelected {
          model.selectedContents.insert(content)
        } else {
          model.selectedContents.remove(content)
        }
      }
    )
  }
}

struct PreviewView: View {
  @EnvironmentObject private var model: SetupModel
  let back: () -> Void
  let apply: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      FileList(title: "Files Reglet will read", files: model.plan?.reads ?? [])
      Divider()
      FileList(title: "Files Reglet will write after confirmation", files: model.plan?.writes ?? [])
      Divider()
      HStack {
        Button("Back", action: back)
        Spacer()
        Text("Daemon, sync, and notifications remain off.")
          .foregroundStyle(.secondary)
        Button {
          apply()
        } label: {
          Label("Create Backups and Apply", systemImage: "checkmark.circle")
        }
        .buttonStyle(.borderedProminent)
        .disabled(model.isWorking)
      }
      .padding(20)
      .background(.regularMaterial)
    }
  }
}

struct FileList: View {
  let title: String
  let files: [PlannedFile]

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(title)
        .font(.headline)
      if files.isEmpty {
        ContentUnavailableView("No files", systemImage: "doc", description: Text("Nothing is needed for this step."))
      } else {
        List(files) { file in
          VStack(alignment: .leading, spacing: 4) {
            HStack {
              Text(file.provider)
                .font(.caption)
                .foregroundStyle(.secondary)
              Text(file.content)
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Text(file.path)
              .font(.system(.body, design: .monospaced))
              .textSelection(.enabled)
          }
          .padding(.vertical, 4)
        }
        .listStyle(.inset)
      }
    }
    .padding(20)
  }
}

struct StatusView: View {
  @EnvironmentObject private var model: SetupModel
  let startOver: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Label("Setup Complete", systemImage: "checkmark.seal")
        .font(.largeTitle.weight(.semibold))
      Text(model.completionMessage ?? "Reglet finished onboarding.")
        .foregroundStyle(.secondary)
        .textSelection(.enabled)

      List(model.detectedProviders) { provider in
        HStack {
          VStack(alignment: .leading) {
            Text(provider.displayName)
            Text(provider.id)
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          Spacer()
          Button {
            Task {
              await model.restore(provider: provider.id)
            }
          } label: {
            Label("Restore", systemImage: "clock.arrow.circlepath")
          }
          Button {
            Task {
              await model.revert(provider: provider.id)
            }
          } label: {
            Label("Revert", systemImage: "arrow.uturn.backward")
          }
        }
        .padding(.vertical, 4)
      }
      .listStyle(.inset)

      HStack {
        Button("Review Another Selection", action: startOver)
        Spacer()
      }
    }
    .padding(32)
  }
}
