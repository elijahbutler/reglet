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

struct ProvidersManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @Binding var showsOnboarding: Bool
  @State private var providerToStop: String?

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
              Button("Stop Managing…", role: .destructive) {
                providerToStop = provider.id
              }
              .disabled(model.isWorking)
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
    .confirmationDialog(
      "Stop managing this provider?",
      isPresented: Binding(
        get: { providerToStop != nil },
        set: { if !$0 { providerToStop = nil } }
      ),
      titleVisibility: .visible
    ) {
      Button("Stop Managing", role: .destructive) {
        if let providerToStop {
          Task { await model.stopManaging(provider: providerToStop) }
        }
        providerToStop = nil
      }
      Button("Cancel", role: .cancel) { providerToStop = nil }
    } message: {
      Text("Reglet preserves the provider's current files, clears ownership, and removes generated rules headers where applicable.")
    }
  }
}

struct SkillsManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var editingSkill: SkillEditorTarget?
  @State private var applyPreview: ApplyReviewScope?
  @State private var showsNewSkill = false
  @State private var searchText = ""
  @State private var confirmsAdoptionOverwrite = false

  private var overview: SkillsOverviewResponse? { model.skillsOverview }
  private var sharedSkills: [SharedSkillSummary] {
    (overview?.shared ?? []).filter { matches($0.name, $0.path) }
  }
  private var providerScopedSkills: [ProviderScopedSkillSummary] {
    (overview?.providerScoped ?? []).filter { matches($0.name, $0.provider, $0.path) }
  }
  private var unmanagedSkills: [UnmanagedSkill] {
    model.unmanagedSkills.filter { matches($0.name, $0.provider, $0.sourcePath) }
  }

  var body: some View {
    VStack(spacing: 0) {
      List {
        Section("Unified (shared)") {
          if sharedSkills.isEmpty {
            Text("No shared skills yet.").foregroundStyle(.secondary)
          } else {
            ForEach(sharedSkills) { skill in
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
                Button("Edit Files…") { editingSkill = SkillEditorTarget(name: skill.name, provider: nil) }
              }
              .padding(.vertical, 2)
            }
          }
        }

        Section("Provider-scoped") {
          if providerScopedSkills.isEmpty {
            Text("No provider-scoped skills.").foregroundStyle(.secondary)
          } else {
            ForEach(providerScopedSkills) { skill in
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
                Button("Edit Files…") { editingSkill = SkillEditorTarget(name: skill.name, provider: skill.provider) }
              }
              .padding(.vertical, 2)
            }
          }
        }

        Section("Provider-local (unmanaged)") {
          if unmanagedSkills.isEmpty {
            Text("No local skills to review. Provider-local skills stay untouched until adopted.")
              .foregroundStyle(.secondary)
          } else {
            UnmanagedSkillsGroups(skills: unmanagedSkills)
          }
        }
      }
      .searchable(text: $searchText, placement: .toolbar, prompt: "Filter skills")
      .overlay {
        if overview == nil && !model.isWorking {
          ContentUnavailableView("Skills unavailable", systemImage: "hammer", description: Text("Refresh to scan this Mac."))
        }
      }

      Divider()
      HStack {
        Text("Adoption saves skills to the master. Review & Apply distributes them.")
          .font(.caption).foregroundStyle(.secondary)
        Spacer()
        Button("New Skill…") { showsNewSkill = true }
        Button("Preview Apply…") {
          Task {
            if let preview = await model.previewApply(content: .skills) {
              applyPreview = ApplyReviewScope(
                preview: preview,
                contents: [.skills],
                providers: [],
                title: "Review Skills Apply"
              )
            }
          }
        }
        .keyboardShortcut(.defaultAction)
          .disabled(model.isWorking)
        Button {
          if model.hasPendingSkillOverwrite() {
            confirmsAdoptionOverwrite = true
          } else {
            Task { await model.adoptSelectedSkills() }
          }
        } label: {
          Label("Adopt Selected to Master", systemImage: "square.and.arrow.down")
        }
        .buttonStyle(.borderedProminent)
        .disabled(model.checkedSkills.isEmpty || model.isWorking)
      }
      .padding(16)
      .background(.regularMaterial)
    }
    .sheet(item: $editingSkill) { target in
      SkillEditorView(target: target).environmentObject(model)
    }
    .sheet(isPresented: $showsNewSkill) {
      NewSkillView().environmentObject(model)
    }
    .sheet(item: $applyPreview) { scope in
      ApplyPreviewView(scope: scope, close: { applyPreview = nil }, applied: {})
        .environmentObject(model)
    }
    .confirmationDialog("Overwrite selected master skills?", isPresented: $confirmsAdoptionOverwrite) {
      Button("Overwrite and Adopt", role: .destructive) {
        Task { await model.adoptSelectedSkills() }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This replaces existing skill files in the master directory. Provider copies will not change until you review and apply Skills.")
    }
  }

  private func matches(_ values: String...) -> Bool {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    return query.isEmpty || values.contains { $0.localizedCaseInsensitiveContains(query) }
  }
}

struct SkillEditorTarget: Identifiable {
  let name: String
  let provider: String?
  var id: String { "\(provider ?? "shared"):\(name)" }
}

struct SkillEditorView: View {
  @EnvironmentObject private var model: SetupModel
  @Environment(\.dismiss) private var dismiss
  let target: SkillEditorTarget
  @State private var tree: ManagedSkillTree?
  @State private var selectedPath: String?
  @State private var content = ""
  @State private var savedContent = ""
  @State private var confirmsDelete = false
  @State private var draftName = ""
  @State private var newFilePath = ""
  @State private var showsNewFile = false
  @State private var confirmsDeleteFile = false
  @State private var renamedFilePath = ""
  @State private var showsRenameFile = false
  @State private var pendingPath: String?
  @State private var resolvesUnsavedSelection = false

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        VStack(alignment: .leading) {
          HStack {
            TextField("Skill name", text: $draftName).font(.title2.weight(.semibold)).frame(width: 260)
            Button("Rename") { Task { if await model.renameSkill(name: target.name, newName: draftName, provider: target.provider) { dismiss() } } }
              .disabled(draftName.isEmpty || draftName == target.name || content != savedContent)
          }
          Text(target.provider.map { "Provider-scoped: \($0)" } ?? "Shared skill").foregroundStyle(.secondary)
        }
        Spacer()
        if tree?.shadowsShared == true { SkillBadge(text: "shadows shared", tint: .orange) }
        Button("Delete Skill", role: .destructive) { confirmsDelete = true }
      }.padding()
      Divider()
      HSplitView {
        VStack(spacing: 0) {
          List(tree?.files ?? [], selection: $selectedPath) { file in
            Label(file.path, systemImage: "doc").tag(file.path)
          }
          Divider()
          HStack {
            Button { newFilePath = ""; showsNewFile = true } label: { Image(systemName: "plus") }
            Button(role: .destructive) { confirmsDeleteFile = true } label: { Image(systemName: "minus") }
              .disabled(selectedPath == nil || selectedPath == "SKILL.md")
            Button { renamedFilePath = selectedPath ?? ""; showsRenameFile = true } label: { Image(systemName: "pencil") }
              .disabled(selectedPath == nil || selectedPath == "SKILL.md")
            Spacer()
          }.padding(8)
        }.frame(minWidth: 210)
        VStack(spacing: 0) {
          if selectedPath != nil {
            TextEditor(text: $content).font(.system(.body, design: .monospaced)).padding(10)
            Divider()
            HStack {
              Text(content == savedContent ? "Saved to master — not applied" : "Unsaved changes")
                .font(.caption).foregroundStyle(content == savedContent ? Color.secondary : Color.orange)
              Spacer()
              Button("Save") { save() }.buttonStyle(.borderedProminent)
                .keyboardShortcut("s", modifiers: .command)
                .disabled(content == savedContent || model.isWorking)
            }.padding()
          } else {
            ContentUnavailableView("Select a skill file", systemImage: "doc")
          }
        }.frame(minWidth: 500)
      }
    }
    .frame(minWidth: 760, minHeight: 520)
    .task { draftName = target.name; tree = await model.loadSkillTree(name: target.name, provider: target.provider); selectedPath = tree?.files.first?.path }
    .onChange(of: selectedPath) { oldPath, newPath in
      guard oldPath == nil || content == savedContent else {
        pendingPath = newPath; selectedPath = oldPath; resolvesUnsavedSelection = true; return
      }
      guard let newPath else { return }
      Task { if let loaded = await model.loadSkillFile(name: target.name, provider: target.provider, path: newPath) { content = loaded; savedContent = loaded } }
    }
    .confirmationDialog("Delete \(target.name)?", isPresented: $confirmsDelete) {
      Button("Delete from Master", role: .destructive) { Task { if await model.deleteSkill(name: target.name, provider: target.provider) { dismiss() } } }
    } message: { Text("Provider copies remain until you preview and apply Skills.") }
    .alert("New Skill File", isPresented: $showsNewFile) {
      TextField("assets/example.md", text: $newFilePath)
      Button("Cancel", role: .cancel) {}
      Button("Create") {
        Task {
          if await model.saveSkillFile(name: target.name, provider: target.provider, path: newFilePath, content: "") {
            tree = await model.loadSkillTree(name: target.name, provider: target.provider)
            selectedPath = newFilePath
          }
        }
      }.disabled(newFilePath.isEmpty)
    } message: { Text("The empty file is saved to the master and is not applied yet.") }
    .alert("Rename Skill File", isPresented: $showsRenameFile) {
      TextField("assets/example.md", text: $renamedFilePath)
      Button("Cancel", role: .cancel) {}
      Button("Rename") {
        guard let selectedPath else { return }
        Task {
          if await model.renameSkillFile(name: target.name, provider: target.provider, path: selectedPath, newPath: renamedFilePath) {
            self.selectedPath = renamedFilePath
            tree = await model.loadSkillTree(name: target.name, provider: target.provider)
          }
        }
      }.disabled(renamedFilePath.isEmpty)
    }
    .confirmationDialog("Delete \(selectedPath ?? "file")?", isPresented: $confirmsDeleteFile) {
      Button("Delete from Master", role: .destructive) {
        guard let selectedPath else { return }
        Task {
          if await model.deleteSkillFile(name: target.name, provider: target.provider, path: selectedPath) {
            self.selectedPath = nil; content = ""; savedContent = ""
            tree = await model.loadSkillTree(name: target.name, provider: target.provider)
          }
        }
      }
    }
    .confirmationDialog("Save changes before switching files?", isPresented: $resolvesUnsavedSelection) {
      Button("Save") {
        guard let current = selectedPath else { return }
        Task {
          if await model.saveSkillFile(name: target.name, provider: target.provider, path: current, content: content) {
            savedContent = content; selectedPath = pendingPath; pendingPath = nil
          }
        }
      }
      Button("Discard Changes", role: .destructive) { content = savedContent; selectedPath = pendingPath; pendingPath = nil }
      Button("Cancel", role: .cancel) { pendingPath = nil }
    }
    .interactiveDismissDisabled(content != savedContent)
  }

  private func save() {
    guard let selectedPath else { return }
    Task { if await model.saveSkillFile(name: target.name, provider: target.provider, path: selectedPath, content: content) { savedContent = content; tree = await model.loadSkillTree(name: target.name, provider: target.provider) } }
  }
}

struct NewSkillView: View {
  @EnvironmentObject private var model: SetupModel
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var provider = ""
  @State private var content = "# New Skill\n"
  @State private var confirmsDiscard = false
  private var hasUnsavedDraft: Bool {
    !name.isEmpty || !provider.isEmpty || content != "# New Skill\n"
  }
  var body: some View {
    Form {
      TextField("Skill name", text: $name)
      TextField("Provider (blank for shared)", text: $provider)
      TextEditor(text: $content).font(.system(.body, design: .monospaced)).frame(minHeight: 220)
      HStack {
        Spacer()
        Button("Cancel") {
          if hasUnsavedDraft {
            confirmsDiscard = true
          } else {
            dismiss()
          }
        }
        Button("Save to Master") {
          Task { if await model.createSkill(name: name, provider: provider.isEmpty ? nil : provider, content: content) { dismiss() } }
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut("s", modifiers: .command)
        .disabled(name.isEmpty)
      }
    }
    .padding()
    .frame(width: 560, height: 400)
    .interactiveDismissDisabled(hasUnsavedDraft)
    .confirmationDialog("Discard new skill draft?", isPresented: $confirmsDiscard) {
      Button("Discard", role: .destructive) { dismiss() }
      Button("Keep Editing", role: .cancel) {}
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

struct McpManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var selectedName: String?
  @State private var name = ""
  @State private var transport = 0
  @State private var command = ""
  @State private var args = ""
  @State private var url = ""
  @State private var env = ""
  @State private var saved = McpServerDefinition()
  @State private var applyPreview: ApplyReviewScope?
  @State private var pendingName: String?
  @State private var resolvesUnsavedSelection = false
  @State private var confirmsDelete = false
  @State private var confirmsOverwrite = false
  @State private var searchText = ""

  private var definition: McpServerDefinition {
    transport == 0
      ? McpServerDefinition(command: command, args: args.split(separator: "\n").map(String.init), env: parseEnvironment(), url: nil)
      : McpServerDefinition(command: nil, args: nil, env: nil, url: url)
  }
  private var valid: Bool {
    !name.isEmpty && (transport == 0 ? !command.trimmingCharacters(in: .whitespaces).isEmpty : (URL(string: url)?.scheme.map { $0 == "http" || $0 == "https" } ?? false))
  }

  var body: some View {
    HSplitView {
      VStack(spacing: 0) {
        TextField("Filter servers", text: $searchText)
          .textFieldStyle(.roundedBorder)
          .padding(8)
        List(filteredServers, selection: $selectedName) { entry in
          VStack(alignment: .leading) { Text(entry.name); if !entry.issues.isEmpty { Text(entry.issues.joined(separator: ", ")).font(.caption).foregroundStyle(.red) } }.tag(entry.name)
        }
        Divider()
        Button("New Server") { selectedName = nil }.padding()
      }.frame(minWidth: 220)
      Form {
        TextField("Server name", text: $name)
        Picker("Transport", selection: $transport) { Text("Local command").tag(0); Text("Remote URL").tag(1) }.pickerStyle(.segmented)
        if transport == 0 {
          TextField("Command", text: $command)
          TextField("Arguments (one per line)", text: $args, axis: .vertical).lineLimit(3...8)
          TextField("Environment (OUTPUT_KEY=LOCAL_VARIABLE, one per line)", text: $env, axis: .vertical).lineLimit(3...8)
          Text("Reglet stores only local process-environment variable names. Values are resolved in memory during apply and never shown here.")
            .font(.caption)
            .foregroundStyle(.secondary)
        } else {
          TextField("https://server.example/mcp", text: $url)
        }
        HStack {
          if selectedName != nil {
            Button("Delete", role: .destructive) { confirmsDelete = true }
          }
          Spacer()
          Text(definition == saved ? "Saved to master — not applied" : "Unsaved changes").font(.caption).foregroundStyle(definition == saved ? Color.secondary : Color.orange)
          Button("Save") {
            if selectedName == nil && !model.mcpServers.contains(where: { $0.name == name }) {
              Task { if await model.saveMcp(name: name, definition: definition) { saved = definition; selectedName = name } }
            } else {
              confirmsOverwrite = true
            }
          }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut("s", modifiers: .command)
            .disabled(!valid || definition == saved)
        }
      }.formStyle(.grouped).frame(minWidth: 500)
    }
    .safeAreaInset(edge: .bottom) {
      HStack {
        Spacer()
        Button("Preview Apply…") {
          Task {
            if let preview = await model.previewApply(content: .mcp) {
              applyPreview = ApplyReviewScope(
                preview: preview,
                contents: [.mcp],
                providers: [],
                title: "Review MCP Apply"
              )
            }
          }
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
        .disabled(model.isWorking)
      }
      .padding()
      .background(.regularMaterial)
    }
    .onChange(of: selectedName) { oldValue, value in
      if definition != saved && oldValue != nil {
        pendingName = value; selectedName = oldValue; resolvesUnsavedSelection = true
      } else { load(value) }
    }
    .sheet(item: $applyPreview) { scope in
      ApplyPreviewView(scope: scope, close: { applyPreview = nil }, applied: {})
        .environmentObject(model)
    }
    .confirmationDialog("Save changes before switching servers?", isPresented: $resolvesUnsavedSelection) {
      Button("Save") { Task { if await model.saveMcp(name: name, definition: definition) { saved = definition; selectedName = pendingName; pendingName = nil } } }
      Button("Discard Changes", role: .destructive) { saved = definition; selectedName = pendingName; pendingName = nil }
      Button("Cancel", role: .cancel) { pendingName = nil }
    }
    .confirmationDialog("Delete \(name)?", isPresented: $confirmsDelete) {
      Button("Delete from Master", role: .destructive) {
        Task {
          if await model.deleteMcp(name: name) {
            clear()
          }
        }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This deletes the canonical server definition. Existing provider copies remain until you review and apply MCP.")
    }
    .confirmationDialog("Replace \(name)?", isPresented: $confirmsOverwrite) {
      Button("Replace in Master", role: .destructive) {
        Task { if await model.saveMcp(name: name, definition: definition) { saved = definition; selectedName = name } }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This replaces the canonical MCP definition. Existing provider copies remain unchanged until you review and apply MCP.")
    }
  }

  private func load(_ selected: String?) {
    guard let selected else {
      clear()
      return
    }
    guard let entry = model.mcpServers.first(where: { $0.name == selected }) else { return }
    name = entry.name; command = entry.server.command ?? ""; args = (entry.server.args ?? []).joined(separator: "\n"); url = entry.server.url ?? ""; env = (entry.server.env ?? [:]).sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value.name)" }.joined(separator: "\n"); transport = entry.server.url == nil ? 0 : 1; saved = entry.server
  }
  private var filteredServers: [McpServersResponse.Entry] {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return model.mcpServers }
    return model.mcpServers.filter { entry in
      entry.name.localizedCaseInsensitiveContains(query)
        || (entry.server.command ?? "").localizedCaseInsensitiveContains(query)
        || (entry.server.url ?? "").localizedCaseInsensitiveContains(query)
    }
  }
  private func clear() { selectedName = nil; name = ""; command = ""; args = ""; url = ""; env = ""; transport = 0; saved = McpServerDefinition() }
  private func parseEnvironment() -> [String: McpProcessEnvironmentReference] {
    Dictionary(uniqueKeysWithValues: env.split(separator: "\n").compactMap { line in
      guard let split = line.firstIndex(of: "=") else { return nil }
      let key = String(line[..<split]).trimmingCharacters(in: .whitespacesAndNewlines)
      let name = String(line[line.index(after: split)...]).trimmingCharacters(in: .whitespacesAndNewlines)
      guard !key.isEmpty, !name.isEmpty else { return nil }
      return (key, McpProcessEnvironmentReference(name: name))
    })
  }
}

struct ApplyPreviewView: View {
  @EnvironmentObject private var model: SetupModel
  let scope: ApplyReviewScope
  let close: () -> Void
  let applied: () -> Void
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(scope.title).font(.title2.weight(.semibold))
      if !scope.preview.validationIssues.isEmpty { Label(scope.preview.validationIssues.joined(separator: "\n"), systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
      List(scope.preview.entries) { entry in
        DisclosureGroup {
          Text(entry.diff).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
          Text("Drift: \(entry.driftStatus)").font(.caption).foregroundStyle(.secondary)
          if let hash = entry.expectedTargetHash {
            Text("Expected target hash: \(hash)").font(.system(.caption2, design: .monospaced)).textSelection(.enabled)
          }
          if let hash = entry.resultingTargetHash {
            Text("Resulting target hash: \(hash)").font(.system(.caption2, design: .monospaced)).textSelection(.enabled)
          }
          Text("Snapshot: \(entry.snapshot.behavior)\(entry.snapshot.location.map { " → \($0)" } ?? "")").font(.caption).foregroundStyle(.secondary)
          Text("Backup: \(entry.backup.behavior)\(entry.backup.location.map { " → \($0)" } ?? "")").font(.caption).foregroundStyle(.secondary)
        } label: {
          VStack(alignment: .leading) { Text("\(entry.provider) · \(entry.operation)"); Text(entry.path).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary) }
        }
      }
      HStack {
        Spacer()
        Button("Cancel", action: close)
        Button("Apply to Providers") {
          Task {
            if await model.applyPreview(scope.preview, contents: scope.contents, providers: scope.providers) {
              applied()
              close()
            }
          }
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
        .disabled(!scope.preview.validationIssues.isEmpty || model.isWorking)
      }
    }.padding(24).frame(minWidth: 760, minHeight: 560)
  }
}

struct RulesManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var selectedPath: String?
  @State private var content = ""
  @State private var savedContent = ""
  @State private var applyPreview: ApplyReviewScope?
  @State private var pendingPath: String?
  @State private var resolvesUnsavedSelection = false

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
            .keyboardShortcut("s", modifiers: .command)
            .disabled(!hasUnsavedChanges || model.isWorking)
            Button("Preview Apply…") {
              Task {
                if let preview = await model.previewApply(content: .rules) {
                  applyPreview = ApplyReviewScope(
                    preview: preview,
                    contents: [.rules],
                    providers: [],
                    title: "Review Rules Apply"
                  )
                }
              }
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
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
    .onChange(of: selectedPath) { oldPath, newPath in
      if hasUnsavedChanges, oldPath != nil, newPath != oldPath {
        pendingPath = newPath
        selectedPath = oldPath
        resolvesUnsavedSelection = true
      } else {
        load(newPath)
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
    .sheet(item: $applyPreview) { scope in
      ApplyPreviewView(scope: scope, close: { applyPreview = nil }, applied: {})
        .environmentObject(model)
    }
    .confirmationDialog("Save changes before switching rules?", isPresented: $resolvesUnsavedSelection) {
      Button("Save") {
        guard let currentPath = selectedPath else { return }
        Task {
          if await model.saveRule(path: currentPath, content: content) {
            savedContent = content
            self.selectedPath = pendingPath
            pendingPath = nil
          }
        }
      }
      Button("Discard Changes", role: .destructive) {
        savedContent = content
        selectedPath = pendingPath
        pendingPath = nil
      }
      Button("Cancel", role: .cancel) { pendingPath = nil }
    }
  }

  private func load(_ path: String?) {
    guard let path else { return }
    Task {
      if let loaded = await model.loadRule(path: path) {
        content = loaded
        savedContent = loaded
      }
    }
  }
}

struct RecoveryManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var receiptToRestore: OperationReceipt?
  @State private var confirmsLegacyClear = false

  var body: some View {
    List {
      Section("Operation receipts") {
        if model.operationReceipts.isEmpty {
          Text("No operations have been recorded on this Mac yet.")
            .foregroundStyle(.secondary)
        } else {
          ForEach(model.operationReceipts) { receipt in
            VStack(alignment: .leading, spacing: 6) {
              HStack {
                Text(receipt.lifecycle.capitalized)
                  .font(.headline)
                Spacer()
                Text("\(receipt.targets.count) target\(receipt.targets.count == 1 ? "" : "s")")
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
              Text(receipt.startedAt)
                .font(.caption)
                .foregroundStyle(.secondary)
              ForEach(receipt.targets.prefix(3)) { target in
                VStack(alignment: .leading, spacing: 2) {
                  Text(target.path)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                  Text(target.snapshot.map { "Snapshot: \($0)" } ?? "Snapshot: target did not exist")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .textSelection(.enabled)
                }
              }
              if receipt.targets.count > 3 {
                Text("+ \(receipt.targets.count - 3) more path(s)")
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
              Button("Restore this receipt…", role: .destructive) {
                receiptToRestore = receipt
              }
              .disabled(model.isWorking || receipt.targets.isEmpty)
            }
            .padding(.vertical, 4)
          }
        }
      }

      if let legacy = model.legacyNetworkState, legacy.present {
        Section("Inert legacy network state") {
          Text("Older local credentials and snapshots are inactive. Clearing them is permanent.")
            .foregroundStyle(.secondary)
          ForEach(legacy.paths, id: \.self) { path in
            Text(path)
              .font(.system(.caption, design: .monospaced))
              .textSelection(.enabled)
          }
          Button("Clear Legacy State…", role: .destructive) {
            confirmsLegacyClear = true
          }
          .disabled(model.isWorking)
        }
      }
    }
    .confirmationDialog(
      "Restore provider files from this receipt?",
      isPresented: Binding(
        get: { receiptToRestore != nil },
        set: { if !$0 { receiptToRestore = nil } }
      ),
      titleVisibility: .visible
    ) {
      Button("Restore", role: .destructive) {
        if let receiptToRestore {
          Task { await model.restoreOperation(receiptToRestore.id) }
        }
        receiptToRestore = nil
      }
      Button("Cancel", role: .cancel) { receiptToRestore = nil }
    } message: {
      Text("This replaces each listed provider path with its private snapshot from the selected operation.")
    }
    .confirmationDialog(
      "Clear inert legacy network state?",
      isPresented: $confirmsLegacyClear,
      titleVisibility: .visible
    ) {
      Button("Clear State", role: .destructive) {
        Task { await model.clearLegacyNetworkState() }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This permanently removes inactive pre-V1 credentials and snapshots from this Mac.")
    }
  }
}

struct ActivityDriftManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var reviewedReplacement: ApplyReviewScope?

  private var drift: [DriftRecord] { model.status?.drift ?? [] }
  private var drifted: [DriftRecord] { drift.filter { $0.status != "clean" } }
  private var clean: [DriftRecord] { drift.filter { $0.status == "clean" } }
  private var latestReceipt: OperationReceipt? { model.operationReceipts.first }
  private var managedProviders: [StatusResponse.Provider] {
    model.status?.providers.filter(\.enabled) ?? []
  }
  private var diagnostics: String {
    let receipt = latestReceipt.map { "lastReceipt=\($0.id) lifecycle=\($0.lifecycle) targets=\($0.targets.count)" } ?? "lastReceipt=none"
    return "managedProviders=\(managedProviders.count) drifted=\(drifted.count) \(receipt)"
  }

  var body: some View {
    List {
      Section("Manager status") {
        if managedProviders.isEmpty {
          Text("No provider scopes are managed yet.")
            .foregroundStyle(.secondary)
        } else {
          ForEach(managedProviders) { provider in
            Text("\(model.providerDisplayName(provider.id)): \([provider.contents.rules ? "Rules" : nil, provider.contents.skills ? "Skills" : nil, provider.contents.mcp ? "MCP" : nil].compactMap { $0 }.joined(separator: ", "))")
              .font(.caption)
          }
        }
      }

      Section("Latest operation") {
        if let receipt = latestReceipt {
          Text(receipt.id)
            .font(.system(.caption, design: .monospaced))
            .textSelection(.enabled)
          Text("\(receipt.lifecycle.capitalized) · \(receipt.targets.count) target\(receipt.targets.count == 1 ? "" : "s")")
          if let message = receipt.recovery.message {
            Text(message)
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          if receipt.lifecycle == "rolled-back" {
            Text("Resolve the reported issue, then create a fresh review before retrying.")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        } else {
          Text("No operation receipt yet. Review & Apply creates one for every provider mutation.")
            .foregroundStyle(.secondary)
        }
      }

      if !drifted.isEmpty {
        Section("Needs attention") {
          ForEach(drifted) { record in
            DriftRow(record: record, reviewedReplacement: $reviewedReplacement)
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

      Section("Copyable diagnostics") {
        Text(diagnostics)
          .font(.system(.caption, design: .monospaced))
          .textSelection(.enabled)
        Text("Include this local summary when reporting a retry or recovery problem. It contains no resolved environment values.")
          .font(.caption)
          .foregroundStyle(.secondary)
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
    .sheet(item: $reviewedReplacement) { scope in
      ApplyPreviewView(scope: scope, close: { reviewedReplacement = nil }, applied: {})
      .environmentObject(model)
    }
  }
}

struct DriftRow: View {
  @EnvironmentObject private var model: SetupModel
  let record: DriftRecord
  @Binding var reviewedReplacement: ApplyReviewScope?

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
          ? "The managed file was removed. Review the replacement before recreating it from the master."
          : "Import keeps the edits in the master; review the exact replacement before overwriting it.")
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
        guard let content = ContentKind(rawValue: record.content) else { return }
        Task {
          if let preview = await model.previewApply(content: content, provider: record.provider) {
            reviewedReplacement = ApplyReviewScope(
              preview: preview,
              contents: [content],
              providers: [record.provider],
              title: "Review Drift Replacement"
            )
          }
        }
      } label: {
        Label("Review Replace", systemImage: "doc.text.magnifyingglass")
      }
      .disabled(model.isWorking)
      .help("Review the exact replacement before overwriting the provider file")
    }
    .padding(.vertical, 4)
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
  @State private var onboardingReview: ApplyReviewScope?
  @State private var confirmsOnboardingSkillOverwrite = false

  private var showsPromptStep: Bool {
    model.selectedContents.contains(.rules)
  }

  private var showsSkillsStep: Bool {
    !model.selectedProviderUnmanagedSkills.isEmpty
  }

  private var route: OnboardingRoute {
    OnboardingRoute(includesPrompts: showsPromptStep, includesSkills: showsSkillsStep)
  }

  private var nextAfterSelection: Int {
    showsPromptStep ? 2 : (showsSkillsStep ? 3 : 4)
  }

  private var nextAfterPrompts: Int {
    showsSkillsStep ? 3 : 4
  }

  private var previewBackStep: Int {
    showsSkillsStep ? 3 : (showsPromptStep ? 2 : 1)
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
              step = route.next(after: .selection).rawValue
            }
          }
        case 2:
          PromptHandlingStepView(
            back: { step = route.back(from: .prompts).rawValue },
            continueAction: { step = route.next(after: .prompts).rawValue }
          )
        case 3:
          SkillsStepView(
            back: { step = route.back(from: .skills).rawValue },
            continueAction: { step = route.next(after: .skills).rawValue }
          )
        case 4:
          PreviewView(
            back: { step = route.back(from: .preview).rawValue },
            review: {
              if model.hasPendingSkillOverwrite(limitedTo: model.selectedProviders) {
                confirmsOnboardingSkillOverwrite = true
              } else {
                Task {
                  if let review = await model.prepareOnboardingReview() {
                    onboardingReview = review
                  }
                }
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
    .sheet(item: $onboardingReview) { scope in
      ApplyPreviewView(
        scope: scope,
        close: { onboardingReview = nil },
        applied: { step = 5 }
      )
      .environmentObject(model)
    }
    .confirmationDialog("Overwrite selected master skills?", isPresented: $confirmsOnboardingSkillOverwrite) {
      Button("Overwrite and Review", role: .destructive) {
        Task {
          if let review = await model.prepareOnboardingReview() {
            onboardingReview = review
          }
        }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This replaces existing skill files in the master directory before the final provider review. No provider copy changes until you apply that review.")
    }
  }
}

struct HeaderView: View {
  let step: Int

  private let steps = ["Safety", "Choose", "Prompts", "Skills", "Preview", "Done"]

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
      .frame(width: 460)
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
        SafetyRow(symbol: "network.slash", title: "Local-only: no account, service, or network connection")
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
      .keyboardShortcut(.defaultAction)
      .accessibilityHint("Continues to provider selection")

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
          .keyboardShortcut(.defaultAction)
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

struct PromptHandlingStepView: View {
  @EnvironmentObject private var model: SetupModel
  let back: () -> Void
  let continueAction: () -> Void

  private var availableSources: [RuleComparison] {
    model.availableRuleMergeProviders
  }

  private var canGenerate: Bool {
    model.rulePromptMode == .unified && model.selectedRuleMergeProviders.count >= 2 && !model.isWorking
  }

  private var canContinue: Bool {
    if model.rulePromptMode == .providerSpecific {
      return !model.isWorking
    }
    return !model.editableRuleMergeDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isWorking
  }

  var body: some View {
    VStack(spacing: 0) {
      Form {
        Section("System prompt handling") {
          Picker("Mode", selection: $model.rulePromptMode) {
            ForEach(RulePromptMode.allCases) { mode in
              Text(mode.label).tag(mode)
            }
          }
          .pickerStyle(.radioGroup)

          if model.rulePromptMode == .providerSpecific {
            Text("Reglet will preserve selected providers' existing prompt files as separate master documents and compose them during apply.")
              .foregroundStyle(.secondary)
          } else {
            Text("Reglet will save one reviewed unified draft to 00-general.md and skip importing provider-specific prompt files.")
              .foregroundStyle(.secondary)
          }
        }

        if model.rulePromptMode == .unified {
          Section {
            if availableSources.count < 2 {
              Text("At least two selected providers need existing prompt files before Reglet can generate a merge.")
                .foregroundStyle(.secondary)
            } else {
              ForEach(availableSources) { source in
                Toggle(isOn: mergeSourceBinding(source.provider)) {
                  VStack(alignment: .leading, spacing: 2) {
                    Text(model.providerDisplayName(source.provider))
                    Text(source.sourcePath)
                      .font(.system(.caption, design: .monospaced))
                      .foregroundStyle(.secondary)
                      .textSelection(.enabled)
                  }
                }
              }
            }
          } header: {
            Text("Sources to merge")
          } footer: {
            Text("The AI task receives only these local prompt files and returns a draft; nothing is saved until final Apply.")
          }

          Section("Unified draft") {
            if let draft = model.ruleMergeDraft {
              LabeledContent("Generated with", value: draft.provider)
              Text("\(draft.sources.count) source prompts merged.")
                .foregroundStyle(.secondary)
            } else {
              Text("Generate a draft, then review and edit it here before continuing.")
                .foregroundStyle(.secondary)
            }

            TextEditor(text: $model.editableRuleMergeDraft)
              .font(.system(.body, design: .monospaced))
              .frame(minHeight: 180)
              .accessibilityLabel("Unified system prompt draft")

            if let error = model.ruleMergeError {
              Label(error, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .textSelection(.enabled)
            }

            HStack {
              Spacer()
              Button {
                Task { await model.generateRuleMergeDraft() }
              } label: {
                Label(model.ruleMergeDraft == nil ? "Generate AI Draft" : "Retry AI Merge", systemImage: "wand.and.stars")
              }
              .disabled(!canGenerate)
            }
          }
        }
      }
      .formStyle(.grouped)
      Divider()
      HStack {
        Button("Back", action: back)
          .keyboardShortcut(.cancelAction)
        Spacer()
        Button {
          continueAction()
        } label: {
          Label("Continue", systemImage: "arrow.right")
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
        .disabled(!canContinue)
      }
      .padding(20)
      .background(.regularMaterial)
    }
  }

  private func mergeSourceBinding(_ provider: String) -> Binding<Bool> {
    Binding(
      get: { model.selectedRuleMergeProviders.contains(provider) },
      set: { isSelected in
        if isSelected {
          model.selectedRuleMergeProviders.insert(provider)
        } else {
          model.selectedRuleMergeProviders.remove(provider)
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
          .keyboardShortcut(.cancelAction)
        Spacer()
        Button {
          continueAction()
        } label: {
          Label("Preview Files", systemImage: "doc.text.magnifyingglass")
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
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
  let review: () -> Void

  private var selectedAdoptions: [UnmanagedSkill] {
    model.selectedProviderUnmanagedSkills
      .filter { model.checkedSkills.contains($0.id) }
      .sorted { $0.id < $1.id }
  }

  private var duplicateAdoptionDestinations: Set<String> {
    let destinations = selectedAdoptions.map { skill in
      model.skillScope(skill.id) == .shared ? skill.sharedDestination : skill.providerDestination
    }
    let counts = Dictionary(destinations.map { ($0, 1) }, uniquingKeysWith: +)
    return Set(counts.compactMap { $0.value > 1 ? $0.key : nil })
  }

  private var selectedSharedSkillNames: Set<String> {
    Set(selectedAdoptions.compactMap { model.skillScope($0.id) == .shared ? $0.name : nil })
  }

  private var hasBlockedAdoption: Bool {
    selectedAdoptions.contains { skill in
      let destination = model.skillScope(skill.id) == .shared ? skill.sharedDestination : skill.providerDestination
      return !model.canAdopt(skill) || duplicateAdoptionDestinations.contains(destination)
    }
  }

  private var displayedWrites: [PlannedFile] {
    var writes = model.plan?.writes ?? []
    if model.rulePromptMode == .unified && model.selectedContents.contains(.rules) {
      writes = writes.filter { !($0.content == "rules" && $0.scope == "master" && $0.path.contains("/imported-")) }
      writes.insert(
        PlannedFile(
          provider: "reglet",
          content: "rules",
          path: "\(model.scan?.regletHome ?? "~/.reglet")/rules/00-general.md",
          scope: "master",
          operation: "write",
          reason: "save unified prompt draft"
        ),
        at: 0
      )
    }
    return writes
  }

  private var hasBlockedUnifiedDraft: Bool {
    model.rulePromptMode == .unified
      && model.selectedContents.contains(.rules)
      && model.editableRuleMergeDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var body: some View {
    VStack(spacing: 0) {
      List {
        Section("Files Reglet will read") {
          FileRows(files: model.plan?.reads ?? [])
        }

        Section("Files Reglet will write after confirmation") {
          FileRows(files: displayedWrites)
        }

        Section {
          let rules = model.plan?.reconciliation.rules ?? []
          if rules.isEmpty {
            Text("No provider rule files were selected for reconciliation.")
              .foregroundStyle(.secondary)
          } else {
            ScrollView(.horizontal) {
              HStack(alignment: .top, spacing: 0) {
                ForEach(rules) { comparison in
                  RuleComparisonRow(comparison: comparison)
                    .frame(width: 340, alignment: .topLeading)
                    .padding(.horizontal, 12)
                  if comparison.id != rules.last?.id { Divider() }
                }
              }
            }
            .accessibilityLabel("Discovered provider rule sources")
          }
        } header: {
          Text("Provider rule reconciliation")
        } footer: {
          Text(model.rulePromptMode == .unified
            ? "The unified draft is saved as one master prompt. Provider-specific source prompts are not imported as separate master documents in this mode."
            : "Different provider rules are preserved as separate master documents, then composed into generated provider outputs during apply.")
        }

        if model.selectedContents.contains(.rules) {
          Section("System prompt decision") {
            if model.rulePromptMode == .unified {
              Label("Unified prompt draft will be saved to 00-general.md", systemImage: "doc.text")
              Text(model.editableRuleMergeDraft.isEmpty ? "No draft yet." : model.editableRuleMergeDraft)
                .font(.system(.caption, design: .monospaced))
                .lineLimit(8)
                .textSelection(.enabled)
            } else {
              Label("Provider-specific prompt documents will be preserved", systemImage: "rectangle.stack")
            }
          }
        }

        Section {
          SkillInventoryPreview(
            selectedAdoptions: selectedAdoptions,
            duplicateDestinations: duplicateAdoptionDestinations,
            selectedSharedSkillNames: selectedSharedSkillNames
          )
        } header: {
          Text("Projected skill inventory")
        } footer: {
          Text("Unchecked provider-local skills stay local. Conflicting checked adoptions are blocked unless Overwrite is enabled in the Skills step.")
        }

        Section("Safety") {
          Label("Daemon remains off", systemImage: "checkmark.shield")
          Label("No network service is configured", systemImage: "network.slash")
          Label("Notifications remain off", systemImage: "bell.slash")
        }
      }
      .listStyle(.inset)
      Divider()
      HStack {
        Button("Back", action: back)
          .keyboardShortcut(.cancelAction)
        Spacer()
        Text(statusMessage)
          .foregroundStyle(.secondary)
        Button {
          review()
        } label: {
          Label("Review Exact Changes", systemImage: "doc.text.magnifyingglass")
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
        .accessibilityHint("Stages the local master content, then opens the digest-backed provider review")
        .disabled(model.isWorking || hasBlockedAdoption || hasBlockedUnifiedDraft)
      }
      .padding(20)
      .background(.regularMaterial)
    }
  }

  private var statusMessage: String {
    if hasBlockedAdoption {
      return "Resolve blocked skill adoptions before applying."
    }
    if hasBlockedUnifiedDraft {
      return "Generate or enter a unified prompt draft before applying."
    }
    return "Daemon and notifications remain off; Reglet is local-only."
  }
}

struct FileRows: View {
  let files: [PlannedFile]

  var body: some View {
    if files.isEmpty {
      Text("No files.")
        .foregroundStyle(.secondary)
    } else {
      ForEach(files) { file in
        PlannedFileRow(file: file)
      }
    }
  }
}

struct PlannedFileRow: View {
  let file: PlannedFile

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 8) {
        Text(file.provider)
          .font(.caption)
          .foregroundStyle(.secondary)
        Text(file.content)
          .font(.caption)
          .foregroundStyle(.secondary)
        Text(file.scope)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      Text(file.path)
        .font(.system(.body, design: .monospaced))
        .textSelection(.enabled)
    }
    .padding(.vertical, 3)
  }
}

struct RuleComparisonRow: View {
  @EnvironmentObject private var model: SetupModel
  let comparison: RuleComparison

  private var status: (String, String, Color) {
    switch comparison.state {
    case "new":
      ("doc.badge.plus", "New master rule document", .blue)
    case "matching":
      ("checkmark.circle", "Matches existing master document", .green)
    default:
      ("exclamationmark.triangle", "Different from existing master document", .orange)
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Image(systemName: status.0)
          .foregroundStyle(status.2)
          .accessibilityLabel(status.1)
        Text(model.providerDisplayName(comparison.provider))
          .font(.headline)
        Text(status.1)
          .foregroundStyle(.secondary)
      }
      PathSummary(label: "Source", value: comparison.sourcePath)
      PathSummary(label: "Destination", value: comparison.destinationPath)
      Text(comparison.preview.isEmpty ? "(empty file)" : comparison.preview)
        .font(.system(.caption, design: .monospaced))
        .textSelection(.enabled)
        .lineLimit(6)
      if comparison.truncated {
        Label("Preview truncated", systemImage: "scissors")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 6)
  }
}

struct SkillInventoryPreview: View {
  @EnvironmentObject private var model: SetupModel
  let selectedAdoptions: [UnmanagedSkill]
  let duplicateDestinations: Set<String>
  let selectedSharedSkillNames: Set<String>

  private var overview: SkillsOverviewResponse? { model.skillsOverview }

  var body: some View {
    if overview == nil && selectedAdoptions.isEmpty {
      Text("Skill inventory unavailable.")
        .foregroundStyle(.secondary)
    } else {
      ForEach(overview?.shared ?? []) { skill in
        VStack(alignment: .leading, spacing: 4) {
          Label(skill.name, systemImage: "hammer")
          Text(skill.path)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
          if !skill.shadowedBy.isEmpty {
            Text("Shadowed by \(skill.shadowedBy.map { model.providerDisplayName($0) }.joined(separator: ", "))")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
        .padding(.vertical, 3)
      }

      ForEach(overview?.providerScoped ?? []) { skill in
        VStack(alignment: .leading, spacing: 4) {
          Label("\(skill.name) (\(model.providerDisplayName(skill.provider)))", systemImage: "hammer.circle")
          Text(skill.path)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
          if skill.shadowsShared {
            Text("Shadows a shared skill for this provider.")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
        .padding(.vertical, 3)
      }

      if selectedAdoptions.isEmpty {
        Text("No provider-local skills are selected for adoption.")
          .foregroundStyle(.secondary)
      } else {
        ForEach(selectedAdoptions) { skill in
          SkillProjectionRow(
            skill: skill,
            hasSelectionCollision: duplicateDestinations.contains(
              model.skillScope(skill.id) == .shared ? skill.sharedDestination : skill.providerDestination
            ),
            selectedSharedSkillNames: selectedSharedSkillNames
          )
        }
      }
    }
  }
}

struct SkillProjectionRow: View {
  @EnvironmentObject private var model: SetupModel
  let skill: UnmanagedSkill
  let hasSelectionCollision: Bool
  let selectedSharedSkillNames: Set<String>

  private var scope: SkillAdoptionScope { model.skillScope(skill.id) }
  private var destination: String {
    scope == .shared ? skill.sharedDestination : skill.providerDestination
  }
  private var conflict: Bool {
    (scope == .shared ? skill.sharedConflict : skill.providerConflict) == "destination-exists"
  }
  private var overwrite: Bool { model.overwriteFlags.contains(skill.id) }
  private var blocked: Bool { hasSelectionCollision || (conflict && !overwrite) }
  private var statusText: String {
    if hasSelectionCollision { return "Blocked: another selection uses this destination" }
    if blocked { return "Blocked: destination exists" }
    if conflict && overwrite { return "Will overwrite existing destination" }
    return scope == .shared ? "Will become shared" : "Will become provider-scoped"
  }
  private var statusSymbol: String {
    if blocked { return "xmark.octagon" }
    if conflict && overwrite { return "exclamationmark.triangle" }
    return "square.and.arrow.down"
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Image(systemName: statusSymbol)
          .foregroundStyle(blocked ? Color.red : (conflict ? Color.orange : Color.accentColor))
          .accessibilityLabel(statusText)
        Text(skill.name)
          .font(.headline)
        Text(model.providerDisplayName(skill.provider))
          .foregroundStyle(.secondary)
        Text(statusText)
          .foregroundStyle(.secondary)
      }
      PathSummary(label: "Source", value: skill.sourcePath)
      PathSummary(label: "Destination", value: destination)
      Text("Affected providers: \(affectedProviders.map { model.providerDisplayName($0) }.joined(separator: ", "))")
        .font(.caption)
        .foregroundStyle(.secondary)
      if scope == .provider && ((model.skillsOverview?.shared.contains { $0.name == skill.name } ?? false) || selectedSharedSkillNames.contains(skill.name)) {
        Text("This provider-scoped skill will shadow the shared skill for \(model.providerDisplayName(skill.provider)).")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 6)
  }

  private var affectedProviders: [String] {
    scope == .provider ? [skill.provider] : skill.affectedProviders
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
          Text(provider.enabled ? "Managed" : "Available")
            .font(.caption)
            .foregroundStyle(.secondary)
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
