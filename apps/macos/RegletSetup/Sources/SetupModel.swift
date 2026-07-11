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
  /// Keys are "provider:name"; presence = checked for adoption.
  @Published var checkedSkills: Set<String> = []
  /// Chosen scope per skill key; missing = .shared.
  @Published var skillScopes: [String: SkillAdoptionScope] = [:]
  /// Keyed by "provider:name"; presence = overwrite conflicting destination.
  @Published var overwriteFlags: Set<String> = []

  private let command = RegletCommand()

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
  }

  var canContinue: Bool {
    !selectedProviders.isEmpty && !selectedContents.isEmpty && !isWorking
  }

  func load() {
    Task {
      await refreshScan()
    }
  }

  func refreshScan() async {
    await runWork {
      let response = try await self.command.scan()
      self.scan = response
      self.skillsOverview = try await self.command.skillsList()
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
    }
  }

  @discardableResult
  func applySelection() async -> Bool {
    await runWork {
      let result = try await self.command.onboard(
        providers: Array(self.selectedProviders).sorted(),
        contents: Array(self.selectedContents).sorted { $0.rawValue < $1.rawValue }
      )
      self.completionMessage = result.stdout.isEmpty ? "Onboarding complete." : result.stdout
      self.scan = try await self.command.scan()
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
