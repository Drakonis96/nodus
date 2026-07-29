# Security Policy

## Supported versions

Security fixes are provided for the latest published Nodus release. Older
versions may not receive patches.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

Before reporting a vulnerability, verify whether it still affects the latest
release available from the
[Nodus releases page](https://github.com/Drakonis96/nodus/releases/latest).

## Reporting a vulnerability

Do not report security vulnerabilities through a public GitHub issue, the
desktop app's **Suggest / Report** flow, a pull request, or a discussion.

Use GitHub's
[private vulnerability reporting form](https://github.com/Drakonis96/nodus/security/advisories/new).
Include:

- A clear description of the vulnerability and its impact
- The affected Nodus version and operating system
- Reproduction steps or a minimal proof of concept
- Any prerequisites, configuration, or permissions required
- Suggested mitigations, if known

Do not include real credentials, private vaults, student data, personal data, or
confidential documents. Use synthetic test data and redact secrets from logs and
screenshots.

You should receive an acknowledgement within seven days and an initial
assessment within fourteen days. Timelines for remediation and disclosure depend
on severity, complexity, and release requirements. Please allow maintainers a
reasonable opportunity to investigate and publish a fix before public
disclosure.

## Scope

Security reports may cover the Nodus desktop app, Nodus Server, the Zotero
plugin, local IPC or MCP boundaries, update and packaging flows, data storage,
backup and synchronization, or bundled document-processing tools.

General bugs, feature requests, and vault proposals belong in the repository's
public issue templates. Product feedback belongs in the permanent
[shared feedback thread](https://github.com/Drakonis96/nodus/issues/272).
