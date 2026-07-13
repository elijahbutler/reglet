import Foundation
import XCTest
@testable import RegletSetup

final class RegletSetupTests: XCTestCase {
  func testOnboardingRouteSkipsOnlyUnavailableSteps() {
    XCTAssertEqual(OnboardingRoute(includesPrompts: true, includesSkills: true).next(after: .selection), .prompts)
    XCTAssertEqual(OnboardingRoute(includesPrompts: false, includesSkills: true).next(after: .selection), .skills)
    XCTAssertEqual(OnboardingRoute(includesPrompts: true, includesSkills: false).back(from: .preview), .prompts)
    XCTAssertEqual(OnboardingRoute(includesPrompts: false, includesSkills: false).next(after: .selection), .preview)
  }

  @MainActor
  func testSkillAdoptionChoicesRequireExplicitOverwriteForChosenScope() {
    let skill = UnmanagedSkill(
      provider: "claude", name: "review", sourcePath: "/local/review",
      sharedDestination: "/master/skills/review", providerDestination: "/master/skills/claude/review",
      sharedConflict: "destination-exists", providerConflict: "none", affectedProviders: ["claude", "codex"]
    )
    let model = SetupModel()
    XCTAssertFalse(model.canAdopt(skill))
    model.overwriteFlags.insert(skill.id)
    XCTAssertTrue(model.canAdopt(skill))
    model.overwriteFlags.remove(skill.id)
    model.skillScopes[skill.id] = .provider
    XCTAssertTrue(model.canAdopt(skill))
    XCTAssertEqual(model.skillScope(skill.id), .provider)
    XCTAssertEqual(skill.affectedProviders, ["claude", "codex"])
  }

  func testCommandReportsExitFailureAndMalformedJSON() async throws {
    let failure = try makeExecutable("#!/bin/sh\necho 'permission denied' >&2\nexit 13\n")
    do {
      _ = try await RegletCommand(executable: failure).scan()
      XCTFail("Expected command failure")
    } catch {
      XCTAssertTrue(error.localizedDescription.contains("permission denied"))
      XCTAssertTrue(error.localizedDescription.contains("13"))
    }

    let malformed = try makeExecutable("#!/bin/sh\nprintf 'not-json'\n")
    do {
      _ = try await RegletCommand(executable: malformed).status()
      XCTFail("Expected decoding failure")
    } catch {
      XCTAssertTrue(error.localizedDescription.contains("Invalid output"))
      XCTAssertTrue(error.localizedDescription.contains("stdout bytes=8"))
    }
  }

  @MainActor
  func testLocalOnlyDriftAndRecoveryUseCommandBoundary() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
    let log = directory.appendingPathComponent("commands.log").path
    let snapshot = #"{"version":1,"scan":{"version":1,"regletHome":"/tmp/reglet","providers":[],"safety":{"daemonEnabled":false,"syncEnabled":false,"notificationsEnabled":false,"requiresExplicitConfirmation":true}},"status":{"version":1,"regletHome":"/tmp/reglet","capabilities":{"mode":"public-v1","localOnly":true,"sync":false},"providers":[],"drift":[],"driftedCount":0},"skills":{"version":1,"regletHome":"/tmp/reglet","shared":[],"providerScoped":[],"unmanaged":[]},"rules":{"version":1,"documents":[]},"mcp":{"version":1,"servers":[]},"operations":[],"legacyNetworkState":{"present":false,"paths":[]}}"#
    let preview = #"{"version":1,"digest":"review-digest","validationIssues":[],"entries":[]}"#
    let script = """
    #!/bin/sh
    printf '%s\n' "$*" >> '\(log)'
    case "$1" in
      manager) printf '%s' '\(snapshot)' ;;
      apply-structured) printf '%s' '\(preview)' ;;
      *) printf 'ok' ;;
    esac
    """
    let executable = try makeExecutable(script, directory: directory)
    let model = SetupModel(command: RegletCommand(executable: executable))

    let reviewed = await model.previewApply(content: .rules, provider: "claude")
    if let reviewed {
      _ = await model.applyPreview(reviewed, content: .rules, provider: "claude")
    } else {
      XCTFail("Expected structured review preview")
    }
    await model.importDrifted(provider: "codex", content: "skills")
    await model.restoreOperation("receipt-1")
    await model.clearLegacyNetworkState()

    let commands = try String(contentsOfFile: log, encoding: .utf8)
    XCTAssertTrue(commands.contains("apply-structured preview --content rules --provider claude"))
    XCTAssertTrue(commands.contains("apply-structured apply --digest review-digest --content rules --provider claude"))
    XCTAssertTrue(commands.contains("import codex:skills"))
    XCTAssertTrue(commands.contains("operations restore receipt-1"))
    XCTAssertTrue(commands.contains("state clear-legacy-network-state"))
    XCTAssertFalse(commands.contains("sync"))
  }

  @MainActor
  func testOnboardingStagesThenUsesOneStructuredReview() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
    let log = directory.appendingPathComponent("commands.log").path
    let snapshot = #"{"version":1,"scan":{"version":1,"regletHome":"/tmp/reglet","providers":[],"safety":{"daemonEnabled":false,"syncEnabled":false,"notificationsEnabled":false,"requiresExplicitConfirmation":true}},"status":{"version":1,"regletHome":"/tmp/reglet","capabilities":{"mode":"public-v1","localOnly":true,"sync":false},"providers":[],"drift":[],"driftedCount":0},"skills":{"version":1,"regletHome":"/tmp/reglet","shared":[],"providerScoped":[],"unmanaged":[]},"rules":{"version":1,"documents":[]},"mcp":{"version":1,"servers":[]},"operations":[],"legacyNetworkState":{"present":false,"paths":[]}}"#
    let preview = #"{"version":1,"digest":"onboarding-digest","validationIssues":[],"entries":[]}"#
    let script = """
    #!/bin/sh
    printf '%s\n' "$*" >> '\(log)'
    case "$1" in
      manager) printf '%s' '\(snapshot)' ;;
      apply-structured) printf '%s' '\(preview)' ;;
      *) printf 'ok' ;;
    esac
    """
    let executable = try makeExecutable(script, directory: directory)
    let model = SetupModel(command: RegletCommand(executable: executable))
    model.selectedProviders = ["claude"]
    model.selectedContents = [.rules]
    model.rulePromptMode = .providerSpecific

    let review = await model.prepareOnboardingReview()

    XCTAssertEqual(review?.preview.digest, "onboarding-digest")
    XCTAssertEqual(review?.contents, [.rules])
    XCTAssertEqual(review?.providers, ["claude"])
    let commands = try String(contentsOfFile: log, encoding: .utf8)
    XCTAssertTrue(commands.contains("init --provider claude --content rules --no-apply"))
    XCTAssertTrue(commands.contains("apply-structured preview --content rules --provider claude"))
    XCTAssertFalse(commands.contains("apply --content rules"))
  }

  private func makeExecutable(_ contents: String, directory: URL? = nil) throws -> String {
    let ownsDirectory = directory == nil
    let directory = directory ?? FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let url = directory.appendingPathComponent("fake-reglet")
    try contents.write(to: url, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
    if ownsDirectory {
      addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
    }
    return url.path
  }
}
