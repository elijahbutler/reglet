import SwiftUI

struct RecoveryManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var receiptToRestore: OperationReceipt?
  @State private var confirmsLegacyClear = false

  var body: some View {
    List {
      Section("Operation receipts") {
        if model.operationReceipts.isEmpty {
          Text("No operations have been recorded on this Mac yet.")
            .foregroundStyle(.secondary)
        } else {
          ForEach(model.operationReceipts) { receipt in
            VStack(alignment: .leading, spacing: 6) {
              HStack {
                Text(receipt.lifecycle.capitalized)
                  .font(.headline)
                Spacer()
                Text("\(receipt.targets.count) target\(receipt.targets.count == 1 ? "" : "s")")
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
              Text(receipt.startedAt)
                .font(.caption)
                .foregroundStyle(.secondary)
              ForEach(receipt.targets.prefix(3)) { target in
                VStack(alignment: .leading, spacing: 2) {
                  Text(target.path)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                  Text(target.snapshot.map { "Snapshot: \($0)" } ?? "Snapshot: target did not exist")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .textSelection(.enabled)
                }
              }
              if receipt.targets.count > 3 {
                Text("+ \(receipt.targets.count - 3) more path(s)")
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
              Button("Restore this receipt…", role: .destructive) {
                receiptToRestore = receipt
              }
              .disabled(model.isWorking || receipt.targets.isEmpty)
            }
            .padding(.vertical, 4)
          }
        }
      }

      if let legacy = model.legacyNetworkState, legacy.present {
        Section("Inert legacy network state") {
          Text("Older local credentials and snapshots are inactive. Clearing them is permanent.")
            .foregroundStyle(.secondary)
          ForEach(legacy.paths, id: \.self) { path in
            Text(path)
              .font(.system(.caption, design: .monospaced))
              .textSelection(.enabled)
          }
          Button("Clear Legacy State…", role: .destructive) {
            confirmsLegacyClear = true
          }
          .disabled(model.isWorking)
        }
      }
    }
    .confirmationDialog(
      "Restore provider files from this receipt?",
      isPresented: Binding(
        get: { receiptToRestore != nil },
        set: { if !$0 { receiptToRestore = nil } }
      ),
      titleVisibility: .visible
    ) {
      Button("Restore", role: .destructive) {
        if let receiptToRestore {
          Task { await model.restoreOperation(receiptToRestore.id) }
        }
        receiptToRestore = nil
      }
      Button("Cancel", role: .cancel) { receiptToRestore = nil }
    } message: {
      Text("This replaces each listed provider path with its private snapshot from the selected operation.")
    }
    .confirmationDialog(
      "Clear inert legacy network state?",
      isPresented: $confirmsLegacyClear,
      titleVisibility: .visible
    ) {
      Button("Clear State", role: .destructive) {
        Task { await model.clearLegacyNetworkState() }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This permanently removes inactive pre-V1 credentials and snapshots from this Mac.")
    }
  }
}
