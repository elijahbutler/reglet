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
      case .mcp: McpManagerView()
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
  @State private var editingSkill: SkillEditorTarget?
  @State private var applyPreview: StructuredApplyPreview?
  @State private var showsNewSkill = false

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
                Button("Edit Files…") { editingSkill = SkillEditorTarget(name: skill.name, provider: nil) }
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
                Button("Edit Files…") { editingSkill = SkillEditorTarget(name: skill.name, provider: skill.provider) }
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
        Button("New Skill…") { showsNewSkill = true }
        Button("Preview Apply…") { Task { applyPreview = await model.previewApply(content: .skills) } }
          .disabled(model.isWorking)
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
    .sheet(item: $editingSkill) { target in
      SkillEditorView(target: target).environmentObject(model)
    }
    .sheet(isPresented: $showsNewSkill) {
      NewSkillView().environmentObject(model)
    }
    .sheet(item: $applyPreview) { preview in
      ApplyPreviewView(preview: preview, content: .skills) { applyPreview = nil }
        .environmentObject(model)
    }
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
  var body: some View {
    Form {
      TextField("Skill name", text: $name)
      TextField("Provider (blank for shared)", text: $provider)
      TextEditor(text: $content).font(.system(.body, design: .monospaced)).frame(minHeight: 220)
      HStack { Spacer(); Button("Cancel") { dismiss() }; Button("Save to Master") { Task { if await model.createSkill(name: name, provider: provider.isEmpty ? nil : provider, content: content) { dismiss() } } }.buttonStyle(.borderedProminent).disabled(name.isEmpty) }
    }.padding().frame(width: 560, height: 400)
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
  @State private var applyPreview: StructuredApplyPreview?
  @State private var pendingName: String?
  @State private var resolvesUnsavedSelection = false

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
        List(model.mcpServers, selection: $selectedName) { entry in
          VStack(alignment: .leading) { Text(entry.name); if !entry.issues.isEmpty { Text(entry.issues.joined(separator: ", ")).font(.caption).foregroundStyle(.red) } }.tag(entry.name)
        }
        Divider()
        Button("New Server") { selectedName = nil; clear() }.padding()
      }.frame(minWidth: 220)
      Form {
        TextField("Server name", text: $name)
        Picker("Transport", selection: $transport) { Text("Local command").tag(0); Text("Remote URL").tag(1) }.pickerStyle(.segmented)
        if transport == 0 {
          TextField("Command", text: $command)
          TextField("Arguments (one per line)", text: $args, axis: .vertical).lineLimit(3...8)
          TextField("Environment (KEY=value, one per line)", text: $env, axis: .vertical).lineLimit(3...8)
          Text("Environment values are stored as plain text in the synced master definition.").font(.caption).foregroundStyle(.orange)
        } else {
          TextField("https://server.example/mcp", text: $url)
        }
        HStack {
          if selectedName != nil { Button("Delete", role: .destructive) { Task { if await model.deleteMcp(name: name) { clear() } } } }
          Spacer()
          Text(definition == saved ? "Saved to master — not applied" : "Unsaved changes").font(.caption).foregroundStyle(definition == saved ? Color.secondary : Color.orange)
          Button("Save") { Task { if await model.saveMcp(name: name, definition: definition) { saved = definition; selectedName = name } } }.buttonStyle(.borderedProminent).disabled(!valid || definition == saved)
        }
      }.formStyle(.grouped).frame(minWidth: 500)
    }
    .safeAreaInset(edge: .bottom) {
      HStack { Spacer(); Button("Preview Apply…") { Task { applyPreview = await model.previewApply(content: .mcp) } }.buttonStyle(.borderedProminent).disabled(model.isWorking) }.padding().background(.regularMaterial)
    }
    .onChange(of: selectedName) { oldValue, value in
      if definition != saved && oldValue != nil {
        pendingName = value; selectedName = oldValue; resolvesUnsavedSelection = true
      } else { load(value) }
    }
    .sheet(item: $applyPreview) { preview in ApplyPreviewView(preview: preview, content: .mcp) { applyPreview = nil }.environmentObject(model) }
    .confirmationDialog("Save changes before switching servers?", isPresented: $resolvesUnsavedSelection) {
      Button("Save") { Task { if await model.saveMcp(name: name, definition: definition) { saved = definition; selectedName = pendingName; pendingName = nil } } }
      Button("Discard Changes", role: .destructive) { saved = definition; selectedName = pendingName; pendingName = nil }
      Button("Cancel", role: .cancel) { pendingName = nil }
    }
  }

  private func load(_ selected: String?) {
    guard let entry = model.mcpServers.first(where: { $0.name == selected }) else { return }
    name = entry.name; command = entry.server.command ?? ""; args = (entry.server.args ?? []).joined(separator: "\n"); url = entry.server.url ?? ""; env = (entry.server.env ?? [:]).sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "\n"); transport = entry.server.url == nil ? 0 : 1; saved = entry.server
  }
  private func clear() { selectedName = nil; name = ""; command = ""; args = ""; url = ""; env = ""; transport = 0; saved = McpServerDefinition() }
  private func parseEnvironment() -> [String: String] {
    Dictionary(uniqueKeysWithValues: env.split(separator: "\n").compactMap { line in guard let split = line.firstIndex(of: "=") else { return nil }; return (String(line[..<split]), String(line[line.index(after: split)...])) })
  }
}

struct ApplyPreviewView: View {
  @EnvironmentObject private var model: SetupModel
  let preview: StructuredApplyPreview
  let content: ContentKind
  let close: () -> Void
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Preview \(content.label) Apply").font(.title2.weight(.semibold))
      if !preview.validationIssues.isEmpty { Label(preview.validationIssues.joined(separator: "\n"), systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
      List(preview.entries) { entry in
        DisclosureGroup {
          Text(entry.diff).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
          Text("Backup: \(entry.backup.behavior)\(entry.backup.location.map { " → \($0)" } ?? "")").font(.caption).foregroundStyle(.secondary)
        } label: {
          VStack(alignment: .leading) { Text("\(entry.provider) · \(entry.operation)"); Text(entry.path).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary) }
        }
      }
      HStack { Spacer(); Button("Cancel", action: close); Button("Apply to Providers") { Task { if await model.applyPreview(preview, content: content) { close() } } }.buttonStyle(.borderedProminent).disabled(!preview.validationIssues.isEmpty || model.isWorking) }
    }.padding(24).frame(minWidth: 760, minHeight: 560)
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
  private enum SyncMode: String, CaseIterable, Identifiable {
    case local, cloud, selfHosted
    var id: String { rawValue }
    var title: String {
      switch self {
      case .local: "Local only"
      case .cloud: "Reglet Cloud"
      case .selfHosted: "Self-hosted"
      }
    }
  }

  @EnvironmentObject private var model: SetupModel
  @State private var serverUrl = ""
  @State private var token = ""
  @State private var deviceName = ""
  @State private var isEditingConnection = false
  @State private var syncMode: SyncMode = .local

  private var syncInfo: StatusResponse.SyncInfo? { model.status?.sync }
  private var showsForm: Bool { !(syncInfo?.configured ?? false) || isEditingConnection }
  private var cloudUrl: String {
    ProcessInfo.processInfo.environment["REGLET_CLOUD_SYNC_URL"] ?? "https://sync.reglet.cloud"
  }

  var body: some View {
    Form {
      if showsForm {
        Section("Sync mode") {
          Picker("Sync mode", selection: $syncMode) {
            ForEach(SyncMode.allCases) { mode in
              Text(mode.title).tag(mode)
            }
          }
          .pickerStyle(.segmented)

          switch syncMode {
          case .local:
            Label("Everything stays on this Mac. No account, server, or network connection is required.", systemImage: "macbook")
          case .cloud:
            Label("Managed multi-device sync for people who do not want to operate a server.", systemImage: "cloud")
          case .selfHosted:
            Label("Connect to the public Reglet sync server you operate.", systemImage: "server.rack")
          }
        }

        if syncMode != .local {
          Section(syncMode == .cloud ? "Reglet Cloud beta" : "Self-hosted server") {
            if syncMode == .selfHosted {
              TextField("Server URL", text: $serverUrl, prompt: Text("https://sync.example.com"))
                .textContentType(.URL)
                .autocorrectionDisabled()
            } else {
              LabeledContent("Service", value: cloudUrl)
              Text("Use the beta access token from your Reglet Cloud account.")
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            SecureField(syncMode == .cloud ? "Beta access token" : "Server token", text: $token)
            TextField("Device name", text: $deviceName, prompt: Text("this-mac"))
            HStack {
              if isEditingConnection {
                Button("Cancel") { isEditingConnection = false }
              }
              Spacer()
              Button("Connect") {
                Task {
                  let selectedUrl = syncMode == .cloud ? cloudUrl : serverUrl
                  if await model.configureSync(
                    url: selectedUrl,
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
              .disabled((syncMode == .selfHosted && serverUrl.isEmpty) || token.isEmpty || model.isWorking)
            }
          }
        }
        Section {
          Text(syncMode == .local
            ? "You can add Cloud or self-hosted sync later without changing or losing your master directory."
            : "Sync runs only when you start it. Background sync and the daemon remain separate opt-ins, and the token is stored locally in ~/.reglet/.state.")
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
              syncMode = syncInfo.serverUrl == cloudUrl ? .cloud : .selfHosted
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
            apply: {
              Task {
                guard await model.applySelection() else { return }
                if !model.checkedSkills.isEmpty {
                  await model.adoptSelectedSkills(limitedTo: model.selectedProviders)
                }
                step = 5
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
  let apply: () -> Void

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
          Label("Sync remains off", systemImage: "arrow.triangle.2.circlepath")
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
          apply()
        } label: {
          Label("Create Backups and Apply", systemImage: "checkmark.circle")
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
        .accessibilityHint("Creates provider backups, then applies the reviewed changes")
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
    return "Daemon, sync, and notifications remain off."
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
