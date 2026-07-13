import CoreText
import SwiftUI

extension Color {
  init(hex: UInt32, alpha: Double = 1) {
    let red = Double((hex >> 16) & 0xff) / 255
    let green = Double((hex >> 8) & 0xff) / 255
    let blue = Double(hex & 0xff) / 255
    self.init(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
  }
}

enum Theme {
  enum Colors {
    static let voidBlack = Color(hex: 0x040506)
    static let ink = Color(hex: 0x07080a)
    static let obsidian = Color(hex: 0x111214)
    static let graphite = Color(hex: 0x1b1c1e)
    static let slate = Color(hex: 0x2f3031)
    static let iron = Color(hex: 0x454647)
    static let smoke = Color(hex: 0x6a6b6c)
    static let ash = Color(hex: 0x9c9c9d)
    static let mist = Color(hex: 0xe6e6e6)
    static let white = Color.white
    static let coral = Color(hex: 0xff6363)
    static let emberHush = Color(hex: 0x452324)
    static let info = Color(hex: 0x56c2ff)
    static let success = Color(hex: 0x59d499)
    static let warning = Color(hex: 0xffb224)
    static let error = Color(hex: 0xe5484d)
    static let errorText = Color(hex: 0xff9294)
  }

  enum Fonts {
    static let eyebrowTracking: CGFloat = 0.8

    static var eyebrow: Font { inter(size: 11, weight: .semibold) }
    static var body: Font { inter(size: 13, weight: .regular) }
    static var bodyLg: Font { inter(size: 15, weight: .regular) }
    static var subheading: Font { inter(size: 17, weight: .medium) }
    static var headingSm: Font { inter(size: 20, weight: .medium) }
    static var heading: Font { inter(size: 26, weight: .medium) }
    static var headingLg: Font { inter(size: 34, weight: .regular) }

    static func mono(size: CGFloat = 12) -> Font {
      .system(size: size, weight: .regular, design: .monospaced)
    }

    private static func inter(size: CGFloat, weight: Font.Weight) -> Font {
      if FontRegistrar.didRegister {
        return Font.custom("Inter", size: size).weight(weight)
      }
      return .system(size: size, weight: weight)
    }
  }

  enum Spacing {
    static let xs: CGFloat = 8
    static let sm: CGFloat = 16
    static let md: CGFloat = 24
    static let lg: CGFloat = 32
    static let xl: CGFloat = 40
    static let xxl: CGFloat = 48
  }

  enum Radius {
    static let badge: CGFloat = 6
    static let control: CGFloat = 8
    static let card: CGFloat = 16
    static let largeCard: CGFloat = 20
  }

  enum FontRegistrar {
    nonisolated(unsafe) private static var attemptedRegistration = false
    nonisolated(unsafe) private(set) static var didRegister = false

    static func register() {
      guard !attemptedRegistration else { return }
      attemptedRegistration = true

      let registered = ["Inter-Regular", "Inter-Medium", "Inter-SemiBold"].map(registerFont(named:))
      didRegister = registered.allSatisfy { $0 }
      if !didRegister {
        print("RegletSetup: Inter font registration failed; falling back to system fonts.")
      }
    }

    private static func registerFont(named name: String) -> Bool {
      guard let url = Bundle.module.url(forResource: name, withExtension: "ttf", subdirectory: "Fonts") else {
        print("RegletSetup: missing font resource \(name).ttf")
        return false
      }

      var error: Unmanaged<CFError>?
      if CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) {
        return true
      }

      if let error {
        let description = CFErrorCopyDescription(error.takeRetainedValue()) as String
        print("RegletSetup: could not register \(name).ttf: \(description)")
      }
      return false
    }
  }
}
