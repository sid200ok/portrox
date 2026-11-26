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
to values the DB constraint allows. Booking validates before writing, honours
paid_booking, and locks slots. The public booking form calls portrox_book and
reveals a reference box bound to the returned appointment.

## Remaining

### P1 - availability enforcement
The weekly windows are RENDERED but NOT ENFORCED. portrox_book checks only
past_slot and slot uniqueness, so a 03:00 Sunday booking is accepted. The rules
live in availability.json while the availability table is empty. Fix: sync the
file rules into the table, then enforce day, window and duration in the site
timezone inside portrox_book, and prove it with a gate.

### P1 - human acceptance
docs/LAUNCH.md section 3 must be re-run: the booking form changed from writing a
message to creating a locked appointment.

### P2 - transactional email
Needs a provider key. Draft-only AI text exists; sending does not.

### P2 - server-side gateway orders
stripe, razorpay and hyperswitch need a server holding the secret key. A static
site with only the publishable key cannot create orders. Requires an edge
function or a small public service, which is a deliberate architecture change.

### P2 - client portal
Re-enable Supabase auth deliberately, populate site_members, scope reads by
membership, and replace the login.html stub that still promises Phase 3.

### P3 - deferred advisories
multiple_permissive_policies and unused_index are performance notes on a
near-empty database. Consolidating RLS risks access control for no launch gain.
