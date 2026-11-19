# Portrox: UI action ↔ terminal command

## Who hosts what

| Layer | Provider | Up when your laptop is off? |
|---|---|---|
| Website (HTML/CSS/JS) | **GitHub Pages** | **Yes, 24×7** |
| Backend API (DB/Auth/Storage/Realtime/Functions) | **Supabase** | **Yes** (see pausing) |
| Portrox Studio (authoring) | your Linux box, `127.0.0.1:<kernel port>` | only while editing |

Supabase does **not** host websites. Publishing pushes static files to GitHub.

### 24×7 risk
Supabase **Free** allows **2 active projects** and pauses a project after **1 week
of inactivity**. `.github/workflows/supabase-keepalive.yml` queries
`rest/v1/system_pages?select=slug&limit=1` twice weekly. That table is
anon-readable by policy, part of the bootstrap schema, holds no tenant data, and
is never written by visitors. GitHub disables scheduled workflows after 60 days
of repo inactivity; any push re-enables them.

## Supabase mapping

| Studio action | Terminal mirror |
|---|---|
| Settings › Supabase account › paste `sbp_` token | `supabase login` |
| Validate and load projects | `bash scripts/supabase-lab.sh account` |
| New project | `bash scripts/supabase-lab.sh create --org <slug>` |
| Project binding › Default | `bash scripts/supabase-lab.sh link` |
| Fetch key | `bash scripts/supabase-lab.sh key` |
| Bootstrap | `bash scripts/supabase-lab.sh bootstrap` |
| Bootstrap › observe existing | `node scripts/reconcile-schema.mjs` |
| Health | `bash scripts/supabase-lab.sh health` |
| Advisors | `bash scripts/supabase-lab.sh advisor` |
| Inbox | `bash scripts/supabase-lab.sh inbox` |
| — no UI equivalent — | `bash scripts/supabase-lab.sh push-all` (typed confirmation) |

`bash scripts/supabase-lab.sh doctor` prints which field unlocks each module.

## GitHub mapping

| Studio action | Terminal mirror |
|---|---|
| Repositories › refresh | `gh repo list --limit 100` |
| Create repository | `gh repo create <name> --public` |
| Branches / Commits | `gh api repos/O/R/branches` · `/commits` |
| Pages › status | `gh api repos/O/R/pages` |
| Pages › enable / update | `gh api -X POST/PUT repos/O/R/pages` |
| Pages › request build | `gh api -X POST repos/O/R/pages/builds` |
| Pages › latest / history | `gh api repos/O/R/pages/builds/latest` · `/builds` |
| Pages › DNS health | `gh api repos/O/R/pages/health` |
| Pages › disable | `gh api -X DELETE repos/O/R/pages` |
| Workflows › list | `gh workflow list` |
| Workflows › enable / disable | `gh workflow enable/disable <file>` |
| Workflows › run | `gh workflow run <file> --ref main` |
| Runs › list / cancel / rerun | `gh run list` · `gh run cancel ID` · `gh run rerun ID` |
| Secrets › list / delete | `gh secret list` · `gh secret remove NAME` |
| Studio › Publish | `git push -f origin HEAD:refs/heads/gh-pages` + Pages API |

**Deferred:** creating an Actions secret needs libsodium sealed-box encryption
against the repo public key. `gh secret set` does that; Portrox does not yet.
Listing and deleting are implemented and never expose values.

## Credential classes

| Credential | Prefix | Where it may live | Power |
|---|---|---|---|
| Publishable (anon) | `sb_publishable_` | browser bundle | RLS-bound, no identity |
| Secret / service | `sb_secret_` | server only | bypasses RLS |
| Supabase PAT | `sbp_` | your machine, `0600` | create/delete projects, run SQL |
| GitHub PAT | `ghp_` / `github_pat_` | your machine, `0600` | repo + Pages + workflows |

### Secret handling rules (enforced)
- curl reads headers from a `0600` config file — never `-H "Bearer …"` in argv.
- psql reads `PGPASSWORD` from the environment; SQL travels on stdin.
- Every sourced shell file is single-quote escaped.
- A created project's password is written once to a `0600` handoff file named
  after the **new** ref, never printed.
- Detectors match quoted filenames and JSON keys — never substrings.
  `process.env` is not a dotenv read; `db_password_stored` is not a password.
- **No personal project ref is hardcoded in source.** Destructive or
  legacy-applying operations require a typed confirmation of the target.

## Verified API facts (do not re-guess these)

- `GET /v1/projects/{ref}/health` **requires** `services`. Send **repeated keys**
  (`?services=db&services=auth`), not a `%2C`-joined single value. Response
  `name` enum: `auth,db,db_postgres_user,pooler,realtime,rest,storage,pg_bouncer`.
  Status enum: `COMING_UP,ACTIVE_HEALTHY,UNHEALTHY`. `healthy` is deprecated.
  The client self-heals to `services=db` on a 400 and surfaces both errors.
- `POST /v1/projects` takes `organization_slug` + `region_selection`
  (`smartGroup`: `americas|emea|apac`). `organization_id`, `region`, `plan` are
  deprecated. Omit `desired_instance_size` to keep scale-to-zero.
- `POST /database/migrations` worked for this account; `/database/query` is the
  experimental fallback and does **not** record a version, so Portrox records it.
- **Bootstrap is the default.** `full_history: true` additionally requires
  `confirm === ref` and returns a warning naming the legacy grants it introduces.
- Pause / restart / restore **are** programmable.
- `PATCH /database/password` exists but its **request body shape is unverified**;
  the client requires confirmation and surfaces the API error verbatim.
- Pages: `POST /pages` → 201/409/422; `PUT /pages` → 204; `DELETE /pages` → 204;
  `POST /pages/builds` → 201; `GET /pages/health` → 200, or 202 on first call
  (async), 422 when no CNAME, 400 when custom domains are unavailable.

## Expected denials (do NOT "fix" these)

`POST /rest/v1/submissions` as `anon` returns `42501 permission denied`. PostgREST
hints `GRANT INSERT … TO anon`. **Ignore that hint.** `portrox_submit()` is the
only intake door so the rate limit cannot be bypassed. Granting direct INSERT
would re-open unlimited anonymous spam against any tenant.

## Predicates

- `configured` — account access token present
- `project_ready` — bound project resolves URL + publishable key
- `db_ok` — every probed service reports `ACTIVE_HEALTHY`
- `schema_complete` — **every** `BOOTSTRAP_FILES` entry recorded (not a count)

## Verification

```
node scripts/preflight.mjs
node scripts/verify-ui.mjs
node scripts/verify-auth.mjs
node scripts/verify-daemon.mjs
node scripts/verify-github.mjs
node scripts/verify-render.mjs
node scripts/verify-supabase.mjs
bash scripts/verify-all.sh
```
