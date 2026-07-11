import Foundation

struct ScanResponse: Decodable {
  let version: Int
  let regletHome: String
  let providers: [Provider]
  let safety: Safety

  struct Provider: Decodable, Identifiable {
    let id: String
    let displayName: String
    let detected: Bool
    let enabled: Bool
    let contents: Contents
    let inventory: Inventory
  }

  struct Contents: Decodable {
    let rules: Bool
    let skills: Bool
    let mcp: Bool
  }

  struct Inventory: Decodable {
    let rulesPath: String?
    let rulesExists: Bool
    let skillsDir: String?
    let skills: [String]
    let mcpPath: String?
    let mcpServers: [String]
  }
}

struct PlanResponse: Decodable {
  let version: Int
  let mode: String
  let regletHome: String
  let providers: [Provider]
  let reads: [PlannedFile]
  let writes: [PlannedFile]
  let safety: Safety

  struct Provider: Decodable, Identifiable {
    let id: String
    let displayName: String
    let detected: Bool
    let contents: [String: PlannedContent]
  }

  struct PlannedContent: Decodable {
    let selected: Bool
    let supported: Bool
    let readPaths: [String]
    let writePaths: [String]
    let notes: [String]
  }
}

struct PlannedFile: Decodable, Identifiable {
  let provider: String
  let content: String
  let path: String
  let scope: String
  let operation: String
  let reason: String

  var id: String {
    "\(operation):\(scope):\(provider):\(content):\(path)"
  }
}

struct Safety: Decodable {
  let daemonEnabled: Bool
  let syncEnabled: Bool
  let notificationsEnabled: Bool
  let requiresExplicitConfirmation: Bool
}

enum ContentKind: String, CaseIterable, Identifiable {
  case rules
  case skills
  case mcp

  var id: String {
    rawValue
  }

  var label: String {
    switch self {
    case .rules:
      "Rules"
    case .skills:
      "Skills"
    case .mcp:
      "MCP"
    }
  }
}

struct UnmanagedSkillsResponse: Decodable {
  let version: Int
  let skills: [UnmanagedSkill]
}

struct UnmanagedSkill: Decodable, Identifiable {
  let provider: String
  let name: String
  let sourcePath: String
  let sharedDestination: String
  let providerDestination: String
  let sharedConflict: String
  let providerConflict: String
  let affectedProviders: [String]

  var id: String { "\(provider):\(name)" }
}

struct SkillAdoptionResponse: Decodable {
  let version: Int
  let adoption: Adoption

  struct Adoption: Decodable {
    let provider: String
    let name: String
    let scope: String
    let sourcePath: String
    let destination: String
    let overwritten: Bool
    let affectedProviders: [String]
  }
}

enum SkillAdoptionScope: String {
  case shared
  case provider
}
