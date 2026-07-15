# Desktop native acceptance record

Complete this record against the exact release-candidate checksums before removing the frozen Swift app. A source-level or mocked test does not satisfy a native evidence row.

| Platform | Artifact | Clean install | Launch/scan | Onboard | Edit rules/skills/MCP | Preview/apply | Drift/detach | Restore | Update check | Uninstall | Accessibility evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| macOS 14+ arm64 | ad-hoc-signed `.app.zip` and `.dmg` | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | VoiceOver: pending |
| macOS 14+ x86_64 | ad-hoc-signed `.app.zip` and `.dmg` | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | VoiceOver: pending |
| Windows 10 1803+ x64 | unsigned NSIS `.exe` | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Narrator: pending |
| Windows 11 x64 | unsigned NSIS `.exe` | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Narrator: pending |

For every row, attach the release checksum, date, tester, keyboard-only result, screen-reader notes, and evidence that secret canaries never appeared in the UI, logs, receipts, previews, or crash diagnostics. Record Gatekeeper or SmartScreen approval steps rather than treating the accepted unsigned warning as a failure.
