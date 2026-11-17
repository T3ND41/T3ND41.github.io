/* Hanekom website -> Supabase inquiry queue.
   Only browser-safe public credentials are used here. Never add a secret or
   service-role key to this file.
   If the queue endpoint cannot be reached (service outage, dead network), the
   visitor's typed details are offered back to them as prefilled email and
   WhatsApp backup routes, so an outage can never silently swallow an
   enquiry. */
(function () {
  'use strict';

  var ENDPOINT = 'https://vpjqzatzzbbzdvlkkugg.supabase.co/functions/v1/receive-inquiry';
  var PUBLISHABLE_KEY = 'sb_publishable_Dj0UAJSAV0otlXodWDg2bQ_Zn0wf5Ls';

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

  function submissionKey(form, type, data) {
    var signature = JSON.stringify(data);
    var storageKey = 'hanekom_pending_' + type;
    var digest = window.crypto && window.crypto.subtle
      ? window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature))
        .then(function (bytes) {
          return Array.from(new Uint8Array(bytes)).map(function (b) {
            return b.toString(16).padStart(2, '0');
          }).join('');
        }) : Promise.resolve(null);
    return digest.catch(function () { return null; }).then(function (hash) {
      var pending = form.hanekomPending;
      try {
        if (!pending && hash) pending = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      } catch (e) {}
      if (!pending || pending.signature !== (hash || signature)) {
        pending = { signature: hash || signature, key: requestKey(type) };
      }
      form.hanekomPending = pending;
      if (hash) {
        try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); } catch (e) {}
      }
      return pending.key;
    });
  }

  /* Canonical origin for every link that leaves the site in a message, so
     WhatsApp and email always point clients at hanekom.co.zm no matter which
     host is serving the page. */
  var SITE_ORIGIN = 'https://hanekom.co.zm';

  function productPageUrl(product) {
    return SITE_ORIGIN + '/' + String(product.url || '').replace(/^\//, '');
  }

  function productImageUrl(product) {
    return product.img ? SITE_ORIGIN + '/assets/cat/' + product.img + '.jpg' : '';
  }

  function quotationItems() {
    var basket = window.HanekomQuote && window.HanekomQuote.all
      ? window.HanekomQuote.all() : {};
    return Object.keys(basket).map(function (code) {
      var product = window.hanekomByCode ? window.hanekomByCode(code) : null;
      if (!product) return null;
      var selected = basket[code] || {};
      return {
        product_code: code,
        product_name: product.name,
        description: product.variant || '',
        quantity: Number(selected.q) || 1,
        unit: 'each',
        size: selected.s || '',
        colour: selected.c || '',
        selected_size: selected.s || '',
        selected_colour: selected.c || '',
        specifications: 'Website catalogue item: ' + code,
        product_url: productPageUrl(product),
        image_url: productImageUrl(product)
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
      items: items,
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

  /* ---- offline backup routes ----
     The primary path is the encrypted queue above. When it cannot be
     reached, compose the exact same request into mailto: and wa.me: links
     so one tap hands it to sales by email or WhatsApp instead. Nothing is
     sent anywhere without the visitor tapping a link, and nothing here
     stores their details beyond what the form already holds. */
  var SALES_EMAIL = 'sales@hanekom.co.zm';
  var SALES_WHATSAPP = '260954263566';

  function backupText(data) {
    var kind = data.inquiry_type === 'quotation' ? 'quotation request' : 'enquiry';
    var lines = ['Website ' + kind + ' (sent from the backup route)', ''];
    if (data.items && data.items.length) {
      lines.push('Requested items:');
      data.items.forEach(function (item) {
        var spec = [item.selected_size, item.selected_colour].filter(Boolean).join(', ');
        lines.push('- ' + item.quantity + ' x ' + item.product_name + (spec ? ' (' + spec + ')' : ''));
        if (item.product_code) lines.push('  Catalogue code: ' + item.product_code);
        if (item.product_url) lines.push('  Product page: ' + item.product_url);
        if (item.image_url) lines.push('  Photo: ' + item.image_url);
      });
      lines.push('');
    }
    if (data.full_name) lines.push('Name: ' + data.full_name);
    if (data.company_name) lines.push('Company: ' + data.company_name);
    if (data.email) lines.push('Email: ' + data.email);
    if (data.phone) lines.push('Phone / WhatsApp: ' + data.phone);
    if (data.location) lines.push('Town / delivery location: ' + data.location);
    if (data.industry) lines.push('Industry / sector: ' + data.industry);
    if (data.preferred_channel) lines.push('Preferred contact: ' + data.preferred_channel);
    if (data.message) lines.push('', 'Message:', data.message);
    return lines.join('\n');
  }

  function clearBackup(form) {
    var box = form.querySelector('[data-form-backup]');
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }

  function offerBackup(form, data) {
    var box = form.querySelector('[data-form-backup]');
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('data-form-backup', '');
      var statusBox = form.querySelector('[data-form-status]');
      if (statusBox && statusBox.parentNode) statusBox.parentNode.insertBefore(box, statusBox.nextSibling);
      else form.appendChild(box);
    }
    box.innerHTML = '';
    var text = backupText(data);
    var kind = data.inquiry_type === 'quotation' ? 'quotation request' : 'enquiry';
    var intro = document.createElement('p');
    intro.style.cssText = 'margin:.6rem 0 .5rem;font-size:.92rem;opacity:.85;';
    intro.textContent = 'Backup routes — hand the same details straight to sales if the queue stays unreachable:';
    box.appendChild(intro);
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:.6rem;';
    var mail = document.createElement('a');
    mail.className = 'btn';
    mail.href = 'mailto:' + SALES_EMAIL + '?subject=' +
      encodeURIComponent('Website ' + kind + ' — backup route') +
      '&body=' + encodeURIComponent(text);
    mail.textContent = 'Email the same details';
    var wa = document.createElement('a');
    wa.className = 'btn btn-primary';
    wa.href = 'https://wa.me/' + SALES_WHATSAPP + '?text=' + encodeURIComponent(text);
    wa.textContent = 'Send on WhatsApp';
    wa.target = '_blank';
    wa.rel = 'noopener';
    row.appendChild(mail);
    row.appendChild(wa);
    box.appendChild(row);
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

      if (form.hanekomSending) return;

      if (!form.checkValidity()) {
        form.reportValidity();
        status(form, 'warn', 'Please complete the required fields marked with an asterisk.');
        return;
      }

      var original = button ? button.textContent : '';
      form.hanekomSending = true;
      if (button) { button.disabled = true; button.textContent = 'Sending securely...'; }
      status(form, 'busy', isQuote ? 'Saving your quotation request...' : 'Saving your enquiry...');

      var data = payload(form, type);
      var trap = form.querySelector('[name="botcheck"]');
      data.website = trap && trap.checked ? 'filled' : '';
      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, 20000);
      submissionKey(form, type, data).then(function (key) {
      data.request_key = key;
      return fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'apikey': PUBLISHABLE_KEY
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok || data.ok !== true || data.processed !== true) {
            throw new Error(data.error || data.message || ('Request failed (' + response.status + ')'));
          }
          return data;
        });
      })
      .then(function (data) {
        clearTimeout(timeout);
        try {
          sessionStorage.removeItem('hanekom_pending_' + type);
          sessionStorage.setItem('hanekom_last_receipt', JSON.stringify({
            reference: data.reference_number || '', receivedAt: Date.now()
          }));
        } catch (e) {}
        form.hanekomPending = null;
        clearBackup(form);
        try { if (isQuote && window.HanekomQuote) window.HanekomQuote.clear(); } catch (e) {}
        status(form, '', 'Request received. Opening the confirmation page...');
        window.location.href = 'thank-you.html';
      })
      .catch(function () {
        clearTimeout(timeout);
        form.hanekomSending = false;
        if (button) { button.disabled = false; button.textContent = original; }
        status(form, 'error', 'We could not reach the sales queue just now — our records service may be briefly offline. Your information is still here: please press Send again in a minute, or use a backup option below so your request reaches us either way.');
        offerBackup(form, data);
      });
      }, true);
    });
  });
})();
