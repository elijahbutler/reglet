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
  let unifiedSkills: [UnifiedSkill]
  let rules: RulesReconciliation
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
    let items: [String]?
    let readPaths: [String]
    let writePaths: [String]
    let notes: [String]
  }
}

struct UnifiedSkill: Decodable, Identifiable {
  let name: String
  let status: String
  let sourceProvider: String?
  let sourceName: String?

  var id: String {
    "\(status):\(sourceProvider ?? "master"):\(sourceName ?? name):\(name)"
  }
}

struct RulesReconciliation: Decodable {
  let status: String
  let strategy: String
  let sources: [RuleSource]
  let unifiedFiles: [String]
}

struct RuleSource: Decodable, Identifiable {
  let provider: String
  let displayName: String
  let path: String
  let hash: String
  let byteLength: Int
  let lineCount: Int
  let preview: String

  var id: String {
    "\(provider):\(path)"
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

struct SkillTarget: Identifiable, Hashable {
  let providerId: String
  let providerName: String
  let skillName: String

  var id: String {
    "\(providerId):\(skillName)"
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
