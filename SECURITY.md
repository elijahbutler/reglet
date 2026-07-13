# Security policy

## Report a vulnerability

Please do not open a public issue for a suspected vulnerability. Send a concise report to the repository maintainers through GitHub's private security-advisory reporting flow, including reproduction steps, affected version, impact, and any suggested mitigation.

If private reporting is unavailable for the repository, use GitHub's contact method listed on the project profile and request a private security channel.

We will acknowledge reports, assess scope, and coordinate disclosure before publishing a fix.

## V1 security boundary

Public V1 is local-only. It protects Reglet state with owner-only permissions, requires typed MCP process-environment references, redacts resolved values from its own review and recovery data, and journals provider writes for rollback and explicit receipt restore.

Please include any relevant information about permissions, redaction, transaction recovery, provider-output handling, or unexpected network behavior in a report.
