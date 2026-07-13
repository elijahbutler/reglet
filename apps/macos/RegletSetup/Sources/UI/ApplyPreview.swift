import SwiftUI

struct ApplyPreviewView: View {
  @EnvironmentObject private var model: SetupModel
  let scope: ApplyReviewScope
  let close: () -> Void
  let applied: () -> Void
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(scope.title).font(.title2.weight(.semibold))
      if !scope.preview.validationIssues.isEmpty { Label(scope.preview.validationIssues.joined(separator: "\n"), systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
      List(scope.preview.entries) { entry in
        DisclosureGroup {
          Text(entry.diff).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
          Text("Drift: \(entry.driftStatus)").font(.caption).foregroundStyle(.secondary)
          if let hash = entry.expectedTargetHash {
            Text("Expected target hash: \(hash)").font(.system(.caption2, design: .monospaced)).textSelection(.enabled)
          }
          if let hash = entry.resultingTargetHash {
            Text("Resulting target hash: \(hash)").font(.system(.caption2, design: .monospaced)).textSelection(.enabled)
          }
          Text("Snapshot: \(entry.snapshot.behavior)\(entry.snapshot.location.map { " → \($0)" } ?? "")").font(.caption).foregroundStyle(.secondary)
          Text("Backup: \(entry.backup.behavior)\(entry.backup.location.map { " → \($0)" } ?? "")").font(.caption).foregroundStyle(.secondary)
        } label: {
          VStack(alignment: .leading) { Text("\(entry.provider) · \(entry.operation)"); Text(entry.path).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary) }
        }
      }
      HStack {
        Spacer()
        Button("Cancel", action: close)
        Button("Apply to Providers") {
          Task {
            if await model.applyPreview(scope.preview, contents: scope.contents, providers: scope.providers) {
              applied()
              close()
            }
          }
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
        .disabled(!scope.preview.validationIssues.isEmpty || model.isWorking)
      }
    }.padding(24).frame(minWidth: 760, minHeight: 560)
  }
}
