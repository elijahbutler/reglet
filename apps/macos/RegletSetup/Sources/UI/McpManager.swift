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
          .textFieldStyle(.roundedBorder)
          .padding(8)
        List(filteredServers, selection: $selectedName) { entry in
          VStack(alignment: .leading) { Text(entry.name); if !entry.issues.isEmpty { Text(entry.issues.joined(separator: ", ")).font(.caption).foregroundStyle(.red) } }.tag(entry.name)
        }
        Divider()
        Button("New Server") { selectedName = nil }.padding()
      }.frame(minWidth: 220)
      Form {
        TextField("Server name", text: $name)
        Picker("Transport", selection: $transport) { Text("Local command").tag(0); Text("Remote URL").tag(1) }.pickerStyle(.segmented)
        if transport == 0 {
          TextField("Command", text: $command)
          TextField("Arguments (one per line)", text: $args, axis: .vertical).lineLimit(3...8)
          TextField("Environment (OUTPUT_KEY=LOCAL_VARIABLE, one per line)", text: $env, axis: .vertical).lineLimit(3...8)
          Text("Reglet stores only local process-environment variable names. Values are resolved in memory during apply and never shown here.")
            .font(.caption)
            .foregroundStyle(.secondary)
        } else {
          TextField("https://server.example/mcp", text: $url)
        }
        HStack {
          if selectedName != nil {
            Button("Delete", role: .destructive) { confirmsDelete = true }
          }
          Spacer()
          Text(definition == saved ? "Saved to master — not applied" : "Unsaved changes").font(.caption).foregroundStyle(definition == saved ? Color.secondary : Color.orange)
          Button("Save") {
            if selectedName == nil && !model.mcpServers.contains(where: { $0.name == name }) {
              Task { if await model.saveMcp(name: name, definition: definition) { saved = definition; selectedName = name } }
            } else {
              confirmsOverwrite = true
            }
          }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut("s", modifiers: .command)
            .disabled(!valid || definition == saved)
        }
      }.formStyle(.grouped).frame(minWidth: 500)
    }
    .safeAreaInset(edge: .bottom) {
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
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
        .disabled(model.isWorking)
      }
      .padding()
      .background(.regularMaterial)
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
