# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Email **sid200ok@duck.com** with `SECURITY: Portrox` in the subject. Include:

- affected version or commit SHA
- reproduction steps or a proof of concept
- impact as you understand it
- whether you have already disclosed it elsewhere

You will get an acknowledgement within **72 hours**. Please allow **90 days**
before public disclosure, or agree a shorter window if the issue is actively
exploited. Credit is given in the fix commit and release notes unless you prefer
to remain anonymous.

There is no bug bounty. This is a personal project funded by
[GitHub Sponsors](https://github.com/sponsors/sid200ok).

## Supported versions

Only the latest `main` is supported. There are no backported patches.

## Threat model

**In scope**

- The Studio daemon: it must bind `127.0.0.1` only, require a valid `Host`, a
  loopback `Origin` when present, and the per-run CSRF token on every write.
- Credential handling: no secret in `argv`, no secret in a rendered bundle, no
  secret returned to the browser, `0600` files inside a `0700` directory.
- The database: `anon` must have **zero** table write grants. Intake is only via
  the rate-limited `SECURITY DEFINER` RPCs. Every authenticated write policy must
  be member- or owner-guarded. RLS must be enabled on anything a client role can
  touch.
- The `gh` transport: deny-by-default endpoint allowlist, no endpoint beginning
  with `-`, forced hostname, typed confirmation on destructive calls.
- Publishing: the built Pages commit must equal the commit that was pushed.

**Out of scope**

- An attacker who already has code execution as your local user. The Studio
  trusts the machine it runs on.
- A malicious or compromised Supabase / GitHub account, or a vendor-side breach.
- Denial of service against GitHub Pages or Supabase free tier.
- Social engineering, physical access, or attacks on your password manager.
- Findings that require you to disable a documented protection first.

## Known accepted exceptions

These are deliberate and are asserted by the verification suite, not hidden:

| Finding | Why it is accepted |
|---|---|
| `anon` / `authenticated` can EXECUTE `portrox_submit` and `portrox_book` | They are the **only** intake doors: rate-limited, honeypot-checked, `search_path` pinned. Direct table INSERT is denied, so the limit cannot be bypassed. |
| `rls_enabled_no_policy` on `contact_messages`, `legacy_projects` | Unused legacy tables in **deny-all** state: RLS enabled, zero client grants, zero policies. Nothing is reachable. Data is retained because it may contain real historical leads. |
| `unused_index` advisories | Expected on a low-traffic database. Dropping them would harm real workloads. |
| `multiple_permissive_policies` | An optimisation, not a vulnerability. Tracked for Phase 2. |

## Operator responsibilities

Portrox is a tool, not a hosted service. If you publish a site with it:

1. **Rotate the default Studio password immediately.** The suite fails while the
   shipped default is active.
2. Use **scoped, short-lived** tokens. A Supabase PAT can delete every project in
   your account; a GitHub PAT with `repo` + `workflow` can rewrite repositories
   and run CI.
3. Keep Supabase **signup and anonymous sign-in disabled** until you actually
   build a client portal. `node scripts/audit-auth.mjs --harden` enforces this.
4. Run `node scripts/backup-db.mjs` and `node scripts/backup-offsite.mjs`. Local
   backups die with the disk. **A lost passphrase means unrecoverable backups.**
5. You are the data controller for submissions and bookings. Publish a privacy
   notice, define retention, and honour deletion requests.
6. Run `bash scripts/verify-all.sh` before every publish, and use
   `bash scripts/release.sh` so a red suite can never be committed.

## Verification

`bash scripts/verify-all.sh` runs, in order: preflight, emitted-browser-script
syntax, Supabase management surface, GitHub operations, authenticated-surface
audit, auth lifecycle regression, build, render, content structure, daemon
perimeter plus a sandboxed authenticated suite, credential strength, config
precondition, intake RPC, database grants and a **future** booking, restore proof
in a scratch schema, probe cleanup, profile handle, live-site byte equality, and
gitleaks over the working tree **and full history** with a positive control.
