import SwiftUI

struct PathSummary: View {
  let label: String
  let value: String
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(label)
        .font(Theme.Fonts.eyebrow)
        .foregroundStyle(Theme.Colors.ash)
      Text(value)
        .font(Theme.Fonts.mono())
        .foregroundStyle(Theme.Colors.mist)
        .textSelection(.enabled)
    }
  }
}

struct FileRows: View {
  let files: [PlannedFile]

  var body: some View {
    if files.isEmpty {
      Text("No files.")
        .foregroundStyle(Theme.Colors.ash)
    } else {
      ForEach(files) { file in
        PlannedFileRow(file: file)
      }
    }
  }
}

struct PlannedFileRow: View {
  let file: PlannedFile

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 8) {
        Text(file.provider)
          .font(Theme.Fonts.eyebrow)
          .foregroundStyle(Theme.Colors.ash)
        Text(file.content)
          .font(Theme.Fonts.eyebrow)
          .foregroundStyle(Theme.Colors.ash)
        Text(file.scope)
          .font(Theme.Fonts.eyebrow)
          .foregroundStyle(Theme.Colors.ash)
      }
      Text(file.path)
        .font(Theme.Fonts.mono())
        .foregroundStyle(Theme.Colors.mist)
        .textSelection(.enabled)
    }
    .padding(.vertical, 3)
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
    .font(Theme.Fonts.body)
    .foregroundStyle(Theme.Colors.mist)
  }
}
