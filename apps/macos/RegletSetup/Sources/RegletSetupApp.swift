import SwiftUI

@main
struct RegletSetupApp: App {
  @StateObject private var model = SetupModel()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(model)
        .frame(minWidth: 880, minHeight: 620)
        .task {
          model.load()
        }
    }
    .windowStyle(.titleBar)
    .windowToolbarStyle(.unified)
  }
}

struct ContentView: View {
  @EnvironmentObject private var model: SetupModel
  @State private var step = 0

  var body: some View {
    VStack(spacing: 0) {
      HeaderView(step: step)
      Divider()
      Group {
        switch step {
        case 0:
          SafetyView {
            step = 1
          }
        case 1:
          SelectionView {
            Task {
              await model.refreshPlan()
              step = 2
            }
          }
        case 2:
          PreviewView(
            back: { step = 1 },
            apply: {
              Task {
                await model.applySelection()
                step = 3
              }
            }
          )
        default:
          StatusView(startOver: {
            step = 1
          })
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .overlay(alignment: .bottom) {
      if model.isWorking {
        ProgressView()
          .controlSize(.small)
          .padding(12)
      }
    }
    .alert("Reglet command failed", isPresented: Binding(
      get: { model.errorMessage != nil },
      set: { if !$0 { model.errorMessage = nil } }
    )) {
      Button("OK") {
        model.errorMessage = nil
      }
    } message: {
      Text(model.errorMessage ?? "")
    }
  }
}

struct HeaderView: View {
  let step: Int

  private let steps = ["Safety", "Choose", "Preview", "Done"]

  var body: some View {
    HStack(spacing: 16) {
      Image(systemName: "slider.horizontal.3")
        .font(.title2)
        .symbolRenderingMode(.hierarchical)
      VStack(alignment: .leading, spacing: 2) {
        Text("Reglet Setup")
          .font(.headline)
        Text("One source of truth for local agent configuration")
          .foregroundStyle(.secondary)
          .font(.subheadline)
      }
      Spacer()
      Picker("Step", selection: .constant(step)) {
        ForEach(steps.indices, id: \.self) { index in
          Text(steps[index]).tag(index)
        }
      }
      .pickerStyle(.segmented)
      .frame(width: 360)
      .disabled(true)
    }
    .padding(20)
    .background(.regularMaterial)
  }
}

struct SafetyView: View {
  let continueAction: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      Spacer()
      VStack(alignment: .leading, spacing: 10) {
        Text("Set up Reglet without surprises.")
          .font(.system(size: 32, weight: .semibold))
        Text("Reglet will scan local agent configuration, show the exact files involved, and wait for confirmation before writing provider files.")
          .font(.title3)
          .foregroundStyle(.secondary)
          .frame(maxWidth: 680, alignment: .leading)
      }

      VStack(alignment: .leading, spacing: 12) {
        SafetyRow(symbol: "checkmark.shield", title: "No daemon starts during setup")
        SafetyRow(symbol: "arrow.triangle.2.circlepath", title: "No sync is configured unless you enable it later")
        SafetyRow(symbol: "doc.badge.gearshape", title: "Provider writes are previewed before backup and apply")
        SafetyRow(symbol: "clock.arrow.circlepath", title: "Reglet backs up managed provider paths before changing them")
        SafetyRow(symbol: "arrow.uturn.backward", title: "Revert restores backed-up paths or removes Reglet-created outputs")
      }

      Button {
        continueAction()
      } label: {
        Label("Continue", systemImage: "arrow.right")
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.large)

      Spacer()
    }
    .padding(40)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct SafetyRow: View {
  let symbol: String
  let title: String

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: symbol)
        .frame(width: 24)
        .foregroundStyle(.tint)
      Text(title)
    }
    .font(.body)
  }
}

struct SelectionView: View {
  @EnvironmentObject private var model: SetupModel
  let continueAction: () -> Void

  var body: some View {
    HSplitView {
      VStack(alignment: .leading, spacing: 12) {
        Label("Providers", systemImage: "macwindow")
          .font(.headline)
        ScrollView {
          VStack(alignment: .leading, spacing: 8) {
            ForEach(model.scan?.providers ?? []) { provider in
              Toggle(isOn: providerBinding(provider.id)) {
                VStack(alignment: .leading, spacing: 2) {
                  Text(provider.displayName)
                  Text(provider.detected ? "Detected" : "Not found")
                    .font(.caption)
                    .foregroundStyle(provider.detected ? .secondary : .tertiary)
                }
              }
              .disabled(!provider.detected)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      .padding(24)
      .frame(minWidth: 320)

      VStack(alignment: .leading, spacing: 18) {
        Label("Content", systemImage: "checklist")
          .font(.headline)
        VStack(alignment: .leading, spacing: 12) {
          ForEach(ContentKind.allCases) { content in
            Toggle(isOn: contentBinding(content)) {
              Text(content.label)
            }
          }
        }
        if model.selectedContents.contains(.skills) {
          SkillSelectionView()
        }
        Spacer()
        HStack {
          Button {
            Task {
              await model.refreshScan()
            }
          } label: {
            Label("Rescan", systemImage: "arrow.clockwise")
          }
          Spacer()
          Button {
            continueAction()
          } label: {
            Label("Preview Files", systemImage: "doc.text.magnifyingglass")
          }
          .buttonStyle(.borderedProminent)
          .disabled(!model.canContinue)
        }
      }
      .padding(24)
      .frame(minWidth: 420)
    }
  }

  private func providerBinding(_ provider: String) -> Binding<Bool> {
    Binding(
      get: { model.selectedProviders.contains(provider) },
      set: { isSelected in
        if isSelected {
          model.selectedProviders.insert(provider)
          if let providerRecord = model.scan?.providers.first(where: { $0.id == provider }) {
            for skill in providerRecord.inventory.skills {
              model.selectedSkillTargets.insert("\(provider):\(skill)")
            }
          }
        } else {
          model.selectedProviders.remove(provider)
          model.selectedSkillTargets = Set(model.selectedSkillTargets.filter { !$0.hasPrefix("\(provider):") })
        }
      }
    )
  }

  private func contentBinding(_ content: ContentKind) -> Binding<Bool> {
    Binding(
      get: { model.selectedContents.contains(content) },
      set: { isSelected in
        if isSelected {
          model.selectedContents.insert(content)
        } else {
          model.selectedContents.remove(content)
        }
      }
    )
  }
}

struct SkillSelectionView: View {
  @EnvironmentObject private var model: SetupModel

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Label("Skills to Transfer", systemImage: "square.stack.3d.up")
        .font(.headline)
      if model.availableSkillTargets.isEmpty {
        Text("No provider skills were found for the selected providers.")
          .foregroundStyle(.secondary)
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: 8) {
            ForEach(model.availableSkillTargets) { target in
              Toggle(isOn: skillBinding(target.id)) {
                VStack(alignment: .leading, spacing: 2) {
                  Text(target.skillName)
                  Text(target.providerName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
              }
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 180)
      }
    }
  }

  private func skillBinding(_ target: String) -> Binding<Bool> {
    Binding(
      get: { model.selectedSkillTargets.contains(target) },
      set: { isSelected in
        if isSelected {
          model.selectedSkillTargets.insert(target)
        } else {
          model.selectedSkillTargets.remove(target)
        }
      }
    )
  }
}

struct PreviewView: View {
  @EnvironmentObject private var model: SetupModel
  let back: () -> Void
  let apply: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      FileList(title: "Files Reglet will read", files: model.plan?.reads ?? [])
      Divider()
      FileList(title: "Files Reglet will write after confirmation", files: model.plan?.writes ?? [])
      Divider()
      HStack {
        Button("Back", action: back)
        Spacer()
        Text("Daemon, sync, and notifications stay off. Managed provider paths are backed up before writes.")
          .foregroundStyle(.secondary)
        Button {
          apply()
        } label: {
          Label("Create Backups and Apply", systemImage: "checkmark.circle")
        }
        .buttonStyle(.borderedProminent)
        .disabled(model.isWorking)
      }
      .padding(20)
      .background(.regularMaterial)
    }
  }
}

struct FileList: View {
  let title: String
  let files: [PlannedFile]

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(title)
        .font(.headline)
      if files.isEmpty {
        ContentUnavailableView("No files", systemImage: "doc", description: Text("Nothing is needed for this step."))
      } else {
        List(files) { file in
          VStack(alignment: .leading, spacing: 4) {
            HStack {
              Text(file.provider)
                .font(.caption)
                .foregroundStyle(.secondary)
              Text(file.content)
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Text(file.path)
              .font(.system(.body, design: .monospaced))
              .textSelection(.enabled)
          }
          .padding(.vertical, 4)
        }
        .listStyle(.inset)
      }
    }
    .padding(20)
  }
}

struct StatusView: View {
  @EnvironmentObject private var model: SetupModel
  let startOver: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Label("Setup Complete", systemImage: "checkmark.seal")
        .font(.largeTitle.weight(.semibold))
      Text(model.completionMessage ?? "Reglet finished onboarding.")
        .foregroundStyle(.secondary)
        .textSelection(.enabled)

      List(model.detectedProviders) { provider in
        HStack {
          VStack(alignment: .leading) {
            Text(provider.displayName)
            Text(provider.id)
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          Spacer()
          Button {
            Task {
              await model.restore(provider: provider.id)
            }
          } label: {
            Label("Restore", systemImage: "clock.arrow.circlepath")
          }
          Button {
            Task {
              await model.revert(provider: provider.id)
            }
          } label: {
            Label("Revert", systemImage: "arrow.uturn.backward")
          }
        }
        .padding(.vertical, 4)
      }
      .listStyle(.inset)

      HStack {
        Button("Review Another Selection", action: startOver)
        Spacer()
      }
    }
    .padding(32)
  }
}
