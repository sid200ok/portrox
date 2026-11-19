# Portrox

Self-hostable portfolio engine. A **local Studio** on your Linux box renders a
fully static site and publishes it to **GitHub Pages**, backed by **Supabase**.

Created by **Siddhant Kumar**. MIT licensed.

| Layer | Where it runs | Up when your laptop is off? |
|---|---|---|
| Public website | GitHub Pages, HTTPS | **Yes, 24x7** |
| Backend API (Postgres, RLS, intake RPC) | Supabase cloud | **Yes** |
| Portrox Studio (authoring) | `127.0.0.1:<kernel-assigned port>` | only while editing |

Supabase does **not** host websites. Publishing pushes static files to GitHub.
The Studio never binds a public interface and never uses a fixed port.

## Install

```
git clone https://github.com/sid200ok/portrox.git
cd portrox
npm install
node packages/cli/portrox.mjs doctor
node packages/cli/portrox.mjs start
```

`start` prints the exact local URL. `npm link` optionally puts `portrox` on PATH.

## All configuration happens in the Studio

Portrox **never reads a `.env` file**. Everything is entered in the UI and written
to `~/.portrox/config.json` (mode `0600`, directory `0700`).

### Settings -> Supabase account
Paste a **personal access token** (`sbp_...`). One account token drives many
projects. The Studio loads your organisations and projects, fetches the
**publishable** key, and bootstraps the schema. Secret/service keys are rejected
and never enter a rendered bundle.

There is **no email/password sign-in**. Ownership is recorded as `studio_owner`;
`sites.owner_id` stays NULL unless you later link a Supabase Auth user. Auth
signup and anonymous sign-in are **disabled** — there is no client portal yet.

### Settings -> GitHub
Paste a PAT with `repo` + `workflow`, **or** click *Use my WSL gh session* to
adopt an existing `gh auth login`. `gh` is the transport for every GitHub call.
Pushes authenticate by probing token / `gh` credential helper / SSH, in that
order, and **never prompt**.

## Create and publish

In **Studio**: create a site, bind a Supabase project, then **Register** and
**Publish**. Publishing renders, pushes an orphan `gh-pages`, switches Pages to
legacy branch deploy, requests a build, polls until it builds **the exact commit
pushed**, and marks the site live.

Terminal mirror of every step: `docs/UI-TO-TERMINAL.md`.

## GitHub Pages reality

One account has exactly one `{account}.github.io` user site.

| Mode | URL | Limit |
|---|---|---|
| `user` | `account.github.io` | 1 per account |
| `project` | `account.github.io/repo` | unlimited |
| `org` | `org.github.io` | 1 per org |
| `custom` | your domain | unlimited (needs DNS) |

GitHub's own `pages-build-deployment` workflow **builds** a legacy site and is
never disabled. Competing Actions deployers are disabled, with every decision
logged.

## Commands

```
portrox start | stop | restart | status | logs | doctor
portrox build <site> | --all
portrox enable-autostart | disable-autostart

node scripts/publish-site.mjs        # register + render + push + Pages + build
node scripts/inventory.mjs           # is the portfolio actually filled in?
node scripts/backup-db.mjs           # logical backup, 0600, gitignored
node scripts/restore-db.mjs          # prove restorability in a scratch schema
node scripts/backup-offsite.mjs      # encrypted copy to a PRIVATE repo
node scripts/audit-db.mjs            # grants, RLS, a FUTURE booking
node scripts/audit-auth.mjs          # signup, anonymous users, write policies
bash scripts/verify-all.sh           # every gate, in order
bash scripts/release.sh "message"    # backup -> publish -> gates -> commit
```

`release.sh` refuses to commit unless the whole suite is green.

## Database

`supabase/migrations/` is the applied source of truth and is **immutable** once
applied. `packages/database/migrations/` is a **generated mirror**;
`scripts/sync-mirrors.mjs` owns the mapping and `preflight` fails on drift.

- `anon` has **no table write grant anywhere**. `portrox_submit()` and
  `portrox_book()` are the only intake doors: rate-limited, honeypot-checked.
- Every authenticated write policy is guarded by
  `portrox_private.portrox_is_member(site_id)` or `sites.owner_id = auth.uid()`.
  `site_members` requires **ownership**, not self-identity, so a user cannot add
  themselves to a site.
- RLS helper functions live in `portrox_private`, which PostgREST does not
  expose, so they are not callable as RPC.
- Unused legacy tables are **deny-all**: RLS enabled, zero client grants, zero
  policies. Advisor lints on them are informational.
- Public reads are gated on `sites.is_published`.
- `system_pages` is select-only for client roles; the About-Website page is
  locked in the database.
- Deleting a submission cascades to its appointment, so a cancelled lead frees
  the slot instead of blocking it forever.

## Security

- Studio binds `127.0.0.1` only; the kernel assigns the port each start.
- Every write needs a valid `Host`, a loopback `Origin` when present, and a
  per-run CSRF token. Sessions are HttpOnly, SameSite=Strict.
- Passwords and recovery answers are scrypt-hashed. Rotation status derives from
  the **password**, never the username.
- `portrox stop` verifies `/proc/<pid>/cmdline` before signalling. Never `pkill`.
- Secrets travel in the **environment**; SQL travels on **stdin**. Never argv.
- `gh` endpoints are deny-by-default allowlisted. An endpoint starting with `-`
  is refused. Destructive calls need a typed confirmation; the API console
  refuses DELETE outright.
- `bash scripts/audit-secrets.sh` runs a positive control, then tree, then full
  history, and fails closed if there is nothing to scan.

## Backups

`backup-db.mjs` writes per-table JSON plus a manifest of row counts and migration
versions into `backups/` — `0700`/`0600`, gitignored, contains PII.
`restore-db.mjs` clones each table into a scratch schema, loads the JSON via
`json_populate_recordset`, compares counts, and drops the schema. Production is
never written.

`backup-offsite.mjs` encrypts with AES-256-GCM (scrypt key), **verifies the round
trip before shipping**, confirms the target repo is private, and **appends** to
it — never force-pushes. Keep the passphrase in a password manager; it is not in
the repo and is not recoverable.

## Platform limits

- Supabase Free: **2 active projects**, paused after 1 week idle. A keepalive
  workflow queries `system_pages` twice weekly. Extra sites can share one project
  (`mode: shared`) with `site_id` + RLS isolation.
- GitHub disables scheduled workflows after 60 days of repo inactivity; any push
  re-enables them.
- Do **not** drop indexes because the advisor reports `unused_index` on a
  low-traffic database.

## Status

Phase 1 complete: CLI, Studio, UI-only credentials, renderer, publish, intake,
hardening, gates, backups with proven restore.

Phase 2: Studio content CRUD (experience/projects/services), media uploads,
inbox UI, guided intro wizard, paid-booking verification, client portal.
