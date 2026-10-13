const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = { fetch: async () => ({ ok: false }), Uint8Array };
context.window = context;
vm.createContext(context);
for (const file of ['assets/js/pdf.js', 'assets/js/quote-pdf.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
}

const items = [
  { p: { name: 'Impressions 65/35 Conti Suit', variant: 'All Colours' }, v: { q: 4, s: 'M', c: 'Grey' } },
  { p: { name: 'Javlin Acid Resistant Worksuit', variant: '' }, v: { q: 5, s: 'L', c: '' } },
];

context.hanekomQuotePDF(items, { name: 'PDF layout test' }).then(result => {
  const pdf = Buffer.from(result.bytes);
  const text = pdf.toString('latin1');
  for (const label of ['Description', 'Colour', 'Unit', 'Qty', 'Grey', 'To confirm', 'Size requested: M']) {
    assert.ok(text.includes('(' + label + ') Tj'), label + ' missing from PDF');
  }
  if (process.argv[2]) {
    fs.mkdirSync(path.dirname(process.argv[2]), { recursive: true });
    fs.writeFileSync(process.argv[2], pdf);
  }
  console.log('Quotation PDF includes the separate Colour column and selected values');
}).catch(error => { console.error(error); process.exitCode = 1; });
