import SwiftUI

struct ProvidersManagerView: View {
  @EnvironmentObject private var model: SetupModel
  @Binding var showsOnboarding: Bool
  @State private var providerToStop: String?

  var body: some View {
    List {
      Section {
        ForEach(model.scan?.providers ?? []) { provider in
          HStack(spacing: 12) {
            Image(systemName: provider.detected ? "checkmark.circle.fill" : "circle.dashed")
              .foregroundStyle(provider.detected ? Theme.Colors.success : Theme.Colors.smoke)
              .accessibilityLabel(provider.detected ? "Detected" : "Not detected")
            VStack(alignment: .leading, spacing: 3) {
              Text(provider.displayName)
                .font(Theme.Fonts.bodyLg)
                .foregroundStyle(Theme.Colors.mist)
              Text(provider.enabled ? "Managed" : (provider.detected ? "Available" : "Not installed"))
                .font(Theme.Fonts.body)
                .foregroundStyle(Theme.Colors.ash)
            }
            Spacer()
            if provider.enabled {
              Text([provider.contents.rules ? "Rules" : nil, provider.contents.skills ? "Skills" : nil, provider.contents.mcp ? "MCP" : nil].compactMap { $0 }.joined(separator: " · "))
                .font(Theme.Fonts.body)
                .foregroundStyle(Theme.Colors.ash)
              Button("Stop Managing…", role: .destructive) {
                providerToStop = provider.id
              }
              .buttonStyle(.regletDestructive)
              .disabled(model.isWorking)
            }
          }
          .padding(.vertical, 8)
          .listRowBackground(Theme.Colors.voidBlack)
        }
      } header: {
        SectionHeader(title: "Installed Providers")
      }
    }
    .listStyle(.inset)
    .scrollContentBackground(.hidden)
    .background(Theme.Colors.voidBlack)
    .overlay {
      if model.scan == nil && !model.isWorking {
        ContentUnavailableView("Provider status unavailable", systemImage: "macwindow", description: Text("Refresh to scan this Mac."))
      }
    }
    .safeAreaInset(edge: .bottom) {
      StatusStrip {
        HStack {
          Spacer()
          Button {
            showsOnboarding = true
          } label: {
            Label("Configure Providers", systemImage: "slider.horizontal.3")
          }
          .buttonStyle(.regletPrimary)
        }
      }
    }
    .confirmationDialog(
      "Stop managing this provider?",
      isPresented: Binding(
        get: { providerToStop != nil },
        set: { if !$0 { providerToStop = nil } }
      ),
      titleVisibility: .visible
    ) {
      Button("Stop Managing", role: .destructive) {
        if let providerToStop {
          Task { await model.stopManaging(provider: providerToStop) }
        }
        providerToStop = nil
      }
      Button("Cancel", role: .cancel) { providerToStop = nil }
    } message: {
      Text("Reglet preserves the provider's current files, clears ownership, and removes generated rules headers where applicable.")
    }
  }
}

struct InventoryManagerView: View {
  @EnvironmentObject private var model: SetupModel
  let kind: ContentKind
  var body: some View {
    List(model.scan?.providers.filter { $0.enabled } ?? []) { provider in
      VStack(alignment: .leading, spacing: 4) {
        Text(provider.displayName)
          .font(Theme.Fonts.bodyLg)
          .foregroundStyle(Theme.Colors.mist)
        Text(kind == .rules ? (provider.inventory.rulesPath ?? "Unsupported") : (provider.inventory.mcpPath ?? "Unsupported"))
          .font(Theme.Fonts.mono())
          .foregroundStyle(Theme.Colors.ash)
          .textSelection(.enabled)
      }
      .padding(.vertical, 8)
      .listRowBackground(Theme.Colors.voidBlack)
    }
    .listStyle(.inset)
    .scrollContentBackground(.hidden)
    .background(Theme.Colors.voidBlack)
  }
}
