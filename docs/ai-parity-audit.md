# AI parity audit

`docs/ai-parity-manifest.json` is the no-tools, executable inventory for the
Desktop, local Server, Server Web and Cloudflare surfaces. Each feature records
ownership, roles, viewport, status and file/line evidence. The release contract
has no accepted placeholders: every required Server Web surface must have
executable evidence, and strict mode fails if a placeholder is introduced.
`partial` remains available for an explicitly documented backend capability
whose safe publication workflow has not yet been promoted to the release
contract; it must never be used to disguise a required UI placeholder.

Commands:

```sh
npm run audit:ai-parity
npm run test:ai-parity
npm run test:ai-parity:strict
```

The Cloudflare gate is deliberately independent of the Advanced Server Web
bundle. It rejects `/app`, `src/serverWeb`, `server/dist/web` and related
markers from the worker/release scope, while requiring the technical API,
admin and OAuth route contracts to remain discoverable. It does not claim that
Cloudflare implements Desktop AI; that distinction is represented in the
feature entries.
