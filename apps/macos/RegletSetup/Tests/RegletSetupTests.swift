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
  func testSyncDriftAndRecoveryUseCommandBoundary() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
    let log = directory.appendingPathComponent("commands.log").path
    let scan = #"{"version":1,"regletHome":"/tmp/reglet","providers":[],"safety":{"daemonEnabled":false,"syncEnabled":false,"notificationsEnabled":false,"requiresExplicitConfirmation":true}}"#
    let status = #"{"version":1,"regletHome":"/tmp/reglet","providers":[],"drift":[],"driftedCount":0,"sync":{"configured":false,"serverUrl":"","deviceName":""}}"#
    let script = """
    #!/bin/sh
    printf '%s\n' "$*" >> '\(log)'
    case "$1" in
      sync) echo 'network unavailable' >&2; exit 7 ;;
      status) printf '%s' '\(status)' ;;
      scan) printf '%s' '\(scan)' ;;
      *) printf 'ok' ;;
    esac
    """
    let executable = try makeExecutable(script, directory: directory)
    let model = SetupModel(command: RegletCommand(executable: executable))

    await model.runSync()
    XCTAssertTrue(model.lastSyncError?.contains("network unavailable") == true)
    await model.reapply(provider: "claude", content: "rules")
    await model.importDrifted(provider: "codex", content: "skills")
    await model.restore(provider: "claude")
    await model.revert(provider: "codex")

    let commands = try String(contentsOfFile: log, encoding: .utf8)
    XCTAssertTrue(commands.contains("apply --provider claude --content rules"))
    XCTAssertTrue(commands.contains("import codex:skills"))
    XCTAssertTrue(commands.contains("restore claude"))
    XCTAssertTrue(commands.contains("revert codex"))
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
