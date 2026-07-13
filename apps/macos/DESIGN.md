---
name: Reglet for macOS
description: A calm, auditable command center for local AI-agent configuration.
colors:
  void-black: "#040506"
  ink: "#07080A"
  obsidian: "#111214"
  graphite: "#1B1C1E"
  slate: "#2F3031"
  ash: "#9C9C9D"
  mist: "#E6E6E6"
  coral: "#FF6363"
  info: "#56C2FF"
  success: "#59D499"
  warning: "#FFB224"
  error: "#E5484D"
  error-text: "#FF9294"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 400
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 500
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.8px"
rounded:
  badge: "6px"
  control: "8px"
  card: "16px"
  large-card: "20px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "32px"
  xl: "40px"
  xxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.slate}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  button-secondary:
    backgroundColor: "{colors.obsidian}"
    textColor: "{colors.ash}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  card:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "24px"
  input:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.mist}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
---

# Design System: Reglet for macOS

## Overview

**Creative North Star: "Midnight Command Center."** Reglet is a dark, precise macOS guide for configuration work that must remain understandable and reversible. It should feel like a trusted native tool in a focused engineering workspace: calm, compact, and deliberate rather than theatrical.

Safety is part of the visual hierarchy. File paths, current state, and recovery choices take precedence over decoration; the UI always explains what it will do and does not imply background action. The system rejects Electron-style dashboards, marketing-heavy setup wizards, terminal-only first-run flows, noisy card grids, and onboarding that obscures file writes or network behavior.

- Dense but breathable, on an 8-point spacing grid.
- Dark-only, with tonal layering rather than broad color fields.
- Familiar macOS navigation and controls, customized only where clarity improves.
- Keyboard-accessible, contrast-aware, and never color-only for status.

## Colors

The palette is near-black infrastructure with a single reserved brand signal and explicit semantic state colors.

- **Void Black** (`#040506`) is the application canvas; **Ink** (`#07080A`) is a raised card surface; **Obsidian** (`#111214`) is pressed and selected state; **Graphite** (`#1B1C1E`) is a field or badge fill; and **Slate** (`#2F3031`) is the border layer.
- **Mist** (`#E6E6E6`) is high-emphasis text and the primary action fill. **Ash** (`#9C9C9D`) is accessible secondary text. Do not use Smoke (`#6A6B6C`) for essential body copy.
- **Coral** (`#FF6363`) is brand-only: the Reglet mark and the one AI-specific badge. It is never a CTA, selection, error, success, or warning color.
- **Info** (`#56C2FF`), **Success** (`#59D499`), **Warning** (`#FFB224`), and **Error** (`#E5484D`, with `#FF9294` text on `#452324` error wash) communicate named status alongside an icon and label.

**The One Coral Rule.** Coral earns attention through scarcity; a screen should not use it for general interaction or state.

## Typography

Inter is the sole UI family (Regular, Medium, and SemiBold), bundled with a system-font fallback. SF Mono is reserved for exact paths and command-like data.

- **Display** — 34px regular: onboarding safety hero only.
- **Headline** — 26px medium: page-level heading.
- **Section title** — 20px medium; **subheading** — 17px medium: grouping and local hierarchy.
- **Body** — 13px regular; **body large** — 15px regular: dense settings content and explanatory copy.
- **Label** — 11px semibold, uppercase, +0.8px tracking: sparing section metadata, not a repeated visual scaffold.

**The Exactness Rule.** Use SF Mono only when a user may need to identify, copy, or compare a path or command; prose and control labels remain Inter.

## Elevation

There are no drop shadows. Depth comes from quiet tonal layers and a keyboard-key surface treatment: Ink fill, a top white-to-clear hairline, a bottom clear-to-black hairline, and a final low-opacity outline. Increase Contrast strengthens hairlines from 10% to 25% white.

**The Flat-by-Default Rule.** A surface is flat unless it contains a bounded task, form, or transient status. Never add `.shadow()` as decoration.

## Components

### Buttons

- **Primary:** Mist fill, Iron text, 8px radius, 12px horizontal / 7px vertical padding; used only for the next clear action.
- **Secondary:** Obsidian fill, Slate border, Ash text; standard low-emphasis action.
- **Destructive:** Graphite fill with Error Text; destructive meaning is always also stated in the label.
- **Ghost:** transparent at rest with a subtle graphite pressed state. All controls retain visible keyboard focus and disabled state.

### Cards / Containers

- **Card surface:** Ink, 16px continuous corners, 24px standard padding, layered inset borders instead of shadows.
- **Large onboarding surface:** 20px continuous corners. Do not nest cards merely to create structure.

### Inputs / Fields

- **Text field:** Graphite fill, Slate hairline, 8px continuous corners, 10px horizontal / 7px vertical padding, and Body type.
- **Status badge:** Graphite fill (or Ember Hush for errors), 6px corners, icon plus text, and semantic color selected by status kind.

### Navigation

- **Sidebar:** Void Black canvas, 1px Slate divider, 8px control-radius rows, Obsidian selected pill, Mist selected text. The coral mark identifies Reglet but never marks the selected item.
- **Status strip:** Ink bottom bar with a top hairline; use it for persistent save/apply state instead of material effects.

## Do's and Don'ts

### Do:

- **Do** use the named Theme tokens and the 8/16/24/32/40/48 spacing scale.
- **Do** keep status icon-plus-label semantics and existing accessibility labels when restyling a view.
- **Do** use `CardSurface`, the Reglet button styles, `StatusBadge`, and `RegletTextFieldStyle` before inventing a new treatment.
- **Do** respect Increase Contrast and Reduce Motion, and preserve familiar macOS keyboard behavior.
- **Do** make file paths, previewed changes, backups, and recovery actions concrete and easy to inspect.

### Don't:

- **Don't** use `.shadow()`, `.regularMaterial`, raw chromatic SwiftUI literals, or native accent-tinted selection.
- **Don't** use Coral for CTAs, selected navigation, or semantic success/warning/error states.
- **Don't** use Smoke for essential body text, or rely on color alone to convey a state.
- **Don't** create Electron-style dashboards, marketing-heavy setup wizards, terminal-only first-run flows, or noisy card grids.
- **Don't** hide file writes, background/network behavior, or recovery implications behind vague copy or automatic-looking interactions.
