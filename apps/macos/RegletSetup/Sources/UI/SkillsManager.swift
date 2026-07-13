import SwiftUI

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
