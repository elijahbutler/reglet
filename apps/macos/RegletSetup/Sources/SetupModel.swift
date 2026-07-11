import Foundation

@MainActor
final class SetupModel: ObservableObject {
  @Published var scan: ScanResponse?
  @Published var plan: PlanResponse?
  @Published var selectedProviders: Set<String> = []
  @Published var selectedContents: Set<ContentKind> = Set(ContentKind.allCases)
  @Published var selectedSkillTargets: Set<String> = []
  @Published var isWorking = false
  @Published var errorMessage: String?
  @Published var completionMessage: String?

  private let command = RegletCommand()

  var detectedProviders: [ScanResponse.Provider] {
    scan?.providers.filter(\.detected) ?? []
  }

  var canContinue: Bool {
    !selectedProviders.isEmpty && !selectedContents.isEmpty && hasRequiredSkillSelection && !isWorking
  }

  var availableSkillTargets: [SkillTarget] {
    detectedProviders
      .filter { selectedProviders.contains($0.id) }
      .flatMap { provider in
        provider.inventory.skills.sorted().map { skill in
          SkillTarget(providerId: provider.id, providerName: provider.displayName, skillName: skill)
        }
      }
  }

  var selectedSkillTargetArguments: [String] {
    guard selectedContents.contains(.skills) else {
      return []
    }
    return availableSkillTargets
      .map(\.id)
      .filter { selectedSkillTargets.contains($0) }
      .sorted()
  }

  private var hasRequiredSkillSelection: Bool {
    guard selectedContents.contains(.skills) else {
      return true
    }
    let availableTargets = availableSkillTargets
    return availableTargets.isEmpty || availableTargets.contains { selectedSkillTargets.contains($0.id) }
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
      if self.selectedProviders.isEmpty {
        self.selectedProviders = Set(response.providers.filter(\.detected).map(\.id))
      }
      let availableTargets = Set(self.availableSkillTargets.map(\.id))
      if self.selectedSkillTargets.isEmpty {
        self.selectedSkillTargets = availableTargets
      } else {
        self.selectedSkillTargets = self.selectedSkillTargets.intersection(availableTargets)
      }
    }
  }

  func refreshPlan() async {
    await runWork {
      self.plan = try await self.command.plan(
        providers: Array(self.selectedProviders).sorted(),
        contents: Array(self.selectedContents).sorted { $0.rawValue < $1.rawValue },
        skills: self.selectedSkillTargetArguments
      )
    }
  }

  func applySelection() async {
    await runWork {
      let result = try await self.command.onboard(
        providers: Array(self.selectedProviders).sorted(),
        contents: Array(self.selectedContents).sorted { $0.rawValue < $1.rawValue },
        skills: self.selectedSkillTargetArguments
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

  private func runWork(_ operation: @escaping () async throws -> Void) async {
    isWorking = true
    errorMessage = nil
    defer {
      isWorking = false
    }

    do {
      try await operation()
    } catch {
      errorMessage = error.localizedDescription
    }
  }
}
