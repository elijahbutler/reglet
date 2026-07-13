import SwiftUI

struct CardSurface: ViewModifier {
  @Environment(\.colorSchemeContrast) private var contrast

  func body(content: Content) -> some View {
    let radius = Theme.Radius.card
    let hairlineOpacity = contrast == .increased ? 0.25 : 0.10

    content
      .background(Theme.Colors.ink, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
          .strokeBorder(
            LinearGradient(
              colors: [Color.white.opacity(hairlineOpacity), .clear],
              startPoint: .top,
              endPoint: .bottom
            ),
            lineWidth: 1
          )
      }
      .overlay {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
          .strokeBorder(
            LinearGradient(
              colors: [.clear, Color.black.opacity(0.30)],
              startPoint: .top,
              endPoint: .bottom
            ),
            lineWidth: 1
          )
      }
      .overlay {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
          .strokeBorder(Color.white.opacity(hairlineOpacity), lineWidth: 0.5)
      }
  }
}

extension View {
  func cardSurface() -> some View {
    modifier(CardSurface())
  }
}

struct RegletPrimaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    RegletButtonBody(
      configuration: configuration,
      fill: configuration.isPressed ? Theme.Colors.mist.opacity(0.82) : Theme.Colors.mist,
      border: nil,
      foreground: Theme.Colors.iron
    )
  }
}

struct RegletSecondaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    RegletButtonBody(
      configuration: configuration,
      fill: configuration.isPressed ? Theme.Colors.obsidian.opacity(0.78) : Theme.Colors.obsidian,
      border: Theme.Colors.slate,
      foreground: nil
    )
  }
}

struct RegletDestructiveButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    RegletButtonBody(
      configuration: configuration,
      fill: configuration.isPressed ? Theme.Colors.graphite.opacity(0.78) : Theme.Colors.graphite,
      border: nil,
      foreground: Theme.Colors.errorText
    )
  }
}

struct RegletGhostButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    RegletButtonBody(
      configuration: configuration,
      fill: configuration.isPressed ? Theme.Colors.graphite.opacity(0.45) : .clear,
      border: nil,
      foreground: nil,
      dimsOnHover: true
    )
  }
}

private struct RegletButtonBody: View {
  @Environment(\.colorSchemeContrast) private var contrast
  @State private var isHovering = false
  let configuration: ButtonStyle.Configuration
  let fill: Color
  let border: Color?
  let foreground: Color?
  var dimsOnHover = false

  var body: some View {
    configuration.label
      .font(Theme.Fonts.body)
      .foregroundStyle(foreground ?? secondaryText)
      .padding(.horizontal, 12)
      .padding(.vertical, 7)
      .background(fill, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
          .strokeBorder((border ?? .clear).opacity(border == nil ? 0 : hairlineOpacity), lineWidth: 1)
      }
      .opacity(dimsOnHover && (isHovering || configuration.isPressed) ? 0.78 : 1)
      .onHover { isHovering = $0 }
  }

  private var hairlineOpacity: Double {
    contrast == .increased ? 0.25 : 0.10
  }

  private var secondaryText: Color {
    contrast == .increased ? Theme.Colors.mist : Theme.Colors.ash
  }
}

extension ButtonStyle where Self == RegletPrimaryButtonStyle {
  static var regletPrimary: RegletPrimaryButtonStyle { RegletPrimaryButtonStyle() }
}

extension ButtonStyle where Self == RegletSecondaryButtonStyle {
  static var regletSecondary: RegletSecondaryButtonStyle { RegletSecondaryButtonStyle() }
}

extension ButtonStyle where Self == RegletDestructiveButtonStyle {
  static var regletDestructive: RegletDestructiveButtonStyle { RegletDestructiveButtonStyle() }
}

extension ButtonStyle where Self == RegletGhostButtonStyle {
  static var regletGhost: RegletGhostButtonStyle { RegletGhostButtonStyle() }
}

struct StatusBadge: View {
  enum Kind {
    case neutral
    case info
    case success
    case warning
    case error
    case brand
  }

  @Environment(\.colorSchemeContrast) private var contrast
  let text: String
  let kind: Kind

  var body: some View {
    Label {
      Text(text)
        .font(Theme.Fonts.eyebrow)
        .foregroundStyle(labelColor)
    } icon: {
      Image(systemName: iconName)
        .font(.system(size: 9, weight: .semibold))
        .foregroundStyle(kindColor)
    }
    .labelStyle(.titleAndIcon)
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(backgroundColor, in: RoundedRectangle(cornerRadius: Theme.Radius.badge, style: .continuous))
  }

  private var backgroundColor: Color {
    kind == .error ? Theme.Colors.emberHush : Theme.Colors.graphite
  }

  private var labelColor: Color {
    contrast == .increased ? Theme.Colors.mist : Theme.Colors.ash
  }

  private var iconName: String {
    switch kind {
    case .neutral: "circle.fill"
    case .info: "info.circle.fill"
    case .success: "checkmark.circle.fill"
    case .warning: "exclamationmark.triangle.fill"
    case .error: "xmark.octagon.fill"
    case .brand: "sparkle"
    }
  }

  private var kindColor: Color {
    switch kind {
    case .neutral: Theme.Colors.slate
    case .info: Theme.Colors.info
    case .success: Theme.Colors.success
    case .warning: Theme.Colors.warning
    case .error: Theme.Colors.errorText
    case .brand: Theme.Colors.coral
    }
  }
}

struct RegletTextFieldStyle: TextFieldStyle {
  @Environment(\.colorSchemeContrast) private var contrast

  func _body(configuration: TextField<Self._Label>) -> some View {
    configuration
      .font(Theme.Fonts.body)
      .textFieldStyle(.plain)
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
      .background(Theme.Colors.graphite, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
          .strokeBorder(Theme.Colors.slate.opacity(contrast == .increased ? 0.25 : 0.10), lineWidth: 1)
      }
  }
}

struct SectionHeader: View {
  @Environment(\.colorSchemeContrast) private var contrast
  let title: String

  var body: some View {
    Text(title.uppercased())
      .font(Theme.Fonts.eyebrow)
      .tracking(Theme.Fonts.eyebrowTracking)
      .foregroundStyle(contrast == .increased ? Theme.Colors.mist : Theme.Colors.ash)
  }
}

struct StatusStrip<Content: View>: View {
  @Environment(\.colorSchemeContrast) private var contrast
  @ViewBuilder let content: Content

  var body: some View {
    content
      .font(Theme.Fonts.body)
      .padding(.horizontal, Theme.Spacing.sm)
      .padding(.vertical, 10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Theme.Colors.ink)
      .overlay(alignment: .top) {
        Rectangle()
          .fill(Color.white.opacity(contrast == .increased ? 0.25 : 0.10))
          .frame(height: 1)
      }
  }
}
