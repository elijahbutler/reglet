import Foundation
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
      .background(Theme.Colors.voidBlack)
    }
    .overlay(alignment: .bottom) {
      if model.isWorking {
        ProgressView()
          .controlSize(.small)
          .padding(12)
      }
    }
    .background(Theme.Colors.voidBlack)
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
      ZStack {
        RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
          .fill(Theme.Colors.coral)
        Image(systemName: "slider.horizontal.3")
          .font(Theme.Fonts.bodyLg)
          .symbolRenderingMode(.hierarchical)
          .foregroundStyle(Theme.Colors.voidBlack)
      }
      .frame(width: 34, height: 34)
      .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text("Reglet Setup")
          .font(Theme.Fonts.subheading)
          .foregroundStyle(Theme.Colors.mist)
        Text("One source of truth for local agent configuration")
          .foregroundStyle(Theme.Colors.ash)
          .font(Theme.Fonts.body)
      }
      Spacer()
      StepRail(steps: steps, currentStep: step)
        .frame(width: 460)
    }
    .padding(20)
    .background(Theme.Colors.ink)
  }
}

private struct StepRail: View {
  let steps: [String]
  let currentStep: Int

  var body: some View {
    HStack(spacing: 6) {
      ForEach(steps.indices, id: \.self) { index in
        StepPill(title: steps[index], state: state(for: index))
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Step \(min(currentStep + 1, steps.count)) of \(steps.count): \(steps[min(currentStep, steps.count - 1)])")
  }

  private func state(for index: Int) -> StepPill.State {
    if index < currentStep { return .completed }
    if index == currentStep { return .active }
    return .upcoming
  }
}

private struct StepPill: View {
  enum State {
    case completed
    case active
    case upcoming
  }

  let title: String
  let state: State

  var body: some View {
    HStack(spacing: 5) {
      if state == .completed {
        Image(systemName: "checkmark")
          .font(Theme.Fonts.eyebrow)
      }
      Text(title)
        .lineLimit(1)
    }
    .font(Theme.Fonts.eyebrow)
    .foregroundStyle(foreground)
    .padding(.horizontal, 9)
    .padding(.vertical, 6)
    .frame(maxWidth: .infinity)
    .background(background, in: Capsule())
  }

  private var background: Color {
    state == .active ? Theme.Colors.mist : Theme.Colors.graphite
  }

  private var foreground: Color {
    state == .active ? Theme.Colors.voidBlack : Theme.Colors.ash
  }
}

struct SafetyView: View {
  let continueAction: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      Spacer()
      VStack(alignment: .leading, spacing: 10) {
        Text("Set up Reglet without surprises.")
          .font(Theme.Fonts.headingLg)
          .foregroundStyle(Theme.Colors.white)
        Text("Reglet will scan local agent configuration, show the exact files involved, and wait for confirmation before writing provider files.")
          .font(Theme.Fonts.bodyLg)
          .foregroundStyle(Theme.Colors.ash)
          .frame(maxWidth: 680, alignment: .leading)
      }

      VStack(alignment: .leading, spacing: 12) {
        SafetyRow(symbol: "checkmark.shield", title: "No daemon starts during setup")
        SafetyRow(symbol: "network.slash", title: "Local by default; optional AI drafting runs only with per-use consent")
        SafetyRow(symbol: "doc.badge.gearshape", title: "Provider writes are previewed before backup and apply")
        SafetyRow(symbol: "clock.arrow.circlepath", title: "Restore and revert remain available after onboarding")
      }

      Button {
        continueAction()
      } label: {
        Label("Continue", systemImage: "arrow.right")
      }
      .buttonStyle(.regletPrimary)
      .controlSize(.large)
      .keyboardShortcut(.defaultAction)
      .accessibilityHint("Continues to provider selection")

      Spacer()
    }
    .padding(40)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.Colors.voidBlack)
  }
}

struct SelectionView: View {
  @EnvironmentObject private var model: SetupModel
  let continueAction: () -> Void

  var body: some View {
    HSplitView {
      VStack(alignment: .leading, spacing: 12) {
        Label("Providers", systemImage: "macwindow")
          .font(Theme.Fonts.subheading)
          .foregroundStyle(Theme.Colors.mist)
        ScrollView {
          VStack(alignment: .leading, spacing: 8) {
            ForEach(model.scan?.providers ?? []) { provider in
              Toggle(isOn: providerBinding(provider.id)) {
                VStack(alignment: .leading, spacing: 2) {
                  Text(provider.displayName)
                    .foregroundStyle(Theme.Colors.mist)
                  Text(provider.detected ? "Detected" : "Not found")
                    .font(Theme.Fonts.eyebrow)
                    .foregroundStyle(provider.detected ? Theme.Colors.ash : Theme.Colors.smoke)
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
      .background(Theme.Colors.ink)

      VStack(alignment: .leading, spacing: 18) {
        Label("Content", systemImage: "checklist")
          .font(Theme.Fonts.subheading)
          .foregroundStyle(Theme.Colors.mist)
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
          .buttonStyle(.regletPrimary)
          .keyboardShortcut(.defaultAction)
          .disabled(!model.canContinue)
        }
      }
      .padding(24)
      .frame(minWidth: 420)
      .background(Theme.Colors.ink)
    }
    .background(Theme.Colors.voidBlack)
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
  @State private var consentRunner: RuleMergeRunner?
  let back: () -> Void
  let continueAction: () -> Void

  private var availableSources: [RuleComparison] {
    model.availableRuleMergeProviders
  }

  private var canGenerate: Bool {
    model.rulePromptMode == .unified
      && model.selectedRuleMergeProviders.count >= 2
      && model.selectedRuleMergeRunner != nil
      && !model.isWorking
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
              .foregroundStyle(Theme.Colors.ash)
          } else {
            Text("Reglet will save one reviewed unified draft to 00-general.md and skip importing provider-specific prompt files.")
              .foregroundStyle(Theme.Colors.ash)
          }
        }

        if model.rulePromptMode == .unified {
          Section {
            if availableSources.count < 2 {
              Text("At least two selected providers need existing prompt files before Reglet can generate a merge.")
                .foregroundStyle(Theme.Colors.ash)
            } else {
              ForEach(availableSources) { source in
                Toggle(isOn: mergeSourceBinding(source.provider)) {
                  VStack(alignment: .leading, spacing: 2) {
                    Text(model.providerDisplayName(source.provider))
                      .foregroundStyle(Theme.Colors.mist)
                    Text(source.sourcePath)
                      .font(Theme.Fonts.mono(size: 11))
                      .foregroundStyle(Theme.Colors.ash)
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
            if model.ruleMergeRunners.isEmpty {
              Label("No supported local AI tool was found. You can still enter a unified draft manually.", systemImage: "wand.and.stars")
                .foregroundStyle(Theme.Colors.ash)
            } else {
              Picker("AI tool", selection: $model.selectedRuleMergeRunnerID) {
                ForEach(model.ruleMergeRunners) { runner in
                  Text(runner.displayName).tag(Optional(runner.id))
                }
              }
              .accessibilityHint("Chooses the local command-line AI tool used to generate the draft")

              if let runner = model.selectedRuleMergeRunner {
                LabeledContent("Executable") {
                  Text(runner.executablePath)
                    .font(Theme.Fonts.mono(size: 11))
                    .foregroundStyle(Theme.Colors.ash)
                    .textSelection(.enabled)
                }
              }
            }

            if let draft = model.ruleMergeDraft {
              LabeledContent("Generated with", value: draft.provider)
              Text("\(draft.sources.count) source prompts merged.")
                .foregroundStyle(Theme.Colors.ash)
            } else {
              Text("Generate a draft, then review and edit it here before continuing.")
                .foregroundStyle(Theme.Colors.ash)
            }

            TextEditor(text: $model.editableRuleMergeDraft)
              .font(Theme.Fonts.mono(size: 13))
              .frame(minHeight: 180)
              .accessibilityLabel("Unified system prompt draft")

            if let error = model.ruleMergeError {
              Label(error, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.Colors.warning)
                .textSelection(.enabled)
            }

            HStack {
              Spacer()
              Button {
                consentRunner = model.selectedRuleMergeRunner
              } label: {
                HStack(spacing: 8) {
                  StatusBadge(text: "AI", kind: .brand)
                  Label(model.ruleMergeDraft == nil ? "Generate AI Draft" : "Retry AI Merge", systemImage: "wand.and.stars")
                }
              }
              .buttonStyle(.regletSecondary)
              .disabled(!canGenerate)
            }
          }
        }
      }
      .formStyle(.grouped)
      .scrollContentBackground(.hidden)
      .background(Theme.Colors.voidBlack)
      Divider()
      StatusStrip {
        HStack {
          Button("Back", action: back)
            .buttonStyle(.regletGhost)
            .keyboardShortcut(.cancelAction)
          Spacer()
          Button {
            continueAction()
          } label: {
            Label("Continue", systemImage: "arrow.right")
          }
          .buttonStyle(.regletPrimary)
          .keyboardShortcut(.defaultAction)
          .disabled(!canContinue)
        }
      }
    }
    .background(Theme.Colors.voidBlack)
    .sheet(item: $consentRunner) { runner in
      AiDraftConsentView(
        runner: runner,
        sources: availableSources.filter { model.selectedRuleMergeProviders.contains($0.provider) },
        cancel: { consentRunner = nil },
        generate: {
          consentRunner = nil
          Task { await model.generateRuleMergeDraft(runner: runner) }
        }
      )
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

private struct AiDraftConsentView: View {
  let runner: RuleMergeRunner
  let sources: [RuleComparison]
  let cancel: () -> Void
  let generate: () -> Void

  @FocusState private var focusesGenerate: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: Theme.Spacing.md) {
      VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
        HStack(spacing: Theme.Spacing.xs) {
          StatusBadge(text: "External AI", kind: .brand)
          Text("Generate with \(runner.displayName)?")
            .font(Theme.Fonts.headingSm)
            .foregroundStyle(Theme.Colors.mist)
        }
        Text("Reglet will run this installed command once to propose a unified system prompt.")
          .font(Theme.Fonts.bodyLg)
          .foregroundStyle(Theme.Colors.ash)
      }

      VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
        Text("Executable")
          .font(Theme.Fonts.eyebrow)
          .foregroundStyle(Theme.Colors.ash)
        Text(runner.executablePath)
          .font(Theme.Fonts.mono())
          .foregroundStyle(Theme.Colors.mist)
          .textSelection(.enabled)
      }

      VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
        Text("Files sent to the tool")
          .font(Theme.Fonts.eyebrow)
          .foregroundStyle(Theme.Colors.ash)
        ScrollView {
          VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            ForEach(sources) { source in
              HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.xs) {
                Image(systemName: "doc.text")
                  .foregroundStyle(Theme.Colors.info)
                  .accessibilityHidden(true)
                Text(source.sourcePath)
                  .font(Theme.Fonts.mono(size: 11))
                  .foregroundStyle(Theme.Colors.mist)
                  .textSelection(.enabled)
                  .frame(maxWidth: .infinity, alignment: .leading)
              }
            }
          }
        }
        .frame(maxHeight: 150)
      }

      Label {
        Text("The contents of these files are sent to \(runner.displayName) under its provider's privacy terms. The returned draft stays editable and is not saved or applied until you complete final Apply.")
      } icon: {
        Image(systemName: "lock.shield")
      }
      .font(Theme.Fonts.body)
      .foregroundStyle(Theme.Colors.ash)

      HStack {
        Spacer()
        Button("Cancel", action: cancel)
          .buttonStyle(.regletGhost)
          .keyboardShortcut(.cancelAction)
        Button("Generate with \(runner.displayName)", action: generate)
          .buttonStyle(.regletPrimary)
          .keyboardShortcut(.defaultAction)
          .focused($focusesGenerate)
      }
    }
    .padding(Theme.Spacing.lg)
    .frame(width: 620, height: 470)
    .background(Theme.Colors.voidBlack)
    .onAppear { focusesGenerate = true }
  }
}

struct SkillsStepView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var previewedSkill: UnmanagedSkill?
  let back: () -> Void
  let continueAction: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      List {
        Section {
          UnmanagedSkillsGroups(
            skills: model.selectedProviderUnmanagedSkills,
            onPreview: { previewedSkill = $0 }
          )
        } header: {
          Text("Choose where each provider-local skill belongs")
        } footer: {
          Text("Leaving a skill provider-local makes no changes. Other choices stage a copy for the file review on the next step.")
        }
      }
      .listStyle(.inset)
      .scrollContentBackground(.hidden)
      .background(Theme.Colors.voidBlack)
      .padding(.horizontal, Theme.Spacing.sm)
      Divider()
      StatusStrip {
        HStack {
          Button("Back", action: back)
            .buttonStyle(.regletGhost)
            .keyboardShortcut(.cancelAction)
          Spacer()
          Button {
            continueAction()
          } label: {
            Label("Review Setup", systemImage: "arrow.right")
          }
          .buttonStyle(.regletPrimary)
          .keyboardShortcut(.defaultAction)
          .disabled(model.isWorking)
        }
      }
    }
    .background(Theme.Colors.voidBlack)
    .sheet(item: $previewedSkill) { skill in
      UnmanagedSkillPreview(skill: skill)
        .environmentObject(model)
    }
  }
}

private struct UnmanagedSkillPreview: View {
  @EnvironmentObject private var model: SetupModel
  @Environment(\.dismiss) private var dismiss
  let skill: UnmanagedSkill
  @State private var tree: ManagedSkillTree?
  @State private var selectedPath: String?
  @State private var content = ""
  @State private var isLoadingTree = false
  @State private var isLoadingFile = false

  private var selectedFile: ManagedSkillTree.File? {
    tree?.files.first { $0.path == selectedPath }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 5) {
        HStack {
          Label(skill.name, systemImage: "hammer")
            .font(Theme.Fonts.subheading)
            .foregroundStyle(Theme.Colors.mist)
          Spacer()
          StatusBadge(text: model.providerDisplayName(skill.provider), kind: .info)
          Button("Done") { dismiss() }
            .buttonStyle(.regletSecondary)
            .keyboardShortcut(.cancelAction)
        }
        Text(skill.sourcePath)
          .font(Theme.Fonts.mono(size: 11))
          .foregroundStyle(Theme.Colors.ash)
          .textSelection(.enabled)
          .lineLimit(2)
          .truncationMode(.middle)
      }
      .padding(Theme.Spacing.sm)

      Divider()

      if isLoadingTree {
        ProgressView("Loading files…")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if let tree, tree.files.isEmpty {
        ContentUnavailableView("No files", systemImage: "doc", description: Text("This skill directory is empty."))
      } else if tree != nil {
        HSplitView {
          List(tree?.files ?? [], selection: $selectedPath) { file in
            VStack(alignment: .leading, spacing: 2) {
              Label(file.path, systemImage: "doc")
                .lineLimit(1)
              Text(ByteCountFormatter.string(fromByteCount: Int64(file.bytes), countStyle: .file))
                .font(Theme.Fonts.eyebrow)
                .foregroundStyle(Theme.Colors.ash)
            }
            .tag(file.path)
          }
          .listStyle(.sidebar)
          .scrollContentBackground(.hidden)
          .background(Theme.Colors.graphite)
          .frame(minWidth: 210, idealWidth: 240)

          Group {
            if isLoadingFile {
              ProgressView("Loading preview…")
            } else if selectedPath == nil {
              ContentUnavailableView("Select a file", systemImage: "doc.text")
            } else if let selectedFile, selectedFile.bytes > 1_000_000 {
              ContentUnavailableView(
                "File too large to preview",
                systemImage: "doc.badge.ellipsis",
                description: Text("The file remains included if you adopt this skill.")
              )
            } else {
              ScrollView([.horizontal, .vertical]) {
                Text(content.isEmpty ? "(empty file)" : content)
                  .font(Theme.Fonts.mono(size: 12))
                  .foregroundStyle(Theme.Colors.mist)
                  .textSelection(.enabled)
                  .frame(maxWidth: .infinity, alignment: .topLeading)
                  .padding(Theme.Spacing.sm)
              }
            }
          }
          .frame(minWidth: 500, maxWidth: .infinity, maxHeight: .infinity)
          .background(Theme.Colors.ink)
        }
      } else {
        ContentUnavailableView("Preview unavailable", systemImage: "exclamationmark.triangle")
      }
    }
    .frame(minWidth: 760, idealWidth: 880, minHeight: 520, idealHeight: 600)
    .background(Theme.Colors.voidBlack)
    .task(id: skill.id) {
      isLoadingTree = true
      tree = await model.loadUnmanagedSkillTree(skill)
      selectedPath = tree?.files.first(where: { $0.path == "SKILL.md" })?.path ?? tree?.files.first?.path
      isLoadingTree = false
    }
    .task(id: selectedPath) {
      guard let selectedPath else { return }
      guard let file = tree?.files.first(where: { $0.path == selectedPath }), file.bytes <= 1_000_000 else {
        content = ""
        return
      }
      isLoadingFile = true
      content = await model.loadUnmanagedSkillFile(skill, path: selectedPath) ?? ""
      isLoadingFile = false
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

  private var hasBlockedAdoption: Bool {
    selectedAdoptions.contains { skill in
      let destination = model.skillScope(skill.id) == .shared ? skill.sharedDestination : skill.providerDestination
      return !model.canAdopt(skill) || duplicateAdoptionDestinations.contains(destination)
    }
  }

  private var hasBlockedUnifiedDraft: Bool {
    model.rulePromptMode == .unified
      && model.selectedContents.contains(.rules)
      && model.editableRuleMergeDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private var providerSummaries: [OnboardingProviderSummary] {
    (model.scan?.providers ?? [])
      .filter { model.selectedProviders.contains($0.id) }
      .map { provider in
        OnboardingProviderSummary(
          id: provider.id,
          displayName: previewProviderName(provider.id, fallback: provider.displayName),
          ruleFileName: model.selectedContents.contains(.rules)
            ? provider.inventory.rulesPath.map { ($0 as NSString).lastPathComponent }
            : nil,
          skillNames: model.selectedContents.contains(.skills) && provider.inventory.skillsDir != nil
            ? skillNames(for: provider.id)
            : [],
          includesMcp: model.selectedContents.contains(.mcp) && provider.inventory.mcpPath != nil
        )
      }
      .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
  }

  private var unifiedSkillCount: Int {
    Set(providerSummaries.flatMap(\.skillNames)).count
  }

  var body: some View {
    VStack(spacing: 0) {
      List {
        Section {
          UnifiedSourceSummary(
            contents: model.selectedContents,
            skillCount: unifiedSkillCount
          )
        } header: {
          Text("Reglet")
        }

        Section("Provider destinations") {
          ForEach(providerSummaries) { provider in
            OnboardingProviderSyncDisclosure(provider: provider)
          }
        }
      }
      .listStyle(.inset)
      .scrollContentBackground(.hidden)
      .background(Theme.Colors.voidBlack)
      Divider()
      StatusStrip {
        HStack {
          Button("Back", action: back)
            .buttonStyle(.regletGhost)
            .keyboardShortcut(.cancelAction)
          Spacer()
          Text(statusMessage)
            .foregroundStyle(Theme.Colors.ash)
          Button {
            review()
          } label: {
            Label("Review Changes", systemImage: "doc.text.magnifyingglass")
          }
          .buttonStyle(.regletPrimary)
          .keyboardShortcut(.defaultAction)
          .accessibilityHint("Stages the local master content, then opens the digest-backed provider review")
          .disabled(model.isWorking || hasBlockedAdoption || hasBlockedUnifiedDraft)
        }
      }
    }
    .background(Theme.Colors.voidBlack)
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

  private func skillNames(for provider: String) -> [String] {
    var names = Set(model.skillsOverview?.shared.map(\.name) ?? [])
    names.formUnion(
      model.skillsOverview?.providerScoped
        .filter { $0.provider == provider }
        .map(\.name) ?? []
    )

    for skill in selectedAdoptions {
      if model.skillScope(skill.id) == .shared || skill.provider == provider {
        names.insert(skill.name)
      }
    }
    return names.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
  }
}

private struct OnboardingProviderSummary: Identifiable {
  let id: String
  let displayName: String
  let ruleFileName: String?
  let skillNames: [String]
  let includesMcp: Bool

  var summary: String {
    var parts: [String] = []
    if let ruleFileName { parts.append(ruleFileName) }
    if !skillNames.isEmpty { parts.append("\(skillNames.count) skill\(skillNames.count == 1 ? "" : "s")") }
    if includesMcp { parts.append("MCP") }
    return parts.isEmpty ? "Nothing to sync" : parts.joined(separator: " · ")
  }
}

private struct OnboardingProviderSyncDisclosure: View {
  let provider: OnboardingProviderSummary
  @State private var isExpanded = false

  var body: some View {
    DisclosureGroup(isExpanded: $isExpanded) {
      VStack(spacing: 0) {
        if let ruleFileName = provider.ruleFileName {
          OnboardingSyncRow(icon: "doc.text", name: "AGENT.md → \(ruleFileName)", detail: "Unified instructions")
        }
        ForEach(provider.skillNames, id: \.self) { name in
          OnboardingSyncRow(icon: "hammer", name: name, detail: "Skill")
        }
        if provider.includesMcp {
          OnboardingSyncRow(icon: "server.rack", name: "MCP settings", detail: "Provider configuration")
        }
        if provider.ruleFileName == nil && provider.skillNames.isEmpty && !provider.includesMcp {
          Label("No supported content selected", systemImage: "minus.circle")
            .font(Theme.Fonts.body)
            .foregroundStyle(Theme.Colors.ash)
            .padding(.vertical, 8)
        }
      }
      .padding(.leading, 4)
    } label: {
      VStack(alignment: .leading, spacing: 2) {
        Text(provider.displayName)
          .font(Theme.Fonts.bodyLg)
          .foregroundStyle(Theme.Colors.mist)
        Text(provider.summary)
          .font(Theme.Fonts.eyebrow)
          .foregroundStyle(Theme.Colors.ash)
      }
    }
    .padding(.vertical, 6)
    .listRowBackground(Theme.Colors.voidBlack)
    .listRowSeparatorTint(Theme.Colors.white.opacity(0.10))
  }
}

private struct OnboardingSyncRow: View {
  let icon: String
  let name: String
  let detail: String

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: icon)
        .foregroundStyle(Theme.Colors.ash)
        .frame(width: 22)
      VStack(alignment: .leading, spacing: 2) {
        Text(name)
          .font(Theme.Fonts.body)
          .foregroundStyle(Theme.Colors.mist)
        Text(detail)
          .font(Theme.Fonts.eyebrow)
          .foregroundStyle(Theme.Colors.ash)
      }
      Spacer()
    }
    .padding(.vertical, 8)
  }
}

struct StatusView: View {
  @EnvironmentObject private var model: SetupModel
  let startOver: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Label("Setup Complete", systemImage: "checkmark.seal")
        .font(Theme.Fonts.headingLg)
        .foregroundStyle(Theme.Colors.mist)
      Text(model.completionMessage ?? "Reglet finished onboarding.")
        .foregroundStyle(Theme.Colors.ash)
        .textSelection(.enabled)

      List(model.detectedProviders) { provider in
        HStack {
          VStack(alignment: .leading) {
            Text(provider.displayName)
            Text(provider.id)
              .font(Theme.Fonts.eyebrow)
              .foregroundStyle(Theme.Colors.ash)
          }
          Spacer()
          Text(provider.enabled ? "Managed" : "Available")
            .font(Theme.Fonts.eyebrow)
            .foregroundStyle(Theme.Colors.ash)
        }
        .padding(.vertical, 4)
      }
      .listStyle(.inset)
      .scrollContentBackground(.hidden)
      .background(Theme.Colors.voidBlack)

      HStack {
        Button("Review Another Selection", action: startOver)
          .buttonStyle(.regletSecondary)
        Spacer()
      }
    }
    .padding(32)
    .background(Theme.Colors.voidBlack)
  }
}
