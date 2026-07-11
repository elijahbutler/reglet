import AppKit
import Foundation

struct AppUpdate: Equatable {
  let version: String
  let releaseURL: URL
}

enum UpdateCheckResult: Equatable {
  case available(AppUpdate)
  case upToDate(currentVersion: String)
}

enum UpdateCheckError: LocalizedError {
  case invalidResponse
  case missingReleaseURL

  var errorDescription: String? {
    switch self {
    case .invalidResponse:
      "Could not read the latest Reglet release from GitHub."
    case .missingReleaseURL:
      "The latest Reglet release did not include a usable download page."
    }
  }
}

struct UpdateChecker {
  private struct GitHubRelease: Decodable {
    let tagName: String
    let htmlURL: URL?
    let draft: Bool
    let prerelease: Bool

    enum CodingKeys: String, CodingKey {
      case tagName = "tag_name"
      case htmlURL = "html_url"
      case draft
      case prerelease
    }
  }

  private let latestReleaseURL = URL(string: "https://api.github.com/repos/elijahbutler/reglet/releases/latest")!

  var currentVersion: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
  }

  func check() async throws -> UpdateCheckResult {
    var request = URLRequest(url: latestReleaseURL)
    request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
    request.setValue("Reglet/\(currentVersion)", forHTTPHeaderField: "User-Agent")

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse,
          (200..<300).contains(httpResponse.statusCode) else {
      throw UpdateCheckError.invalidResponse
    }

    let release = try JSONDecoder().decode(GitHubRelease.self, from: data)
    guard !release.draft, !release.prerelease else {
      return .upToDate(currentVersion: currentVersion)
    }
    guard let releaseURL = release.htmlURL else {
      throw UpdateCheckError.missingReleaseURL
    }

    let latestVersion = Self.normalizedVersion(release.tagName)
    if Self.isVersion(latestVersion, newerThan: currentVersion) {
      return .available(AppUpdate(version: latestVersion, releaseURL: releaseURL))
    }
    return .upToDate(currentVersion: currentVersion)
  }

  static func openRelease(_ update: AppUpdate) {
    NSWorkspace.shared.open(update.releaseURL)
  }

  private static func normalizedVersion(_ version: String) -> String {
    version.trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "^v", with: "", options: .regularExpression)
  }

  private static func isVersion(_ candidate: String, newerThan current: String) -> Bool {
    let candidateParts = comparableParts(candidate)
    let currentParts = comparableParts(current)
    let maxCount = max(candidateParts.count, currentParts.count)

    for index in 0..<maxCount {
      let candidatePart = index < candidateParts.count ? candidateParts[index] : 0
      let currentPart = index < currentParts.count ? currentParts[index] : 0
      if candidatePart > currentPart { return true }
      if candidatePart < currentPart { return false }
    }
    return false
  }

  private static func comparableParts(_ version: String) -> [Int] {
    normalizedVersion(version)
      .split(separator: ".")
      .map { component in
        let digits = component.prefix { $0.isNumber }
        return Int(digits) ?? 0
      }
  }
}
