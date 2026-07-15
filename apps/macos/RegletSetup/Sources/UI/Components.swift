import SwiftUI

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
    .font(Theme.Fonts.body)
    .foregroundStyle(Theme.Colors.mist)
  }
}
