import SwiftUI

struct ApplyPreviewView: View {
  @EnvironmentObject private var model: SetupModel
  let scope: ApplyReviewScope
  let close: () -> Void
  let applied: () -> Void
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 12) {
        Text(scope.title)
          .font(Theme.Fonts.headingSm)
          .foregroundStyle(Theme.Colors.mist)
        if !scope.preview.validationIssues.isEmpty {
          Label(scope.preview.validationIssues.joined(separator: "\n"), systemImage: "exclamationmark.triangle.fill")
            .font(Theme.Fonts.body)
            .foregroundStyle(Theme.Colors.errorText)
            .padding(Theme.Spacing.sm)
            .background(Theme.Colors.ink, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        }
      }
      .padding(Theme.Spacing.md)
      List(scope.preview.entries) { entry in
        DisclosureGroup {
          Text(entry.diff)
            .font(Theme.Fonts.mono())
            .foregroundStyle(Theme.Colors.mist)
            .textSelection(.enabled)
            .padding(Theme.Spacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.Colors.ink, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
          Text("Drift: \(entry.driftStatus)")
            .font(Theme.Fonts.body)
            .foregroundStyle(Theme.Colors.ash)
          if let hash = entry.expectedTargetHash {
            Text("Expected target hash: \(hash)")
              .font(Theme.Fonts.mono(size: 11))
              .foregroundStyle(Theme.Colors.ash)
              .textSelection(.enabled)
          }
          if let hash = entry.resultingTargetHash {
            Text("Resulting target hash: \(hash)")
              .font(Theme.Fonts.mono(size: 11))
              .foregroundStyle(Theme.Colors.ash)
              .textSelection(.enabled)
          }
          Text("Snapshot: \(entry.snapshot.behavior)\(entry.snapshot.location.map { " → \($0)" } ?? "")")
            .font(Theme.Fonts.body)
            .foregroundStyle(Theme.Colors.ash)
          Text("Backup: \(entry.backup.behavior)\(entry.backup.location.map { " → \($0)" } ?? "")")
            .font(Theme.Fonts.body)
            .foregroundStyle(Theme.Colors.ash)
        } label: {
          VStack(alignment: .leading, spacing: 4) {
            Text("\(entry.provider) · \(entry.operation)")
              .font(Theme.Fonts.bodyLg)
              .foregroundStyle(Theme.Colors.mist)
            Text(entry.path)
              .font(Theme.Fonts.mono())
              .foregroundStyle(Theme.Colors.ash)
          }
        }
        .padding(.vertical, 6)
        .listRowBackground(Theme.Colors.voidBlack)
        .listRowSeparatorTint(Theme.Colors.white.opacity(0.10))
      }
      .listStyle(.inset)
      .scrollContentBackground(.hidden)
      .background(Theme.Colors.voidBlack)
      StatusStrip {
        HStack {
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
    .frame(minWidth: 760, minHeight: 560)
  }
}
