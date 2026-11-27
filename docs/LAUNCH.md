# Launch acceptance - human checks no gate can perform

Automated gates prove the machine. These prove the experience. Run before
announcing the site, and after any change to the behaviour a section covers.

The previous sign-off (commit 77553fe, 2026-11-25) is SUPERSEDED. Two reasons,
both provable from the suite output rather than opinion:

- Section 3 described "Mon-Fri 10:00-18:00 IST". That window set does not exist.
  The real rules are Mon 10:00-13:00, Wed 10:00-13:00, Fri 15:00-18:00, and they
  are now ENFORCED in SQL, not merely printed on the page.
- Section 4 was ticked for a live avatar. No image ships on any page: the content
  gate reports "all images have alt (0)" for all six pages and the media table
  holds zero rows.

Boxes marked "carried forward" were proven at 77553fe and the behaviour they
cover has not changed. Re-run them if you want a fresh record; they are labelled
so nobody mistakes them for evidence gathered at the new commit.

## 1. Custody - entirely in the Studio
No terminal command handles a secret. Settings -> Backup does all of it.
- [x] Settings -> Backup -> Generate key. Copied to the OS clipboard, NEVER
      displayed. The panel shows only a sha256 fingerprint.
- [x] Click "I saved it in my password manager". The panel reads custody confirmed.
- [ ] RE-CONFIRM: the fingerprint shown in Studio matches the entry in your
      password manager. If the key was ever replaced, the old entry decrypts
      nothing. This is the one box that protects you against a dead laptop.
- [x] Click "Back up now". The result panel ends with OFFSITE OK.
- [x] Never paste the key into a chat, ticket or screenshot. The fingerprint is
      safe to share; the key is not.

## 2. Real lead, end to end
- [x] Open https://sid200ok.github.io in a private window (carried forward)
- [x] Submit the contact form with a real message (carried forward)
- [x] Studio -> Settings -> Inbox -> Load inbox: the lead appears (carried forward)
- [x] Click read, then replied; the state persists after reload (carried forward)
- [x] Click the mailto link; your mail client opens correctly (carried forward)
- [x] Delete the test lead by typing its id; it disappears (carried forward)

## 3. Real booking - MUST RE-RUN, the behaviour changed
Pick a slot inside the REAL windows: Mon 10:00-13:00, Wed 10:00-13:00,
Fri 15:00-18:00, Asia/Kolkata, 30 minutes, starting on :00 or :30.
- [ ] Book a valid future slot. It succeeds.
- [ ] Studio -> Inbox: it appears as a booking, and the time shown is the IST
      wall clock you picked - NOT five and a half hours earlier.
- [ ] Try the SAME slot in a second window: refused, and the message tells you
      the slot is taken.
- [ ] Try Sunday 03:00: refused, and the message is readable - not a raw code
      and not a blank box.
- [ ] Try a time outside the window on a working day, e.g. Monday 09:00: refused
      with a readable message.
- [ ] Try 10:07: refused with a readable message about the time grid.
- [ ] Delete the test booking; the slot is bookable again.

## 4. Real image - the share card ships; the portrait is optional
- [x] The 1200x630 share card is generated from profile.json and ships in the
      build. verify-meta parses its PNG header and refuses a placeholder.
- [x] twitter:card is summary_large_image only because that image exists.
- [ ] Paste the homepage URL into a chat to yourself: the preview card shows the
      name, headline and site address - not an empty box.
- [ ] Open the card file directly in a browser and read it. If the wording is not
      how you want to be introduced, edit data/profile.json and re-run
      `node scripts/make-og.mjs`, then republish.
- [ ] OPTIONAL: upload a personal photo (PNG/JPEG/WebP) in Studio -> Settings ->
      Media, set as avatar, republish. Try a .svg: it must be refused.

## 5. Your own words
- [x] Studio -> Settings -> Intro -> Load defaults -> edit -> Preview (carried forward)
- [x] Preview reads like you, then Save and rebuild -> Publish (carried forward)
- [x] Live homepage: exactly one big heading, your prose below (carried forward)

## 6. Mobile and offline
- [x] Open the site on a phone: nav, forms and booking are usable (carried forward)
- [x] Turn OFF your laptop. Reload on the phone: it still works and the contact
      form still submits. This is the whole point. (carried forward)
- [ ] On the phone, try an out-of-window slot: the refusal message is readable
      on a small screen.

## 7. Reachability from another network
- [x] Someone outside your network opens the site and submits the form (carried forward)
- [x] The lead reaches your Inbox (carried forward)

## 8. Studio acceptance - the authoring surface, by hand
No gate renders this app. scripts/verify-ui.mjs proves the emitted script PARSES
and that the expected ids, tabs and endpoint calls are PRESENT in the source.
It cannot see a runtime throw, a hidden control, or a handler wired to the wrong
function. This section is the only proof that the Studio actually works.

Open the URL from `portrox status` in a browser. Press F12 and keep the Console
visible for the whole section. ANY red uncaught error is a failure - stop and
report it with the tab name and the message.

DO NOT PRESS, during acceptance: Backup -> Replace key or Clear key - GitHub ops
-> Delete repo, Disable Pages, Delete secret/variable - Intro -> Save - Content
-> Save (unless you intend the change) - Payments -> Remove. Loading is safe;
those actions mutate real state.

### 8.1 Login and shell
- [ ] The login page renders. Console clean.
- [ ] Log in with your rotated credentials. The dashboard renders. Console clean.
- [ ] The dashboard checklist shows real state: account connected, schema
      complete, 1 of 2 free projects, site bound to the project.
- [ ] Hamburger collapses and expands the sidebar. Ctrl+B does the same.
- [ ] Narrow the window to phone width: the sidebar becomes an overlay with a
      scrim, and tapping the scrim closes it.
- [ ] Nav: Dashboard, Studio, Settings, About. Each renders, and the page title
      and breadcrumb update to match.

### 8.2 Every settings tab renders
- [ ] Account, Supabase, GitHub, Security, Appearance - each renders, no console
      error, and no secret value is visible anywhere on screen.
- [ ] Project binding and GitHub ops - the repository selector lists real repos.
- [ ] Content editor - Load a file; the text appears. Do NOT Save.
- [ ] Inbox - Load inbox. It is empty (0 rows) and says so honestly rather than
      showing an error or a spinner forever.
- [ ] Media - Load. Empty list renders honestly.
- [ ] Intro - Load defaults, then Preview. The preview reads like you. Do NOT Save.
- [ ] Payments - the provider list renders; secret fields are masked; a
      server-required gateway is labelled as needing a server.
- [ ] AI provider - it shows NOT CONFIGURED, and the key field is masked.
- [ ] Backup - the sha256 fingerprint is shown, custody reads confirmed, and the
      raw key is nowhere on screen.

### 8.3 Session
- [ ] Sign out returns you to the login page.
- [ ] Pressing Back does not restore the session.
- [ ] Reloading a deep tab while signed out serves login, not the panel.

### 8.4 The one assertion that matters
- [ ] Across every step above, the browser console showed ZERO uncaught errors.

## Sign-off
Every box ticked or explicitly carried forward -> launch-ready. Record both:

    git rev-parse --short HEAD && date -u +%Y-%m-%d

Previous sign-off: SUPERSEDED (Siddhant Kumar, commit 77553fe, 2026-11-25)
Current sign-off:  ____________________  commit __________  date __________
