# Configuration

Everything is an environment variable with a default; `docker run` with one volume works as is.

## Server

| Variable | Default | |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | |
| `BASE_URL` | — | Public URL, e.g. `https://review.example.com`. Needed for single sign-on and links in Pocket Core events. |
| `DATA_DIR` | `./data` (`/data` in the image) | Database, documents, Core token. |
| `DB_PATH` | `$DATA_DIR/pocket-collaborator.db` | |
| `FILES_DIR` | `$DATA_DIR/files` | Uploaded documents, `<review id>/<sha256>.pdf`. |
| `TRUST_PROXY` | `true` | Take the client IP from `X-Forwarded-For`. |
| `LOG_LEVEL` / `LOG_FORMAT` | `info` / `text` | `debug`…`error`; `text` or `json`. |
| `METRICS_ENABLED` | `true` | Prometheus text at `/metrics` (row counts, live connections). |

## Documents and review time

| Variable | Default | |
|---|---|---|
| `MAX_UPLOAD_MB` | `100` | Largest document accepted. |
| `IDLE_AFTER` | `2m` | No input (scroll, mouse, keys, zoom) for this long and a person stops accruing review time. Reading a long page without touching anything is normal, so don't go much below a minute. Minimum `10s`. |
| `SESSION_GAP` | `10m` | A pause longer than this starts a new reading session. |
| `TICK_INTERVAL` | `5s` | How often the server credits time. 1s–1m. |

See [review-time.md](review-time.md) for how these play together.

## Sign-in

| Variable | Default | |
|---|---|---|
| `AUTH_MODE` | `local` | `local` (passwords and/or single sign-on), `proxy` (trust `AUTH_PROXY_HEADER` from Authelia/Authentik/Tinyauth), `none` (everyone is the first user: demos only). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | — | Create the first admin on an empty database and skip the setup screen. |
| `SESSION_TTL` | `720h` | |
| `SECURE_COOKIES` | `false` | Set `true` behind HTTPS. |
| `AUTH_PROXY_HEADER` / `AUTH_PROXY_EMAIL_HEADER` | `Remote-User` / `Remote-Email` | |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_NAME` | — | Any OpenID Connect provider (PocketID, Authentik, Keycloak…). Callback: `BASE_URL/api/v1/auth/oidc/callback`. |
| `OIDC_AUTO_CREATE` | `true` | Unknown verified emails get a member account. |

People invited to a review by email get an account without a password: they sign in with single sign-on, or an admin sets a password under Settings → People.

## Pocket Core

| Variable | |
|---|---|
| `CORE_URL` | e.g. `http://host.docker.internal:8179`. Empty = no Core, nothing changes. |
| `CORE_REGISTRATION_KEY` | Core's registration key. |
| `CORE_APP_URL` | How Core reaches this app (defaults to `BASE_URL`). |

## Demo

`DEMO_DATA=true` seeds an empty database with a contract in its second round (two revisions, five people, issues, replies, tasks, made-up review time), a draft and a finished review. The PDFs are generated, nothing is downloaded.
