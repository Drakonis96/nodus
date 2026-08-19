# Nodus Cloud for Cloudflare

Nodus synchronisation and publication server, installed directly into each user's own Cloudflare account. Cloudflare runs the Worker, keeps structured data in D1 and private files in R2. Nodus receives no credentials and no permissions over that account.

## Recommended deployment

Nodus Desktop opens the official **Deploy to Cloudflare** wizard with this folder as the template. Cloudflare then:

1. creates a copy of the code in the GitHub or GitLab account the user chooses;
2. creates D1 and R2 and connects both resources to the Worker;
3. asks for the `NODUS_BOOTSTRAP_SECRET_HASH` secret that Desktop displays;
4. applies the migrations and publishes a free `workers.dev` URL.

There is no domain to buy, no traditional hosting to arrange and no Cloudflare token to hand over to Nodus. The location of D1 and R2 is whatever Cloudflare selects automatically in this flow. The official button documents no parameter for pinning jurisdiction; anyone who needs strict pinning should create those resources manually and review Cloudflare's current options.

Official documentation: [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [D1](https://developers.cloudflare.com/d1/), [R2](https://developers.cloudflare.com/r2/).

## What the template contains

- `src/`: the Nodus Cloud Worker and API.
- `migrations/`: the versioned D1 schema.
- `wrangler.jsonc`: the D1/R2 bindings and the maintenance task.
- `.dev.vars.example`: the secret variable Cloudflare asks for during deployment.
- `package.json`: applies the migrations before publishing the Worker.

Vectorize is optional. Its indexes require a specific dimension that depends on each vault's embedding model, which a static public template cannot know. Direct deployment uses portable matrices in R2 and exact search; if the owner adds `VECTORS_<dim>` bindings, the Worker announces them and Desktop uses them automatically.

## Local development

Wrangler 4.123 or later requires Node 22 or later. Compute the SHA-256 of a test secret first and pass it to the Worker; the verifier uses the original secret.

```sh
cd cloudflare
npm install
npx wrangler d1 migrations apply DB --local
NODUS_TEST_BOOTSTRAP_HASH="$(printf %s final-local-secret | shasum -a 256 | awk '{print $1}')"
npx wrangler dev --local --port 8799 --var "NODUS_BOOTSTRAP_SECRET_HASH:$NODUS_TEST_BOOTSTRAP_HASH"
```

In another terminal, from the repository root:

```sh
node scripts/verify-cloudflare-local.mjs
```

To exercise scheduled maintenance, start Wrangler with `--test-scheduled` and open `http://localhost:8799/__scheduled?cron=17+3+*+*+*`.

### Limits that only appear on a real deployment

The open-source workerd behind `wrangler dev` does not enforce every limit of Cloudflare's production runtime. The known case is PBKDF2: Workers rejects more than **100,000 iterations** with `NotSupportedError`, while local development accepts any count, so an invalid constant passes local verification and breaks the real deployment with an HTTP 500. `scripts/test-cloudflare-bootstrap.mjs` reproduces that ceiling against the real `auth.mjs` and runs as part of `npm test`.

That ceiling is the platform's, not a choice: it sits below the 600,000 iterations OWASP recommends for PBKDF2-SHA256, and Workers offers no alternative. Raising it the day Cloudflare lifts the cap means changing `PASSWORD_ITERATIONS` in `src/auth.mjs` and nothing else: every password records in `password_scheme` the count it was computed with, and `verifyPassword` replays it, so passwords already on record keep verifying.

## Licence and updates

The code is distributed under AGPL-3.0-only. The capabilities response links to the corresponding source code. The copy created by the wizard belongs to the user; commits to that copy trigger Workers Builds. Read `UPDATING.md` before taking in a new version of Nodus Cloud.
