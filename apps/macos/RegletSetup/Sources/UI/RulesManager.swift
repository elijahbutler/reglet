import SwiftUI

struct RulesManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var selectedPath: String?
  @State private var content = ""
  @State private var savedContent = ""
  @State private var applyPreview: ApplyReviewScope?
  @State private var pendingPath: String?
  @State private var resolvesUnsavedSelection = false

  private var hasUnsavedChanges: Bool { content != savedContent }

  var body: some View {
    HSplitView {
      List(model.ruleDocuments, selection: $selectedPath) { document in
        Label(document.path, systemImage: "doc.text")
          .tag(document.path)
      }
      .frame(minWidth: 190, idealWidth: 230)

      VStack(spacing: 0) {
        if let selectedPath {
          TextEditor(text: $content)
            .font(.system(.body, design: .monospaced))
            .scrollContentBackground(.hidden)
            .padding(12)
            .accessibilityLabel("Rule document editor")
          Divider()
          HStack {
            Text(hasUnsavedChanges ? "Unsaved changes" : "Saved to master")
              .font(.caption)
              .foregroundStyle(hasUnsavedChanges ? Color.orange : Color.secondary)
            Spacer()
            Button("Save") {
              Task {
                if await model.saveRule(path: selectedPath, content: content) {
                  savedContent = content
                }
              }
            }
            .keyboardShortcut("s", modifiers: .command)
            .disabled(!hasUnsavedChanges || model.isWorking)
            Button("Preview Apply…") {
              Task {
                if let preview = await model.previewApply(content: .rules) {
                  applyPreview = ApplyReviewScope(
                    preview: preview,
                    contents: [.rules],
                    providers: [],
                    title: "Review Rules Apply"
                  )
                }
              }
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
            .disabled(hasUnsavedChanges || model.isWorking)
          }
          .padding(12)
          .background(.regularMaterial)
        } else {
          ContentUnavailableView("Select a rule document", systemImage: "doc.text", description: Text("Edits are saved to the master first, then applied explicitly."))
        }
      }
      .frame(minWidth: 440)
    }
    .onChange(of: selectedPath) { oldPath, newPath in
      if hasUnsavedChanges, oldPath != nil, newPath != oldPath {
        pendingPath = newPath
        selectedPath = oldPath
        resolvesUnsavedSelection = true
      } else {
        load(newPath)
      }
    }
    .task {
      if selectedPath == nil, let first = model.ruleDocuments.first?.path {
        selectedPath = first
      }
    }
    .onChange(of: model.ruleDocuments.map(\.path)) { _, paths in
      if selectedPath == nil {
        selectedPath = paths.first
      }
    }
    .sheet(item: $applyPreview) { scope in
      ApplyPreviewView(scope: scope, close: { applyPreview = nil }, applied: {})
        .environmentObject(model)
    }
    .confirmationDialog("Save changes before switching rules?", isPresented: $resolvesUnsavedSelection) {
      Button("Save") {
        guard let currentPath = selectedPath else { return }
        Task {
          if await model.saveRule(path: currentPath, content: content) {
            savedContent = content
            self.selectedPath = pendingPath
            pendingPath = nil
          }
        }
      }
      Button("Discard Changes", role: .destructive) {
        savedContent = content
        selectedPath = pendingPath
        pendingPath = nil
      }
      Button("Cancel", role: .cancel) { pendingPath = nil }
    }
  }

  private func load(_ path: String?) {
    guard let path else { return }
    Task {
      if let loaded = await model.loadRule(path: path) {
        content = loaded
        savedContent = loaded
      }
    }
  }
}
