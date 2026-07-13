import SwiftUI

struct SkillBadge: View {
  let text: String
  let tint: Color

  var body: some View {
    Text(text)
      .font(.caption2)
      .padding(.horizontal, 6)
      .padding(.vertical, 2)
      .background(tint.opacity(0.18), in: Capsule())
      .foregroundStyle(tint)
  }
}

struct PathSummary: View {
  let label: String
  let value: String
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(label).font(.caption).foregroundStyle(.secondary)
      Text(value).font(.system(.body, design: .monospaced)).textSelection(.enabled)
    }
  }
}

struct FileRows: View {
  let files: [PlannedFile]

  var body: some View {
    if files.isEmpty {
      Text("No files.")
        .foregroundStyle(.secondary)
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
          .font(.caption)
          .foregroundStyle(.secondary)
        Text(file.content)
          .font(.caption)
          .foregroundStyle(.secondary)
        Text(file.scope)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      Text(file.path)
        .font(.system(.body, design: .monospaced))
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
    .font(.body)
  }
}
