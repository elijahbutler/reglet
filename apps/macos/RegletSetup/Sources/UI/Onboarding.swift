import SwiftUI

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
