import Foundation

struct CommandResult {
  let stdout: String
  let stderr: String
  let status: Int32
}

enum RegletCommandError: LocalizedError {
  case failed(command: String, stderr: String, status: Int32)
  case invalidOutput(command: String, details: String)

  var errorDescription: String? {
    switch self {
    case let .failed(command, stderr, status):
      "Command failed (\(status)): \(command)\n\(stderr)"
    case let .invalidOutput(command, details):
      "Invalid output from \(command): \(details)"
    }
  }
}

struct RegletCommand {
  private let executableOverride: String?

  init(executable: String? = nil) {
    executableOverride = executable
  }

  var executable: String {
    if let executableOverride { return executableOverride }
    if let override = ProcessInfo.processInfo.environment["REGLET_BINARY"] {
      return override
    }
    if let bundled = Bundle.main.url(forResource: "reglet", withExtension: nil)?.path,
       FileManager.default.isExecutableFile(atPath: bundled) {
      return bundled
    }
    if FileManager.default.isExecutableFile(atPath: "/usr/local/bin/reglet") {
      return "/usr/local/bin/reglet"
    }
    if FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/reglet") {
      return "/opt/homebrew/bin/reglet"
    }
    return "reglet"
  }

  func scan() async throws -> ScanResponse {
    let result = try await run(["scan", "--json"])
    return try decode(ScanResponse.self, from: result.stdout, command: "reglet scan --json")
  }

  func managerSnapshot() async throws -> ManagerSnapshotResponse {
    let result = try await run(["manager", "snapshot", "--json"])
    return try decode(ManagerSnapshotResponse.self, from: result.stdout, command: "reglet manager snapshot --json")
  }

  func plan(providers: [String], contents: [ContentKind]) async throws -> PlanResponse {
    var arguments = ["plan"]
    if !providers.isEmpty {
      arguments.append("--provider")
      arguments.append(providers.joined(separator: ","))
    }
    if !contents.isEmpty {
      arguments.append("--content")
      arguments.append(contents.map(\.rawValue).joined(separator: ","))
    }
    arguments.append("--json")

    let result = try await run(arguments)
    return try decode(PlanResponse.self, from: result.stdout, command: "reglet \(arguments.joined(separator: " "))")
  }

  func onboard(
    providers: [String],
    contents: [ContentKind],
    includeEmptyContent: Bool = false,
    stageOnly: Bool = true
  ) async throws -> CommandResult {
    var arguments = ["init"]
    if !providers.isEmpty {
      arguments.append("--provider")
      arguments.append(providers.joined(separator: ","))
    }
    if !contents.isEmpty || includeEmptyContent {
      arguments.append("--content")
      arguments.append(contents.map(\.rawValue).joined(separator: ","))
    }
    if stageOnly {
      arguments.append("--no-apply")
    }
    return try await run(arguments)
  }

  func enroll(_ target: String) async throws -> CommandResult {
    try await run(["enroll", target])
  }

  func unenroll(_ target: String) async throws -> CommandResult {
    try await run(["unenroll", target])
  }

  func status() async throws -> StatusResponse {
    let result = try await run(["status", "--json"])
    return try decode(StatusResponse.self, from: result.stdout, command: "reglet status --json")
  }

  func importDrifted(provider: String, content: String) async throws -> CommandResult {
    try await run(["import", "\(provider):\(content)"])
  }

  func rulesList() async throws -> RulesListResponse {
    let result = try await run(["rules", "list", "--json"])
    return try decode(RulesListResponse.self, from: result.stdout, command: "reglet rules list --json")
  }

  func readRule(path: String) async throws -> String {
    try await run(["rules", "read", path]).stdout
  }

  func writeRule(path: String, content: String) async throws {
    _ = try await run(["rules", "write", path], stdin: content)
  }

  func ruleMergeRunners() async throws -> RuleMergeRunnersResponse {
    let arguments = ["rules", "merge-runners", "--json"]
    let result = try await run(arguments)
    return try decode(RuleMergeRunnersResponse.self, from: result.stdout, command: "reglet \(arguments.joined(separator: " "))")
  }

  func mergeRuleDraft(providers: [String], runner: String) async throws -> RuleMergeDraftResponse {
    var arguments = ["rules", "merge-draft"]
    if !providers.isEmpty {
      arguments.append("--provider")
      arguments.append(providers.joined(separator: ","))
    }
    arguments.append("--runner")
    arguments.append(runner)
    arguments.append("--json")
    let result = try await run(arguments)
    return try decode(RuleMergeDraftResponse.self, from: result.stdout, command: "reglet \(arguments.joined(separator: " "))")
  }

  func skillsList() async throws -> SkillsOverviewResponse {
    let result = try await run(["skills", "list", "--json"])
    return try decode(SkillsOverviewResponse.self, from: result.stdout, command: "reglet skills list --json")
  }

  func skillTree(name: String, provider: String?) async throws -> SkillTreeResponse {
    var arguments = ["skills", "files", name, "--scope", provider == nil ? "shared" : "provider", "--json"]
    if let provider { arguments += ["--provider", provider] }
    let result = try await run(arguments)
    return try decode(SkillTreeResponse.self, from: result.stdout, command: "reglet \(arguments.joined(separator: " "))")
  }

  func readSkillFile(name: String, provider: String?, path: String) async throws -> SkillFileResponse {
    var arguments = ["skills", "read", name, path, "--scope", provider == nil ? "shared" : "provider", "--json"]
    if let provider { arguments += ["--provider", provider] }
    let result = try await run(arguments)
    return try decode(SkillFileResponse.self, from: result.stdout, command: "reglet \(arguments.joined(separator: " "))")
  }

  func inspectUnmanagedSkill(_ skill: UnmanagedSkill) async throws -> SkillTreeResponse {
    let arguments = ["skills", "inspect", skill.provider, skill.name, "--json"]
    let result = try await run(arguments)
    return try decode(SkillTreeResponse.self, from: result.stdout, command: "reglet \(arguments.joined(separator: " "))")
  }

  func readUnmanagedSkillFile(_ skill: UnmanagedSkill, path: String) async throws -> SkillFileResponse {
    let arguments = ["skills", "inspect", skill.provider, skill.name, path, "--json"]
    let result = try await run(arguments)
    return try decode(SkillFileResponse.self, from: result.stdout, command: "reglet \(arguments.joined(separator: " "))")
  }

  func writeSkillFile(name: String, provider: String?, path: String, content: String) async throws {
    var arguments = ["skills", "write", name, path, "--scope", provider == nil ? "shared" : "provider"]
    if let provider { arguments += ["--provider", provider] }
    _ = try await run(arguments, stdin: content)
  }

  func createSkill(name: String, provider: String?, content: String) async throws {
    var arguments = ["skills", "create", name, "--scope", provider == nil ? "shared" : "provider"]
    if let provider { arguments += ["--provider", provider] }
    _ = try await run(arguments, stdin: content)
  }

  func deleteSkill(name: String, provider: String?) async throws {
    var arguments = ["skills", "delete", name, "--scope", provider == nil ? "shared" : "provider"]
    if let provider { arguments += ["--provider", provider] }
    _ = try await run(arguments)
  }

  func renameSkill(name: String, newName: String, provider: String?) async throws {
    var arguments = ["skills", "rename", name, newName, "--scope", provider == nil ? "shared" : "provider"]
    if let provider { arguments += ["--provider", provider] }
    _ = try await run(arguments)
  }

  func deleteSkillFile(name: String, provider: String?, path: String) async throws {
    var arguments = ["skills", "delete-file", name, path, "--scope", provider == nil ? "shared" : "provider"]
    if let provider { arguments += ["--provider", provider] }
    _ = try await run(arguments)
  }

  func renameSkillFile(name: String, provider: String?, path: String, newPath: String) async throws {
    var arguments = ["skills", "rename-file", name, path, newPath, "--scope", provider == nil ? "shared" : "provider"]
    if let provider { arguments += ["--provider", provider] }
    _ = try await run(arguments)
  }

  func mcpList() async throws -> McpServersResponse {
    let arguments = ["mcp", "list", "--json"]
    let result = try await run(arguments)
    return try decode(McpServersResponse.self, from: result.stdout, command: "reglet mcp list --json")
  }

  func upsertMcp(name: String, definition: McpServerDefinition) async throws {
    let data = try JSONEncoder().encode(definition)
    guard let input = String(data: data, encoding: .utf8) else { throw RegletCommandError.invalidOutput(command: "mcp upsert", details: "could not encode server") }
    _ = try await run(["mcp", "upsert", name], stdin: input)
  }

  func deleteMcp(name: String) async throws {
    _ = try await run(["mcp", "delete", name])
  }

  func previewApply(contents: [ContentKind], providers: [String] = []) async throws -> StructuredApplyPreview {
    var arguments = ["apply-structured", "preview", "--content", contents.map(\.rawValue).joined(separator: ",")]
    if !providers.isEmpty {
      arguments += ["--provider", providers.sorted().joined(separator: ",")]
    }
    let result = try await run(arguments)
    return try decode(StructuredApplyPreview.self, from: result.stdout, command: "reglet \(arguments.joined(separator: " "))")
  }

  func previewApply(content: ContentKind, provider: String? = nil) async throws -> StructuredApplyPreview {
    try await previewApply(contents: [content], providers: provider.map { [$0] } ?? [])
  }

  func applyPreview(_ preview: StructuredApplyPreview, contents: [ContentKind], providers: [String] = []) async throws {
    var arguments = ["apply-structured", "apply", "--digest", preview.digest, "--content", contents.map(\.rawValue).joined(separator: ",")]
    if !providers.isEmpty {
      arguments += ["--provider", providers.sorted().joined(separator: ",")]
    }
    _ = try await run(arguments)
  }

  func applyPreview(_ preview: StructuredApplyPreview, content: ContentKind, provider: String? = nil) async throws {
    try await applyPreview(preview, contents: [content], providers: provider.map { [$0] } ?? [])
  }

  func restoreOperation(_ id: String) async throws -> CommandResult {
    try await run(["operations", "restore", id])
  }

  func clearLegacyNetworkState() async throws -> CommandResult {
    try await run(["state", "clear-legacy-network-state"])
  }

  func adoptSkill(_ skill: UnmanagedSkill, scope: SkillAdoptionScope, overwrite: Bool = false) async throws -> SkillAdoptionResponse {
    var arguments = ["skills", "adopt", skill.provider, skill.name, "--scope", scope.rawValue]
    if overwrite {
      arguments.append("--overwrite")
    }
    arguments.append("--json")
    let result = try await run(arguments)
    return try decode(SkillAdoptionResponse.self, from: result.stdout, command: "reglet \(arguments.joined(separator: " "))")
  }

  private func run(_ arguments: [String], stdin: String? = nil) async throws -> CommandResult {
    try await Task.detached(priority: .userInitiated) {
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
      process.arguments = [executable] + arguments

      let captureDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent("reglet-command-\(UUID().uuidString)", isDirectory: true)
      try FileManager.default.createDirectory(at: captureDirectory, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: captureDirectory) }

      let stdoutURL = captureDirectory.appendingPathComponent("stdout")
      let stderrURL = captureDirectory.appendingPathComponent("stderr")
      guard FileManager.default.createFile(
        atPath: stdoutURL.path,
        contents: nil,
        attributes: [.posixPermissions: 0o600]
      ), FileManager.default.createFile(
        atPath: stderrURL.path,
        contents: nil,
        attributes: [.posixPermissions: 0o600]
      ) else {
        throw RegletCommandError.invalidOutput(command: "reglet \(arguments.joined(separator: " "))", details: "could not create command capture files")
      }

      let stdoutHandle = try FileHandle(forWritingTo: stdoutURL)
      let stderrHandle = try FileHandle(forWritingTo: stderrURL)
      defer {
        try? stdoutHandle.close()
        try? stderrHandle.close()
      }
      process.standardOutput = stdoutHandle
      process.standardError = stderrHandle

      let stdinPipe = Pipe()
      if stdin != nil {
        process.standardInput = stdinPipe
      }

      try process.run()

      if let stdin, let data = stdin.data(using: .utf8) {
        stdinPipe.fileHandleForWriting.write(data)
        try stdinPipe.fileHandleForWriting.close()
      }
      process.waitUntilExit()

      try stdoutHandle.close()
      try stderrHandle.close()
      let stdout = String(data: try Data(contentsOf: stdoutURL), encoding: .utf8) ?? ""
      let stderr = String(data: try Data(contentsOf: stderrURL), encoding: .utf8) ?? ""
      let result = CommandResult(stdout: stdout, stderr: stderr, status: process.terminationStatus)
      if result.status != 0 {
        throw RegletCommandError.failed(
          command: "reglet \(arguments.joined(separator: " "))",
          stderr: stderr,
          status: result.status
        )
      }
      return result
    }.value
  }

  private func decode<T: Decodable>(_ type: T.Type, from stdout: String, command: String) throws -> T {
    guard let data = stdout.data(using: .utf8) else {
      throw RegletCommandError.invalidOutput(command: command, details: "stdout is not UTF-8")
    }
    do {
      return try JSONDecoder().decode(type, from: data)
    } catch {
      throw RegletCommandError.invalidOutput(
        command: command,
        details: "\(String(reflecting: error)); stdout bytes=\(data.count)"
      )
    }
  }
}
