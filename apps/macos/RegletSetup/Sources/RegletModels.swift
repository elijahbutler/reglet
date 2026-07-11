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

struct StatusResponse: Decodable {
  let version: Int
  let regletHome: String
  let providers: [Provider]
  let drift: [DriftRecord]
  let driftedCount: Int
  let sync: SyncInfo

  struct Provider: Decodable, Identifiable {
    let id: String
    let displayName: String
    let enabled: Bool
    let contents: ScanResponse.Contents
  }

  struct SyncInfo: Decodable {
    let configured: Bool
    let serverUrl: String
    let deviceName: String
  }
}

struct DriftRecord: Decodable, Identifiable {
  let outputPath: String
  let provider: String
  let content: String
  let status: String

  var id: String { "\(provider):\(content):\(outputPath)" }
}

struct SyncRunResponse: Decodable {
  let version: Int
  let pulled: [String]
  let pushed: [String]
  let conflicts: [String]
  let deleted: [String]
}

struct RulesListResponse: Decodable {
  let version: Int
  let documents: [Document]

  struct Document: Decodable, Identifiable {
    let path: String
    var id: String { path }
  }
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

struct SkillsOverviewResponse: Decodable {
  let version: Int
  let regletHome: String
  let shared: [SharedSkillSummary]
  let providerScoped: [ProviderScopedSkillSummary]
  let unmanaged: [UnmanagedSkill]
}

struct SharedSkillSummary: Decodable, Identifiable {
  let name: String
  let path: String
  let fileCount: Int
  let shadowedBy: [String]

  var id: String { name }
}

struct ProviderScopedSkillSummary: Decodable, Identifiable {
  let provider: String
  let name: String
  let path: String
  let fileCount: Int
  let shadowsShared: Bool

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
