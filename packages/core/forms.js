/* Portrox public form handler. Insert-only; server-side RLS is the security boundary. */
(function () {
  'use strict';
  var cfg = window.PORTROX;
  if (!cfg || !cfg.url || !cfg.key) return;
  if (/^sb_(secret|service)_/.test(cfg.key)) { console.error('[portrox] secret key refused'); return; }
  var MIN_MS = 3000;
  function wire(id, kind) {
    var f = document.getElementById(id);
    if (!f) return;
    var t0 = Date.now(), busy = false;
    var st = f.querySelector('[data-status]');
    var hp = f.querySelector('input[name=honeypot]');
    function set(m, ok) { if (st) { st.textContent = m; st.className = 'status ' + (ok ? 'ok' : 'err'); } }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      if (hp && hp.value.trim() !== '') { set('Message sent — thank you!', true); f.reset(); return; }
      if (Date.now() - t0 < MIN_MS) { set('Please take a moment before sending.', false); return; }
      var fd = new FormData(f), o = { site_id: cfg.site, kind: kind };
      ['full_name','email','message','slot'].forEach(function (k) {
        var v = (fd.get(k) || '').toString().trim();
        if (v) o[k] = v;
      });
      if (!o.full_name || !o.email || !o.message) { set('Name, email and message are required.', false); return; }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email) === false) { set('Please enter a valid email.', false); return; }
      var btn = f.querySelector('button[type=submit]');
      busy = true; if (btn) btn.disabled = true; set('Sending…', true);
      var ac = new AbortController();
      var to = setTimeout(function () { ac.abort(); }, 15000);
      fetch(cfg.url + '/rest/v1/rpc/portrox_submit', {
        method: 'POST', signal: ac.signal,
        headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_site: o.site_id, p_kind: kind, p_full_name: o.full_name, p_email: o.email, p_message: o.message, p_slot: o.slot || null, p_honeypot: null })
      }).then(function (r) {
        clearTimeout(to);
        return r.json().catch(function () { return { ok: false }; }).then(function (j) {
          if (r.ok && j && j.ok) { set('Sent — thank you!', true); f.reset(); t0 = Date.now(); }
          else if (j && j.error === 'rate_limited') set('Too many requests. Please try later.', false);
          else set('Send failed. Please try later.', false);
        });
      }).catch(function (err) { clearTimeout(to); console.error('[portrox]', err); set('Network error. Please try later.', false); })
        .finally(function () { busy = false; if (btn) btn.disabled = false; });
    });
  }
  wire('contact-form', 'contact');
  /* The booking form must BOOK. It previously called portrox_submit with kind
     'booking', which only wrote a message: no appointment, no slot lock, no
     timestamp, and the whole paid-booking path was unreachable by visitors. */
  function wireBook() {
    var f = document.getElementById('book-form');
    if (!f) return;
    var t0 = Date.now(), busy = false;
    var st = f.querySelector('[data-status]');
    var hp = f.querySelector('input[name=honeypot]');
    function set(m, ok) { if (st) { st.textContent = m; st.className = 'status ' + (ok ? 'ok' : 'err'); } }
    function post(fn, body) {
      return fetch(cfg.url + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
    }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      if (hp && hp.value.trim() !== '') { set('Request sent — thank you!', true); f.reset(); return; }
      if (Date.now() - t0 < MIN_MS) { set('Please take a moment before sending.', false); return; }
      var fd = new FormData(f);
      var name = (fd.get('full_name') || '').toString().trim();
      var email = (fd.get('email') || '').toString().trim();
      var msg = (fd.get('message') || '').toString().trim() || 'Booking request';
      var raw = (fd.get('starts_at') || '').toString();
      if (!name || !email || !raw) { set('Name, email and a slot are required.', false); return; }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) === false) { set('Please enter a valid email.', false); return; }
      var when = new Date(raw);
      if (isNaN(when.getTime())) { set('Please pick a valid date and time.', false); return; }
      if (when.getTime() <= Date.now()) { set('Please pick a future slot.', false); return; }
      var btn = f.querySelector('button[type=submit]');
      busy = true; if (btn) btn.disabled = true; set('Booking…', true);
      post('portrox_book', { p_site: cfg.site, p_full_name: name, p_email: email, p_message: msg,
        p_starts_at: when.toISOString(), p_minutes: cfg.minutes || 30 })
        .then(function (j) {
          if (j && j.ok && j.appointment_id) {
            set('Booked — ' + (j.status === 'pending' ? 'awaiting payment confirmation.' : 'confirmed.'), true);
            f.reset(); t0 = Date.now();
            var box = document.getElementById('pay-ref');
            if (box) { box.hidden = false; box.setAttribute('data-appt', j.appointment_id); }
          } else if (j && j.error === 'slot_taken') set('That slot is taken. Please pick another.', false);
          else if (j && j.error === 'past_slot') set('Please pick a future slot.', false);
          else if (j && j.error === 'rate_limited') set('Too many requests. Please try later.', false);
          else set('Booking failed. Please try later.', false);
        })
        .catch(function (err) { console.error('[portrox]', err); set('Network error. Please try later.', false); })
        .finally(function () { busy = false; if (btn) btn.disabled = false; });
    });
    var send = document.getElementById('pay-ref-send');
    if (send) send.addEventListener('click', function () {
      var box = document.getElementById('pay-ref');
      var rs = box ? box.querySelector('[data-ref-status]') : null;
      var appt = box ? box.getAttribute('data-appt') : '';
      var val = (document.getElementById('pay-ref-val') || {}).value || '';
      function rset(m, ok) { if (rs) { rs.textContent = m; rs.className = 'status ' + (ok ? 'ok' : 'err'); } }
      if (!appt) { rset('Book a slot first.', false); return; }
      if (val.trim().length < 4) { rset('Enter the reference from your payment.', false); return; }
      rset('Sending…', true);
      post('portrox_payment_ref', { p_appointment: appt, p_ref: val.trim() })
        .then(function (j) {
          if (j && j.ok) rset('Reference received. The owner will verify and confirm.', true);
          else if (j && j.error === 'reference_already_submitted') rset('A reference was already sent for this booking.', false);
          else rset('Could not send the reference. Please use the contact form.', false);
        })
        .catch(function () { rset('Network error. Please try later.', false); });
    });
  }
  wireBook();
})();
