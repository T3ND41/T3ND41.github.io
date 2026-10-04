/* Hanekom website -> Supabase inquiry queue.
   Only browser-safe public credentials are used here. Never add a secret or
   service-role key to this file. */
(function () {
  'use strict';

  var ENDPOINT = 'https://vpjqzatzzbbzdvlkkugg.supabase.co/functions/v1/receive-inquiry';
  var PUBLISHABLE_KEY = 'sb_publishable_Dj0UAJSAV0otlXodWDg2bQ_Zn0wf5Ls';
  var ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwanF6YXR6emJiemR2bGtrdWdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1MDY2OTEsImV4cCI6MjEwNjA4MjY5MX0.hblK53mpKVdg30nGRAKgov8H-gmcA0MXxhgWaAFiR1M';

  function value(form, id) {
    var el = form.querySelector('#' + id);
    return el ? el.value.trim() : '';
  }

  function requestKey(type) {
    var suffix = '';
    try { suffix = crypto.randomUUID(); }
    catch (e) { suffix = Math.random().toString(36).slice(2); }
    return 'web-' + type + '-' + Date.now() + '-' + suffix;
  }

  function quotationItems() {
    var basket = window.HanekomQuote && window.HanekomQuote.all
      ? window.HanekomQuote.all() : {};
    return Object.keys(basket).map(function (code) {
      var product = window.hanekomByCode ? window.hanekomByCode(code) : null;
      if (!product) return null;
      var selected = basket[code] || {};
      return {
        product_name: product.name,
        description: product.variant || '',
        quantity: Number(selected.q) || 1,
        unit: 'each',
        size: selected.s || '',
        colour: selected.c || '',
        specifications: 'Website catalogue item: ' + code
      };
    }).filter(Boolean);
  }

  function payload(form, type) {
    var isQuote = type === 'quotation';
    var preferred = (isQuote ? value(form, 'contactpref') : 'email').toLowerCase();
    if (preferred === 'phone call') preferred = 'phone';
    var items = isQuote ? quotationItems() : [];
    var details = isQuote ? value(form, 'details') : value(form, 'c-msg');
    var name = isQuote ? value(form, 'name') : value(form, 'c-name');
    var company = isQuote ? value(form, 'company') : value(form, 'c-company');
    var email = isQuote ? value(form, 'email') : value(form, 'c-email');
    var phone = isQuote ? value(form, 'phone') : value(form, 'c-phone');
    var town = isQuote ? value(form, 'town') : '';
    return {
      request_key: requestKey(type),
      source: 'website',
      inquiry_type: type,
      full_name: name,
      company_name: company,
      email: email,
      phone: phone,
      whatsapp_number: phone,
      location: town,
      delivery_location: town,
      industry: isQuote ? value(form, 'industry') : '',
      preferred_channel: preferred || 'email',
      consent_to_contact: false,
      interest: items.length
        ? 'Quotation request for ' + items.length + (items.length === 1 ? ' product' : ' products')
        : details.slice(0, 240) || 'General procurement enquiry',
      message: details,
      notes: details,
      quotation_items: items,
      currency: 'ZMW',
      notification_targets: ['google_sheets', 'email', 'whatsapp'],
      notification_email: 'sales@hanekom.co.zm',
      notification_whatsapp: '260954263566',
      website_origin: location.origin,
      page_url: location.href
    };
  }

  function status(form, kind, message) {
    var box = form.querySelector('[data-form-status]');
    if (!box) return;
    box.className = 'form-status ' + (kind || '');
    box.textContent = message;
    box.hidden = false;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var forms = document.querySelectorAll('[data-supabase-inquiry]');
    forms.forEach(function (form) {
      var type = form.getAttribute('data-supabase-inquiry') || 'general';
      var isQuote = type === 'quotation';
      var button = form.querySelector('button[type="submit"]');
      if (button) button.textContent = isQuote ? 'Send quotation request' : 'Send enquiry';
      status(form, '', 'Your request will be saved securely in the Hanekom sales queue.');

      form.addEventListener('submit', function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (!form.checkValidity()) {
        form.reportValidity();
        status(form, 'warn', 'Please complete the required fields marked with an asterisk.');
        return;
      }

      var original = button ? button.textContent : '';
      if (button) { button.disabled = true; button.textContent = 'Sending securely...'; }
      status(form, 'busy', 'Saving your quotation request...');

      fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'apikey': PUBLISHABLE_KEY,
          'Authorization': 'Bearer ' + ANON_JWT
        },
        body: JSON.stringify(payload(form, type))
      })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok || data.ok === false) {
            throw new Error(data.error || data.message || ('Request failed (' + response.status + ')'));
          }
          return data;
        });
      })
      .then(function () {
        try { if (isQuote && window.HanekomQuote) window.HanekomQuote.clear(); } catch (e) {}
        status(form, '', 'Request received. Opening the confirmation page...');
        window.location.href = 'thank-you.html';
      })
      .catch(function () {
        if (button) { button.disabled = false; button.textContent = original; }
        status(form, 'error', 'We could not save the request. Your information is still here. Please try again, or use WhatsApp or email below.');
      });
      }, true);
    });
  });
})();
