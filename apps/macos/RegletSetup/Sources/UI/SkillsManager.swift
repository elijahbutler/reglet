import SwiftUI

struct SkillsManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var editingSkill: SkillEditorTarget?
  @State private var applyPreview: ApplyReviewScope?
  @State private var showsNewSkill = false
  @State private var searchText = ""
  @State private var confirmsAdoptionOverwrite = false
  @Environment(\.colorSchemeContrast) private var contrast

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
            Text("No shared skills yet.").foregroundStyle(secondaryText)
          } else {
            ForEach(sharedSkills) { skill in
              VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                  Text(skill.name)
                  ForEach(skill.shadowedBy, id: \.self) { provider in
                    StatusBadge(text: "shadowed by \(model.providerDisplayName(provider))", kind: .warning)
                  }
                }
                Text(skill.path)
                  .font(Theme.Fonts.mono())
                  .foregroundStyle(secondaryText)
                  .textSelection(.enabled)
                Button("Edit Files…") { editingSkill = SkillEditorTarget(name: skill.name, provider: nil) }
                  .buttonStyle(.regletSecondary)
              }
              .padding(.vertical, 2)
            }
          }
        }

        Section("Provider-scoped") {
          if providerScopedSkills.isEmpty {
            Text("No provider-scoped skills.").foregroundStyle(secondaryText)
          } else {
            ForEach(providerScopedSkills) { skill in
              VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                  Text(skill.name)
                  Text(model.providerDisplayName(skill.provider))
                    .font(Theme.Fonts.eyebrow)
                    .foregroundStyle(secondaryText)
                  if skill.shadowsShared {
                    StatusBadge(text: "shadows shared", kind: .warning)
                  }
                }
                Text(skill.path)
                  .font(Theme.Fonts.mono())
                  .foregroundStyle(secondaryText)
                  .textSelection(.enabled)
                Button("Edit Files…") { editingSkill = SkillEditorTarget(name: skill.name, provider: skill.provider) }
                  .buttonStyle(.regletSecondary)
              }
              .padding(.vertical, 2)
            }
          }
        }

        Section("Provider-local (unmanaged)") {
          if unmanagedSkills.isEmpty {
            Text("No local skills to review. Provider-local skills stay untouched until adopted.")
              .foregroundStyle(secondaryText)
          } else {
            UnmanagedSkillsGroups(skills: unmanagedSkills)
          }
        }
      }
      .searchable(text: $searchText, placement: .toolbar, prompt: "Filter skills")
      .scrollContentBackground(.hidden)
      .background(Theme.Colors.voidBlack)
      .overlay {
        if overview == nil && !model.isWorking {
          ContentUnavailableView("Skills unavailable", systemImage: "hammer", description: Text("Refresh to scan this Mac."))
        }
      }

      Divider()
      StatusStrip {
        HStack {
        Text("Adoption saves skills to the master. Review & Apply distributes them.")
          .font(Theme.Fonts.body)
          .foregroundStyle(secondaryText)
        Spacer()
        Button("New Skill…") { showsNewSkill = true }
          .buttonStyle(.regletSecondary)
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
        .buttonStyle(.regletSecondary)
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
        .buttonStyle(.regletPrimary)
        .disabled(model.checkedSkills.isEmpty || model.isWorking)
        }
      }
    }
    .background(Theme.Colors.voidBlack)
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

  private var secondaryText: Color {
    contrast == .increased ? Theme.Colors.mist : Theme.Colors.ash
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
  @Environment(\.colorSchemeContrast) private var contrast

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        VStack(alignment: .leading) {
          HStack {
            TextField("Skill name", text: $draftName)
              .font(Theme.Fonts.subheading)
              .textFieldStyle(RegletTextFieldStyle())
              .frame(width: 260)
            Button("Rename") { Task { if await model.renameSkill(name: target.name, newName: draftName, provider: target.provider) { dismiss() } } }
              .buttonStyle(.regletSecondary)
              .disabled(draftName.isEmpty || draftName == target.name || content != savedContent)
          }
          Text(target.provider.map { "Provider-scoped: \($0)" } ?? "Shared skill")
            .font(Theme.Fonts.body)
            .foregroundStyle(secondaryText)
        }
        Spacer()
        if tree?.shadowsShared == true { StatusBadge(text: "shadows shared", kind: .warning) }
        Button("Delete Skill", role: .destructive) { confirmsDelete = true }
          .buttonStyle(.regletDestructive)
      }
      .padding(Theme.Spacing.sm)
      Divider()
      HSplitView {
        VStack(spacing: 0) {
          List(tree?.files ?? [], selection: $selectedPath) { file in
            Label(file.path, systemImage: "doc").tag(file.path)
          }
          .scrollContentBackground(.hidden)
          .background(Theme.Colors.ink)
          Divider()
          HStack {
            Button { newFilePath = ""; showsNewFile = true } label: { Image(systemName: "plus") }
              .buttonStyle(.regletGhost)
            Button(role: .destructive) { confirmsDeleteFile = true } label: { Image(systemName: "minus") }
              .buttonStyle(.regletGhost)
              .disabled(selectedPath == nil || selectedPath == "SKILL.md")
            Button { renamedFilePath = selectedPath ?? ""; showsRenameFile = true } label: { Image(systemName: "pencil") }
              .buttonStyle(.regletGhost)
              .disabled(selectedPath == nil || selectedPath == "SKILL.md")
            Spacer()
          }.padding(Theme.Spacing.xs)
        }
        .frame(minWidth: 210)
        VStack(spacing: 0) {
          if selectedPath != nil {
            TextEditor(text: $content)
              .font(Theme.Fonts.mono())
              .foregroundStyle(Theme.Colors.mist)
              .scrollContentBackground(.hidden)
              .background(Theme.Colors.ink)
              .padding(10)
            Divider()
            saveStrip
          } else {
            ContentUnavailableView("Select a skill file", systemImage: "doc")
          }
        }.frame(minWidth: 500)
      }
    }
    .padding(Theme.Spacing.sm)
    .background(Theme.Colors.voidBlack)
    .cardSurface()
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

  private var saveStrip: some View {
    StatusStrip {
      HStack {
        StatusBadge(text: content == savedContent ? "Saved to master — not applied" : "Unsaved changes", kind: content == savedContent ? .neutral : .warning)
        Spacer()
        Button("Save") { save() }
          .buttonStyle(.regletPrimary)
          .keyboardShortcut("s", modifiers: .command)
          .disabled(content == savedContent || model.isWorking)
      }
    }
  }

  private var secondaryText: Color {
    contrast == .increased ? Theme.Colors.mist : Theme.Colors.ash
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
    VStack(spacing: 0) {
      Form {
        TextField("Skill name", text: $name)
          .textFieldStyle(RegletTextFieldStyle())
        TextField("Provider (blank for shared)", text: $provider)
          .textFieldStyle(RegletTextFieldStyle())
        TextEditor(text: $content)
          .font(Theme.Fonts.mono())
          .foregroundStyle(Theme.Colors.mist)
          .scrollContentBackground(.hidden)
          .background(Theme.Colors.ink)
          .frame(minHeight: 220)
      }
      .formStyle(.grouped)
      .scrollContentBackground(.hidden)
      .background(Theme.Colors.voidBlack)

      StatusStrip {
        HStack {
          StatusBadge(text: hasUnsavedDraft ? "Draft not saved" : "Ready", kind: hasUnsavedDraft ? .warning : .neutral)
          Spacer()
          Button("Cancel") {
            if hasUnsavedDraft {
              confirmsDiscard = true
            } else {
              dismiss()
            }
          }
          .buttonStyle(.regletSecondary)
          Button("Save to Master") {
            Task { if await model.createSkill(name: name, provider: provider.isEmpty ? nil : provider, content: content) { dismiss() } }
          }
          .buttonStyle(.regletPrimary)
          .keyboardShortcut("s", modifiers: .command)
          .disabled(name.isEmpty)
        }
      }
    }
    .padding(Theme.Spacing.sm)
    .background(Theme.Colors.voidBlack)
    .cardSurface()
    .frame(width: 560, height: 400)
    .interactiveDismissDisabled(hasUnsavedDraft)
    .confirmationDialog("Discard new skill draft?", isPresented: $confirmsDiscard) {
      Button("Discard", role: .destructive) { dismiss() }
      Button("Keep Editing", role: .cancel) {}
    }
  }
}

/// Reusable grouped destination-picker rows for unmanaged skills.
/// Emits a per-provider header followed by one row per skill.
/// Used by both the onboarding Skills step and the Skills manager.
struct UnmanagedSkillsGroups: View {
  @EnvironmentObject private var model: SetupModel
  let skills: [UnmanagedSkill]
  let onPreview: ((UnmanagedSkill) -> Void)?

  init(skills: [UnmanagedSkill], onPreview: ((UnmanagedSkill) -> Void)? = nil) {
    self.skills = skills
    self.onPreview = onPreview
  }

  private var byProvider: [(provider: String, skills: [UnmanagedSkill])] {
    Dictionary(grouping: skills, by: \.provider)
      .map { (provider: $0.key, skills: $0.value.sorted { $0.name < $1.name }) }
      .sorted { $0.provider < $1.provider }
  }

  var body: some View {
    ForEach(byProvider, id: \.provider) { group in
      HStack {
        Text(model.providerDisplayName(group.provider))
          .font(Theme.Fonts.subheading)
          .foregroundStyle(Theme.Colors.mist)
        Spacer()
        Menu("Set All") {
          Button("Leave All Provider-Local") { setAll(group.skills, to: .local) }
          Button("Keep All for This Provider") { setAll(group.skills, to: .provider) }
          Button("Share All with Providers") { setAll(group.skills, to: .shared) }
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
      }
      ForEach(group.skills) { skill in
        SkillSelectionRow(skill: skill, onPreview: onPreview)
      }
    }
  }

  private func setAll(_ skills: [UnmanagedSkill], to choice: SkillAdoptionChoice) {
    for skill in skills { model.setSkillAdoptionChoice(choice, for: skill) }
  }
}

struct SkillSelectionRow: View {
  @EnvironmentObject private var model: SetupModel
  @Environment(\.colorSchemeContrast) private var contrast
  let skill: UnmanagedSkill
  let onPreview: ((UnmanagedSkill) -> Void)?

  private var choice: SkillAdoptionChoice { model.skillAdoptionChoice(skill) }
  private var destination: String {
    switch choice {
    case .local: skill.sourcePath
    case .provider: skill.providerDestination
    case .shared: skill.sharedDestination
    }
  }

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 7) {
          Text(skill.name)
            .foregroundStyle(Theme.Colors.mist)
          if choice != .local && model.overwriteFlags.contains(skill.id) {
            Label("Replaces existing", systemImage: "exclamationmark.triangle.fill")
              .font(Theme.Fonts.eyebrow)
              .foregroundStyle(Theme.Colors.warning)
          }
        }
        Text(destination)
          .font(Theme.Fonts.mono())
          .foregroundStyle(secondaryText)
          .lineLimit(1)
          .truncationMode(.middle)
      }

      Spacer()

      if let onPreview {
        Button {
          onPreview(skill)
        } label: {
          Label("Preview", systemImage: "doc.text.magnifyingglass")
        }
        .buttonStyle(.regletGhost)
      }

      Picker("Destination", selection: choiceBinding) {
        Text("Leave provider-local").tag(SkillAdoptionChoice.local)
        Text(skill.providerConflict == "destination-exists" ? "Replace provider-only copy" : "This provider only")
          .tag(SkillAdoptionChoice.provider)
        Text(skill.sharedConflict == "destination-exists" ? "Replace shared copy" : "Share with providers")
          .tag(SkillAdoptionChoice.shared)
      }
      .labelsHidden()
      .frame(width: 210)
      .accessibilityLabel("Destination for \(skill.name)")
    }
    .padding(.vertical, 2)
  }

  private var secondaryText: Color {
    contrast == .increased ? Theme.Colors.mist : Theme.Colors.ash
  }

  private var choiceBinding: Binding<SkillAdoptionChoice> {
    Binding(
      get: { model.skillAdoptionChoice(skill) },
      set: { model.setSkillAdoptionChoice($0, for: skill) }
    )
  }
}
