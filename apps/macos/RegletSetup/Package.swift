// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "RegletSetup",
  platforms: [
    .macOS(.v14)
  ],
  products: [
    .executable(name: "RegletSetup", targets: ["RegletSetup"])
  ],
  targets: [
    .executableTarget(
      name: "RegletSetup",
      path: "Sources"
    )
  ]
)
