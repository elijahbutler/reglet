import Foundation

struct ApplyReviewScope: Identifiable {
  let preview: StructuredApplyPreview
  let contents: [ContentKind]
  let providers: [String]
  let title: String

  var id: String {
    "\(providers.joined(separator: ",")):\(contents.map(\.rawValue).joined(separator: ",")):\(preview.digest)"
  }
}

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
  @Published var operationReceipts: [OperationReceipt] = []
  @Published var legacyNetworkState: LegacyNetworkState?
  @Published var ruleDocuments: [RulesListResponse.Document] = []
  @Published var mcpServers: [McpServersResponse.Entry] = []
  @Published var update: AppUpdate?
  @Published var updateMessage: String?
  @Published var isCheckingForUpdates = false
  @Published var automaticUpdateChecks = UserDefaults.standard.bool(forKey: "automaticUpdateChecks")
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
  @Published var ruleMergeRunners: [RuleMergeRunner] = []
  @Published var selectedRuleMergeRunnerID: String?

  private let command: RegletCommand
  private let updateChecker = UpdateChecker()
  private let dismissedUpdateVersionKey = "dismissedUpdateVersion"
  private let automaticUpdateChecksKey = "automaticUpdateChecks"

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

  var selectedRuleMergeRunner: RuleMergeRunner? {
    ruleMergeRunners.first { $0.id == selectedRuleMergeRunnerID }
  }

  func providerDisplayName(_ id: String) -> String {
    scan?.providers.first(where: { $0.id == id })?.displayName ?? id
  }

  func skillScope(_ key: String) -> SkillAdoptionScope {
    skillScopes[key] ?? .shared
  }

  func skillAdoptionChoice(_ skill: UnmanagedSkill) -> SkillAdoptionChoice {
    guard checkedSkills.contains(skill.id) else { return .local }
    return skillScope(skill.id) == .provider ? .provider : .shared
  }

  func setSkillAdoptionChoice(_ choice: SkillAdoptionChoice, for skill: UnmanagedSkill) {
    switch choice {
    case .local:
      checkedSkills.remove(skill.id)
      skillScopes.removeValue(forKey: skill.id)
      overwriteFlags.remove(skill.id)
    case .provider, .shared:
      let scope: SkillAdoptionScope = choice == .provider ? .provider : .shared
      let conflict = scope == .provider ? skill.providerConflict : skill.sharedConflict
      checkedSkills.insert(skill.id)
      skillScopes[skill.id] = scope
      if conflict == "destination-exists" {
        overwriteFlags.insert(skill.id)
      } else {
        overwriteFlags.remove(skill.id)
      }
    }
  }

  /// Whether the skill's chosen scope has a clear destination (or overwrite is set).
  func canAdopt(_ skill: UnmanagedSkill) -> Bool {
    let conflict = skillScope(skill.id) == .shared ? skill.sharedConflict : skill.providerConflict
    return conflict != "destination-exists" || overwriteFlags.contains(skill.id)
  }

  func hasPendingSkillOverwrite(limitedTo providers: Set<String>? = nil) -> Bool {
    unmanagedSkills.contains { skill in
      checkedSkills.contains(skill.id)
        && overwriteFlags.contains(skill.id)
        && (providers == nil || providers?.contains(skill.provider) == true)
    }
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
      if automaticUpdateChecks {
        await checkForUpdates(silent: true)
      }
    }
  }

  func setAutomaticUpdateChecks(_ enabled: Bool) {
    automaticUpdateChecks = enabled
    UserDefaults.standard.set(enabled, forKey: automaticUpdateChecksKey)
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
      let snapshot = try await self.command.managerSnapshot()
      self.apply(snapshot)
      if self.selectedProviders.isEmpty {
        self.selectedProviders = Set(snapshot.scan.providers.filter(\.detected).map(\.id))
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
      do {
        self.ruleMergeRunners = try await self.command.ruleMergeRunners().runners
        if !self.ruleMergeRunners.contains(where: { $0.id == self.selectedRuleMergeRunnerID }) {
          self.selectedRuleMergeRunnerID = self.ruleMergeRunners.first?.id
        }
      } catch {
        self.ruleMergeRunners = []
        self.selectedRuleMergeRunnerID = nil
        self.ruleMergeError = error.localizedDescription
      }
    }
  }

  func prepareOnboardingReview() async -> ApplyReviewScope? {
    var review: ApplyReviewScope?
    await runWork {
      let providers = Array(self.selectedProviders).sorted()
      let contents = Array(self.selectedContents).sorted { $0.rawValue < $1.rawValue }
      if self.rulePromptMode == .unified && self.selectedContents.contains(.rules) {
        let draft = self.editableRuleMergeDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if draft.isEmpty {
          throw SetupError.message("Generate or enter a unified prompt draft before applying.")
        }
        let nonRuleContents = contents.filter { $0 != .rules }
        _ = try await self.command.onboard(
          providers: providers,
          contents: nonRuleContents,
          includeEmptyContent: true
        )
        try await self.command.writeRule(path: "00-general.md", content: self.editableRuleMergeDraft)
        for provider in providers {
          _ = try await self.command.enroll("\(provider):rules")
        }
      } else {
        _ = try await self.command.onboard(providers: providers, contents: contents)
      }

      let adopted = try await self.stageSelectedSkills(limitedTo: self.selectedProviders)
      let preview = try await self.command.previewApply(contents: contents, providers: providers)
      self.apply(try await self.command.managerSnapshot())
      self.completionMessage = adopted == 0
        ? "Onboarding changes are staged locally. Review the exact provider writes before applying."
        : "Onboarding changes and \(adopted) skill\(adopted == 1 ? "" : "s") are staged locally. Review the exact provider writes before applying."
      review = ApplyReviewScope(
        preview: preview,
        contents: contents,
        providers: providers,
        title: "Review Onboarding Apply"
      )
    }
    return review
  }

  func generateRuleMergeDraft(runner: RuleMergeRunner) async {
    isWorking = true
    ruleMergeError = nil
    errorMessage = nil
    defer { isWorking = false }

    guard selectedRuleMergeProviders.count >= 2 else {
      ruleMergeError = "Select at least two provider prompts to merge."
      return
    }

    do {
      let draft = try await command.mergeRuleDraft(
        providers: Array(selectedRuleMergeProviders).sorted(),
        runner: runner.id
      )
      ruleMergeDraft = draft
      editableRuleMergeDraft = draft.draft
    } catch {
      ruleMergeError = "\(error.localizedDescription)\n\nMake sure \(runner.displayName) is signed in, then retry. Sign-in command: \(runner.signInCommand)"
    }
  }

  func refreshStatus() async {
    await runWork {
      self.apply(try await self.command.managerSnapshot())
    }
  }

  /// Copies drifted provider content back into the master. Does not re-apply;
  /// the drift row stays visible until the user explicitly applies.
  func importDrifted(provider: String, content: String) async {
    await runWork {
      _ = try await self.command.importDrifted(provider: provider, content: content)
      self.completionMessage = "Imported \(provider) \(content) into the master directory."
      self.apply(try await self.command.managerSnapshot())
    }
  }

  func stopManaging(provider: String, content: String? = nil) async {
    await runWork {
      let target = content.map { "\(provider):\($0)" } ?? provider
      _ = try await self.command.unenroll(target)
      self.completionMessage = "Stopped managing \(target). Provider content was preserved."
      self.apply(try await self.command.managerSnapshot())
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
      self.apply(try await self.command.managerSnapshot())
      self.completionMessage = "Saved \(path) to the master directory."
    }
  }

  func loadSkillTree(name: String, provider: String?) async -> ManagedSkillTree? {
    var tree: ManagedSkillTree?
    await runWork { tree = try await self.command.skillTree(name: name, provider: provider).tree }
    return tree
  }

  func loadSkillFile(name: String, provider: String?, path: String) async -> String? {
    var content: String?
    await runWork { content = try await self.command.readSkillFile(name: name, provider: provider, path: path).document.content }
    return content
  }

  func loadUnmanagedSkillTree(_ skill: UnmanagedSkill) async -> ManagedSkillTree? {
    var tree: ManagedSkillTree?
    await runWork { tree = try await self.command.inspectUnmanagedSkill(skill).tree }
    return tree
  }

  func loadUnmanagedSkillFile(_ skill: UnmanagedSkill, path: String) async -> String? {
    var content: String?
    await runWork { content = try await self.command.readUnmanagedSkillFile(skill, path: path).document.content }
    return content
  }

  func saveSkillFile(name: String, provider: String?, path: String, content: String) async -> Bool {
    await runWork {
      try await self.command.writeSkillFile(name: name, provider: provider, path: path, content: content)
      self.apply(try await self.command.managerSnapshot())
      self.completionMessage = "Saved \(path) to the master — not applied."
    }
  }

  func createSkill(name: String, provider: String?, content: String) async -> Bool {
    await runWork {
      try await self.command.createSkill(name: name, provider: provider, content: content)
      self.apply(try await self.command.managerSnapshot())
      self.completionMessage = "Created \(name) in the master — not applied."
    }
  }

  func deleteSkill(name: String, provider: String?) async -> Bool {
    await runWork {
      try await self.command.deleteSkill(name: name, provider: provider)
      self.apply(try await self.command.managerSnapshot())
      self.completionMessage = "Deleted \(name) from the master — not applied."
    }
  }

  func renameSkill(name: String, newName: String, provider: String?) async -> Bool {
    await runWork {
      try await self.command.renameSkill(name: name, newName: newName, provider: provider)
      self.apply(try await self.command.managerSnapshot())
      self.completionMessage = "Renamed \(name) to \(newName) in the master — not applied."
    }
  }

  func deleteSkillFile(name: String, provider: String?, path: String) async -> Bool {
    await runWork {
      try await self.command.deleteSkillFile(name: name, provider: provider, path: path)
      self.completionMessage = "Deleted \(path) from the master — not applied."
    }
  }

  func renameSkillFile(name: String, provider: String?, path: String, newPath: String) async -> Bool {
    await runWork {
      try await self.command.renameSkillFile(name: name, provider: provider, path: path, newPath: newPath)
      self.completionMessage = "Renamed \(path) to \(newPath) in the master — not applied."
    }
  }

  func saveMcp(name: String, definition: McpServerDefinition) async -> Bool {
    await runWork {
      try await self.command.upsertMcp(name: name, definition: definition)
      self.apply(try await self.command.managerSnapshot())
      self.completionMessage = "Saved \(name) to the master — not applied."
    }
  }

  func deleteMcp(name: String) async -> Bool {
    await runWork {
      try await self.command.deleteMcp(name: name)
      self.apply(try await self.command.managerSnapshot())
      self.completionMessage = "Deleted \(name) from the master — not applied."
    }
  }

  func previewApply(contents: [ContentKind], providers: [String] = []) async -> StructuredApplyPreview? {
    var preview: StructuredApplyPreview?
    await runWork { preview = try await self.command.previewApply(contents: contents, providers: providers) }
    return preview
  }

  func previewApply(content: ContentKind, provider: String? = nil) async -> StructuredApplyPreview? {
    await previewApply(contents: [content], providers: provider.map { [$0] } ?? [])
  }

  func applyPreview(_ preview: StructuredApplyPreview, contents: [ContentKind], providers: [String] = []) async -> Bool {
    await runWork {
      try await self.command.applyPreview(preview, contents: contents, providers: providers)
      let snapshot = try await self.command.managerSnapshot()
      self.apply(snapshot)
      let receipt = snapshot.operations.first(where: { $0.structuredPreviewDigest == preview.digest })
      let contentLabel = contents.map(\.label).joined(separator: ", ")
      self.completionMessage = receipt == nil
        ? "Applied \(contentLabel) to providers."
        : "Applied \(contentLabel) to providers. Receipt: \(receipt?.id ?? "")."
    }
  }

  func applyPreview(_ preview: StructuredApplyPreview, content: ContentKind, provider: String? = nil) async -> Bool {
    await applyPreview(preview, contents: [content], providers: provider.map { [$0] } ?? [])
  }

  func restoreOperation(_ id: String) async {
    await runWork {
      let result = try await self.command.restoreOperation(id)
      self.completionMessage = result.stdout.isEmpty ? "Restore complete." : result.stdout
      self.apply(try await self.command.managerSnapshot())
    }
  }

  func clearLegacyNetworkState() async {
    await runWork {
      let result = try await self.command.clearLegacyNetworkState()
      self.completionMessage = result.stdout.isEmpty ? "Legacy network state cleared." : result.stdout
      self.apply(try await self.command.managerSnapshot())
    }
  }

  /// Adopts every checked skill into the master directory. Provider writes are
  /// deliberately deferred until the caller opens a structured Review & Apply.
  @discardableResult
  func adoptSelectedSkills(limitedTo providers: Set<String>? = nil) async -> Bool {
    isWorking = true
    errorMessage = nil
    defer { isWorking = false }

    do {
      let adopted = try await stageSelectedSkills(limitedTo: providers)
      if adopted > 0 {
        apply(try await command.managerSnapshot())
        completionMessage = "Adopted \(adopted) skill\(adopted == 1 ? "" : "s") into the master. Review & Apply Skills to distribute them."
      }
    } catch {
      errorMessage = error.localizedDescription
      return false
    }
    return true
  }

  private func stageSelectedSkills(limitedTo providers: Set<String>? = nil) async throws -> Int {
    let unmanaged = unmanagedSkills
    var adoptedKeys: [String] = []

    for key in checkedSkills.sorted() {
      guard let skill = unmanaged.first(where: { $0.id == key }) else { continue }
      if let providers, !providers.contains(skill.provider) { continue }
      guard canAdopt(skill) else { continue }
      _ = try await command.adoptSkill(skill, scope: skillScope(key), overwrite: overwriteFlags.contains(key))
      adoptedKeys.append(key)
    }

    for key in adoptedKeys {
      checkedSkills.remove(key)
      skillScopes.removeValue(forKey: key)
      overwriteFlags.remove(key)
    }
    return adoptedKeys.count
  }

  private func apply(_ snapshot: ManagerSnapshotResponse) {
    scan = snapshot.scan
    status = snapshot.status
    skillsOverview = snapshot.skills
    ruleDocuments = snapshot.rules.documents
    mcpServers = snapshot.mcp.servers
    operationReceipts = snapshot.operations
    legacyNetworkState = snapshot.legacyNetworkState
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
