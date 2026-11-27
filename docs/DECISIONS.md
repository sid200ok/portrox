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
| D8 | multiple_permissive_policies and unused_index advisories are deferred | near-empty database; consolidating RLS risks access control for no gain | verify-supabase NOTE lines |
| D9 | Payments: manual and hosted_link work today; stripe, razorpay and hyperswitch require a server holding the secret key | a publishable key cannot create orders | verify-payments |
| D10 | AI is draft-only. Nothing auto-sends, publishes or charges | the operator stays in the loop | verify-ai-tasks |
| D11 | Backups are AES-256-GCM encrypted offsite; the key lives in the Studio key store | release must never take a secret in argv | backup + restore gates |
| D12 | Booking rules are enforced in SQL from public.availability, synced from availability.json. No row means fail closed | rendered-but-unenforced rules accepted a Sunday 03:00 booking | verify-availability |
| D13 | Slot duration is server-owned. A mismatched p_minutes is refused, never clamped | clamping let a visitor take a four-hour block silently | verify-availability |
| D14 | The inbox shows the visitor's wall clock in the site timezone | to_char on a timestamptz rendered UTC, 5:30 away from the pick | verify-availability |
| D15 | Overlap is a BEFORE trigger under a per-site advisory lock, not a GiST EXCLUDE constraint | timestamptz + interval is STABLE, so Postgres refused the index expression with 42P17. A trigger needs no immutability and no extension | verify-availability |
| D16 | The intake limiter is a count of LIVE submission rows, not a counter table | portrox_submit counts rows for (site, email OR ip) in the last hour, limit 5; portrox_private holds zero tables. Probe cleanup therefore resets it, so gates may use the real door | portrox_submit body, read 2026-11-27 |
| D17 | Release order is backup, daemon, verify, publish, live, offsite, commit | the previous order published and pushed an immutable offsite bundle before verifying, so a red run still shipped | release.sh |
| D18 | Every supabase migration is byte-mirrored or declared legacy with a reason | 19 source files against 12 mirrors went unnoticed; a self-hoster would get a different schema | verify-migrations |

## D7 - anonymous intake doors, stated as they actually are

Anonymous execute is granted on exactly three SECURITY DEFINER functions.
The advisor flags all three; they are accepted individually, not as a class.

| door | rate limited | site scoped | validates before write | write-once / constrained | returns visitor data |
|-|-|-|-|-|-|
| portrox_submit | yes: 5 live rows/hour per site, matched on email OR ip | yes (p_site) | yes | insert only | no |
| portrox_book | inherits submit. Refusals return BEFORE submit, so they write nothing and are unmetered | yes (p_site) | yes | slot held by overlap check plus trigger; the race loser deletes its own submission | no |
| portrox_payment_ref | **NO** | **indirect only** - takes p_appointment, resolves the site from the row | yes | write-once, never changes status, refuses cancelled | no |

portrox_payment_ref is accepted because it writes one bounded string to a row
identified by an unguessable UUIDv4, is write-once, and returns no visitor data.
It is NOT accepted as rate-limited: it is not. Its distinct error codes are a
state oracle on appointment UUIDs. Both facts are open item O8.

Two claims in earlier versions of this file were wrong and are corrected here:
- 2026-11-27: it said all three doors were rate-limited. Asserted from the
  advisor allowlist instead of the function body. portrox_payment_ref is not.
- 2026-11-27: it said a full suite inherently spends the five-row allowance and
  therefore cannot include an end-to-end booking proof. Wrong: the limiter counts
  live rows and every gate deletes its probes, so cleanup resets it. The five
  rows were one gate's own un-cleaned residue. The full proof is the default again.

## Standing rules

- R1 Timezone: booking logic never uses host local time. The host is currently
  Asia/Amman (+03); the site timezone in availability.json is the only authority.
- R2 Never rewrite a file that has not been read in this session. Large or unread
  files get asserted, anchored patches with a backup and a rollback.
- R3 A gate that asserts over zero items must say so. Vacuous passes are labelled.
- R4 Truncated output must print "showing N of M".
- R5 Gate labels name the phases actually covered, not a historical phase.
- R6 A signed launch acceptance is invalidated when the behaviour it covers
  changes. Re-run, then re-sign against the new commit.
- R7 A probe must derive its inputs from the same rules the code enforces. A probe
  that invents a slot proves usability, not correctness.
- R8 Never fabricate content to satisfy a gate. A missing description is an
  authoring task with a named file, not text the normalizer invents.
- R9 A refusal test must print the identity it actually sent. A test labelled
  "unknown site" that silently used the real site id is worse than no test.
- R10 No irreversible action before verification. Publish, offsite push and commit
  all follow a green suite.

## Open (must close before announcing)

| id | Item | Owner |
|-|-|-|
| O2 | Booking is a request until a notification channel exists | build |
| O3 | Confirm the password-manager key fingerprint matches the Studio key store | operator |
| O5 | Real 50-160 char descriptions for book and services; avatar and OG image | build |
| O6 | Visitor notice for AI processing and offsite storage of messages | build |
| O7 | LAUNCH.md section 3 quotes windows that do not exist, and section 4 claims a live avatar that is not shipped. Fix, re-run, re-sign | operator |
| O8 | Rate-limit portrox_payment_ref and collapse its error oracle | build |
| O10 | Backup retention; rotate legacy JWT keys; drop dormant PII tables | build |
| O11 | Measure whether the edge rewrites x-forwarded-for. If the first hop is client-controlled, the limiter is bypassable with rotating emails | build |
| O12 | Advisor lists are truncated without a count (19 findings, 14 shown) | build |
| O13 | too_many_pending is unproven because paid_booking is false; prove it on a scratch site | build |

## Addendum 2026-11-27 (later run) - corrections and closures

- D19 The intake IP is taken from the LAST hop of x-forwarded-for and is used for
  forensics only. MEASURED: with first-hop parsing, three forged headers stored
  203.0.113.7/32, 198.51.100.9/32 and 203.0.113.7/32 - the forgery landed. With
  last-hop parsing all three store one identical address. The edge therefore
  APPENDS the real address; it does not overwrite the header. An earlier audit
  line claiming "the edge overwrites it" was a mechanism claim the probe cannot
  observe, and it was wrong. The gate now asserts invariance, not mechanism.
- D20 Page descriptions are DERIVED from the owner's data: book from
  availability.json, services from services.json titles. No new site.json keys,
  no invented prose, and the snippet cannot drift from what the site enforces.
- D21 twitter:card is summary_large_image only when og:image exists, otherwise
  summary. Declaring a large-image card with no image renders an empty box.
- D22 verify-content measures the HTML-escaped attribute, so its lengths are
  inflated by 4 per ampersand. verify-meta decodes entities and owns the 50-160
  quality contract; verify-content keeps the structural non-empty floor.

Closed here:
- O11 CLOSED. The first hop WAS caller-controlled; the limiter no longer uses any
  IP. Proven by verify-intake (three ceilings, forged headers reset nothing) and
  audit-xff (invariance plus independence).
- O12 CLOSED. Advisor output prints "showing N of M".

New standing rule:
- R11 Write the verdict predicate first, prove every branch is reachable by the
  cases the probe sends, normalise values before comparing, and never assert a
  mechanism that was not observed. Three gates of mine broke this in a row.

## Addendum 2026-11-27 (renderer scope failure)

- R12 The acceptance test for a code change is the program's own output, not a
  static inspection of the source. node --check parses; it cannot resolve an
  identifier or see a scope error. Textual position is not lexical scope.
- Incident: the description helpers were injected inside layout() because the
  anchor line lived there, while the call sites are in renderSite(). Every build
  threw "servicesDesc is not defined". A repair patch then compared line numbers,
  concluded the scope was fine, and printed SKIP. verify-meta compounded it by
  reporting META OK against a dist/ the failed build had wiped.
- Resolution: helpers declared in renderSite beside svc and avail, which the page
  body already renders, so no parallel file loader and no second read. The patch
  is accepted only after a real build emits six pages and the descriptions are
  read back from the artifact. verify-meta now derives the expected page set from
  cfg.nav and fails on a zero-page or partial build.
- D20 status: the derivation decision stands; it is proven only by the build output
  recorded in the release that carries this addendum.
- Known future item: login.html carries a 13-character description. It is not
  rendered while client_auth is false. Enabling the portal will correctly fail the
  50-160 rule until a real description is written.
- Backup naming: use name.bak.N, never name.bak2. .gitignore covers *.bak and
  *.bak.* only, so .bak2 would have been committed by git add -A.

## Addendum 2026-11-27 (noindex social metadata)

- D23 A noindex page is exempt from snippet-length and social-description
  requirements. verify-content established this earlier: "A 404 page must be
  noindex; requiring a meta description there was wrong." verify-meta contradicted
  it and blocked an otherwise green build. Social metadata describes shareable
  content; an error page is neither shared nor indexed. Any such tag that IS
  present must be non-empty, and card/image consistency still applies.
- R13 Before adding a rule to a new gate, check whether an existing gate already
  decided the opposite. A new gate must not silently reverse a recorded decision.
- Ledger synced: ROADMAP carried 19/20-character descriptions, a 168-character
  homepage, 19=12+7 parity and first-hop trust. All four were stale against the
  artifact and are corrected in the same commit that proves them.

## Addendum 2026-11-27 (release ordering: the commit is not the last irreversible act)

- Incident: the suite passed 35 gates, publish pushed gh-pages 54249374, verify-live
  confirmed byte-identity, and the offsite bundle was appended. Then
  end-of-file-fixer modified docs/DECISIONS.md, pre-commit returned non-zero because
  a hook changed a file, and `git commit || exit 1` aborted. Production was left
  AHEAD of version control: a live artifact that no commit described.
- Cause 1 (mine): the release ordered verification before publish but still left the
  commit last. The boundary that matters is the first IRREVERSIBLE action, and
  pushing gh-pages plus appending an immutable offsite bundle are both irreversible.
- Cause 2 (mine): the doc append used rstrip plus a block that already ended in a
  newline plus another newline, which does not guarantee exactly one trailing
  newline. Deterministic form: rstrip('\n') + '\n\n' + block.strip('\n') + '\n'.
- Cause 3 (mine): the failure was silent. `git commit || exit 1` printed no state,
  so the operator could not tell what had shipped.
- D24 Release order is backup, daemon, normalise, suite, inventory, COMMIT, publish,
  live, offsite, PUSH. The only permitted divergence is repo-ahead-of-live.
- D25 Formatting hooks run before the first irreversible action, and the commit
  retries exactly once, and only when the hook reports that it modified files.
- D26 Every release exit path prints committed / published / live / offsite / pushed.
- R14 Enumerate every irreversible action and put all cheap deterministic checks
  before the FIRST of them. "Verify before publish" was a proxy for the real
  property, which is "verify and commit before anything irreversible".

## Addendum 2026-11-27 (derived artifacts and URL-based features)

- D27 A derived artifact committed to git needs a freshness gate. og-card.png is
  generated from profile.json; without a check, editing the headline and
  republishing changes the site text while the share card still advertises the old
  one. scripts/make-og.mjs --check regenerates in memory, writes nothing, compares
  bytes, and runs in the suite before verify-meta. Same drift class as the schema
  mirrors that sync-mirrors exists to protect.
- D28 A URL-based feature needs a fetch gate, not an existence gate. verify-meta
  proved the image was in dist; verify-live never requested it. A 404 on that one
  asset would have left every gate green and every share card blank.
  verify-meta --live fetches each og:image URL, asserts 200 and an image
  content-type, and compares bytes with the build. It runs after publish, beside
  the live artifact gate. A thrown fetch is a NETWORK failure, never evidence that
  something is unpublished - the HTTP 0 lesson.
- R15 For any new gate, name the property in one sentence before writing code.
  If the assertion is a proxy for that property (file exists, line number, syntax
  parses, marker present), replace it with the property or record why the proxy is
  sufficient. Six gates of mine failed this in a row.
- Observed and closed: the gitleaks slowdown (3.23s tree / 15.1s history) was WSL
  I/O contention. The next run measured 142ms / 316ms on the same byte count.

## Addendum 2026-11-27 (what a wiring gate does not prove)

- D29 scripts/verify-ui.mjs is a SYNTAX and SOURCE-PRESENCE gate. It parses the
  emitted script and asserts that ids, tab names and api() calls exist. That is
  real value - it caught a backend shipped with no frontend twice - but it is a
  proxy. It cannot observe a runtime throw, a control hidden by CSS, or a handler
  wired to the wrong function. The property "the Studio works" is proven only by
  a human rendering it and clicking through it, which is docs/LAUNCH.md section 8.
  Recorded under R15 instead of letting 36 green gates imply usability.
- D30 No AI provider key is configured (config.json holds supabase and github
  only), so no visitor data can reach a third party today. Standing condition:
  add a visitor-facing privacy notice BEFORE adding an AI key, because draft
  generation transmits the visitor's name, email and message to the provider.
- Observation: 21 stale .bak files were archived and removed; git status stayed
  empty, proving only ignored files were touched. Nothing was lost - every one is
  a copy of a committed file, recoverable with git show <sha>:<path>.

## Addendum 2026-11-27 (a duplicate of something that already existed)

- D31 The CLI already provided start, stop, restart, status, logs,
  enable-autostart, disable-autostart, build, doctor and help, plus the px alias.
  Nothing was missing. A parallel scripts/portrox-service.mjs was added anyway and
  wrote a COMPETING unit to the same ~/.config/systemd/user/portrox.service path.
  Two writers to one artifact is the drift class sync-mirrors and make-og --check
  exist to prevent. The module is removed; the CLI is the single writer.
- The duplicate's unit also set Environment=PATH unquoted from the interactive
  shell. systemd splits Environment= on spaces, so the value truncated at the first
  Windows path containing a space, and the content changed between shells. The
  CLI's unit sets no PATH and uses absolute paths for node and the CLI, which is
  both simpler and correct.
- R16 When a step's output decides whether a later step should EXIST, do not put
  the later step in the same message. "Run Step 1 alone first" was written twice
  and contradicted by the same paste twice. Reading first is not reading first if
  the write ships in the same breath.
- D32 TMPDIR is inherited from another project (~/veda/.veda/tmp), so Portrox test
  fixtures were created inside a different project's tree. Releases pin
  TMPDIR=/tmp. Both gates cleaned up, so there was no residue, but isolation must
  not depend on an ambient variable owned by someone else.
- Observed, not a defect: the performance advisor fell 19 -> 18 between runs.
  apply-migration already labels it eventually consistent. No schema change.
- Scope: no Windows-side work. The user unit lives in ~/.config/systemd/user,
  which is WSL-internal and required for autostart; nothing outside WSL is touched.

## Addendum 2026-11-28 (autostart detected the wrong mechanism)

- D33 systemdUser() used `systemctl --user is-system-running`, which exits
  NON-ZERO for the state 'degraded'. Degraded means systemd IS running and an
  unrelated user unit failed - here pulseaudio.service, pulseaudio.socket and a
  transtream daphne unit. The CLI therefore reported "WSL without systemd",
  installed a .bashrc hook, and never rewrote the unit, so the removed duplicate's
  unit stayed enabled with its malformed Environment=PATH. Two autostart
  mechanisms were live at once.
- The predicate now runs `systemctl --user show-environment`, which succeeds in
  degraded state and fails only when no user manager is reachable. That is the
  property the branch actually needs. Availability, not health.
- Cleanup verified by output, not by intent: the canonical unit says
  "localhost, dynamic port", carries no Environment=PATH, and no bashrc hook
  remains. The previous turn claimed this was done when it was not.
- R17 A predicate must test the property the branch depends on. "Is the service
  healthy" and "is the service available" are different questions, and conflating
  them silently selects the wrong code path on any machine with an unrelated
  failed unit.
