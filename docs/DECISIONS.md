# Portrox decision ledger

Settled decisions are NOT re-opened in review. Change one only with a new dated
entry that says what superseded it and which gate proves the new behaviour.

## Settled

| id | Decision | Why | Evidence |
|-|-|-|-|
| D1 | Canonical public handle is **sid200ok** | repo, PAT account and live site all use it | check-profile gate |
| D2 | Reuse Supabase project nwpolajiufkxpvgdeddi | legacy tables renamed and locked, keepalive repointed | verify-supabase |
| D3 | GitHub Pages hosts the site; Supabase hosts data only | a static site cannot hold a secret | publish + live gates |
| D4 | Studio binds 127.0.0.1 with a kernel-assigned port, never a fixed port | no public authoring surface, no port collisions | verify-daemon |
| D5 | Content files under sites/ are canonical; the DB is canonical for intake, site registry, media metadata and system pages | the renderer is file-driven and offline-capable | content-api + render gates |
| D6 | GitHub access may use the system gh credential as a disclosed fallback | it is printed as "via system" in status and preflight | verify-git-auth |
| D7 | Anonymous intake is allowed ONLY through portrox_submit, portrox_book and portrox_payment_ref | rate-limited SECURITY DEFINER doors; no direct table write | verify-supabase advisor allowlist |
| D8 | multiple_permissive_policies and unused_index advisories are deferred | near-empty database; consolidating RLS risks access control for no gain | verify-supabase NOTE lines |
| D9 | Payments: manual and hosted_link work today; stripe, razorpay and hyperswitch require a server holding the secret key | a publishable key cannot create orders | verify-payments |
| D10 | AI is draft-only. Nothing auto-sends, publishes or charges | the operator stays in the loop | verify-ai-tasks |
| D11 | Backups are AES-256-GCM encrypted offsite; the key lives in the Studio key store | release must never take a secret in argv | backup + restore gates |

## Required properties of every anonymous RPC door (D7)

A door is accepted only if ALL of these hold, in SQL, proven by a gate:

1. rate limited on a correctly parsed client IP (first hop of x-forwarded-for)
2. scoped by site_id, so one tenant can never touch another
3. validated before any write, leaving no orphan row on refusal
4. write-once or status-constrained where it mutates an existing record
5. never returns another visitor's data

## Standing rules

- R1 Timezone: booking logic never uses host local time. The host may be on any
  offset; the site timezone in availability.json is the only authority.
- R2 Never rewrite a file that has not been read in this session. Large or
  unread files get asserted, anchored patches with a backup and a rollback.
- R3 A gate that asserts over zero items must say so. Vacuous passes are labelled.
- R4 Truncated output must print "showing N of M".
- R5 Gate labels name the phases actually covered, not a historical phase.
- R6 A signed launch acceptance is invalidated when the behaviour it covers
  changes. Re-run, then re-sign against the new commit.

## Open (must close before announcing)

| id | Item | Owner |
|-|-|-|
| O1 | Availability windows enforced in portrox_book, overlaps excluded, duration server-side | build |
| O2 | Booking is a request until a notification channel exists | build |
| O3 | Backup key copied off-machine and restore proven from that copy alone | operator |
| O4 | Supabase signup state gated again in the suite | build |
| O5 | Avatar and OG image shipped; descriptions 50-160 chars | build |
| O6 | Visitor notice for AI processing and offsite storage of messages | build |
| O7 | LAUNCH.md section 3 re-run and re-signed | operator |
