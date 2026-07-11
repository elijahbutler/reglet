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
      case .rules: RulesManagerView()
      case .mcp: InventoryManagerView(kind: .mcp)
      case .sync: SyncManagerView()
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

  private var overview: SkillsOverviewResponse? { model.skillsOverview }

  var body: some View {
    VStack(spacing: 0) {
      List {
        Section("Unified (shared)") {
          if (overview?.shared ?? []).isEmpty {
            Text("No shared skills yet.").foregroundStyle(.secondary)
          } else {
            ForEach(overview?.shared ?? []) { skill in
              VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                  Text(skill.name)
                  ForEach(skill.shadowedBy, id: \.self) { provider in
                    SkillBadge(text: "shadowed by \(model.providerDisplayName(provider))", tint: .orange)
                  }
                }
                Text(skill.path)
                  .font(.system(.caption, design: .monospaced))
                  .foregroundStyle(.secondary)
                  .textSelection(.enabled)
              }
              .padding(.vertical, 2)
            }
          }
        }

        Section("Provider-scoped") {
          if (overview?.providerScoped ?? []).isEmpty {
            Text("No provider-scoped skills.").foregroundStyle(.secondary)
          } else {
            ForEach(overview?.providerScoped ?? []) { skill in
              VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                  Text(skill.name)
                  Text(model.providerDisplayName(skill.provider))
                    .font(.caption).foregroundStyle(.secondary)
                  if skill.shadowsShared {
                    SkillBadge(text: "shadows shared", tint: .orange)
                  }
                }
                Text(skill.path)
                  .font(.system(.caption, design: .monospaced))
                  .foregroundStyle(.secondary)
                  .textSelection(.enabled)
              }
              .padding(.vertical, 2)
            }
          }
        }

        Section("Provider-local (unmanaged)") {
          if model.unmanagedSkills.isEmpty {
            Text("No local skills to review. Provider-local skills stay untouched until adopted.")
              .foregroundStyle(.secondary)
          } else {
            UnmanagedSkillsGroups(skills: model.unmanagedSkills)
          }
        }
      }
      .overlay {
        if overview == nil && !model.isWorking {
          ContentUnavailableView("Skills unavailable", systemImage: "hammer", description: Text("Refresh to scan this Mac."))
        }
      }

      Divider()
      HStack {
        Text("Adoption applies skills to every enrolled provider.")
          .font(.caption).foregroundStyle(.secondary)
        Spacer()
        Button {
          Task { await model.adoptSelectedSkills() }
        } label: {
          Label("Adopt Selected", systemImage: "square.and.arrow.down")
        }
        .buttonStyle(.borderedProminent)
        .disabled(model.checkedSkills.isEmpty || model.isWorking)
      }
      .padding(16)
      .background(.regularMaterial)
    }
  }
}

struct SkillBadge: View {
  let text: String
  let tint: Color

  var body: some View {
    Text(text)
      .font(.caption2)
      .padding(.horizontal, 6)
      .padding(.vertical, 2)
      .background(tint.opacity(0.18), in: Capsule())
      .foregroundStyle(tint)
  }
}

/// Reusable grouped checkbox/scope-picker rows for unmanaged skills.
/// Emits a per-provider header (with select-all) followed by one row per skill.
/// Used by both the onboarding Skills step and the Skills manager.
struct UnmanagedSkillsGroups: View {
  @EnvironmentObject private var model: SetupModel
  let skills: [UnmanagedSkill]

  private var byProvider: [(provider: String, skills: [UnmanagedSkill])] {
    Dictionary(grouping: skills, by: \.provider)
      .map { (provider: $0.key, skills: $0.value.sorted { $0.name < $1.name }) }
      .sorted { $0.provider < $1.provider }
  }

  var body: some View {
    ForEach(byProvider, id: \.provider) { group in
      HStack {
        Text(model.providerDisplayName(group.provider))
          .font(.subheadline.weight(.semibold))
        Spacer()
        Button(allSelected(group.skills) ? "Deselect All" : "Select All") {
          toggleAll(group.skills)
        }
        .buttonStyle(.link)
        .disabled(selectable(in: group.skills).isEmpty)
      }
      ForEach(group.skills) { skill in
        SkillSelectionRow(skill: skill)
      }
    }
  }

  private func selectable(in skills: [UnmanagedSkill]) -> [UnmanagedSkill] {
    skills.filter(model.canAdopt)
  }

  private func allSelected(_ skills: [UnmanagedSkill]) -> Bool {
    let candidates = selectable(in: skills)
    return !candidates.isEmpty && candidates.allSatisfy { model.checkedSkills.contains($0.id) }
  }

  private func toggleAll(_ skills: [UnmanagedSkill]) {
    let candidates = selectable(in: skills)
    if allSelected(skills) {
      for skill in candidates { model.checkedSkills.remove(skill.id) }
    } else {
      for skill in candidates { model.checkedSkills.insert(skill.id) }
    }
  }
}

struct SkillSelectionRow: View {
  @EnvironmentObject private var model: SetupModel
  let skill: UnmanagedSkill

  private var scope: SkillAdoptionScope { model.skillScope(skill.id) }
  private var overwrite: Bool { model.overwriteFlags.contains(skill.id) }
  private var conflicts: Bool {
    let field = scope == .shared ? skill.sharedConflict : skill.providerConflict
    return field == "destination-exists"
  }

  var body: some View {
    HStack(spacing: 12) {
      Toggle(isOn: checkedBinding) {
        VStack(alignment: .leading, spacing: 2) {
          Text(skill.name)
          Text(scope == .shared ? skill.sharedDestination : skill.providerDestination)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(.secondary)
        }
      }
      .toggleStyle(.checkbox)
      .disabled(conflicts && !overwrite)

      Spacer()

      Picker("Scope", selection: scopeBinding) {
        Text("Share with all").tag(SkillAdoptionScope.shared)
        Text("This provider only").tag(SkillAdoptionScope.provider)
      }
      .labelsHidden()
      .frame(width: 190)

      if conflicts {
        Image(systemName: "exclamationmark.triangle.fill")
          .foregroundStyle(.orange)
          .accessibilityLabel("Destination already exists")
        Toggle("Overwrite", isOn: overwriteBinding)
          .toggleStyle(.checkbox)
      }
    }
    .padding(.vertical, 2)
  }

  private var checkedBinding: Binding<Bool> {
    Binding(
      get: { model.checkedSkills.contains(skill.id) },
      set: { on in
        if on {
          model.checkedSkills.insert(skill.id)
        } else {
          model.checkedSkills.remove(skill.id)
        }
      }
    )
  }

  private var scopeBinding: Binding<SkillAdoptionScope> {
    Binding(
      get: { model.skillScope(skill.id) },
      set: { newScope in
        model.skillScopes[skill.id] = newScope
        // A checked row must not silently point at a conflicting destination.
        if !model.canAdopt(skill) {
          model.checkedSkills.remove(skill.id)
        }
      }
    )
  }

  private var overwriteBinding: Binding<Bool> {
    Binding(
      get: { model.overwriteFlags.contains(skill.id) },
      set: { on in
        if on {
          model.overwriteFlags.insert(skill.id)
        } else {
          model.overwriteFlags.remove(skill.id)
          if conflicts { model.checkedSkills.remove(skill.id) }
        }
      }
    )
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

struct RulesManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var selectedPath: String?
  @State private var content = ""
  @State private var savedContent = ""
  @State private var applyPreview: String?

  private var hasUnsavedChanges: Bool { content != savedContent }

  var body: some View {
    HSplitView {
      List(model.ruleDocuments, selection: $selectedPath) { document in
        Label(document.path, systemImage: "doc.text")
          .tag(document.path)
      }
      .frame(minWidth: 190, idealWidth: 230)

      VStack(spacing: 0) {
        if let selectedPath {
          TextEditor(text: $content)
            .font(.system(.body, design: .monospaced))
            .scrollContentBackground(.hidden)
            .padding(12)
            .accessibilityLabel("Rule document editor")
          Divider()
          HStack {
            Text(hasUnsavedChanges ? "Unsaved changes" : "Saved to master")
              .font(.caption)
              .foregroundStyle(hasUnsavedChanges ? Color.orange : Color.secondary)
            Spacer()
            Button("Save") {
              Task {
                if await model.saveRule(path: selectedPath, content: content) {
                  savedContent = content
                }
              }
            }
            .disabled(!hasUnsavedChanges || model.isWorking)
            Button("Preview Apply…") {
              Task { applyPreview = await model.previewRulesApply() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(hasUnsavedChanges || model.isWorking)
          }
          .padding(12)
          .background(.regularMaterial)
        } else {
          ContentUnavailableView("Select a rule document", systemImage: "doc.text", description: Text("Edits are saved to the master first, then applied explicitly."))
        }
      }
      .frame(minWidth: 440)
    }
    .onChange(of: selectedPath) { _, newPath in
      guard let newPath else { return }
      Task {
        if let loaded = await model.loadRule(path: newPath) {
          content = loaded
          savedContent = loaded
        }
      }
    }
    .task {
      if selectedPath == nil, let first = model.ruleDocuments.first?.path {
        selectedPath = first
      }
    }
    .onChange(of: model.ruleDocuments.map(\.path)) { _, paths in
      if selectedPath == nil {
        selectedPath = paths.first
      }
    }
    .sheet(isPresented: Binding(
      get: { applyPreview != nil },
      set: { if !$0 { applyPreview = nil } }
    )) {
      VStack(alignment: .leading, spacing: 16) {
        Text("Preview Rules Apply").font(.title2.weight(.semibold))
        Text("These provider writes will be performed. Existing files are backed up according to the normal Reglet apply policy.")
          .foregroundStyle(.secondary)
        ScrollView {
          Text(applyPreview ?? "")
            .font(.system(.body, design: .monospaced))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
        HStack {
          Spacer()
          Button("Cancel") { applyPreview = nil }
          Button("Apply to Providers") {
            applyPreview = nil
            Task { _ = await model.applyRules() }
          }
          .buttonStyle(.borderedProminent)
        }
      }
      .padding(24)
      .frame(minWidth: 680, minHeight: 480)
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

struct ActivityDriftManagerView: View {
  @EnvironmentObject private var model: SetupModel

  private var drift: [DriftRecord] { model.status?.drift ?? [] }
  private var drifted: [DriftRecord] { drift.filter { $0.status != "clean" } }
  private var clean: [DriftRecord] { drift.filter { $0.status == "clean" } }

  var body: some View {
    List {
      if !drifted.isEmpty {
        Section("Needs attention") {
          ForEach(drifted) { record in
            DriftRow(record: record)
          }
        }
      }

      Section("Managed and clean") {
        if clean.isEmpty {
          Text("No managed files yet. Run setup to enroll providers.")
            .foregroundStyle(.secondary)
        } else {
          ForEach(clean) { record in
            VStack(alignment: .leading, spacing: 3) {
              HStack(spacing: 8) {
                Text(model.providerDisplayName(record.provider))
                SkillBadge(text: record.content, tint: .secondary)
              }
              Text(record.outputPath)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            }
            .padding(.vertical, 2)
          }
        }
      }
    }
    .overlay {
      if model.status == nil && !model.isWorking {
        ContentUnavailableView("Drift status unavailable", systemImage: "waveform.path.ecg", description: Text("Refresh to check managed files."))
      } else if model.status != nil && drift.isEmpty && !model.isWorking {
        ContentUnavailableView("Nothing is managed yet", systemImage: "waveform.path.ecg", description: Text("Enroll providers to start tracking managed files."))
      }
    }
    .safeAreaInset(edge: .bottom) {
      if let status = model.status, !drift.isEmpty {
        HStack {
          Image(systemName: status.driftedCount == 0 ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
            .foregroundStyle(status.driftedCount == 0 ? Color.green : Color.orange)
          Text(status.driftedCount == 0
            ? "All \(drift.count) managed files match the master."
            : "\(status.driftedCount) of \(drift.count) managed files changed outside Reglet.")
          Spacer()
        }
        .font(.callout)
        .padding()
        .background(.regularMaterial)
      }
    }
  }
}

struct DriftRow: View {
  @EnvironmentObject private var model: SetupModel
  let record: DriftRecord

  private var isMissing: Bool { record.status == "missing" }

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 8) {
          Text(model.providerDisplayName(record.provider))
          SkillBadge(text: record.content, tint: .secondary)
          SkillBadge(text: isMissing ? "deleted" : "edited", tint: .orange)
        }
        Text(record.outputPath)
          .font(.system(.caption, design: .monospaced))
          .foregroundStyle(.secondary)
          .textSelection(.enabled)
        Text(isMissing
          ? "The managed file was removed. Re-apply recreates it from the master."
          : "Import keeps the edits in the master; Re-apply overwrites them.")
          .font(.caption)
          .foregroundStyle(.tertiary)
      }
      Spacer()
      Button {
        Task { await model.importDrifted(provider: record.provider, content: record.content) }
      } label: {
        Label("Import to Master", systemImage: "square.and.arrow.down")
      }
      .disabled(isMissing || model.isWorking)
      .help("Copy the provider's edits back into the master directory")
      Button {
        Task { await model.reapply(provider: record.provider, content: record.content) }
      } label: {
        Label("Re-apply", systemImage: "arrow.clockwise.circle")
      }
      .disabled(model.isWorking)
      .help("Overwrite the provider file from the master")
    }
    .padding(.vertical, 4)
  }
}

struct SyncManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var serverUrl = ""
  @State private var token = ""
  @State private var deviceName = ""
  @State private var isEditingConnection = false

  private var syncInfo: StatusResponse.SyncInfo? { model.status?.sync }
  private var showsForm: Bool { !(syncInfo?.configured ?? false) || isEditingConnection }

  var body: some View {
    Form {
      if showsForm {
        Section("Self-hosted sync server") {
          TextField("Server URL", text: $serverUrl, prompt: Text("https://sync.example.com"))
            .textContentType(.URL)
            .autocorrectionDisabled()
          SecureField("Server token", text: $token)
          TextField("Device name", text: $deviceName, prompt: Text("this-mac"))
          HStack {
            if isEditingConnection {
              Button("Cancel") { isEditingConnection = false }
            }
            Spacer()
            Button("Connect") {
              Task {
                if await model.configureSync(
                  url: serverUrl,
                  token: token,
                  device: deviceName.isEmpty ? "device" : deviceName
                ) {
                  token = ""
                  isEditingConnection = false
                  await model.runSync()
                }
              }
            }
            .buttonStyle(.borderedProminent)
            .disabled(serverUrl.isEmpty || token.isEmpty || model.isWorking)
          }
        }
        Section {
          Text("Sync runs only when you start it. No background sync is enabled here, and the token is stored locally in ~/.reglet/.state.")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      } else if let syncInfo {
        Section("Connection") {
          LabeledContent("Server", value: syncInfo.serverUrl)
          LabeledContent("Device", value: syncInfo.deviceName)
          HStack {
            Button("Change Connection…") {
              serverUrl = syncInfo.serverUrl
              deviceName = syncInfo.deviceName
              isEditingConnection = true
            }
            Spacer()
            Button {
              Task { await model.runSync() }
            } label: {
              Label("Sync Now", systemImage: "arrow.triangle.2.circlepath")
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.isWorking)
          }
        }

        Section("Last sync") {
          if let error = model.lastSyncError {
            Label {
              Text(error).textSelection(.enabled)
            } icon: {
              Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
            }
          } else if let result = model.lastSyncResult {
            LabeledContent("Pulled", value: "\(result.pulled.count)")
            LabeledContent("Pushed", value: "\(result.pushed.count)")
            LabeledContent("Deleted", value: "\(result.deleted.count)")
            if result.conflicts.isEmpty {
              LabeledContent("Conflicts", value: "0")
            } else {
              VStack(alignment: .leading, spacing: 4) {
                Label("\(result.conflicts.count) conflict\(result.conflicts.count == 1 ? "" : "s") saved as conflict copies", systemImage: "exclamationmark.triangle.fill")
                  .foregroundStyle(.orange)
                ForEach(result.conflicts, id: \.self) { conflict in
                  Text(conflict)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                }
              }
            }
          } else {
            Text("No sync has run in this session.")
              .foregroundStyle(.secondary)
          }
        }
      }
    }
    .formStyle(.grouped)
    .overlay {
      if model.status == nil && !model.isWorking {
        ContentUnavailableView("Sync status unavailable", systemImage: "arrow.triangle.2.circlepath", description: Text("Refresh to load sync configuration."))
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

struct OnboardingView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var step = 0

  private var showsSkillsStep: Bool {
    !model.selectedProviderUnmanagedSkills.isEmpty
  }

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
              step = showsSkillsStep ? 2 : 3
            }
          }
        case 2:
          SkillsStepView(
            back: { step = 1 },
            continueAction: { step = 3 }
          )
        case 3:
          PreviewView(
            back: { step = showsSkillsStep ? 2 : 1 },
            apply: {
              Task {
                guard await model.applySelection() else { return }
                if !model.checkedSkills.isEmpty {
                  await model.adoptSelectedSkills(limitedTo: model.selectedProviders)
                }
                step = 4
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

  private let steps = ["Safety", "Choose", "Skills", "Preview", "Done"]

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
          model.clearSkillSelections(provider: provider)
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

struct SkillsStepView: View {
  @EnvironmentObject private var model: SetupModel
  let back: () -> Void
  let continueAction: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      List {
        Section {
          UnmanagedSkillsGroups(skills: model.selectedProviderUnmanagedSkills)
        } header: {
          Text("Adopt provider-local skills into your unified library")
        } footer: {
          Text("Unchecked skills stay local and untouched. Adoption runs after you confirm on the next step.")
        }
      }
      .listStyle(.inset)
      Divider()
      HStack {
        Button("Back", action: back)
        Spacer()
        Button {
          continueAction()
        } label: {
          Label("Preview Files", systemImage: "doc.text.magnifyingglass")
        }
        .buttonStyle(.borderedProminent)
        .disabled(model.isWorking)
      }
      .padding(20)
      .background(.regularMaterial)
    }
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
