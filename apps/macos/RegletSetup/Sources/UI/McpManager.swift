import SwiftUI

struct McpManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var selectedName: String?
  @State private var name = ""
  @State private var transport = 0
  @State private var command = ""
  @State private var args = ""
  @State private var url = ""
  @State private var env = ""
  @State private var saved = McpServerDefinition()
  @State private var applyPreview: ApplyReviewScope?
  @State private var pendingName: String?
  @State private var resolvesUnsavedSelection = false
  @State private var confirmsDelete = false
  @State private var confirmsOverwrite = false
  @State private var searchText = ""

  private var definition: McpServerDefinition {
    transport == 0
      ? McpServerDefinition(command: command, args: args.split(separator: "\n").map(String.init), env: parseEnvironment(), url: nil)
      : McpServerDefinition(command: nil, args: nil, env: nil, url: url)
  }
  private var valid: Bool {
    !name.isEmpty && (transport == 0 ? !command.trimmingCharacters(in: .whitespaces).isEmpty : (URL(string: url)?.scheme.map { $0 == "http" || $0 == "https" } ?? false))
  }

  var body: some View {
    HSplitView {
      VStack(spacing: 0) {
        TextField("Filter servers", text: $searchText)
          .textFieldStyle(RegletTextFieldStyle())
          .padding(Theme.Spacing.xs)
        List(filteredServers, selection: $selectedName) { entry in
          VStack(alignment: .leading, spacing: 4) {
            Text(entry.name)
              .font(Theme.Fonts.bodyLg)
              .foregroundStyle(Theme.Colors.mist)
            if !entry.issues.isEmpty {
              Label(entry.issues.joined(separator: ", "), systemImage: "exclamationmark.triangle.fill")
                .font(Theme.Fonts.body)
                .foregroundStyle(Theme.Colors.errorText)
            }
          }
          .padding(.vertical, 6)
          .tag(entry.name)
          .listRowBackground(Theme.Colors.voidBlack)
          .listRowSeparatorTint(Theme.Colors.white.opacity(0.10))
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .background(Theme.Colors.voidBlack)
        Rectangle()
          .fill(Theme.Colors.white.opacity(0.10))
          .frame(height: 1)
        Button("New Server") { selectedName = nil }
          .buttonStyle(.regletSecondary)
          .padding(Theme.Spacing.sm)
      }
      .background(Theme.Colors.voidBlack)
      .frame(minWidth: 220)
      ScrollView {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
          SectionHeader(title: "Server Definition")
          VStack(alignment: .leading, spacing: 12) {
            FieldLabel("Server name")
            TextField("Server name", text: $name)
              .textFieldStyle(RegletTextFieldStyle())

            FieldLabel("Transport")
            Picker("Transport", selection: $transport) {
              Text("Local command").tag(0)
              Text("Remote URL").tag(1)
            }
            .pickerStyle(.segmented)

            if transport == 0 {
              FieldLabel("Command")
              TextField("Command", text: $command)
                .textFieldStyle(RegletTextFieldStyle())
              FieldLabel("Arguments (one per line)")
              TextField("Arguments (one per line)", text: $args, axis: .vertical)
                .lineLimit(3...8)
                .textFieldStyle(RegletTextFieldStyle())
              FieldLabel("Environment (OUTPUT_KEY=LOCAL_VARIABLE, one per line)")
              TextField("Environment (OUTPUT_KEY=LOCAL_VARIABLE, one per line)", text: $env, axis: .vertical)
                .lineLimit(3...8)
                .textFieldStyle(RegletTextFieldStyle())
              Text("Reglet stores only local process-environment variable names. Values are resolved in memory during apply and never shown here.")
                .font(Theme.Fonts.body)
                .foregroundStyle(Theme.Colors.ash)
            } else {
              FieldLabel("Remote URL")
              TextField("https://server.example/mcp", text: $url)
                .textFieldStyle(RegletTextFieldStyle())
            }
          }
          .padding(Theme.Spacing.sm)
          .cardSurface()

          HStack {
            if selectedName != nil {
              Button("Delete", role: .destructive) { confirmsDelete = true }
                .buttonStyle(.regletDestructive)
            }
            Spacer()
            Label(definition == saved ? "Saved to master — not applied" : "Unsaved changes", systemImage: definition == saved ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
              .font(Theme.Fonts.body)
              .foregroundStyle(definition == saved ? Theme.Colors.ash : Theme.Colors.warning)
            Button("Save") {
              if selectedName == nil && !model.mcpServers.contains(where: { $0.name == name }) {
                Task { if await model.saveMcp(name: name, definition: definition) { saved = definition; selectedName = name } }
              } else {
                confirmsOverwrite = true
              }
            }
            .buttonStyle(.regletPrimary)
            .keyboardShortcut("s", modifiers: .command)
            .disabled(!valid || definition == saved)
          }
        }
        .padding(Theme.Spacing.md)
      }
      .scrollContentBackground(.hidden)
      .background(Theme.Colors.voidBlack)
      .frame(minWidth: 500)
    }
    .background(Theme.Colors.voidBlack)
    .safeAreaInset(edge: .bottom) {
      StatusStrip {
        HStack {
          Spacer()
          Button("Preview Apply…") {
            Task {
              if let preview = await model.previewApply(content: .mcp) {
                applyPreview = ApplyReviewScope(
                  preview: preview,
                  contents: [.mcp],
                  providers: [],
                  title: "Review MCP Apply"
                )
              }
            }
          }
          .buttonStyle(.regletPrimary)
          .keyboardShortcut(.defaultAction)
          .disabled(model.isWorking)
        }
      }
    }
    .onChange(of: selectedName) { oldValue, value in
      if definition != saved && oldValue != nil {
        pendingName = value; selectedName = oldValue; resolvesUnsavedSelection = true
      } else { load(value) }
    }
    .sheet(item: $applyPreview) { scope in
      ApplyPreviewView(scope: scope, close: { applyPreview = nil }, applied: {})
        .environmentObject(model)
    }
    .confirmationDialog("Save changes before switching servers?", isPresented: $resolvesUnsavedSelection) {
      Button("Save") { Task { if await model.saveMcp(name: name, definition: definition) { saved = definition; selectedName = pendingName; pendingName = nil } } }
      Button("Discard Changes", role: .destructive) { saved = definition; selectedName = pendingName; pendingName = nil }
      Button("Cancel", role: .cancel) { pendingName = nil }
    }
    .confirmationDialog("Delete \(name)?", isPresented: $confirmsDelete) {
      Button("Delete from Master", role: .destructive) {
        Task {
          if await model.deleteMcp(name: name) {
            clear()
          }
        }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This deletes the canonical server definition. Existing provider copies remain until you review and apply MCP.")
    }
    .confirmationDialog("Replace \(name)?", isPresented: $confirmsOverwrite) {
      Button("Replace in Master", role: .destructive) {
        Task { if await model.saveMcp(name: name, definition: definition) { saved = definition; selectedName = name } }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This replaces the canonical MCP definition. Existing provider copies remain unchanged until you review and apply MCP.")
    }
  }

  private func load(_ selected: String?) {
    guard let selected else {
      clear()
      return
    }
    guard let entry = model.mcpServers.first(where: { $0.name == selected }) else { return }
    name = entry.name; command = entry.server.command ?? ""; args = (entry.server.args ?? []).joined(separator: "\n"); url = entry.server.url ?? ""; env = (entry.server.env ?? [:]).sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value.name)" }.joined(separator: "\n"); transport = entry.server.url == nil ? 0 : 1; saved = entry.server
  }
  private var filteredServers: [McpServersResponse.Entry] {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return model.mcpServers }
    return model.mcpServers.filter { entry in
      entry.name.localizedCaseInsensitiveContains(query)
        || (entry.server.command ?? "").localizedCaseInsensitiveContains(query)
        || (entry.server.url ?? "").localizedCaseInsensitiveContains(query)
    }
  }
  private func clear() { selectedName = nil; name = ""; command = ""; args = ""; url = ""; env = ""; transport = 0; saved = McpServerDefinition() }
  private func parseEnvironment() -> [String: McpProcessEnvironmentReference] {
    Dictionary(uniqueKeysWithValues: env.split(separator: "\n").compactMap { line in
      guard let split = line.firstIndex(of: "=") else { return nil }
      let key = String(line[..<split]).trimmingCharacters(in: .whitespacesAndNewlines)
      let name = String(line[line.index(after: split)...]).trimmingCharacters(in: .whitespacesAndNewlines)
      guard !key.isEmpty, !name.isEmpty else { return nil }
      return (key, McpProcessEnvironmentReference(name: name))
    })
  }
}

private struct FieldLabel: View {
  let title: String

  init(_ title: String) {
    self.title = title
  }

  var body: some View {
    Text(title)
      .font(Theme.Fonts.eyebrow)
      .tracking(Theme.Fonts.eyebrowTracking)
      .foregroundStyle(Theme.Colors.ash)
  }
}
