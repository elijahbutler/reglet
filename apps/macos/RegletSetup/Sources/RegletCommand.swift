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

  func plan(providers: [String], contents: [ContentKind], skills: [String]) async throws -> PlanResponse {
    var arguments = ["plan"]
    if !providers.isEmpty {
      arguments.append("--provider")
      arguments.append(providers.joined(separator: ","))
    }
    if !contents.isEmpty {
      arguments.append("--content")
      arguments.append(contents.map(\.rawValue).joined(separator: ","))
    }
    if !skills.isEmpty {
      arguments.append("--skill")
      arguments.append(skills.joined(separator: ","))
    }
    arguments.append("--json")

    let result = try await run(arguments)
    return try decode(PlanResponse.self, from: result.stdout, command: "reglet \(arguments.joined(separator: " "))")
  }

  func onboard(providers: [String], contents: [ContentKind], skills: [String]) async throws -> CommandResult {
    var arguments = ["init"]
    if !providers.isEmpty {
      arguments.append("--provider")
      arguments.append(providers.joined(separator: ","))
    }
    if !contents.isEmpty {
      arguments.append("--content")
      arguments.append(contents.map(\.rawValue).joined(separator: ","))
    }
    if !skills.isEmpty {
      arguments.append("--skill")
      arguments.append(skills.joined(separator: ","))
    }
    return try await run(arguments)
  }

  func restore(provider: String) async throws -> CommandResult {
    try await run(["restore", provider])
  }

  func revert(provider: String) async throws -> CommandResult {
    try await run(["revert", provider])
  }

  private func run(_ arguments: [String]) async throws -> CommandResult {
    try await Task.detached(priority: .userInitiated) {
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
      process.arguments = [executable] + arguments

      let stdoutPipe = Pipe()
      let stderrPipe = Pipe()
      process.standardOutput = stdoutPipe
      process.standardError = stderrPipe

      try process.run()
      process.waitUntilExit()

      let stdout = String(data: stdoutPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
      let stderr = String(data: stderrPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
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
      throw RegletCommandError.invalidOutput(command: command, details: error.localizedDescription)
    }
  }
}
