# Reglet desktop design system

This is the visual reference for the Tauri desktop app. It adapts the design
system used by `reglet-cloud` and the former macOS client to a compact native
desktop workflow. Functional clarity and platform conventions take precedence
over pixel parity.

## Direction

Reglet should feel like a precise local control surface: quiet, exact, and
trustworthy. Use layered near-black surfaces, restrained illumination, and
plain language that makes every operating state clear.

- Prefer one bounded surface or ledger over a grid of promotional cards.
- Show exact sync boundaries and make destructive or provider-writing actions
  concrete, reviewed, and reversible.
- Use native window chrome, familiar focus behavior, and platform-appropriate
  Command/Control shortcuts.
- Keep paths and machine values in a monospaced face. Use Inter or the platform
  sans-serif for interface copy.

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| Void | `#040506` | App background |
| Ink | `#07080A` | Primary surfaces |
| Obsidian | `#111214` | Raised controls and rows |
| Graphite | `#1B1C1E` | Pressed and destructive surfaces |
| Slate | `#2F3031` | Default borders |
| Iron | `#454647` | Strong dividers and disabled edges |
| Ash | `#9C9C9D` | Secondary text |
| Mist | `#E6E6E6` | Primary text and primary actions |
| Coral | `#FF6363` | Reglet brand mark only |
| Info | `#56C2FF` | Focus, selection, and new state |
| Success | `#59D499` | Healthy and completed state |
| Warning | `#FFB224` | Changed and caution state |
| Error | `#E5484D` | Error boundaries |
| Error text | `#FF9294` | Accessible error copy |

Coral is not a call-to-action or status color. The Reglet mark is its only
routine use.

## Surfaces and controls

- Controls are at least 40px high with an 8px radius.
- Status badges use a 6px radius and compact uppercase labels.
- Cards use a 16px radius; large workflow containers may use 20px.
- Use an inset light/dark hairline to establish depth. Avoid decorative drop
  shadows.
- Primary actions use Mist on Void. Secondary actions use Obsidian with a Slate
  border. Destructive actions use Graphite with Error text.
- Use the 8px spacing rhythm: 8, 16, 24, 32, 40, and 48px.

## Onboarding

The setup wizard is an operational walkthrough, not a marketing carousel.

1. Explain local-only behavior and review guarantees.
2. Select detected providers and unified content.
3. Build one editable `AGENT.md`, with explicit per-use AI consent.
4. Adopt raw skills by name without exposing internal paths.
5. Show the unified `.reglet` source once, then provider destinations in
   disclosures such as `AGENT.md → CLAUDE.md`.
6. Condense changes under New, Updated, and Removed states before the exact
   digest-backed apply.

## Accessibility and motion

- Meet WCAG AA contrast and never communicate state by color alone.
- Keep keyboard focus visible with the Info token.
- Preserve keyboard-only operation and logical focus movement between steps.
- Honor `prefers-reduced-motion` and `prefers-contrast`.
