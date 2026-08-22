# Canonical website redirects

This Cloudflare Worker sits in front of the GitHub Pages origin and returns a
permanent `308` response for non-canonical website URLs. It handles every
`/index.html` path, redirects `www` to the apex domain, preserves query strings,
and leaves all canonical requests unchanged for GitHub Pages to serve.

The `nodusresearch.com` and `www` DNS records must be proxied through Cloudflare
before deploying the Worker routes in `wrangler.jsonc`.

Deploy from this directory with an authenticated Wrangler installation:

```sh
wrangler deploy
```
