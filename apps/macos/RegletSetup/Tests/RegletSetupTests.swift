import Foundation
import SwiftUI
import XCTest
@testable import RegletSetup

final class RegletSetupTests: XCTestCase {
  private typealias T = Theme

  func testHexColorInitializerProducesExpectedComponents() {
    assertColor(Color(hex: 0x040506), red: 4 / 255, green: 5 / 255, blue: 6 / 255, alpha: 1)
    assertColor(T.Colors.coral, red: 1, green: 99 / 255, blue: 99 / 255, alpha: 1)
  }

  func testThemeConstantsUseExpectedValues() {
    XCTAssertEqual(T.Radius.badge, 6)
    XCTAssertEqual(T.Radius.control, 8)
    XCTAssertEqual(T.Radius.card, 16)
    XCTAssertEqual(T.Radius.largeCard, 20)

    XCTAssertEqual(T.Spacing.xs, 8)
    XCTAssertEqual(T.Spacing.sm, 16)
    XCTAssertEqual(T.Spacing.md, 24)
    XCTAssertEqual(T.Spacing.lg, 32)
    XCTAssertEqual(T.Spacing.xl, 40)
    XCTAssertEqual(T.Spacing.xxl, 48)
  }

  func testOnboardingRouteSkipsOnlyUnavailableSteps() {
    XCTAssertEqual(OnboardingRoute(includesPrompts: true, includesSkills: true).next(after: .selection), .prompts)
    XCTAssertEqual(OnboardingRoute(includesPrompts: false, includesSkills: true).next(after: .selection), .skills)
    XCTAssertEqual(OnboardingRoute(includesPrompts: true, includesSkills: false).back(from: .preview), .prompts)
    XCTAssertEqual(OnboardingRoute(includesPrompts: false, includesSkills: false).next(after: .selection), .preview)
  }

  func testApplyPreviewCondensesChangedFilesByProvider() {
    let entries = [
      previewEntry(
        provider: "claude", content: "rules", operation: "write",
        path: "/Users/test/.claude/CLAUDE.md", before: nil, after: "rules-v1"
      ),
      previewEntry(
        provider: "claude", content: "skills", operation: "write",
        path: "/Users/test/.claude/skills/review", before: "skill-v1", after: "skill-v2"
      ),
      previewEntry(
        provider: "claude", content: "skills", operation: "remove",
        path: "/Users/test/.claude/skills/retired", before: "skill-v1", after: nil
      ),
      previewEntry(
        provider: "codex", content: "rules", operation: "write",
        path: "/Users/test/.codex/AGENTS.md", before: "same", after: "same"
      ),
      previewEntry(
        provider: "codex", content: "skills", operation: "remove",
        path: "/Users/test/.agents/skills/already-missing", before: nil, after: nil
      ),
    ]

    let groups = ProviderPreviewGroup.make(entries: entries, providers: ["claude", "codex"])

    XCTAssertEqual(groups.map(\.id), ["claude", "codex"])
    XCTAssertEqual(groups[0].entries.map(\.friendlyName), ["AGENT.md → CLAUDE.md", "retired", "review"])
    XCTAssertEqual(groups[0].entries.compactMap(\.changeKind), [.created, .removed, .updated])
    XCTAssertEqual(groups[0].summary, "1 new · 1 updated · 1 removed")
    XCTAssertTrue(groups[1].entries.isEmpty)
    XCTAssertEqual(groups[1].summary, "Up to date")
    XCTAssertEqual(previewProviderName("claude", fallback: "Claude Code"), "Claude")
    XCTAssertEqual(previewProviderName("custom", fallback: "Custom Provider"), "Custom Provider")
  }

  @MainActor
  func testSkillDestinationChoiceOwnsSelectionScopeAndOverwriteIntent() {
    let skill = UnmanagedSkill(
      provider: "claude", name: "review", sourcePath: "/local/review",
      sharedDestination: "/master/skills/review", providerDestination: "/master/skills/claude/review",
      sharedConflict: "destination-exists", providerConflict: "none", affectedProviders: ["claude", "codex"]
    )
    let model = SetupModel()
    XCTAssertEqual(model.skillAdoptionChoice(skill), .local)

    model.setSkillAdoptionChoice(.shared, for: skill)
    XCTAssertEqual(model.skillAdoptionChoice(skill), .shared)
    XCTAssertTrue(model.checkedSkills.contains(skill.id))
    XCTAssertTrue(model.overwriteFlags.contains(skill.id))
    XCTAssertTrue(model.canAdopt(skill))

    model.setSkillAdoptionChoice(.provider, for: skill)
    XCTAssertEqual(model.skillAdoptionChoice(skill), .provider)
    XCTAssertFalse(model.overwriteFlags.contains(skill.id))
    XCTAssertTrue(model.canAdopt(skill))

    model.setSkillAdoptionChoice(.local, for: skill)
    XCTAssertEqual(model.skillAdoptionChoice(skill), .local)
    XCTAssertFalse(model.checkedSkills.contains(skill.id))
    XCTAssertNil(model.skillScopes[skill.id])
    XCTAssertEqual(skill.affectedProviders, ["claude", "codex"])
  }

  func testUnmanagedSkillPreviewUsesReadOnlyInspectCommands() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
    let log = directory.appendingPathComponent("commands.log").path
    let tree = #"{"version":1,"tree":{"scope":{"kind":"unmanaged","provider":"claude"},"name":"review","path":"/tmp/review","hasSkillMd":true,"frontmatterIssues":[],"files":[{"path":"SKILL.md","bytes":9}],"shadowsShared":false,"shadowedBy":[]}}"#
    let document = #"""
    {"version":1,"document":{"scope":{"kind":"unmanaged","provider":"claude"},"name":"review","path":"SKILL.md","content":"# Review\n"}}
    """#
    let script = """
    #!/bin/sh
    printf '%s\n' "$*" >> '\(log)'
    if [ "$5" = "SKILL.md" ]; then
      printf '%s' '\(document)'
    else
      printf '%s' '\(tree)'
    fi
    """
    let executable = try makeExecutable(script, directory: directory)
    let command = RegletCommand(executable: executable)
    let skill = UnmanagedSkill(
      provider: "claude", name: "review", sourcePath: "/tmp/review",
      sharedDestination: "/tmp/shared/review", providerDestination: "/tmp/provider/review",
      sharedConflict: "none", providerConflict: "none", affectedProviders: ["claude"]
    )

    let inspected = try await command.inspectUnmanagedSkill(skill)
    let read = try await command.readUnmanagedSkillFile(skill, path: "SKILL.md")

    XCTAssertEqual(inspected.tree.scope.kind, "unmanaged")
    XCTAssertEqual(inspected.tree.files.first?.path, "SKILL.md")
    XCTAssertEqual(read.document.content, "# Review\n")
    let commands = try String(contentsOfFile: log, encoding: .utf8)
    XCTAssertTrue(commands.contains("skills inspect claude review --json"))
    XCTAssertTrue(commands.contains("skills inspect claude review SKILL.md --json"))
    XCTAssertFalse(commands.contains("adopt"))
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

  func testRuleMergeRunnerDiscoveryAndExplicitSelectionUseCommandBoundary() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
    let log = directory.appendingPathComponent("commands.log").path
    let runners = #"{"version":1,"runners":[{"id":"codex","displayName":"Codex CLI","executablePath":"/Users/test/.local/bin/codex"},{"id":"claude","displayName":"Claude Code","executablePath":"/Users/test/.local/bin/claude"}]}"#
    let draft = #"{"version":1,"provider":"claude","draft":"Merged draft\n","sources":[{"provider":"claude","sourcePath":"/Users/test/.claude/CLAUDE.md","bytes":10},{"provider":"codex","sourcePath":"/Users/test/.codex/AGENTS.md","bytes":9}]}"#
    let script = """
    #!/bin/sh
    printf '%s\n' "$*" >> '\(log)'
    if [ "$2" = "merge-runners" ]; then
      printf '%s' '\(runners)'
    elif [ "$2" = "merge-draft" ]; then
      printf '%s' '\(draft)'
    fi
    """
    let executable = try makeExecutable(script, directory: directory)
    let command = RegletCommand(executable: executable)

    let discovered = try await command.ruleMergeRunners()
    let merged = try await command.mergeRuleDraft(providers: ["claude", "codex"], runner: "claude")

    XCTAssertEqual(discovered.runners.map(\.id), ["codex", "claude"])
    XCTAssertEqual(discovered.runners.first?.executablePath, "/Users/test/.local/bin/codex")
    XCTAssertEqual(merged.provider, "claude")
    let commands = try String(contentsOfFile: log, encoding: .utf8)
    XCTAssertTrue(commands.contains("rules merge-runners --json"))
    XCTAssertTrue(commands.contains("rules merge-draft --provider claude,codex --runner claude --json"))
  }

  @MainActor
  func testRuleMergeSuccessPopulatesEditableDraft() async throws {
    let draft = #"{"version":1,"provider":"claude","draft":"Merged draft\n","sources":[{"provider":"claude","sourcePath":"/tmp/CLAUDE.md","bytes":10},{"provider":"codex","sourcePath":"/tmp/AGENTS.md","bytes":9}]}"#
    let executable = try makeExecutable("#!/bin/sh\nprintf '%s' '\(draft)'\n")
    let model = SetupModel(command: RegletCommand(executable: executable))
    model.selectedRuleMergeProviders = ["claude", "codex"]
    let runner = RuleMergeRunner(id: "claude", displayName: "Claude Code", executablePath: "/tmp/claude")

    await model.generateRuleMergeDraft(runner: runner)

    XCTAssertEqual(model.ruleMergeDraft?.provider, "claude")
    XCTAssertEqual(model.editableRuleMergeDraft, "Merged draft\n")
    XCTAssertNil(model.ruleMergeError)
  }

  @MainActor
  func testRuleMergeFailurePreservesManualDraftAndShowsSignInRecovery() async throws {
    let executable = try makeExecutable("#!/bin/sh\necho 'authentication required' >&2\nexit 1\n")
    let model = SetupModel(command: RegletCommand(executable: executable))
    model.selectedRuleMergeProviders = ["claude", "codex"]
    model.editableRuleMergeDraft = "Keep this manual draft"
    let runner = RuleMergeRunner(id: "codex", displayName: "Codex CLI", executablePath: "/tmp/codex")

    await model.generateRuleMergeDraft(runner: runner)

    XCTAssertEqual(model.editableRuleMergeDraft, "Keep this manual draft")
    XCTAssertNil(model.ruleMergeDraft)
    XCTAssertTrue(model.ruleMergeError?.contains("authentication required") == true)
    XCTAssertTrue(model.ruleMergeError?.contains("codex login") == true)
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

  private func previewEntry(
    provider: String,
    content: String,
    operation: String,
    path: String,
    before: String?,
    after: String?
  ) -> StructuredApplyPreview.Entry {
    StructuredApplyPreview.Entry(
      provider: provider,
      content: content,
      operation: operation,
      path: path,
      diff: before == after ? "" : "changed",
      expectedTargetHash: before,
      resultingTargetHash: after,
      driftStatus: "clean",
      snapshot: StructuredApplyPreview.Snapshot(behavior: "none", location: nil),
      backup: StructuredApplyPreview.Backup(behavior: "none", location: nil)
    )
  }

  private func assertColor(
    _ color: Color,
    red expectedRed: CGFloat,
    green expectedGreen: CGFloat,
    blue expectedBlue: CGFloat,
    alpha expectedAlpha: CGFloat,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    guard let nsColor = NSColor(color).usingColorSpace(.sRGB) else {
      XCTFail("Expected color to resolve to sRGB", file: file, line: line)
      return
    }

    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    nsColor.getRed(&red, green: &green, blue: &blue, alpha: &alpha)

    XCTAssertEqual(red, expectedRed, accuracy: 0.001, file: file, line: line)
    XCTAssertEqual(green, expectedGreen, accuracy: 0.001, file: file, line: line)
    XCTAssertEqual(blue, expectedBlue, accuracy: 0.001, file: file, line: line)
    XCTAssertEqual(alpha, expectedAlpha, accuracy: 0.001, file: file, line: line)
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
