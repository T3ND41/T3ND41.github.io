/* Hanekom WhatsApp gate — details once, remembered forever (per device).

   Every WhatsApp button used to jump straight to wa.me, so a visitor could
   reach sales without their contact details ever reaching the quote queues,
   the Google Sheet or the sales inbox. This gate closes that hole:

     1. First WhatsApp click (no saved details) → a small form asks for
        Contact name → Company name → Contact number → Business email →
        Address. The same junk filter as the quote/contact forms blocks
        "asdf", "111111111", "aaaa@aaa.aa" and friends.
     2. Saved details are sealed with an integrity signature and re-validated
        on every read (see profile.js) — stored only in the visitor's own
        browser, never on the website server, so there is no central store of
        visitor details to steal.
     3. The details are pushed into the SAME data-collection pipeline as the
        forms (legacy Supabase queue → new Supabase queue → quote-bridge
        worker → Apps Script email + Google Sheet relay), fire-and-forget, so
        a WhatsApp lead is never invisible to sales.
     4. Every later WhatsApp click (even days later, on any page) carries the
        saved details appended to the message text, and the visitor is never
        asked again. There is no way to reach WhatsApp without saving the
        details first — closing the form (X / Esc / backdrop) simply cancels
        the WhatsApp action, so no chat can start anonymously.

   The Apps Script relay is switched on in ONE place — the HANEKOM_RELAY
   constant below (inquiry-submit.js reads the same values, so filling this
   in lights up the Google Sheet + email copy for forms AND WhatsApp leads). */
(function () {
  'use strict';

  /* ---- endpoints (browser-safe public keys only, same as inquiry-submit.js) */
  var PRIMARY_URL = 'https://kqcnyewlkludlvtocsze.supabase.co/rest/v1/inquiry_queue';
  var PRIMARY_KEY = 'sb_publishable_SA0fWl1XxGtoHm8x5FKMBw_BiObT-rN';
  var FALLBACK_URL = 'https://vpjqzatzzbbzdvlkkugg.supabase.co/functions/v1/receive-inquiry';
  var FALLBACK_KEY = 'sb_publishable_Dj0UAJSAV0otlXodWDg2bQ_Zn0wf5Ls';
  var BRIDGE_URL = 'https://hanekom-quote-bridge.hanekominnovationsltd.workers.dev';
  /* Single switch for the Google Sheet + email relay (see header comment). */
  window.HANEKOM_RELAY = { url: '', token: '' };

  var overlay = null, card = null, form = null, statusBox = null;
  var pendingAnchor = null, lastTrigger = null, keyHandler = null;

  function profileApi() { return window.HanekomProfile || null; }

  /* ---- WhatsApp URL handling --------------------------------------------- */

  function identityBlock(p) {
    return '\u2014 Contact details (saved on hanekom.co.zm) \u2014\n' +
      'Name: ' + p.full_name + '\n' +
      'Company: ' + p.company_name + '\n' +
      'Number: ' + p.phone + '\n' +
      'Email: ' + p.email + '\n' +
      'Address: ' + p.location;
  }

  /* Appends the saved identity block to the link's prefilled text. Values are
     already whitespace-collapsed and length-capped by the profile store, and
     encodeURIComponent is applied last, so nothing can break out of the
     message body into the URL. */
  function signedHref(a, p) {
    var raw = a.getAttribute('href') || '';
    if (raw.indexOf('data-hn-signed') > -1 || a.getAttribute('data-hn-signed') === '1') return raw;
    var match = /[?&]text=([^&]*)/.exec(raw);
    var base = '';
    if (match) {
      try { base = decodeURIComponent(match[1]); }
      catch (e) { base = match[1]; }
    }
    var text = (base ? base + '\n\n' : 'Hello Hanekom, I have an enquiry.\n\n') + identityBlock(p);
    var encoded = encodeURIComponent(text);
    var next = match
      ? raw.replace(/([?&])text=[^&]*/, '$1text=' + encoded)
      : raw + (raw.indexOf('?') > -1 ? '&' : '?') + 'text=' + encoded;
    a.setAttribute('data-hn-signed', '1');
    a.setAttribute('href', next);
    return next;
  }

  /* ---- one-time lead capture into the data pipeline ----------------------- */

  function requestKey() {
    var suffix = '';
    try { suffix = crypto.randomUUID(); }
    catch (e) { suffix = Math.random().toString(36).slice(2); }
    return 'web-walead-' + Date.now() + '-' + suffix;
  }

  function leadPayload(data, key) {
    return {
      request_key: key,
      source: 'website',
      inquiry_type: 'general',
      full_name: data.full_name,
      company_name: data.company_name,
      email: data.email,
      phone: data.phone,
      whatsapp_number: data.phone,
      location: data.location,
      delivery_location: data.location,
      industry: '',
      preferred_channel: 'whatsapp',
      consent_to_contact: false,
      interest: 'WhatsApp lead \u2014 contact details captured once before the visitor continued to WhatsApp',
      message: 'Visitor saved their contact details at a WhatsApp button. Their product questions continue in the WhatsApp chat; these details identify them.',
      notes: '',
      items: [],
      quotation_items: [],
      currency: 'ZMW',
      notification_targets: ['google_sheets', 'email', 'whatsapp'],
      notification_email: 'sales@hanekom.co.zm, hanekominnovationsltd@gmail.com',
      notification_emails: ['sales@hanekom.co.zm', 'hanekominnovationsltd@gmail.com'],
      notification_whatsapp: '260954263566',
      website_origin: location.origin,
      page_url: location.href
    };
  }

  function captureLead(data) {
    var key = requestKey();
    /* Google Sheet + sales email relay (when switched on). text/plain keeps
       it a CORS "simple request" — Apps Script cannot answer preflights. */
    var relay = window.HANEKOM_RELAY || {};
    if (relay.url && relay.token) {
      try {
        fetch(relay.url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          keepalive: true,
          body: JSON.stringify({
            type: 'email_notification',
            token: relay.token,
            request_key: key,
            enquiry: {
              inquiry_type: 'general',
              full_name: data.full_name,
              company_name: data.company_name,
              email: data.email,
              phone: data.phone,
              location: data.location,
              industry: '',
              preferred_channel: 'whatsapp',
              message: leadPayload(data, key).message,
              currency: 'ZMW',
              items: [],
              page_url: location.href
            }
          })
        }).catch(function () {});
      } catch (e) {}
    }
    /* Quote-bridge worker: independent third copy, survives Supabase outages. */
    try {
      fetch(BRIDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          company: data.company_name || 'Not provided',
          contact: data.full_name || 'Not provided',
          email: data.email || 'Not provided',
          phone: data.phone || 'Not provided',
          town: data.location || 'Not provided',
          industry: 'Not provided'
        })
      }).catch(function () {});
    } catch (e) {}
    /* Legacy queue (live today) — the durable home of the lead. */
    try {
      fetch(FALLBACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'apikey': FALLBACK_KEY },
        body: JSON.stringify(leadPayload(data, key))
      }).catch(function () {});
    } catch (e) {}
    /* New project queue (lights up once its schema is applied). */
    try {
      fetch(PRIMARY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': PRIMARY_KEY,
          'Authorization': 'Bearer ' + PRIMARY_KEY,
          'x-request-key': key,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          request_key: key,
          source: 'website',
          inquiry_type: 'general',
          payload: leadPayload(data, key)
        })
      }).catch(function () {});
    } catch (e) {}
  }

  /* ---- modal --------------------------------------------------------------- */

  var FIELD_ORDER = ['hn-gate-name', 'hn-gate-company', 'hn-gate-phone', 'hn-gate-email', 'hn-gate-address'];
  var FIELD_META = {
    'hn-gate-name':    { key: 'full_name',    label: 'Contact name',    type: 'text',  auto: 'name',           ph: 'e.g. Brian Mwansa' },
    'hn-gate-company': { key: 'company_name', label: 'Company name',    type: 'text',  auto: 'organization',   ph: 'e.g. Mopani Copper Mines' },
    'hn-gate-phone':   { key: 'phone',        label: 'Contact number',  type: 'tel',   auto: 'tel',            ph: '+260 954 263 566' },
    'hn-gate-email':   { key: 'email',        label: 'Business email',  type: 'email', auto: 'email',          ph: 'purchasing@yourcompany.co.zm' },
    'hn-gate-address': { key: 'location',     label: 'Address',         type: 'text',  auto: 'street-address', ph: 'e.g. Plot 12, Nkana Road, Kitwe' }
  };

  function buildModal() {
    overlay = document.createElement('div');
    overlay.className = 'hn-gate-overlay';
    overlay.hidden = true;

    card = document.createElement('div');
    card.className = 'hn-gate-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'hn-gate-title');
    card.setAttribute('aria-describedby', 'hn-gate-lead');

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'hn-gate-x';
    close.setAttribute('aria-label', 'Close without continuing');
    close.innerHTML = '&times;';
    close.addEventListener('click', function () { closeModal(); });
    card.appendChild(close);

    var title = document.createElement('h2');
    title.className = 'hn-gate-title';
    title.id = 'hn-gate-title';
    title.textContent = 'One quick step before WhatsApp';
    card.appendChild(title);

    var lead = document.createElement('p');
    lead.className = 'hn-gate-lead';
    lead.id = 'hn-gate-lead';
    lead.textContent = 'Save your details once and we\u2019ll remember you on this device \u2014 every WhatsApp message you send us will carry your name and contact details, and you\u2019ll never be asked again. This is the only step between you and WhatsApp.';
    card.appendChild(lead);

    form = document.createElement('form');
    form.id = 'hn-gate-form';
    form.noValidate = true;

    /* Honeypot: invisible to people, catnip to form-filling bots. */
    var hp = document.createElement('input');
    hp.type = 'checkbox';
    hp.name = 'botcheck';
    hp.className = 'hp';
    hp.tabIndex = -1;
    hp.setAttribute('autocomplete', 'off');
    hp.setAttribute('aria-hidden', 'true');
    form.appendChild(hp);

    FIELD_ORDER.forEach(function (id) {
      var meta = FIELD_META[id];
      var wrap = document.createElement('div');
      wrap.className = 'hn-gate-field';
      var label = document.createElement('label');
      label.setAttribute('for', id);
      label.innerHTML = meta.label + ' <span class="req">*</span>';
      var input = document.createElement('input');
      input.type = meta.type;
      input.id = id;
      input.name = meta.label;
      input.required = true;
      input.setAttribute('autocomplete', meta.auto);
      input.setAttribute('placeholder', meta.ph);
      input.setAttribute('maxlength', id === 'hn-gate-address' ? 160 : (id === 'hn-gate-email' ? 120 : (id === 'hn-gate-company' ? 100 : 80)));
      input.setAttribute('aria-describedby', id + '-err');
      input.addEventListener('input', function () {
        input.removeAttribute('aria-invalid');
        var err = document.getElementById(id + '-err');
        if (err) { err.textContent = ''; err.classList.remove('on'); }
      });
      var err = document.createElement('span');
      err.className = 'hn-gate-err';
      err.id = id + '-err';
      err.setAttribute('role', 'alert');
      wrap.appendChild(label);
      wrap.appendChild(input);
      wrap.appendChild(err);
      form.appendChild(wrap);
    });

    statusBox = document.createElement('p');
    statusBox.className = 'hn-gate-note';
    statusBox.textContent = 'Your details are stored only in this browser \u2014 never on our website \u2014 and are sent only to Hanekom sales. See our privacy notice.';
    var privLink = document.createElement('a');
    privLink.href = 'privacy.html';
    privLink.textContent = 'privacy notice';
    privLink.addEventListener('click', function () { closeModal(true); });
    statusBox.appendChild(document.createTextNode(' '));
    statusBox.appendChild(privLink);
    form.appendChild(statusBox);

    var actions = document.createElement('div');
    actions.className = 'hn-gate-actions';
    var go = document.createElement('button');
    go.type = 'submit';
    go.className = 'btn btn-primary';
    go.textContent = 'Save & continue to WhatsApp';
    /* No skip button by design: sales must be able to connect every WhatsApp
       conversation to a real contact. The X / Esc / backdrop close cancels
       the WhatsApp action entirely — the only way through is saving once. */
    actions.appendChild(go);
    form.appendChild(actions);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      onSubmit();
    });

    card.appendChild(form);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeModal();   /* backdrop tap = dismiss */
    });
  }

  function setProblem(input, message) {
    input.setAttribute('aria-invalid', 'true');
    var err = document.getElementById(input.id + '-err');
    if (err) { err.textContent = message; err.classList.add('on'); }
    try { input.focus(); } catch (e) {}
  }

  function collect() {
    var api = profileApi();
    var data = {};
    FIELD_ORDER.forEach(function (id) {
      var meta = FIELD_META[id];
      data[meta.key] = api && api.cleanValue
        ? api.cleanValue(document.getElementById(id).value, { max: id === 'hn-gate-address' ? 160 : (id === 'hn-gate-email' ? 120 : (id === 'hn-gate-company' ? 100 : 80)) })
        : document.getElementById(id).value.trim();
    });
    return data;
  }

  function onSubmit() {
    var api = profileApi();
    if (!api || !form) return;
    var hp = form.querySelector('input[name="botcheck"]');
    if (hp && hp.checked) { closeModal(); return; }   /* bot: fake success */
    var data = collect();
    var problem = api.validate(data);
    if (problem) {
      var input = document.getElementById(problem.field);
      if (input) setProblem(input, problem.message);
      return;
    }
    var go = form.querySelector('button[type="submit"]');
    if (go) { go.disabled = true; go.textContent = 'Saving\u2026'; }
    api.save(data).then(function (profile) {
      captureLead(data);
      var href = pendingAnchor ? signedHref(pendingAnchor, profile) : null;
      closeModal();
      if (href) window.open(href, '_blank', 'noopener');
      if (go) { go.disabled = false; go.textContent = 'Save & continue to WhatsApp'; }
    }).catch(function (problem2) {
      if (go) { go.disabled = false; go.textContent = 'Save & continue to WhatsApp'; }
      var input = problem2 && problem2.field ? document.getElementById(problem2.field) : null;
      if (input && problem2.message) setProblem(input, problem2.message);
    });
  }

  /* If the visitor has already typed their details into a form on this page
     (quote or contact), carry them into the gate so they only confirm. */
  var PAGE_FIELD_SOURCES = {
    'hn-gate-name':    ['name', 'c-name'],
    'hn-gate-company': ['company', 'c-company'],
    'hn-gate-phone':   ['phone', 'c-phone'],
    'hn-gate-email':   ['email', 'c-email'],
    'hn-gate-address': ['town', 'c-town']
  };

  function prefillFromPage() {
    FIELD_ORDER.forEach(function (id) {
      var input = document.getElementById(id);
      if (!input || input.value) return;
      var sources = PAGE_FIELD_SOURCES[id] || [];
      for (var i = 0; i < sources.length; i++) {
        var el = document.getElementById(sources[i]);
        if (el && typeof el.value === 'string' && el.value.trim()) {
          input.value = el.value.trim();
          break;
        }
      }
    });
  }

  function openModal(anchor) {
    if (!overlay) buildModal();
    pendingAnchor = anchor;
    lastTrigger = document.activeElement;
    overlay.hidden = false;
    document.documentElement.classList.add('hn-gate-lock');
    prefillFromPage();
    /* Focus the first field still empty (or the button when all filled). */
    var focusTarget = null;
    for (var i = 0; i < FIELD_ORDER.length; i++) {
      var input = document.getElementById(FIELD_ORDER[i]);
      if (input && !input.value) { focusTarget = input; break; }
    }
    if (!focusTarget) focusTarget = form.querySelector('button[type="submit"]') || card;
    try { focusTarget.focus(); } catch (e) {}
    keyHandler = function (event) {
      if (event.key === 'Escape') { event.preventDefault(); closeModal(); return; }
      if (event.key === 'Tab') {
        var focusable = card.querySelectorAll('input:not([type="checkbox"]), button:not([disabled]), a[href]');
        if (!focusable.length) return;
        var first2 = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first2 || !card.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !card.contains(document.activeElement))) {
          event.preventDefault(); first2.focus();
        }
      }
    };
    document.addEventListener('keydown', keyHandler, true);
  }

  function closeModal(keepFocus) {
    if (!overlay) return;
    overlay.hidden = true;
    document.documentElement.classList.remove('hn-gate-lock');
    if (keyHandler) { document.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
    pendingAnchor = null;
    if (form) form.reset();
    FIELD_ORDER.forEach(function (id) {
      var input = document.getElementById(id);
      if (input) input.removeAttribute('aria-invalid');
      var err = document.getElementById(id + '-err');
      if (err) { err.textContent = ''; err.classList.remove('on'); }
    });
    if (!keepFocus && lastTrigger && lastTrigger.focus) {
      try { lastTrigger.focus(); } catch (e) {}
    }
    lastTrigger = null;
  }

  /* ---- the gate: one capture-phase listener covers every WhatsApp link,
         including links built later by site.js (quote backup routes, the
         bottom nav, product cards) ----------------------------------------- */

  profileApi() && profileApi().ready();

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var a = target.closest('a[href*="wa.me"]');
    if (!a) return;
    var api = profileApi();
    var p = api ? api.get() : null;
    if (p) {
      /* Remembered visitor: stamp the identity block onto the message and let
         the click continue untouched. */
      signedHref(a, p);
      return;
    }
    /* First-timer: hold the navigation, ask for details once. */
    event.preventDefault();
    event.stopPropagation();
    openModal(a);
  }, true);
})();
