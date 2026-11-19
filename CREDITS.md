# Credits and attributions

Portrox is an independent project by **Siddhant Kumar**, released under the MIT
licence. It is **not affiliated with, endorsed by, or sponsored by** any vendor
listed here. All trademarks and service marks belong to their respective owners.

## Runtime and platform

| Project | Role in Portrox | Licence / terms |
|---|---|---|
| [Node.js](https://nodejs.org) | The entire runtime. Portrox uses only built-ins: `node:crypto`, `node:fs`, `node:http`, `node:path`, `node:os`, `node:child_process`, `node:zlib`. | MIT (Node.js), with bundled components under their own licences |
| [PostgreSQL](https://www.postgresql.org) | Database, row-level security, `json_populate_recordset`, catalog introspection. | PostgreSQL Licence |
| [Supabase](https://supabase.com) | Hosted Postgres, PostgREST, GoTrue, Storage, Management API. | Apache-2.0 (Supabase components); hosted service under Supabase Terms |
| [PostgREST](https://postgrest.org) | The REST surface the published site calls. | MIT |
| [GitHub Pages](https://pages.github.com) | Static hosting and TLS for the published site. | GitHub Terms of Service |
| [Git](https://git-scm.com) | Orphan-branch publishing. | GPL-2.0 |
| [GitHub CLI (`gh`)](https://cli.github.com) | The whole GitHub transport, including sealed-box encryption for Actions secrets. | MIT |

## Development and verification tooling

| Project | Role | Licence |
|---|---|---|
| [Supabase CLI](https://supabase.com/docs/guides/cli) | Migration tooling during development. Declared as a **devDependency** only; never shipped to a rendered site. | MIT |
| [gitleaks](https://github.com/gitleaks/gitleaks) | Secret scanning of the working tree and full git history, with a positive control. | MIT |
| [pre-commit](https://pre-commit.com) | Commit-hook framework. | MIT |
| [pre-commit-hooks](https://github.com/pre-commit/pre-commit-hooks) | Large-file, private-key, merge-conflict, YAML/JSON/TOML checks; end-of-file and whitespace fixes. | MIT |
| [Shields.io](https://shields.io) | README badges. | CC0 |

## Documentation sources

Behaviour was verified against the vendors' own published references rather than
assumed. Notably:

- Supabase Management API reference — project creation (`organization_slug`,
  `region_selection`), service health (`services` is required), API keys,
  database migrations and the experimental query endpoint, auth configuration
  (`disable_signup`, `external_anonymous_users_enabled`).
- Supabase database linter documentation — `anon_security_definer_function_executable`,
  `auth_rls_initplan`, `unindexed_foreign_keys`, `rls_enabled_no_policy`.
- GitHub REST reference for Pages — create/update/delete a site, list builds,
  get latest build, request a build, DNS health, and the `build_type` /
  `source.path` constraints.
- GitHub CLI manual — `gh api`, `gh secret set` reading from stdin,
  `gh auth git-credential`.

## People

- **Siddhant Kumar** — author and maintainer.
- Everyone who reports a vulnerability responsibly. See [`SECURITY.md`](SECURITY.md).
- Sponsors: [github.com/sponsors/sid200ok](https://github.com/sponsors/sid200ok).

## What Portrox does NOT use

- **No runtime npm dependencies.** `package.json` has zero `dependencies`.
- **No CDN assets.** The rendered site loads no third-party script, stylesheet,
  font or image. Typography is the system font stack.
- **No analytics, trackers, or telemetry.** Nothing is sent anywhere except the
  Supabase project and GitHub repository you configure yourself.
- **No AI service is called by Portrox itself.** The sample portfolio content
  mentions AI work because that is the author's profession; the engine makes no
  model calls.

If any attribution here is wrong or incomplete, open an issue and it will be
corrected.
