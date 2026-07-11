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
  @Published var unmanagedSkills: [UnmanagedSkill] = []

  private let command = RegletCommand()

  var detectedProviders: [ScanResponse.Provider] {
    scan?.providers.filter(\.detected) ?? []
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
      self.unmanagedSkills = try await self.command.unmanagedSkills().skills
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

  func applySelection() async {
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

  func adoptSkill(_ skill: UnmanagedSkill, scope: SkillAdoptionScope) async {
    await runWork {
      let response = try await self.command.adoptSkill(skill, scope: scope)
      self.completionMessage = "Adopted \(response.adoption.name) into \(response.adoption.destination)."
      self.unmanagedSkills = try await self.command.unmanagedSkills().skills
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
