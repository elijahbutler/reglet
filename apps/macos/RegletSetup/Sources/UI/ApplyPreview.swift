import Foundation
import SwiftUI

func previewProviderName(_ id: String, fallback: String) -> String {
  switch id {
  case "claude": "Claude"
  case "codex": "Codex"
  case "cursor": "Cursor"
  case "gemini": "Gemini"
  case "windsurf": "Windsurf"
  case "opencode": "OpenCode"
  default: fallback
  }
}

enum PreviewChangeKind: String, Hashable {
  case created = "New"
  case updated = "Updated"
  case removed = "Removed"

  var badgeKind: StatusBadge.Kind {
    switch self {
    case .created: .info
    case .updated: .warning
    case .removed: .error
    }
  }
}

extension StructuredApplyPreview.Entry {
  var changeKind: PreviewChangeKind? {
    switch operation {
    case "remove":
      return expectedTargetHash == nil && diff.isEmpty ? nil : .removed
    case "write":
      if expectedTargetHash == resultingTargetHash || diff.isEmpty {
        return nil
      }
      return expectedTargetHash == nil ? .created : .updated
    default:
      return nil
    }
  }

  var friendlyName: String {
    switch content {
    case "rules":
      return "AGENT.md → \(destinationName)"
    case "skills":
      return destinationName
    case "mcp":
      return "MCP settings"
    default:
      return destinationName
    }
  }

  private var destinationName: String {
    let name = (path as NSString).lastPathComponent
    return name.isEmpty ? content.capitalized : name
  }
}

struct ProviderPreviewGroup: Identifiable {
  let id: String
  let entries: [StructuredApplyPreview.Entry]

  var summary: String {
    let counts = Dictionary(grouping: entries.compactMap(\.changeKind), by: { $0 })
    let parts = PreviewChangeKind.allCasesInDisplayOrder.compactMap { kind -> String? in
      guard let count = counts[kind]?.count, count > 0 else { return nil }
      return "\(count) \(kind.rawValue.lowercased())"
    }
    return parts.isEmpty ? "Up to date" : parts.joined(separator: " · ")
  }

  static func make(
    entries: [StructuredApplyPreview.Entry],
    providers: [String]
  ) -> [ProviderPreviewGroup] {
    var providerIDs: [String] = []
    for provider in providers + entries.map(\.provider) where !providerIDs.contains(provider) {
      providerIDs.append(provider)
    }

    return providerIDs.map { provider in
      let changed = entries
        .filter { $0.provider == provider && $0.changeKind != nil }
        .sorted { left, right in
          let leftKey = "\(contentOrder(left.content)):\(left.friendlyName)"
          let rightKey = "\(contentOrder(right.content)):\(right.friendlyName)"
          return leftKey.localizedCaseInsensitiveCompare(rightKey) == .orderedAscending
        }
      return ProviderPreviewGroup(id: provider, entries: changed)
    }
  }

  private static func contentOrder(_ content: String) -> Int {
    switch content {
    case "rules": 0
    case "skills": 1
    case "mcp": 2
    default: 3
    }
  }
}

private extension PreviewChangeKind {
  static let allCasesInDisplayOrder: [PreviewChangeKind] = [.created, .updated, .removed]
}

struct UnifiedSourceSummary: View {
  let contents: Set<ContentKind>
  let skillCount: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          Text("Unified source")
            .font(Theme.Fonts.subheading)
            .foregroundStyle(Theme.Colors.mist)
          Text("Stored locally in .reglet")
            .font(Theme.Fonts.body)
            .foregroundStyle(Theme.Colors.ash)
        }
        Spacer()
        StatusBadge(text: "One source of truth", kind: .brand)
      }

      HStack(spacing: 10) {
        if contents.contains(.rules) {
          UnifiedSourceItem(icon: "doc.text", name: "AGENT.md", detail: "Unified instructions")
        }
        if contents.contains(.skills) {
          UnifiedSourceItem(
            icon: "folder",
            name: "skills",
            detail: "\(skillCount) raw skill\(skillCount == 1 ? "" : "s")"
          )
        }
        if contents.contains(.mcp) {
          UnifiedSourceItem(icon: "server.rack", name: "MCP", detail: "Unified servers")
        }
      }
    }
    .padding(Theme.Spacing.sm)
    .cardSurface()
  }
}

private struct UnifiedSourceItem: View {
  let icon: String
  let name: String
  let detail: String

  var body: some View {
    HStack(spacing: 9) {
      Image(systemName: icon)
        .foregroundStyle(Theme.Colors.info)
        .frame(width: 20)
      VStack(alignment: .leading, spacing: 1) {
        Text(name)
          .font(Theme.Fonts.bodyLg)
          .foregroundStyle(Theme.Colors.mist)
        Text(detail)
          .font(Theme.Fonts.eyebrow)
          .foregroundStyle(Theme.Colors.ash)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 9)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.Colors.graphite, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
  }
}

struct ApplyPreviewView: View {
  @EnvironmentObject private var model: SetupModel
  let scope: ApplyReviewScope
  let close: () -> Void
  let applied: () -> Void

  private var groups: [ProviderPreviewGroup] {
    ProviderPreviewGroup.make(entries: scope.preview.entries, providers: scope.providers)
  }

  private var skillNames: [String] {
    Array(Set(scope.preview.entries.compactMap { entry in
      guard entry.content == "skills", entry.operation == "write" else { return nil }
      return entry.friendlyName
    })).sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
  }

  private var changeCount: Int {
    groups.reduce(0) { $0 + $1.entries.count }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 12) {
        Text(scope.title)
          .font(Theme.Fonts.headingSm)
          .foregroundStyle(Theme.Colors.mist)
        Text("Reglet will sync the unified source into each provider's native files.")
          .font(Theme.Fonts.body)
          .foregroundStyle(Theme.Colors.ash)
        UnifiedSourceSummary(contents: Set(scope.contents), skillCount: skillNames.count)
        if !scope.preview.validationIssues.isEmpty {
          Label(scope.preview.validationIssues.joined(separator: "\n"), systemImage: "exclamationmark.triangle.fill")
            .font(Theme.Fonts.body)
            .foregroundStyle(Theme.Colors.errorText)
            .padding(Theme.Spacing.sm)
            .background(Theme.Colors.ink, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        }
      }
      .padding(Theme.Spacing.md)

      List {
        Section("Provider sync") {
          ForEach(groups) { group in
            ProviderPreviewDisclosure(group: group)
          }
        }
      }
      .listStyle(.inset)
      .scrollContentBackground(.hidden)
      .background(Theme.Colors.voidBlack)

      StatusStrip {
        HStack {
          Label(
            changeCount == 0 ? "All providers are up to date" : "\(changeCount) change\(changeCount == 1 ? "" : "s") ready",
            systemImage: changeCount == 0 ? "checkmark.circle" : "arrow.triangle.2.circlepath"
          )
          .foregroundStyle(Theme.Colors.ash)
          Spacer()
          Button("Cancel", action: close)
            .buttonStyle(.regletGhost)
          Button("Apply to Providers") {
            Task {
              if await model.applyPreview(scope.preview, contents: scope.contents, providers: scope.providers) {
                applied()
                close()
              }
            }
          }
          .buttonStyle(.regletPrimary)
          .keyboardShortcut(.defaultAction)
          .disabled(!scope.preview.validationIssues.isEmpty || model.isWorking)
        }
      }
    }
    .background(Theme.Colors.voidBlack)
    .frame(minWidth: 720, minHeight: 540)
  }
}

private struct ProviderPreviewDisclosure: View {
  @EnvironmentObject private var model: SetupModel
  let group: ProviderPreviewGroup
  @State private var isExpanded = false

  var body: some View {
    DisclosureGroup(isExpanded: $isExpanded) {
      if group.entries.isEmpty {
        Label("No files need changes", systemImage: "checkmark.circle")
          .font(Theme.Fonts.body)
          .foregroundStyle(Theme.Colors.ash)
          .padding(.vertical, 8)
      } else {
        VStack(spacing: 0) {
          ForEach(group.entries) { entry in
            ProviderPreviewChangeRow(entry: entry)
            if entry.id != group.entries.last?.id {
              Divider()
            }
          }
        }
        .padding(.leading, 4)
      }
    } label: {
      HStack(spacing: 10) {
        Image(systemName: "chevron.left.forwardslash.chevron.right")
          .foregroundStyle(Theme.Colors.info)
          .frame(width: 22)
        VStack(alignment: .leading, spacing: 2) {
          Text(previewProviderName(group.id, fallback: model.providerDisplayName(group.id)))
            .font(Theme.Fonts.bodyLg)
            .foregroundStyle(Theme.Colors.mist)
          Text(group.summary)
            .font(Theme.Fonts.eyebrow)
            .foregroundStyle(Theme.Colors.ash)
        }
      }
    }
    .padding(.vertical, 6)
    .listRowBackground(Theme.Colors.voidBlack)
    .listRowSeparatorTint(Theme.Colors.white.opacity(0.10))
  }
}

private struct ProviderPreviewChangeRow: View {
  let entry: StructuredApplyPreview.Entry

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: icon)
        .foregroundStyle(Theme.Colors.ash)
        .frame(width: 22)
      VStack(alignment: .leading, spacing: 2) {
        Text(entry.friendlyName)
          .font(Theme.Fonts.body)
          .foregroundStyle(Theme.Colors.mist)
        Text(detail)
          .font(Theme.Fonts.eyebrow)
          .foregroundStyle(Theme.Colors.ash)
      }
      Spacer()
      if let changeKind = entry.changeKind {
        StatusBadge(text: changeKind.rawValue, kind: changeKind.badgeKind)
      }
    }
    .padding(.vertical, 9)
    .accessibilityElement(children: .combine)
  }

  private var icon: String {
    switch entry.content {
    case "rules": "doc.text"
    case "skills": "hammer"
    case "mcp": "server.rack"
    default: "doc"
    }
  }

  private var detail: String {
    switch entry.content {
    case "rules": "Unified instructions"
    case "skills": "Skill"
    case "mcp": "Provider configuration"
    default: entry.content.capitalized
    }
  }
}
