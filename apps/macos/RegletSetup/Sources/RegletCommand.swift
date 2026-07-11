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
  var executable: String {
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

  func onboard(providers: [String], contents: [ContentKind], includeEmptyContent: Bool = false) async throws -> CommandResult {
    var arguments = ["init"]
    if !providers.isEmpty {
      arguments.append("--provider")
      arguments.append(providers.joined(separator: ","))
    }
    if !contents.isEmpty || includeEmptyContent {
      arguments.append("--content")
      arguments.append(contents.map(\.rawValue).joined(separator: ","))
    }
    return try await run(arguments)
  }

  func enroll(_ target: String) async throws -> CommandResult {
    try await run(["enroll", target])
  }

  func restore(provider: String) async throws -> CommandResult {
    try await run(["restore", provider])
  }

  func revert(provider: String) async throws -> CommandResult {
    try await run(["revert", provider])
  }

  func status() async throws -> StatusResponse {
    let result = try await run(["status", "--json"])
    return try decode(StatusResponse.self, from: result.stdout, command: "reglet status --json")
  }

  func applyContent(provider: String, content: String) async throws -> CommandResult {
    try await run(["apply", "--provider", provider, "--content", content])
  }

  func importDrifted(provider: String, content: String) async throws -> CommandResult {
    try await run(["import", "\(provider):\(content)"])
  }

  func login(url: String, token: String, device: String) async throws -> CommandResult {
    try await run(["login", url, "--token", token, "--device", device])
  }

  func syncNow() async throws -> SyncRunResponse {
    let result = try await run(["sync", "--json"])
    return try decode(SyncRunResponse.self, from: result.stdout, command: "reglet sync --json")
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

  func mergeRuleDraft(providers: [String]) async throws -> RuleMergeDraftResponse {
    var arguments = ["rules", "merge-draft"]
    if !providers.isEmpty {
      arguments.append("--provider")
      arguments.append(providers.joined(separator: ","))
    }
    arguments.append("--json")
    let result = try await run(arguments)
    return try decode(RuleMergeDraftResponse.self, from: result.stdout, command: "reglet \(arguments.joined(separator: " "))")
  }

  func diffRules() async throws -> String {
    try await run(["diff", "--content", "rules"]).stdout
  }

  func applyRules() async throws -> CommandResult {
    try await run(["apply", "--content", "rules"])
  }

  func skillsList() async throws -> SkillsOverviewResponse {
    let result = try await run(["skills", "list", "--json"])
    return try decode(SkillsOverviewResponse.self, from: result.stdout, command: "reglet skills list --json")
  }

  func applySkills() async throws -> CommandResult {
    try await run(["apply", "--content", "skills"])
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
