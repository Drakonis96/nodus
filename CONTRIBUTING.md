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

## Publishing releases

Stable and Beta are separate GitHub Actions entry points backed by the shared
`release-build.yml` implementation:

- **Stable release** accepts only a package version and tag in the form `x.y.z`
  and `vX.Y.Z`. It publishes the existing `latest*.yml` updater manifests,
  installers, and stable Zotero plugin assets, then marks the release as latest.
- **Beta release** accepts only `x.y.z-beta.n` and `vX.Y.Z-beta.N`. It publishes
  `beta*.yml` plus the matching installers, marks the release as a prerelease,
  and never uploads a stable updater manifest.

Pushing a matching tag starts the corresponding workflow. Both workflows can
also be run manually by supplying the exact tag. The channel/version validator
stops a stable tag from entering Beta or a beta tag from entering Stable before
any native build begins.

Before installing a Beta build, the desktop app requires Recovery to be
configured and commits a full encrypted, verified `nodus-pre-update-*` snapshot.
The snapshot records the installed app/schema version and the target version in
its filename, has an independent five-snapshot retention lineage, and is never
removed by scheduled-backup pruning. A failed snapshot blocks only Beta. Stable
updates take the same snapshot when Recovery is already configured, but preserve
the established non-blocking stable update behavior if that optional snapshot
cannot be written.

Age-based backup cleanup is a separate, disabled-by-default opt-in in Settings.
It uses the automatic-backup schedule and catches up after the next launch when
a scheduled cleanup was missed. Before changing any file, Nodus verifies the
newest surviving encrypted backup. It considers only strict regular-backup names
for the current computer, always preserves the three newest regular backups, and
never includes another computer's lineage or `nodus-pre-update-*` snapshots.
Candidates first move atomically to `.nodus-cleanup-trash`; permanent deletion is
allowed only after a seven-day grace period and another successful survivor
verification. Manual confirmations carry an opaque fingerprint of the exact files
shown in the preview, so any intervening folder change aborts the operation. A
partial move is rolled back, and a failed due backup suppresses cleanup for that
maintenance cycle. When this opt-in is disabled, the established stable GFS
rotation remains unchanged.

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

Once a migration has shipped in a Beta, do not renumber, rewrite, or replace it
for Stable. Stable must carry that exact forward migration (plus later migrations
if needed); fixes belong in a new migration. Never rely on an application
downgrade or automatic data rollback as a migration strategy.

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
