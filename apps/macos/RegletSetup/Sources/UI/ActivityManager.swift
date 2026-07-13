import SwiftUI

struct ActivityDriftManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @Environment(\.colorSchemeContrast) private var contrast
  @State private var reviewedReplacement: ApplyReviewScope?

  private var drift: [DriftRecord] { model.status?.drift ?? [] }
  private var drifted: [DriftRecord] { drift.filter { $0.status != "clean" } }
  private var clean: [DriftRecord] { drift.filter { $0.status == "clean" } }
  private var latestReceipt: OperationReceipt? { model.operationReceipts.first }
  private var managedProviders: [StatusResponse.Provider] {
    model.status?.providers.filter(\.enabled) ?? []
  }
  private var diagnostics: String {
    let receipt = latestReceipt.map { "lastReceipt=\($0.id) lifecycle=\($0.lifecycle) targets=\($0.targets.count)" } ?? "lastReceipt=none"
    return "managedProviders=\(managedProviders.count) drifted=\(drifted.count) \(receipt)"
  }

  var body: some View {
    List {
      Section("Manager status") {
        if managedProviders.isEmpty {
          Text("No provider scopes are managed yet.")
            .foregroundStyle(secondaryText)
        } else {
          ForEach(managedProviders) { provider in
            Text("\(model.providerDisplayName(provider.id)): \([provider.contents.rules ? "Rules" : nil, provider.contents.skills ? "Skills" : nil, provider.contents.mcp ? "MCP" : nil].compactMap { $0 }.joined(separator: ", "))")
              .font(Theme.Fonts.body)
              .foregroundStyle(Theme.Colors.mist)
          }
        }
      }

      Section("Latest operation") {
        if let receipt = latestReceipt {
          Text(receipt.id)
            .font(Theme.Fonts.mono())
            .foregroundStyle(Theme.Colors.mist)
            .textSelection(.enabled)
          Text("\(receipt.lifecycle.capitalized) · \(receipt.targets.count) target\(receipt.targets.count == 1 ? "" : "s")")
            .foregroundStyle(Theme.Colors.mist)
          if let message = receipt.recovery.message {
            Text(message)
              .font(Theme.Fonts.body)
              .foregroundStyle(secondaryText)
          }
          if receipt.lifecycle == "rolled-back" {
            Text("Resolve the reported issue, then create a fresh review before retrying.")
              .font(Theme.Fonts.body)
              .foregroundStyle(secondaryText)
          }
        } else {
          Text("No operation receipt yet. Review & Apply creates one for every provider mutation.")
            .foregroundStyle(secondaryText)
        }
      }

      if !drifted.isEmpty {
        Section("Needs attention") {
          ForEach(drifted) { record in
            DriftRow(record: record, reviewedReplacement: $reviewedReplacement)
          }
        }
      }

      Section("Managed and clean") {
        if clean.isEmpty {
          Text("No managed files yet. Run setup to enroll providers.")
            .foregroundStyle(secondaryText)
        } else {
          ForEach(clean) { record in
            VStack(alignment: .leading, spacing: 3) {
              HStack(spacing: 8) {
                Text(model.providerDisplayName(record.provider))
                  .foregroundStyle(Theme.Colors.mist)
                StatusBadge(text: record.content, kind: .success)
              }
              Text(record.outputPath)
                .font(Theme.Fonts.mono())
                .foregroundStyle(secondaryText)
                .textSelection(.enabled)
            }
            .padding(.vertical, 2)
          }
        }
      }

      Section("Copyable diagnostics") {
        Text(diagnostics)
          .font(Theme.Fonts.mono())
          .foregroundStyle(Theme.Colors.mist)
          .textSelection(.enabled)
        Text("Include this local summary when reporting a retry or recovery problem. It contains no resolved environment values.")
          .font(Theme.Fonts.body)
          .foregroundStyle(secondaryText)
      }
    }
    .scrollContentBackground(.hidden)
    .background(Theme.Colors.voidBlack)
    .overlay {
      if model.status == nil && !model.isWorking {
        ContentUnavailableView("Drift status unavailable", systemImage: "waveform.path.ecg", description: Text("Refresh to check managed files."))
      } else if model.status != nil && drift.isEmpty && !model.isWorking {
        ContentUnavailableView("Nothing is managed yet", systemImage: "waveform.path.ecg", description: Text("Enroll providers to start tracking managed files."))
      }
    }
    .safeAreaInset(edge: .bottom) {
      if let status = model.status, !drift.isEmpty {
        StatusStrip {
          HStack {
          Image(systemName: status.driftedCount == 0 ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
            .foregroundStyle(status.driftedCount == 0 ? Theme.Colors.success : Theme.Colors.warning)
          Text(status.driftedCount == 0
            ? "All \(drift.count) managed files match the master."
            : "\(status.driftedCount) of \(drift.count) managed files changed outside Reglet.")
            .foregroundStyle(Theme.Colors.mist)
          Spacer()
          }
        }
      }
    }
    .sheet(item: $reviewedReplacement) { scope in
      ApplyPreviewView(scope: scope, close: { reviewedReplacement = nil }, applied: {})
      .environmentObject(model)
    }
  }

  private var secondaryText: Color {
    contrast == .increased ? Theme.Colors.mist : Theme.Colors.ash
  }
}

struct DriftRow: View {
  @EnvironmentObject private var model: SetupModel
  @Environment(\.colorSchemeContrast) private var contrast
  let record: DriftRecord
  @Binding var reviewedReplacement: ApplyReviewScope?

  private var isMissing: Bool { record.status == "missing" }

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 8) {
          Text(model.providerDisplayName(record.provider))
            .foregroundStyle(Theme.Colors.mist)
          StatusBadge(text: record.content, kind: .success)
          StatusBadge(text: isMissing ? "deleted" : "edited", kind: .warning)
        }
        Text(record.outputPath)
          .font(Theme.Fonts.mono())
          .foregroundStyle(secondaryText)
          .textSelection(.enabled)
        Text(isMissing
          ? "The managed file was removed. Review the replacement before recreating it from the master."
          : "Import keeps the edits in the master; review the exact replacement before overwriting it.")
          .font(Theme.Fonts.body)
          .foregroundStyle(secondaryText)
      }
      Spacer()
      Button {
        Task { await model.importDrifted(provider: record.provider, content: record.content) }
      } label: {
        Label("Import to Master", systemImage: "square.and.arrow.down")
      }
      .buttonStyle(.regletGhost)
      .disabled(isMissing || model.isWorking)
      .help("Copy the provider's edits back into the master directory")
      Button {
        guard let content = ContentKind(rawValue: record.content) else { return }
        Task {
          if let preview = await model.previewApply(content: content, provider: record.provider) {
            reviewedReplacement = ApplyReviewScope(
              preview: preview,
              contents: [content],
              providers: [record.provider],
              title: "Review Drift Replacement"
            )
          }
        }
      } label: {
        Label("Review Replace", systemImage: "doc.text.magnifyingglass")
      }
      .buttonStyle(.regletPrimary)
      .disabled(model.isWorking)
      .help("Review the exact replacement before overwriting the provider file")
    }
    .padding(.vertical, 4)
  }

  private var secondaryText: Color {
    contrast == .increased ? Theme.Colors.mist : Theme.Colors.ash
  }
}
