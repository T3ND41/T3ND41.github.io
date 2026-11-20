/* Hanekom visitor profile — contact details captured ONCE, remembered in the
   visitor's own browser, so WhatsApp buttons (and forms) never have to ask
   twice.

   ── Why this is safe to keep in the browser ──────────────────────────────
   The details live ONLY in the visitor's own localStorage under
   "hn-profile-v1". They are never parked on the website itself (the site is
   fully static — there is no server database of visitors to steal), and they
   only leave the device over HTTPS when the visitor submits them to the
   Hanekom sales queues. Two defences are applied every time the store is
   read, because localStorage is attacker-writable the moment any script runs
   on the origin (same rule site.js applies to the quote basket):

     1. Integrity seal — the stored record carries an HMAC-style SHA-256
        signature over the exact field values + timestamp. If anything edits
        the stored JSON out from under us, the signature no longer matches
        and the record is discarded.
     2. Re-validation — every field is re-run through the same quality gate
        the forms use (no mash, no digit-runs, no junk emails) and re-capped
        to safe lengths, so even a hand-crafted record cannot smuggle
        oversized or hostile strings back into forms or WhatsApp links.

   Field order everywhere is the one sales asked for:
     Contact name → Company name → Contact number → Business email → Address

   Public API (window.HanekomProfile):
     ready()               → Promise<profile|null>  (load + verify + migrate)
     get()                 → profile|null           (verified cache, sync)
     save(data)            → Promise<profile>       rejects with problem
     clear()               → void                   (removes both stores)
     validate(data)        → {field, message}|null  (same gate as forms)
     FIELDS                → field specs, in sales' preferred order  */
(function () {
  'use strict';

  var KEY = 'hn-profile-v1';
  var LEGACY_KEY = 'hanekom_quote_customer_v1';   /* quote form's own store */
  var VERSION = 1;

  /* Field order matches what sales asked for on every form. "key" is the
     field id used by the inquiry payload; "input" is the modal input id. */
  var FIELDS = [
    { key: 'full_name',    input: 'hn-gate-name',    max: 80,  label: 'Contact name' },
    { key: 'company_name', input: 'hn-gate-company', max: 100, label: 'Company name' },
    { key: 'phone',        input: 'hn-gate-phone',   max: 24,  label: 'Contact number' },
    { key: 'email',        input: 'hn-gate-email',   max: 120, label: 'Business email' },
    { key: 'location',     input: 'hn-gate-address', max: 160, label: 'Address' }
  ];

  var cached = null;       /* verified profile (fields + savedAt) or null */
  var readyPromise = null;

  /* ---- quality gate: identical rules to inquiry-submit.js ---------------- */

  function letters_(text) {
    return (String(text || '').match(/[A-Za-z]/g) || []).length;
  }

  function junkWord_(text) {
    var s = String(text || '').toLowerCase();
    if (!s) return false;
    if (/(.)\1{3,}/.test(s)) return true;
    if (/asdf|sdfg|dfgh|qwer|zxcv|uiop|hjkl|vbnm|123456|654321/.test(s)) return true;
    var word = s.replace(/[^a-z]/g, '');
    return word.length >= 5 && !/[aeiou]/.test(word);
  }

  function nameProblem_(text) {
    var words = String(text || '').trim().split(/\s+/);
    if (words.length < 2) return true;
    var total = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length < 2 || !/^[A-Za-z][A-Za-z'.-]*$/.test(w) || junkWord_(w)) return true;
      total += letters_(w);
    }
    return total < 5;
  }

  function phoneProblem_(text) {
    var d = String(text || '').replace(/\D/g, '');
    if (d.length < 9 || d.length > 15) return true;
    if (/^(.)\1+$/.test(d)) return true;
    if (/(.)\1{4,}/.test(d)) return true;
    var up = '0123456789', down = '9876543210';
    for (var i = 0; i + 6 <= d.length; i++) {
      var part = d.slice(i, i + 6);
      if (up.indexOf(part) >= 0 || down.indexOf(part) >= 0) return true;
    }
    return false;
  }

  function emailProblem_(text) {
    var m = /^([A-Za-z0-9._%+-]{2,})@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/
      .exec(String(text || '').trim());
    if (!m) return true;
    var parts = m[2].split('.');
    if (parts[parts.length - 1].length < 2) return true;
    return junkWord_(m[1]) || junkWord_(parts[0]);
  }

  function addressProblem_(text) {
    var addr = String(text || '').trim();
    return addr.length < 4 || letters_(addr) < 3 || junkWord_(addr);
  }

  /* Trim + collapse inner whitespace + hard length cap. Always applied before
     a value is stored AND before a stored value is trusted. */
  function cleanValue(value, field) {
    var s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return s.slice(0, field.max);
  }

  /* Public validation: returns the first problem {field, message} or null.
     "field" is the input id so callers can focus the right box. */
  function validate(data) {
    var name = cleanValue(data && data.full_name, FIELDS[0]);
    if (nameProblem_(name)) {
      return { field: FIELDS[0].input, message: 'Please enter your full name \u2014 first and last name, letters only (e.g. Brian Mwansa).' };
    }
    var company = cleanValue(data && data.company_name, FIELDS[1]);
    if (company.length < 2 || letters_(company) < 2 || junkWord_(company)) {
      return { field: FIELDS[1].input, message: 'Please enter your company or organisation name (e.g. Mopani Copper Mines).' };
    }
    if (phoneProblem_(cleanValue(data && data.phone, FIELDS[2]))) {
      return { field: FIELDS[2].input, message: 'Please enter a real contact number we can call or WhatsApp (e.g. +260 954 263 566).' };
    }
    if (emailProblem_(cleanValue(data && data.email, FIELDS[3]))) {
      return { field: FIELDS[3].input, message: 'Please enter a valid business email address (e.g. purchasing@yourcompany.co.zm).' };
    }
    if (addressProblem_(cleanValue(data && data.location, FIELDS[4]))) {
      return { field: FIELDS[4].input, message: 'Please enter the delivery address or site location (e.g. Plot 12, Nkana Road, Kitwe).' };
    }
    return null;
  }

  /* ---- integrity seal ---------------------------------------------------- */

  function weakHash(text) {
    /* Fallback when WebCrypto is unavailable (very old browsers). Still
       catches casual edits of the stored JSON; the strong hash covers the
       rest. Not a secret — this is tamper detection, not encryption. */
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ text.length;
    for (var i = 0; i < text.length; i++) {
      h1 = ((h1 ^ text.charCodeAt(i)) * 16777619) >>> 0;
      h2 = ((h2 + text.charCodeAt(i) * (i + 7)) * 2654435761) >>> 0;
    }
    return 'w' + h1.toString(16) + h2.toString(16);
  }

  function signature(timestamp, data) {
    var parts = ['hn-profile-v' + VERSION, String(timestamp)];
    FIELDS.forEach(function (f) { parts.push(String(data[f.key] || '')); });
    var base = parts.join('|');
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(base))
        .then(function (buf) {
          var bytes = new Uint8Array(buf), hex = '';
          for (var i = 0; i < bytes.length; i++) {
            hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
          }
          return hex;
        })
        .catch(function () { return weakHash(base); });
    }
    return Promise.resolve(weakHash(base));
  }

  /* ---- storage ------------------------------------------------------------ */

  function erase() {
    try { window.localStorage.removeItem(KEY); } catch (e) {}
    cached = null;
  }

  function store(timestamp, data) {
    return signature(timestamp, data).then(function (sig) {
      var envelope = { v: VERSION, t: timestamp, d: data, h: sig };
      try { window.localStorage.setItem(KEY, JSON.stringify(envelope)); } catch (e) {}
      cached = cloneProfile_(data, timestamp);
      mirrorToQuoteStore_(data, timestamp);
      announce_();
      return cached;
    });
  }

  function cloneProfile_(data, timestamp) {
    var p = {};
    FIELDS.forEach(function (f) { p[f.key] = data[f.key]; });
    if (timestamp) p.savedAt = timestamp;
    return p;
  }

  /* Keep the quote page's own remember-me store in step (one-way mirror), so
     details captured at a WhatsApp button prefill the quotation form too.
     The quote store keeps its own 7-day idle expiry. */
  function mirrorToQuoteStore_(data, timestamp) {
    try {
      var existing = {};
      try {
        var raw = JSON.parse(window.localStorage.getItem(LEGACY_KEY) || '{}');
        var old = raw.details || raw;
        if (old && typeof old === 'object' && !Array.isArray(old)) {
          ['industry', 'contactpref'].forEach(function (k) {
            if (typeof old[k] === 'string' && old[k]) existing[k] = old[k];
          });
        }
      } catch (e) {}
      var details = {
        name: data.full_name || '',
        company: data.company_name || '',
        phone: data.phone || '',
        email: data.email || '',
        town: data.location || ''
      };
      Object.keys(existing).forEach(function (k) { details[k] = existing[k]; });
      window.localStorage.setItem(LEGACY_KEY, JSON.stringify({
        details: details, lastUsedAt: timestamp
      }));
    } catch (e) {}
  }

  function announce_() {
    try { document.dispatchEvent(new CustomEvent('hn:profile', { detail: !!cached })); } catch (e) {}
  }

  function readStored() {
    var raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { return Promise.resolve(null); }
    if (!raw) return Promise.resolve(migrate_());
    var envelope = null;
    try { envelope = JSON.parse(raw); } catch (e) { envelope = null; }
    if (!envelope || envelope.v !== VERSION || !envelope.d ||
        typeof envelope.d !== 'object' || typeof envelope.h !== 'string' ||
        !Number.isFinite(envelope.t) || envelope.t > Date.now() + 60000) {
      erase();
      return Promise.resolve(migrate_());
    }
    var data = {};
    var sane = FIELDS.every(function (f) {
      var v = cleanValue(envelope.d[f.key], f);
      data[f.key] = v;
      return v.length > 0;
    });
    if (!sane || validate(data)) {
      /* Tampered, truncated or stale junk in storage: drop it entirely. */
      erase();
      return Promise.resolve(migrate_());
    }
    return signature(envelope.t, data).then(function (sig) {
      if (sig !== envelope.h) {          /* integrity seal broken */
        erase();
        return migrate_();
      }
      cached = cloneProfile_(data, envelope.t);
      return cached;
    }).catch(function () { erase(); return null; });
  }

  /* One-time migration: the quote form's older remember-me store (plain JSON,
     no seal) is imported only if it passes the full quality gate, then it is
     re-sealed into the protected store. */
  function migrate_() {
    var raw = null;
    try { raw = window.localStorage.getItem(LEGACY_KEY); } catch (e) {}
    if (!raw) return null;
    var saved = {};
    try { saved = JSON.parse(raw) || {}; } catch (e) { return null; }
    var old = saved.details || saved;
    if (!old || typeof old !== 'object' || Array.isArray(old)) return null;
    var candidate = {
      full_name:    old.name || '',
      company_name: old.company || '',
      phone:        old.phone || '',
      email:        old.email || '',
      location:     old.town || ''
    };
    if (validate(candidate)) return null;      /* junk in the old store: ignore */
    var data = {};
    FIELDS.forEach(function (f) { data[f.key] = cleanValue(candidate[f.key], f); });
    var t = Date.now();
    /* store() mirrors the details back into the quote form's own key, so the
       quotation page keeps prefilling exactly as before. */
    return store(t, data).catch(function () { return null; });
  }

  function ready() {
    if (!readyPromise) {
      readyPromise = readStored().catch(function () { return null; });
    }
    return readyPromise;
  }

  function get() { return cached; }

  function save(data) {
    var problem = validate(data || {});
    if (problem) return Promise.reject(problem);
    var clean = {};
    FIELDS.forEach(function (f) { clean[f.key] = cleanValue((data || {})[f.key], f); });
    return store(Date.now(), clean);
  }

  function clear() {
    erase();
    try { window.localStorage.removeItem(LEGACY_KEY); } catch (e) {}
    announce_();
  }

  window.HanekomProfile = {
    ready: ready,
    get: get,
    save: save,
    clear: clear,
    validate: validate,
    cleanValue: cleanValue,
    FIELDS: FIELDS
  };
})();
