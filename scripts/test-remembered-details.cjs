const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('quote.html', 'utf8');
const code = html.match(/\(function rememberedCustomerDetails\(\) \{[\s\S]*?\n  \}\)\(\);/)[0];
const key = 'hanekom_quote_customer_v1';
const week = 7 * 24 * 60 * 60 * 1000;
const storage = new Map();
let now = 2000000000000;

function visit() {
  const ids = ['company', 'name', 'email', 'phone', 'town', 'industry',
    'contactpref', 'remember-details', 'clear-saved-details'];
  const els = Object.fromEntries(ids.map(id => [id, {
    value: id === 'contactpref' ? 'Email' : '', checked: true, hidden: false,
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    dispatchEvent(event) { (this.listeners[event.type] || []).forEach(fn => fn(event)); }
  }]));
  vm.runInNewContext(code, {
    document: { getElementById: id => els[id] },
    localStorage: {
      getItem: k => storage.get(k), setItem: (k, value) => storage.set(k, value),
      removeItem: k => storage.delete(k)
    },
    Date: { now: () => now }, Event: function (type) { this.type = type; }, sync() {}
  });
  return els;
}

let els = visit();
els.name.value = 'Test customer';
els.contactpref.value = 'WhatsApp';
els.name.dispatchEvent({ type: 'input' });
assert.equal(JSON.parse(storage.get(key)).lastUsedAt, now);

now += week - 1;
els = visit();
assert.equal(els.name.value, 'Test customer');
assert.equal(els.contactpref.value, 'WhatsApp');
assert.equal(JSON.parse(storage.get(key)).lastUsedAt, now, 'Revisit resets inactivity');
now += week;
els = visit();
assert.equal(els.name.value, '', 'Seven idle days expire the details');
assert.equal(storage.has(key), false);
assert.equal(els['clear-saved-details'].hidden, true);

storage.set(key, JSON.stringify({ name: 'Previously saved customer' }));
els = visit();
assert.equal(els.name.value, 'Previously saved customer');
assert.equal(JSON.parse(storage.get(key)).lastUsedAt, now, 'Legacy details get a timestamp');
els['clear-saved-details'].dispatchEvent({ type: 'click' });
assert.equal(storage.has(key), false);
assert.equal(els.name.value, '');
assert.equal(els['remember-details'].checked, false);

els = visit();
els.name.value = 'Opt-out test';
els.name.dispatchEvent({ type: 'input' });
els['remember-details'].checked = false;
els['remember-details'].dispatchEvent({ type: 'change' });
assert.equal(storage.has(key), false);
assert.equal(els.name.value, 'Opt-out test', 'Opt-out preserves current form entry');

storage.set(key, JSON.stringify({ details: { name: 'Invalid timestamp' }, lastUsedAt: now + week }));
assert.equal(visit().name.value, '');
storage.set(key, 'invalid json');
assert.equal(visit().name.value, '');
console.log('Passed: save, restore, seven-day expiry, sliding inactivity, legacy upgrade, clear, opt-out, and invalid storage.');
