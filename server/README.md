# Nodus Server

> **Experimental and unstable.** This version is intended for testing only.
> Keep backups, don't use it as your only access to
> important materials and expect incompatible changes before the stable version.

Nodus Server allows you to share a Vault projection with students or researchers. It is independent
of Nodus Desktop: the server lives on Docker and the desktop application only makes outgoing HTTPS
connections. The local MCP port is not published and the original SQLite base is not copied.

## Two ways to run it

**Basic — this computer.** Nodus Desktop starts this exact server itself, as a child process, and
does the whole setup for you. No Docker, no domain, no DNS, no reverse proxy, no port forwarding.
Turn it on in **Settings → Nodus Server → Basic**. This is the right choice if what you want is to
open your own vault from your own phone or tablet. The rest of this document describes the other
one; the basic mode has no manual steps and is documented in the application itself.

Two things are worth knowing before you pick it. The server runs only while Nodus Desktop is open —
quit Nodus and it stops, by design, so nothing is left running in the background without you
knowing. And a sleeping computer answers nothing, which is why the panel offers to hold the machine
awake.

Devices reach a basic-mode server one of two ways, and both are encrypted:

- **Tailscale** (recommended). Nodus detects it, and one button runs
  `tailscale serve --bg --https=443 http://127.0.0.1:7443`. You get a real Let's Encrypt
  certificate for a name like `laptop.tail1234.ts.net`, reachable only from devices signed in to
  your own tailnet, with no port opened on your router and no certificate warning to click through.
  It works from anywhere, not only from home. That forward is configuration held by the Tailscale
  daemon, and it outlives this application and a reboot — so Nodus takes it down again whenever you
  stop the server or choose a different access path. "Nobody else can reach this" has to be true at
  the moment the panel says it.
- **Local network.** Nodus generates a certificate authority and a certificate naming this
  machine's private addresses, and serves HTTPS on them. The first visit from each device shows a
  warning, because the certificate was not signed by an authority the browser already knows — the
  application shows the CA fingerprint so you can check it against what the browser reports before
  you type anything. Carry the laptop to a different network and Nodus notices the addresses have
  changed, re-cuts the certificate and rebinds to the new ones. The authority itself is never
  reissued, so a phone that trusted it once is not asked to trust it again.

There is deliberately **no unencrypted option**. Serving over plain HTTP on a wifi network would put
the password protecting your work in the clear, and that is what these two paths exist to avoid.

One consequence for anyone editing this server: the basic mode runs it on the Node that ships inside
Electron, which trails the current release. `engines` records the floor that is actually exercised —
a Node 22-only API would compile, pass the Docker tests, and break basic mode silently.

## What you need for the advanced mode

- A computer that remains on or a VPS with Windows, macOS or Linux.
- Docker Desktop (Windows/macOS) or Docker Engine with Compose (Linux) plugin.
- A domain or subdomain pointing to the public IP of the server, for example `nodus.universidad.es`.
- Ports 80 and 443 accessible if you are going to use the Caddy included.

The recommended installation defines the administrator account as Stack variables and opens the
login page directly. Alternatively, a temporary token and `/setup` wizard can be used. The daily
management of spaces, users, permissions and devices is done by web.

## Test from Portainer

The workflow `Nodus Server image (experimental)` tests and publishes from `main` a
multi-architecture image in GitHub Container Registry. Create a Stack with `portainer-stack.yml` via
the web editor. Portainer will always download:

- `ghcr.io/drakonis96/nodus-server:main`

The `main` tag moves and is unstable. Each build is also published with a `main-<sha>` tag so you can
able to set or restore a particular test. Define these variables in the Stack:

- `NODUS_DOMAIN`: domain without `https://`, for example `nodus.example.com`.
- `NODUS_ADMIN_EMAIL`: email address for the administrator account.
- `NODUS_ADMIN_PASSWORD`: unique and long password, of at least 12 characters.

These two variables must be defined together. In the first boot they create the account; in later
deployments they update the mail or rotate the password if you change their values. The password is
never written in `state.json`: only your hash is preserved. As long as you maintain these variables,
their values are the authoritative source and will be applied again at each restart.

Alternatively, leave both empty and define `NODUS_SETUP_TOKEN` with a temporary random value of at least
16 characters. In that case you will complete `/setup` manually and you will have to delete the
token later.

The workflow ends by closing the GHCR session and reading the manifest as an anonymous user. Thus,
it fails if the package is not public or if `amd64` or `arm64` is missing; a green run means that
Portainer can download the label without credentials.

This Stack includes Caddy and requires 80/443 to be free. If a proxy reverse already exists, display
only `nodus-server`, connect it to the proxy Docker network and set HTTP `nodus-server:7443`
destination.

## Option A: You don't have Caddy, Nginx or another proxy

1. Download this folder `server` and open a terminal inside it.
2. Copy `.env.example` as `.env`.
3. Edits `.env`: changes `NODUS_DOMAIN` and `NODUS_PUBLIC_URL`, inserts `NODUS_ADMIN_EMAIL` and
   generates a unique password for `NODUS_ADMIN_PASSWORD` (for example, with `openssl rand -base64
   32`). Protects the `.env` file and does not upload it to Git.
4. Runs:

```sh
docker compose --profile proxy pull
docker compose --profile proxy up -d
```

5. Open `https://tu-dominio`: Nodus will send you directly to the login and you can enter with those
   credentials.
6. To rotate them, change the two variables and re-deploy the container. Previous OAuth sessions and
   connections will be closed if the password changes.

Caddy automatically obtains and renews the HTTPS certificate. The data is left in the Docker
`nodus_data` volume; recreating or updating the container does not erase them.

## Option B: you already have Caddy or Nginx on the server

Run Nodus Server only:

```sh
docker compose pull
docker compose up -d
```

Docker posts Nodus exclusively in `127.0.0.1:7443`. So it does not occupy 80/443, it is not directly
accessible from the Internet and does not interfere with your current proxy. Set the domain in that
proxy and forward it to `http://127.0.0.1:7443`.

### Caddy already installed in the system

```caddy
nodus.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:7443
}
```

Reload Caddy after saving the settings.

### Nginx already installed in the system

```nginx
server {
    listen 443 ssl http2;
    server_name nodus.example.com;

    # Keep the certificate paths managed by your installation here.
    ssl_certificate /etc/letsencrypt/live/nodus.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nodus.example.com/privkey.pem;

    client_max_body_size 100m;
    location / {
        proxy_pass http://127.0.0.1:7443;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Authorization $http_authorization;
    }
}
```

If your Caddy/Nginx is also inside Docker, connect both projects to the same external Docker network
and use `nodus-server:7443` as your destination. Do not change port 7443 to `0.0.0.0`: the only
public service must be HTTPS proxy.

## Public domain and URL

`NODUS_PUBLIC_URL` must be exactly the source that people will use, without final path:
`https://nodus.example.com`. The URL added in ChatGPT and Claude will be
`https://nodus.example.com/mcp`.

If you change the domain, update `NODUS_DOMAIN`, `NODUS_PUBLIC_URL`, DNS and proxy; then run `docker
compose up -d` again. Do not use a public IP with HTTP. Nodus Desktop rejects HTTP except for tests
in `localhost`.

## Credentials by environment and Docker secrets

The simple option for Portainer and Compose is `NODUS_ADMIN_EMAIL` + `NODUS_ADMIN_PASSWORD`. Anyone
who has permission to inspect or edit the container will be able to view its variables, so access to
Docker/Portainer should be limited to administrators.

If your platform supports secrets mounted as files, you can use `NODUS_ADMIN_EMAIL_FILE` and
`NODUS_ADMIN_PASSWORD_FILE` instead of the direct values. Do not simultaneously configure a direct
variable and its variant `_FILE`. Nodus reads the file when booting and never records the content.

## Connect a Nodus Desktop Vault

1. Enter as administrator in `https://tu-dominio`.
2. Create a space.
3. Click "Create code for Nodus"; the code expires in 15 minutes and only works once.
4. In Nodus Desktop opens **Adjustments → Server**, type the base URL and code, and press "Connect
   Vault".
5. The first publication is made immediately. After that Nodus checks a SQLite counter every 30
   seconds and only reposts when there are changes, a minute has passed without activity and a
   minimum of two minutes between submissions is respected.

For an academic vault, references and derived academic knowledge are published by default. A
Worldbuilding vault publishes its current canonical corpus: characters, places, groups, scenes,
secrets, calendar, maps (without image binaries), encyclopedia, conflicts/arcs, rules, questions
and current manuscript prose. Private chats, AI proposals, manuscript snapshots, word-history,
credentials, local paths, embeddings and binary files are never published. Teacher
notes/projects/materials and extracted academic passages have separate switches.

### Publication size

A publication travels gzipped and is expanded into JSON in memory, and that JSON is around ten
times larger than the upload. The two sizes therefore have separate limits:

- `NODUS_MAX_SNAPSHOT_BYTES`: largest gzipped upload accepted, 100 MiB by default. Keep your proxy
  in agreement with it (`client_max_body_size` in Nginx).
- `NODUS_MAX_SNAPSHOT_JSON_BYTES`: largest expanded publication accepted, 384 MiB by default. This
  is what a big vault runs into first, and it is what bounds the memory the server needs to read a
  space. It can never go past 512 MiB, the largest string Node can build.

Both accept a whole number of bytes, at least 65536; a value the server cannot use (`0`, `200m`)
stops the boot instead of making every publication fail. When a vault no longer fits, the desktop
says how large it is and which switch to turn off ("Include extracted passages" is usually most of
the weight).

## Access levels

A membership grants one of three levels in one space. An account can hold a different level in each
space it belongs to, and every level is assigned from the web administration — when the account is
created, or later from the user table without having to revoke and grant again.

| Level | Can read | Can send changes back | Can publish |
|---|---|---|---|
| **Reader** | yes | no — anything they write or generate stays on their own device | no |
| **Writer** | yes | yes, once the owner collects them | no |
| **Owner** | yes | yes | yes |

Two things are worth being explicit about.

**The level is re-read on every request.** Downgrading or revoking somebody takes effect on their
very next call, even with a token they already hold; nothing has to be revoked separately.

**A writer's change is not visible to anyone until the owner's desktop collects it.** The server is
a relay with a ledger, not a second copy of the vault: it stores the change, the owner's machine
applies it to the canonical SQLite, and the republication that follows is what everybody else finally
reads. If the owner does not open Nodus, nothing moves. That is a deliberate design decision — one
authority over what the vault contains — and not a fault.

## Connected vaults and the client API

Besides the MCP surface, the server exposes `/api/v1` for Nodus Desktop replicas and for future
mobile clients. **They are two separate OAuth protected resources over the same origin**
(`https://your-domain/mcp` and `https://your-domain/api/v1`), so a token minted for one is refused by
the other. An AI client reads; only an application can write.

- `GET /api/v1/capabilities` — public, unauthenticated. What this build supports.
- `POST /api/v1/auth/login` then `POST /api/v1/auth/device` — sign in with email and password,
  receive a single-use five-minute ticket plus the spaces the account can reach, then take a device
  token for the chosen one. The pairing code flow stays as it is for publishers.
- `GET /api/v1/spaces/:id/...` — works, ideas, themes, gaps, authors, debates, notes, Deep Research
  reports, immersion sessions, passages, search.
- `POST /api/v1/spaces/:id/context` — the retrieval package for a client-side chat. **The server
  never receives an AI provider key**; the client builds its own prompt and calls its own provider.
- `POST /api/v1/spaces/:id/mutations` (writer) and `GET` + `/ack` (owner) — the ledger.
- `PUT /api/v1/spaces/:id/vectors` (owner) and `POST .../search/semantic` — quantized embeddings for
  semantic search. A client whose embedding provider does not match the published one is told so
  explicitly and given a lexical fallback, never a silent empty list.

### Images, and what never travels

Documents never reach the server. No PDFs, no audio, no recordings. Three kinds of image do: the
illustration attached to a Deep Research report, a person's portrait, and the pictures in a
database's attachment columns. Three independent layers enforce that, and each would be sufficient
alone:

1. the desktop reads images from exactly three whitelisted tables and nothing else;
2. no binary can ride inside the publication JSON at all;
3. the server sniffs the bytes of every upload and refuses anything that is not PNG, JPEG, WEBP or
   GIF — including a WAV, which shares its first four bytes with WEBP.

The third table is the only one whose rows are not images by construction — an attachment column
takes whatever file the user dropped on it — so for that source layer 3 is what decides. A database
of photographs publishes its photographs; a database of scanned PDFs publishes their names, their
sizes and nothing else. A ceiling of 8 MiB per file applies before any blob is read.

Images are addressed by the SHA-256 of their content, so republishing an unchanged corpus re-uploads
none of them. Unreferenced images are swept after a grace period.

## Provide access to students or researchers

1. From the web administration it creates a reading account with a temporary password and assigns it
   to a space.
2. The person signs in and opens **My account** to change that password. Your other sessions will be
   closed and your previous OAuth connections will be revoked.
3. You can grant that account reader access to other spaces, revoke it or reset your temporary
   password from the user table. An administrative reset closes all sessions and OAuth connections
   to that account.
4. The person adds `https://tu-dominio/mcp` as a custom MCP connector in ChatGPT or Claude.
5. The client opens the Nodus Server OAuth screen. The person log in and authorizes the reading
   permission.

Each token is linked to that person and to this MCP URL. The tools check the membership of the space
on each call. The current version is deliberately read-only; remote editions are not mixed with the
local vault nor can they overwrite it.

The remote MCP surface includes generic space discovery/search plus Worldbuilding-specific
operations for overview, grounded world search, paginated entity lists, full entity dossiers and
the ordered manuscript. `nodus_list_spaces` reports the published vault type so a client can choose
the correct tool family. The local Desktop MCP has a broader Worldbuilding surface and may create or
edit author-owned records, but it still exposes no destructive delete operation.

## Environment variables the basic mode uses

These exist for Nodus Desktop's basic mode and are unset in every Docker deployment. They are
documented here because they change what the server binds and who it will answer.

- `NODUS_HOST` accepts a comma-separated list, binding the main listener to several addresses. The
  basic mode's local-network path names this machine's private addresses individually rather than
  `0.0.0.0`, so the loopback listener below can hold the same port.
- `NODUS_TLS_CERT_FILE` + `NODUS_TLS_KEY_FILE` serve TLS directly instead of behind a proxy. They
  must be set together: half a pair stops the boot rather than quietly falling back to cleartext.
- `NODUS_LOOPBACK_PORT` opens a second, plain-HTTP listener on 127.0.0.1 only, and is refused
  unless TLS is configured. It exists so the desktop can publish into a server whose self-signed
  certificate it has no way to validate — loopback never leaves the machine, so there is nothing on
  that path to encrypt against.
- `NODUS_LOCAL_PROVISION_FILE` writes a per-boot secret, mode 0600, that unlocks
  `POST /api/v1/local/provision`. That route creates a space and a pairing code for one vault, so
  the desktop does not have to drive the web administration to connect itself. Two independent
  gates guard it: the caller must have read a file only this operating-system user can open, **and**
  must have arrived over loopback — the correct secret presented from the local network gets a 404.
  Without this variable the route does not exist at all.

## Security and operation

- Do not expose 7443 to the Internet or use the server without HTTPS.
- Keep Docker, Caddy/Nginx and Nodus image updated.
- Use unique passwords; the server requires between 12 and 1024 characters.
- The login limits attempts simultaneously by IP, by account (through a hash identifier that does
  not reveal the mail) and across the server. Non-existent accounts perform the same cryptographic
  verification as existing ones to avoid their enumeration by response times.
- `/setup`, pairing, OAuth record and token exchange have their own limits and global limits.
  Authentication bodies are limited, active sessions on their own are limited and internal rate
  limiting records cannot grow without limit.
- Caddy or Nginx must keep the client's actual IP via `X-Forwarded-For`; do not place another
  unreliable proxy directly in front of the internal port.
- Change your own password from **My account**. The administrator can only reset passwords for
  reader accounts; you cannot view existing passwords.
- It revokes any lost device from the web. Disconnecting the Vault on Desktop stops submissions, but
  the administrator must remove the retained posting when appropriate.
- Make periodic copies of the volume `nodus_data` and test its restoration. The status and
  publications are under `/data` within the container.
- The backup should be protected as the materials it contains. For institutional data, document
  accommodation, conservation, accesses, managers and transfers according to your policy and GDPR.

Quick check:

```sh
curl https://tu-dominio/healthz
docker compose logs -f nodus-server
```

The health endpoint must respond with `{"ok":true,...}`. To validate MCP and OAuth end-to-end during
a technical installation MCP Inspector can be used.
