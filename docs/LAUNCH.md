# Launch acceptance — human checks no gate can perform

Automated gates prove the machine. These prove the experience. Run once before
announcing the site, and after any major change.

## 1. Custody (do this first) - entirely in the Studio
No terminal command handles a secret. Settings -> Backup does all of it.
- [ ] Settings -> Backup -> Generate key. It is copied to your OS clipboard and
      NEVER displayed. The panel shows only a sha256 fingerprint.
- [ ] Paste into your password manager as "Portrox offsite backup key". Save.
- [ ] Click "I saved it in my password manager". The panel must read custody
      confirmed. Without this, a dead machine means undecryptable bundles.
- [ ] Click "Back up now". The result panel must end with OFFSITE OK.
- [ ] Never paste the key into a chat, ticket or screenshot. The fingerprint is
      safe to share; the key is not.

## 2. Real lead, end to end
- [ ] Open https://sid200ok.github.io in a private window
- [ ] Submit the contact form with a real message
- [ ] Studio -> Settings -> Inbox -> Load inbox: the lead appears
- [ ] Click `read`, then `replied`; the state persists after reload
- [ ] Click the mailto link; your mail client opens with the right address
- [ ] Delete the test lead by typing its id; confirm it disappears

## 3. Real booking
- [ ] On /book.html pick a future slot inside Mon-Fri 10:00-18:00 IST
- [ ] Confirm it appears in the Inbox as a `booking` with the right time
- [ ] Try the SAME slot again in a second window: it must be refused
- [ ] Delete the test booking; confirm the slot is bookable again

## 4. Real image
- [ ] Studio -> Settings -> Media -> upload a real photo (PNG/JPEG/WebP)
- [ ] Set as avatar, then Studio -> your site -> Publish. Publishing re-renders,
      so the avatar ships without a separate build step.
- [ ] Reload the live site: the avatar renders
- [ ] Try uploading a .svg: it must be refused

## 5. Your own words
- [ ] Studio -> Settings -> Intro -> Load defaults -> edit -> Preview
- [ ] Confirm the preview reads like you, then Save and rebuild -> Publish
- [ ] Reload the live homepage: exactly one big heading, your prose below

## 6. Mobile and offline
- [ ] Open the site on a phone: nav, forms and booking are usable
- [ ] Turn OFF your laptop. Reload the site on the phone: it still works,
      and the contact form still submits. This is the whole point.

## 7. Reachability from another network
- [ ] Ask someone outside your network to open the site and submit the form
- [ ] Confirm the lead reaches your Inbox

## Sign-off
All boxes ticked -> the site is launch-ready. Record both:

    git rev-parse --short HEAD && date -u +%Y-%m-%d

Signed off: ____________________  commit ____________  date ____________
