# Contributing to Nodus

Thank you for helping improve Nodus. Contributions may include bug reports,
feature proposals, product feedback, documentation, translations, tests, and
code.

By participating, you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Before opening an issue

Search the existing issues first. If a matching issue exists, add useful context
there instead of creating a duplicate.

Choose the path that best matches your contribution:

- **Bug report** for reproducible failures or incorrect behavior
- **Feature request** for a new capability or improvement
- **New vault type** for a specialized workspace proposal
- **Product feedback** belongs in the permanent
  [shared feedback thread](https://github.com/Drakonis96/nodus/issues/272);
  add a comment there instead of opening a new issue

The desktop app exposes the same four paths under **Suggest / Report**. Bug
reports, feature requests, and vault proposals open new issues. Product feedback
is copied and added as a comment to the shared thread. All four app flows include
the Nodus version and operating-system details automatically. If you report
directly on GitHub, include that environment information yourself when relevant.

Never include API keys, passwords, private vault content, student data, personal
data, unpublished research, or confidential documents in a public issue.
Security vulnerabilities must be reported privately as described in
[SECURITY.md](SECURITY.md).

## Development setup

Nodus uses Node.js 22 in continuous integration.

1. Fork and clone the repository.
2. Install the locked dependencies:

   ```bash
   npm ci
   ```

3. Rebuild native Electron dependencies:

   ```bash
   npx electron-builder install-app-deps
   ```

4. Start the development app:

   ```bash
   npm run dev
   ```

Use a throwaway vault or demo data while developing. Do not test with real
personal, student, research, or institutional data.

## Quality checks

Run the checks that cover your change:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Changes that affect Electron startup, IPC, the database, packaging, or a major
user flow should also run:

```bash
npm run test:e2e
```

The full end-to-end suite launches the real desktop app and is most reliable on
macOS, which is also the platform used by the main CI job.

## Project conventions

- Keep Nodus local-first. New network access must be explicit, documented, and
  initiated by the user.
- Preserve privacy boundaries. Do not send private content, student work,
  rosters, grades, or credentials to AI providers.
- Nodus must not use AI to grade, rank, profile, or evaluate students.
- Keep claims connected to real sources. Do not fabricate citations or silently
  replace user evidence.
- Add focused tests for behavior changes and regression fixes.
- Reuse established components and patterns before introducing a parallel
  implementation.
- Do not commit build outputs, release artifacts, `node_modules`, temporary
  profiles, credentials, or real user data.

### User-interface text

Spanish is the source language for the desktop interface. Every new static UI
string must also be added to all translation tables under `src/i18n.*.ts`.
Run the internationalization coverage tests before submitting the change.

### Database and privacy changes

Database migrations must be additive, deterministic, and safe for existing
vaults. Changes that affect stored data, backups, synchronization, telemetry,
network requests, AI providers, or student information must include appropriate
privacy documentation and tests.

## Pull requests

Keep each pull request focused on one coherent change. In the pull request:

- Explain the problem and the chosen solution.
- Link related issues with `Closes #123` when appropriate.
- List the checks you ran.
- Include before-and-after screenshots for visible UI changes.
- Call out migrations, privacy effects, network access, or compatibility risks.
- Update documentation and translations when behavior changes.

All required CI checks must pass. Maintainers may ask for a smaller scope,
additional tests, or changes needed to preserve the project's privacy and
evidence standards.

## Licensing

By submitting a contribution, you agree that it may be distributed under the
project's [MIT License](LICENSE).
