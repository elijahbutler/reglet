import SwiftUI

struct RulesManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @Environment(\.colorSchemeContrast) private var contrast
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
          .font(Theme.Fonts.mono())
          .foregroundStyle(Theme.Colors.mist)
          .tag(document.path)
          .listRowBackground(Theme.Colors.voidBlack)
          .listRowSeparatorTint(Theme.Colors.white.opacity(0.10))
      }
      .listStyle(.sidebar)
      .scrollContentBackground(.hidden)
      .background(Theme.Colors.voidBlack)
      .frame(minWidth: 150, idealWidth: 220, maxWidth: 320)

      VStack(spacing: 0) {
        if let selectedPath {
          TextEditor(text: $content)
            .font(Theme.Fonts.mono(size: 13))
            .foregroundStyle(Theme.Colors.mist)
            .scrollContentBackground(.hidden)
            .background(Theme.Colors.ink)
            .padding(12)
            .accessibilityLabel("Rule document editor")
          StatusStrip {
            HStack {
              Label(hasUnsavedChanges ? "Unsaved changes" : "Saved to master", systemImage: hasUnsavedChanges ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(Theme.Fonts.body)
                .foregroundStyle(hasUnsavedChanges ? Theme.Colors.warning : secondaryText)
              Spacer()
              Button("Save") {
                Task {
                  if await model.saveRule(path: selectedPath, content: content) {
                    savedContent = content
                  }
                }
              }
              .buttonStyle(.regletSecondary)
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
              .buttonStyle(.regletPrimary)
              .keyboardShortcut(.defaultAction)
              .disabled(hasUnsavedChanges || model.isWorking)
            }
          }
        } else {
          ContentUnavailableView("Select a rule document", systemImage: "doc.text", description: Text("Edits are saved to the master first, then applied explicitly."))
            .background(Theme.Colors.voidBlack)
        }
      }
      .background(Theme.Colors.voidBlack)
      .frame(minWidth: 0, maxWidth: .infinity)
    }
    .background(Theme.Colors.voidBlack)
    .frame(minWidth: 0, maxWidth: .infinity, maxHeight: .infinity)
    .clipped()
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

  private var secondaryText: Color {
    contrast == .increased ? Theme.Colors.mist : Theme.Colors.ash
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
