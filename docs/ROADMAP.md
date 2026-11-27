# Portrox roadmap

Honest ledger. "Done" means a gate proves it, not that code exists.

## Done

### Phase 0 - hygiene
License, CREDITS, AUTHOR, SECURITY, FUNDING, pre-commit, gitleaks with a positive
control that must fire. Tree and full history clean.

### Phase 1 - engine
Loopback-only Studio, kernel-assigned port, PID ownership proven before any
signal, health-aware start. UI-only credential store. Auth lifecycle with atomic
credentials plus recovery, lockouts and single-use reset tokens. Renderer plus
HTML normalizer. Pages publish that waits for the build of the PUSHED commit and
never requests a duplicate. RLS on every table, zero anonymous write grants,
intake RPCs only. Local and encrypted offsite backups, restore proven in a scratch
schema. A release gate that refuses to commit a red suite.

### Phase 2 - authoring and receiving
Content editor, Inbox with triage, Media uploads, Intro wizard. Each has a
round-trip gate and leaves zero production residue.

### Phase 3a - AI
One OpenAI-compatible client with a configurable base URL; NVIDIA NIM by default.
Key never rendered, only a fingerprint. Eleven draft-only tasks, refused unless
assigned. Inbox draft executor. Nothing auto-sends, publishes or charges.

### Phase 3b - payments
Provider registry: manual, hosted_link, stripe, razorpay, hyperswitch.
hosted_link and manual take named instances, so every country can have its own
gateway. Country and currency routing in admin order. Signature verification for
the two documented schemes only; the others refuse rather than invent one.

### Phase 3c - checkout
Write-once visitor reference. Only the admin may set paid or confirmed, and only
to values the DB constraint allows. Booking validates before writing and honours
paid_booking. The public booking form calls portrox_book and reveals a reference
box bound to the returned appointment.

### Phase 3d - booking enforcement
The weekly windows are now ENFORCED, not merely rendered. Rules are synced from
availability.json into the availability table and checked in the site timezone
inside portrox_book: day, window, duration grid and zero seconds. Duration is
server-owned and a mismatch is refused, never clamped. Overlapping ranges are
refused by a BEFORE trigger under a per-site advisory lock; a pending booking
holds its slot; an unpaid requester is capped at three pending holds. The inbox
records the visitor's wall clock, not the database session's UTC. The loser of an
insert race deletes its own submission, so no refusal leaves an orphan.
Gates: sync-availability, verify-availability. Every booking probe derives its
slot from the same rules the SQL enforces.

### Phase 3e - schema parity
Every supabase migration is either byte-mirrored into packages/database or
declared legacy with a written reason. 20 source = 13 mirrored + 7 legacy.
Gate: verify-migrations.

### Phase 3f - intake ceilings and visitor language
The limiter no longer trusts a client header. Measured: with first-hop parsing
three forged X-Forwarded-For values were stored verbatim; with last-hop parsing
all three collapse to one address. Ceilings are 5 per email per hour, 40 per site
per hour and 200 per site per day, counted from live rows so probe cleanup resets
them. Every refusal code the three RPCs can return is mapped to a sentence a
visitor can act on, and "try later" is reserved for network faults.
Gates: verify-intake, audit-xff, verify-form-messages.

### Phase 3g - search snippets and share cards
Page descriptions are derived from the owner's data, never invented: book from
availability.json, services from services.json titles. twitter:card is
summary_large_image only when og:image exists. verify-meta decodes HTML entities
before measuring, requires the full expected page set, and fails on a zero-page
or partial build. A noindex page is exempt from snippet and social-description
requirements, which is the rule verify-content already established.
Gate: verify-meta.

## Remaining

### P1 - human acceptance
docs/LAUNCH.md section 3 quotes Mon-Fri 10:00-18:00, which is not the rule set:
the real windows are Mon 10:00-13:00, Wed 10:00-13:00, Fri 15:00-18:00. Section 4
is ticked for a live avatar, but no image ships on any page. Fix the wording,
re-run sections 3 and 4, mark the old sign-off superseded, re-sign at the new
commit.

### P1 - presentation
The share card is generated from profile.json by scripts/make-og.mjs: a
deterministic 1200x630 PNG, zero dependencies, self-validated by re-parsing its
own chunks. seo.og_image points at it and twitter:card is summary_large_image
only because the image now ships. verify-meta parses the PNG and refuses a
placeholder. Descriptions are derived from the owner's data and measured on
decoded text: index 144, about 72, services 135, book 88, about-website 58.
Optional, not a blocker: a personal photograph as the avatar. Upload it in the
Studio (Settings -> Media -> set as avatar) and republish; nothing else changes.

### P2 - intake abuse surface
portrox_payment_ref still has no rate limit and returns distinguishable error
codes, which is a state oracle on appointment UUIDs. The submit limiter no longer
trusts any client header: it caps 5 per email per hour, 40 per site per hour and
200 per site per day, all counted from live rows. The stored IP comes from the
last hop and is forensics only. Book refusals return before the limiter, so they
remain unmetered by design.

### P2 - transactional email
Needs a provider key. Draft-only AI text exists; sending does not. Until then a
booking is a request the owner confirms, not an appointment anyone is notified of.

### P2 - server-side gateway orders
stripe, razorpay and hyperswitch need a server holding the secret key. A static
site with only the publishable key cannot create orders. Requires an edge
function or a small public service, which is a deliberate architecture change.

### P2 - client portal
Re-enable Supabase auth deliberately, populate site_members, scope reads by
membership, and replace the login.html stub that still promises Phase 3.

### P3 - housekeeping
Advisor output is truncated without a count. Backup retention is unbounded
locally and in the offsite repo. Legacy JWT API keys are still active. Two
dormant tables carry old rows into every backup. multiple_permissive_policies
and unused_index are performance notes on a near-empty database; consolidating
RLS risks access control for no launch gain.
