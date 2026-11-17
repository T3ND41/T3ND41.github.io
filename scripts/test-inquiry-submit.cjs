const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync('assets/js/inquiry-submit.js', 'utf8');
const storage = new Map();
const requests = [];
const urls = [];

function fakeElement(tag) {
  return {
    tagName: tag, style: {}, children: [], parentNode: null,
    setAttribute() {},
    appendChild(child) { this.children.push(child); if (child) child.parentNode = this; },
    removeChild(child) { this.children = this.children.filter(c => c !== child); }
  };
}

function visit(response) {
  const listeners = {};
  const fields = Object.fromEntries(Object.entries({
    name: 'Test customer', company: 'Test company', email: 'test@example.invalid',
    phone: '+260999111222', town: 'Kitwe', industry: 'Mining',
    details: 'Custom requirements', contactpref: 'Email'
  }).map(([key, value]) => [key, { value }]));
  const button = { textContent: '', disabled: false };
  const box = {};
  const form = {
    querySelector(selector) {
      if (selector[0] === '#') return fields[selector.slice(1)];
      if (selector === '[data-form-status]') return box;
      if (selector === 'button[type="submit"]') return button;
      return null;
    },
    getAttribute() { return 'quotation'; }, checkValidity() { return true; },
    addEventListener(type, callback) { listeners[type] = callback; },
    appendChild() {}
  };
  let cleared = 0;
  const location = { origin: 'https://hanekom.co.zm', href: 'https://hanekom.co.zm/quote.html' };
  const context = {
    window: { crypto: webcrypto, location, HanekomQuote: { all: () => ({}), clear() { cleared++; } } },
    location, crypto: webcrypto, TextEncoder, AbortController, setTimeout, clearTimeout,
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: {
      addEventListener(type, callback) { callback(); }, querySelectorAll: () => [form],
      createElement: tag => fakeElement(tag)
    },
    fetch: async (url, options) => { urls.push(String(url)); requests.push(JSON.parse(options.body)); return response(); }
  };
  vm.runInNewContext(source, context);
  return {
    fields, box, form, location,
    get cleared() { return cleared; },
    submit() { listeners.submit({ preventDefault() {}, stopImmediatePropagation() {} }); }
  };
}

async function settled(page) {
  for (let i = 0; i < 100; i++) {
    if (!page.form.hanekomSending || page.location.href === 'thank-you.html') return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Submission did not settle');
}

(async () => {
  const lostResponse = () => { throw new Error('Connection lost after server save'); };
  let page = visit(lostResponse);
  page.submit(); page.submit(); await settled(page);
  /* One submission runs the whole sink chain once: primary REST queue first,
     then the legacy edge function. The double click must not add a second run. */
  assert.equal(requests.length, 2, 'Double clicks must run the sink chain once');
  assert.equal(urls.length, 2);
  assert(urls[0].includes('kqcnyewlkludlvtocsze'), 'Primary attempt must hit the new project first');
  assert(urls[1].includes('receive-inquiry'), 'Second attempt must hit the legacy queue');
  const originalKey = requests[0].request_key;
  assert.equal(requests[1].request_key, originalKey, 'Both sinks must carry the same request key');
  assert.equal(page.cleared, 0);
  assert.equal(page.fields.name.value, 'Test customer');
  assert(!Array.from(storage.values()).some(value => value.includes('test@example.invalid')), 'Pending storage must contain only hash and key');

  page = visit(lostResponse); page.submit(); await settled(page);
  assert.equal(requests[2].request_key, originalKey, 'Reloaded retry must reuse key');
  page.fields.details.value = 'Changed requirement'; page.submit(); await settled(page);
  assert.notEqual(requests[4].request_key, originalKey, 'Changed enquiry needs a new key');

  page = visit(() => ({ ok: true, json: async () => ({}) })); page.submit(); await settled(page);
  assert.equal(page.cleared, 0, 'Malformed success must not clear the basket');
  assert.equal(page.box.className, 'form-status error');

  page = visit(() => ({ ok: true, json: async () => ({ ok: true, processed: true, reference_number: 'HIL-TEST' }) }));
  page.submit(); await settled(page);
  assert.equal(page.cleared, 1);
  assert.equal(page.location.href, 'thank-you.html');
  assert.equal(storage.has('hanekom_pending_quotation'), false);
  assert.equal(JSON.parse(storage.get('hanekom_last_receipt')).reference, 'HIL-TEST');
  console.log('Passed: duplicate click, sink chain order, lost response, reload retry, changed request, invalid response, and confirmation reference.');
})().catch(error => { console.error(error); process.exitCode = 1; });
