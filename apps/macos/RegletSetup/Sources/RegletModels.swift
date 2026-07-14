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
  let reconciliation: Reconciliation
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

  struct Reconciliation: Decodable {
    let rules: [RuleComparison]
  }
}

struct RuleComparison: Decodable, Identifiable {
  let provider: String
  let sourcePath: String
  let destinationPath: String
  let state: String
  let preview: String
  let truncated: Bool

  var id: String {
    "\(provider):\(sourcePath):\(destinationPath)"
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
  let capabilities: Capabilities

  struct Provider: Decodable, Identifiable {
    let id: String
    let displayName: String
    let enabled: Bool
    let contents: ScanResponse.Contents
  }

  struct Capabilities: Decodable {
    let mode: String
    let localOnly: Bool
    let sync: Bool
  }
}

struct DriftRecord: Decodable, Identifiable {
  let outputPath: String
  let provider: String
  let content: String
  let status: String

  var id: String { "\(provider):\(content):\(outputPath)" }
}

struct RulesListResponse: Decodable {
  let version: Int
  let documents: [Document]

  struct Document: Decodable, Identifiable {
    let path: String
    let scope: Scope?
    var id: String { path }
  }

  struct Scope: Decodable {
    let kind: String
    let provider: String?
  }
}

struct RuleMergeDraftResponse: Decodable {
  let version: Int
  let provider: String
  let draft: String
  let sources: [Source]

  struct Source: Decodable, Identifiable {
    let provider: String
    let sourcePath: String
    let bytes: Int

    var id: String { "\(provider):\(sourcePath)" }
  }
}

struct RuleMergeRunnersResponse: Decodable {
  let version: Int
  let runners: [RuleMergeRunner]
}

struct RuleMergeRunner: Decodable, Identifiable, Hashable {
  let id: String
  let displayName: String
  let executablePath: String

  var signInCommand: String {
    switch id {
    case "codex": "codex login"
    case "claude": "claude auth login"
    case "gemini": "gemini"
    default: executablePath
    }
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

struct SkillTreeResponse: Decodable {
  let version: Int
  let tree: ManagedSkillTree
}

struct ManagedSkillTree: Decodable {
  let scope: Scope
  let name: String
  let path: String
  let hasSkillMd: Bool
  let frontmatterIssues: [String]
  let files: [File]
  let shadowsShared: Bool
  let shadowedBy: [String]

  struct Scope: Decodable {
    let kind: String
    let provider: String?
  }

  struct File: Decodable, Identifiable {
    let path: String
    let bytes: Int
    var id: String { path }
  }
}

struct SkillFileResponse: Decodable {
  let version: Int
  let document: Document

  struct Document: Decodable {
    let scope: ManagedSkillTree.Scope
    let name: String
    let path: String
    let content: String
  }
}

struct McpServersResponse: Decodable {
  let version: Int
  let servers: [Entry]

  struct Entry: Decodable, Identifiable {
    let name: String
    let server: McpServerDefinition
    let issues: [String]
    var id: String { name }
  }
}

struct McpServerDefinition: Codable, Equatable {
  var command: String?
  var args: [String]?
  var env: [String: McpProcessEnvironmentReference]?
  var url: String?
}

struct McpProcessEnvironmentReference: Codable, Equatable {
  var source: String = "process-env"
  var name: String
}

struct OperationReceipt: Decodable, Identifiable {
  let id: String
  let lifecycle: String
  let startedAt: String
  let completedAt: String?
  let structuredPreviewDigest: String?
  let targets: [Target]
  let recovery: Recovery

  struct Target: Decodable, Identifiable {
    let path: String
    let snapshot: String?
    let snapshotKind: String
    var id: String { path }
  }

  struct Recovery: Decodable {
    let attempted: Bool
    let recovered: Bool
    let message: String?
  }
}

struct LegacyNetworkState: Decodable {
  let present: Bool
  let paths: [String]
}

struct ManagerSnapshotResponse: Decodable {
  let version: Int
  let scan: ScanResponse
  let status: StatusResponse
  let skills: SkillsOverviewResponse
  let rules: RulesListResponse
  let mcp: McpServersResponse
  let operations: [OperationReceipt]
  let legacyNetworkState: LegacyNetworkState
}

struct StructuredApplyPreview: Decodable, Identifiable {
  let version: Int
  let digest: String
  let validationIssues: [String]
  let entries: [Entry]
  var id: String { digest }

  struct Entry: Decodable, Identifiable {
    let provider: String
    let content: String
    let operation: String
    let path: String
    let diff: String
    let expectedTargetHash: String?
    let resultingTargetHash: String?
    let driftStatus: String
    let snapshot: Snapshot
    let backup: Backup
    var id: String { "\(provider):\(content):\(path)" }
  }

  struct Snapshot: Decodable {
    let behavior: String
    let location: String?
  }

  struct Backup: Decodable {
    let behavior: String
    let location: String?
  }
}

enum SkillAdoptionScope: String {
  case shared
  case provider
}

enum SkillAdoptionChoice: String, CaseIterable, Identifiable {
  case local
  case provider
  case shared

  var id: String { rawValue }
}

enum OnboardingStep: Int, CaseIterable {
  case safety, selection, prompts, skills, preview, done
}

struct OnboardingRoute: Equatable {
  let includesPrompts: Bool
  let includesSkills: Bool

  func next(after step: OnboardingStep) -> OnboardingStep {
    switch step {
    case .safety: .selection
    case .selection: includesPrompts ? .prompts : (includesSkills ? .skills : .preview)
    case .prompts: includesSkills ? .skills : .preview
    case .skills: .preview
    case .preview: .done
    case .done: .selection
    }
  }

  func back(from step: OnboardingStep) -> OnboardingStep {
    switch step {
    case .prompts: .selection
    case .skills: includesPrompts ? .prompts : .selection
    case .preview: includesSkills ? .skills : (includesPrompts ? .prompts : .selection)
    default: .safety
    }
  }
}

enum RulePromptMode: String, CaseIterable, Identifiable {
  case unified
  case providerSpecific

  var id: String { rawValue }

  var label: String {
    switch self {
    case .unified:
      "Unified prompt"
    case .providerSpecific:
      "Provider-specific prompts"
    }
  }
}
