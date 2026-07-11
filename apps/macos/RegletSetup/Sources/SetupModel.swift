import Foundation

@MainActor
final class SetupModel: ObservableObject {
  @Published var scan: ScanResponse?
  @Published var plan: PlanResponse?
  @Published var selectedProviders: Set<String> = []
  @Published var selectedContents: Set<ContentKind> = Set(ContentKind.allCases)
  @Published var isWorking = false
  @Published var errorMessage: String?
  @Published var completionMessage: String?
  @Published var skillsOverview: SkillsOverviewResponse?
  @Published var status: StatusResponse?
  @Published var lastSyncResult: SyncRunResponse?
  @Published var lastSyncError: String?
  @Published var ruleDocuments: [RulesListResponse.Document] = []
  @Published var update: AppUpdate?
  @Published var updateMessage: String?
  @Published var isCheckingForUpdates = false
  /// Keys are "provider:name"; presence = checked for adoption.
  @Published var checkedSkills: Set<String> = []
  /// Chosen scope per skill key; missing = .shared.
  @Published var skillScopes: [String: SkillAdoptionScope] = [:]
  /// Keyed by "provider:name"; presence = overwrite conflicting destination.
  @Published var overwriteFlags: Set<String> = []
  @Published var rulePromptMode: RulePromptMode = .unified
  @Published var selectedRuleMergeProviders: Set<String> = []
  @Published var ruleMergeDraft: RuleMergeDraftResponse?
  @Published var editableRuleMergeDraft = ""
  @Published var ruleMergeError: String?

  private let command: RegletCommand
  private let updateChecker = UpdateChecker()
  private let dismissedUpdateVersionKey = "dismissedUpdateVersion"

  init(command: RegletCommand = RegletCommand()) {
    self.command = command
  }

  var unmanagedSkills: [UnmanagedSkill] {
    skillsOverview?.unmanaged ?? []
  }

  var detectedProviders: [ScanResponse.Provider] {
    scan?.providers.filter(\.detected) ?? []
  }

  /// Unmanaged skills that belong to a currently selected provider.
  var selectedProviderUnmanagedSkills: [UnmanagedSkill] {
    unmanagedSkills.filter { selectedProviders.contains($0.provider) }
  }

  var availableRuleMergeProviders: [RuleComparison] {
    (plan?.reconciliation.rules ?? [])
      .filter { selectedProviders.contains($0.provider) && !$0.preview.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
      .sorted { $0.provider < $1.provider }
  }

  func providerDisplayName(_ id: String) -> String {
    scan?.providers.first(where: { $0.id == id })?.displayName ?? id
  }

  func skillScope(_ key: String) -> SkillAdoptionScope {
    skillScopes[key] ?? .shared
  }

  /// Whether the skill's chosen scope has a clear destination (or overwrite is set).
  func canAdopt(_ skill: UnmanagedSkill) -> Bool {
    let conflict = skillScope(skill.id) == .shared ? skill.sharedConflict : skill.providerConflict
    return conflict != "destination-exists" || overwriteFlags.contains(skill.id)
  }

  /// Drops selection state for skills of a provider (e.g. when it is deselected).
  func clearSkillSelections(provider: String) {
    let prefix = "\(provider):"
    checkedSkills = checkedSkills.filter { !$0.hasPrefix(prefix) }
    skillScopes = skillScopes.filter { !$0.key.hasPrefix(prefix) }
    overwriteFlags = overwriteFlags.filter { !$0.hasPrefix(prefix) }
    selectedRuleMergeProviders.remove(provider)
  }

  var canContinue: Bool {
    !selectedProviders.isEmpty && !selectedContents.isEmpty && !isWorking
  }

  func load() {
    Task {
      await refreshScan()
      await checkForUpdates(silent: true)
    }
  }

  func checkForUpdates(silent: Bool = false) async {
    isCheckingForUpdates = true
    if !silent {
      updateMessage = nil
    }
    defer { isCheckingForUpdates = false }

    do {
      switch try await updateChecker.check() {
      case let .available(availableUpdate):
        let dismissedVersion = UserDefaults.standard.string(forKey: dismissedUpdateVersionKey)
        if !silent || dismissedVersion != availableUpdate.version {
          update = availableUpdate
        }
      case let .upToDate(currentVersion):
        update = nil
        if !silent {
          updateMessage = "Reglet \(currentVersion) is up to date."
        }
      }
    } catch {
      if !silent {
        updateMessage = error.localizedDescription
      }
    }
  }

  func openLatestRelease() {
    guard let update else { return }
    UpdateChecker.openRelease(update)
    dismissUpdate()
  }

  func dismissUpdate() {
    if let update {
      UserDefaults.standard.set(update.version, forKey: dismissedUpdateVersionKey)
    }
    update = nil
  }

  func refreshScan() async {
    await runWork {
      let response = try await self.command.scan()
      self.scan = response
      self.skillsOverview = try await self.command.skillsList()
      self.status = try await self.command.status()
      self.ruleDocuments = try await self.command.rulesList().documents
      if self.selectedProviders.isEmpty {
        self.selectedProviders = Set(response.providers.filter(\.detected).map(\.id))
      }
    }
  }

  func refreshPlan() async {
    await runWork {
      self.plan = try await self.command.plan(
        providers: Array(self.selectedProviders).sorted(),
        contents: Array(self.selectedContents).sorted { $0.rawValue < $1.rawValue }
      )
      let available = Set(self.availableRuleMergeProviders.map(\.provider))
      self.selectedRuleMergeProviders = self.selectedRuleMergeProviders.intersection(available)
      if self.selectedRuleMergeProviders.isEmpty {
        self.selectedRuleMergeProviders = available
      }
    }
  }

  @discardableResult
  func applySelection() async -> Bool {
    await runWork {
      if self.rulePromptMode == .unified && self.selectedContents.contains(.rules) {
        let draft = self.editableRuleMergeDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if draft.isEmpty {
          throw SetupError.message("Generate or enter a unified prompt draft before applying.")
        }
        let nonRuleContents = self.selectedContents.filter { $0 != .rules }
        _ = try await self.command.onboard(
          providers: Array(self.selectedProviders).sorted(),
          contents: Array(nonRuleContents).sorted { $0.rawValue < $1.rawValue },
          includeEmptyContent: true
        )
        try await self.command.writeRule(path: "00-general.md", content: self.editableRuleMergeDraft)
        for provider in self.selectedProviders.sorted() {
          _ = try await self.command.enroll("\(provider):rules")
        }
        _ = try await self.command.applyRules()
        self.completionMessage = "Onboarding complete. Unified prompt draft was saved and applied."
        self.scan = try await self.command.scan()
        return
      }
      let result = try await self.command.onboard(
        providers: Array(self.selectedProviders).sorted(),
        contents: Array(self.selectedContents).sorted { $0.rawValue < $1.rawValue }
      )
      self.completionMessage = result.stdout.isEmpty ? "Onboarding complete." : result.stdout
      self.scan = try await self.command.scan()
    }
  }

  func generateRuleMergeDraft() async {
    isWorking = true
    ruleMergeError = nil
    errorMessage = nil
    defer { isWorking = false }

    guard selectedRuleMergeProviders.count >= 2 else {
      ruleMergeError = "Select at least two provider prompts to merge."
      return
    }

    do {
      let draft = try await command.mergeRuleDraft(providers: Array(selectedRuleMergeProviders).sorted())
      ruleMergeDraft = draft
      editableRuleMergeDraft = draft.draft
    } catch {
      ruleMergeError = error.localizedDescription
    }
  }

  func refreshStatus() async {
    await runWork {
      self.status = try await self.command.status()
    }
  }

  /// Re-applies one managed output from the master, replacing provider drift.
  func reapply(provider: String, content: String) async {
    await runWork {
      _ = try await self.command.applyContent(provider: provider, content: content)
      self.status = try await self.command.status()
    }
  }

  /// Copies drifted provider content back into the master. Does not re-apply;
  /// the drift row stays visible until the user explicitly applies.
  func importDrifted(provider: String, content: String) async {
    await runWork {
      _ = try await self.command.importDrifted(provider: provider, content: content)
      self.completionMessage = "Imported \(provider) \(content) into the master directory."
      self.status = try await self.command.status()
    }
  }

  func configureSync(url: String, token: String, device: String) async -> Bool {
    await runWork {
      _ = try await self.command.login(url: url, token: token, device: device)
      self.status = try await self.command.status()
    }
  }

  func runSync() async {
    isWorking = true
    lastSyncError = nil
    defer { isWorking = false }
    do {
      lastSyncResult = try await command.syncNow()
      status = try await command.status()
    } catch {
      lastSyncError = error.localizedDescription
    }
  }

  func loadRule(path: String) async -> String? {
    var content: String?
    await runWork {
      content = try await self.command.readRule(path: path)
    }
    return content
  }

  func saveRule(path: String, content: String) async -> Bool {
    await runWork {
      try await self.command.writeRule(path: path, content: content)
      self.ruleDocuments = try await self.command.rulesList().documents
      self.completionMessage = "Saved \(path) to the master directory."
    }
  }

  func previewRulesApply() async -> String? {
    var preview: String?
    await runWork {
      preview = try await self.command.diffRules()
    }
    return preview
  }

  func applyRules() async -> Bool {
    await runWork {
      _ = try await self.command.applyRules()
      self.status = try await self.command.status()
      self.completionMessage = "Applied master rules to enrolled providers."
    }
  }

  func restore(provider: String) async {
    await runWork {
      let result = try await self.command.restore(provider: provider)
      self.completionMessage = result.stdout.isEmpty ? "Restore complete." : result.stdout
      self.scan = try await self.command.scan()
    }
  }

  func revert(provider: String) async {
    await runWork {
      let result = try await self.command.revert(provider: provider)
      self.completionMessage = result.stdout.isEmpty ? "Revert complete." : result.stdout
      self.scan = try await self.command.scan()
    }
  }

  /// Adopts every checked skill (optionally limited to the given providers).
  /// Stops the loop at the first failure, but still applies + refreshes when at
  /// least one adoption succeeded. Returns false if anything failed.
  @discardableResult
  func adoptSelectedSkills(limitedTo providers: Set<String>? = nil) async -> Bool {
    isWorking = true
    errorMessage = nil
    defer { isWorking = false }

    let unmanaged = unmanagedSkills
    var adoptedKeys: [String] = []
    var failure: Error?

    for key in checkedSkills.sorted() {
      guard let skill = unmanaged.first(where: { $0.id == key }) else { continue }
      if let providers, !providers.contains(skill.provider) { continue }
      guard canAdopt(skill) else { continue }
      do {
        _ = try await command.adoptSkill(skill, scope: skillScope(key), overwrite: overwriteFlags.contains(key))
        adoptedKeys.append(key)
      } catch {
        failure = error
        break
      }
    }

    if !adoptedKeys.isEmpty {
      var applyFailed = false
      do {
        _ = try await command.applySkills()
      } catch {
        applyFailed = true
        if failure == nil { failure = error }
      }
      do {
        skillsOverview = try await command.skillsList()
        scan = try await command.scan()
      } catch {
        if failure == nil { failure = error }
      }
      for key in adoptedKeys {
        checkedSkills.remove(key)
        skillScopes.removeValue(forKey: key)
        overwriteFlags.remove(key)
      }
      let summary = "\(adoptedKeys.count) skill\(adoptedKeys.count == 1 ? "" : "s")"
      completionMessage = applyFailed
        ? "Adopted \(summary), but applying to providers failed."
        : "Adopted \(summary)."
    }

    if let failure {
      errorMessage = failure.localizedDescription
      return false
    }
    return true
  }

  @discardableResult
  private func runWork(_ operation: @escaping () async throws -> Void) async -> Bool {
    isWorking = true
    errorMessage = nil
    defer {
      isWorking = false
    }

    do {
      try await operation()
      return true
    } catch {
      errorMessage = error.localizedDescription
      return false
    }
  }
}

enum SetupError: LocalizedError {
  case message(String)

  var errorDescription: String? {
    switch self {
    case let .message(message):
      message
    }
  }
}
