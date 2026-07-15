#!/usr/bin/env swift

import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
  fputs("Usage: render-macos-release-assets.swift <dmg-background.png> <app-icon.png>\n", stderr)
  exit(2)
}

extension NSColor {
  convenience init(hex: UInt32, alpha: CGFloat = 1) {
    self.init(
      calibratedRed: CGFloat((hex >> 16) & 0xff) / 255,
      green: CGFloat((hex >> 8) & 0xff) / 255,
      blue: CGFloat(hex & 0xff) / 255,
      alpha: alpha
    )
  }
}

func writePng(_ image: NSImage, to path: String) throws {
  guard
    let bitmap = image.representations.first as? NSBitmapImageRep,
    let png = bitmap.representation(using: .png, properties: [:])
  else {
    throw NSError(domain: "RegletReleaseAssets", code: 1)
  }
  try png.write(to: URL(fileURLWithPath: path), options: .atomic)
}

func renderImage(size: NSSize, drawing: () -> Void) -> NSImage {
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: Int(size.width),
    pixelsHigh: Int(size.height),
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    fatalError("Could not allocate release asset bitmap")
  }

  bitmap.size = size
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
  drawing()
  NSGraphicsContext.current?.flushGraphics()
  NSGraphicsContext.restoreGraphicsState()

  let image = NSImage(size: size)
  image.addRepresentation(bitmap)
  return image
}

func drawBrandMark(center: NSPoint, outerRadius: CGFloat, innerRadius: CGFloat) {
  NSColor(hex: 0xff6363, alpha: 0.38).setStroke()
  let outer = NSBezierPath(ovalIn: NSRect(
    x: center.x - outerRadius,
    y: center.y - outerRadius,
    width: outerRadius * 2,
    height: outerRadius * 2
  ))
  outer.lineWidth = max(2, outerRadius * 0.08)
  outer.stroke()

  NSColor(hex: 0xff6363).setFill()
  NSBezierPath(ovalIn: NSRect(
    x: center.x - innerRadius,
    y: center.y - innerRadius,
    width: innerRadius * 2,
    height: innerRadius * 2
  )).fill()
}

func drawText(_ text: String, at point: NSPoint, font: NSFont, color: NSColor) {
  text.draw(at: point, withAttributes: [
    .font: font,
    .foregroundColor: color,
  ])
}

func renderBackground() -> NSImage {
  let size = NSSize(width: 760, height: 520)
  return renderImage(size: size) {

  NSColor(hex: 0x040506).setFill()
  NSRect(origin: .zero, size: size).fill()

  let panel = NSBezierPath(roundedRect: NSRect(x: 24, y: 24, width: 712, height: 472), xRadius: 20, yRadius: 20)
  NSColor(hex: 0x07080a).setFill()
  panel.fill()
  NSColor(hex: 0x2f3031, alpha: 0.72).setStroke()
  panel.lineWidth = 1
  panel.stroke()

  drawBrandMark(center: NSPoint(x: 54, y: 460), outerRadius: 11, innerRadius: 6)
  drawText(
    "REGLET",
    at: NSPoint(x: 76, y: 452),
    font: NSFont.systemFont(ofSize: 12, weight: .semibold),
    color: NSColor(hex: 0x9c9c9d)
  )
  drawText(
    "Drag Reglet to Applications",
    at: NSPoint(x: 42, y: 410),
    font: NSFont.systemFont(ofSize: 25, weight: .medium),
    color: NSColor(hex: 0xe6e6e6)
  )
  drawText(
    "Local agent configuration, installed in one step.",
    at: NSPoint(x: 42, y: 382),
    font: NSFont.systemFont(ofSize: 14, weight: .regular),
    color: NSColor(hex: 0x9c9c9d)
  )

  let arrow = NSBezierPath()
  arrow.move(to: NSPoint(x: 332, y: 265))
  arrow.line(to: NSPoint(x: 428, y: 265))
  arrow.move(to: NSPoint(x: 412, y: 279))
  arrow.line(to: NSPoint(x: 429, y: 265))
  arrow.line(to: NSPoint(x: 412, y: 251))
  NSColor(hex: 0x9c9c9d, alpha: 0.78).setStroke()
  arrow.lineWidth = 2
  arrow.lineCapStyle = .round
  arrow.lineJoinStyle = .round
  arrow.stroke()

  NSColor(hex: 0xe6e6e6, alpha: 0.88).setFill()
  NSBezierPath(roundedRect: NSRect(x: 125, y: 178, width: 130, height: 24), xRadius: 6, yRadius: 6).fill()
  NSBezierPath(roundedRect: NSRect(x: 505, y: 178, width: 130, height: 24), xRadius: 6, yRadius: 6).fill()

  drawText(
    "UNSIGNED · NOT NOTARIZED",
    at: NSPoint(x: 564, y: 452),
    font: NSFont.monospacedSystemFont(ofSize: 10, weight: .regular),
    color: NSColor(hex: 0x6a6b6c)
  )

  }
}

func renderIcon() -> NSImage {
  let size = NSSize(width: 1024, height: 1024)
  return renderImage(size: size) {

  NSColor.clear.setFill()
  NSRect(origin: .zero, size: size).fill()

  let tile = NSBezierPath(roundedRect: NSRect(x: 72, y: 72, width: 880, height: 880), xRadius: 205, yRadius: 205)
  NSColor(hex: 0x07080a).setFill()
  tile.fill()
  NSColor(hex: 0x2f3031).setStroke()
  tile.lineWidth = 12
  tile.stroke()

  drawBrandMark(center: NSPoint(x: 512, y: 512), outerRadius: 226, innerRadius: 118)
  }
}

do {
  try writePng(renderBackground(), to: CommandLine.arguments[1])
  try writePng(renderIcon(), to: CommandLine.arguments[2])
} catch {
  fputs("Could not render macOS release assets: \(error)\n", stderr)
  exit(1)
}
