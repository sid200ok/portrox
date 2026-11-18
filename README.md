# Portrox

Self-hostable, multi-tenant portfolio engine. A **private local Studio** renders
**fully static** portfolio sites and publishes them to GitHub Pages.

Created by **Siddhant Kumar**. MIT licensed.

## Two UIs, one repo

| UI | Where | Who |
|---|---|---|
| **Studio** | `127.0.0.1:<dynamic port>` on your machine | you only |
| **Portfolio** | GitHub Pages, HTTPS | the internet |

The Studio never binds a public interface and never uses a fixed port.

## Install

```
git clone https://github.com/sid200ok/portrox.git
cd portrox
npm link
portrox doctor
portrox start
```

`portrox start` prints the exact local URL. Open it in your browser.

## All configuration happens in the UI

Portrox **never reads a `.env` file**. Everything is entered in the Studio and
written to `~/.portrox/config.json` (mode `0600`, directory `0700`).

### Setup · Supabase
1. Project URL (`https://<ref>.supabase.co`)
2. **Publishable (anon)** key — secret/service keys are rejected
3. Auth email + password → **Sign in**

Sign-in establishes your `owner_id`. The password is used once and never stored.
Access/refresh tokens stay on disk and are never returned to the browser.

### Setup · GitHub
Paste a Personal Access Token with `repo` + `workflow` scope (or a fine-grained
token with Contents RW, Pages RW, Administration RW, Workflows RW). The Studio
validates it live and shows the resolved account. The token is passed to `git`
through the environment only — never in argv, never in `.git/config`.

## Create and publish a site

In **Sites**: enter a name, choose a mode, **Create**. Then per site:

1. **Build** — render static output, preview locally
2. **Register** — create the tenant row in Supabase under your owner id
3. **Publish** — provision the repo, push rendered output, configure Pages, mark live

## GitHub Pages reality

One account has **exactly one** `{account}.github.io` user site.

| Mode | URL | Limit |
|---|---|---|
| `user` | `account.github.io` | 1 per account |
| `project` | `account.github.io/repo` | unlimited |
| `org` | `org.github.io` | 1 per org |
| `custom` | your domain | unlimited (needs DNS) |

Publishing pushes to the target repo's `gh-pages` branch and sets Pages to
**legacy/branch** deploy, disabling any competing Actions Pages workflow.

## Commands

```
portrox start | stop | restart | status | logs
portrox enable-autostart | disable-autostart
portrox build <site> | --all
portrox doctor | help
```

Sites are created **only** in the Studio UI. `portrox build` and the Studio's
Build button share one code path and inject the same UI credentials, so the
artifact never depends on the entry point.

## Database

`supabase/migrations/` is the applied source of truth.
`packages/database/migrations/0001_init.sql` is a **byte-identical mirror**;
`scripts/preflight.mjs` fails if they drift.

- `anon` has **no direct table write**. `portrox_submit()` is the only intake
  path, so the rate limit cannot be bypassed.
- Public reads are gated on `sites.is_published` — no cross-tenant disclosure.
- `system_pages` is select-only for client roles; the About-Website page is
  locked in the database and sourced from `packages/core/system-pages/`.
- `portrox_book()` locks slots with a partial unique index and rejects past slots.

## Security

- Studio binds `127.0.0.1` only; the kernel assigns the port each start.
- Every write requires a valid `Host`, a loopback `Origin` when present, and a
  per-run CSRF token.
- `portrox stop` verifies `/proc/<pid>/cmdline` before signalling. Never `pkill`.
- Secret keys never enter a generated site; the renderer refuses to build with one.
- `bash scripts/audit-secrets.sh` runs a positive control, then tree, then full
  history — and fails closed if there are no commits to scan.

## Verification

```
node scripts/preflight.mjs
portrox build --all
node scripts/verify-render.mjs
node scripts/verify-daemon.mjs
node scripts/verify-rpc.mjs            # pre-publish expectations
node scripts/verify-rpc.mjs --positive # after Register + Publish
bash scripts/audit-secrets.sh
```

## Status

Phase 1: CLI, Studio daemon, UI-only credentials, renderer, schema, sample tenant.
Pending: Next.js Studio modules, paid-booking verification, client portal.
