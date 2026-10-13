const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const logo = fs.readFileSync('assets/img/logo-pdf.jpg');
const context = {
  window: {}, Uint8Array, TextEncoder,
  fetch: async () => ({ ok: true, arrayBuffer: async () =>
    logo.buffer.slice(logo.byteOffset, logo.byteOffset + logo.byteLength) })
};
vm.createContext(context);
for (const file of ['config.js', 'products.js', 'pdf.js', 'quote-pdf.js']) {
  vm.runInContext(fs.readFileSync('assets/js/' + file, 'utf8'), context);
}

(async () => {
  const products = context.window.HANEKOM_PRODUCTS;
  const p = code => products.find(product => product.code === code);
  const result = await context.window.hanekomQuotePDF([
    { p: p('P01'), v: { q: 10, s: 'L', c: 'Navy blue' } },
    { p: p('P06'), v: { q: 5, s: 'XL', c: 'Orange' } },
    { p: p('P14'), v: { q: 2, s: 'UK 9', c: '' } }
  ], { company: 'PDF verification', name: 'Test buyer', email: 'test@example.invalid',
       phone: '+260 999 123 456', town: 'Kitwe' });
  const bytes = Buffer.from(result.bytes);
  const text = bytes.toString('latin1');
  for (const expected of ['Colour: Navy blue', 'Colour: Orange', 'Colour: To confirm',
    '5-7 days', 'Size requested: L']) assert(text.includes(expected), expected);
  assert(!text.includes('14-21 days'));
  if (process.argv[2]) fs.writeFileSync(process.argv[2], bytes);
  // The fallback remains correct when site configuration fails to load.
  context.window.HANEKOM_CONFIG = {};
  vm.runInContext(fs.readFileSync('assets/js/quote-pdf.js', 'utf8'), context);
  const fallback = await context.window.hanekomQuotePDF(
    [{ p: p('P01'), v: { q: 1, s: '', c: 'Bottle green' } }], {});
  assert(Buffer.from(fallback.bytes).toString('latin1').includes('5-7 days'));
  console.log('Passed: selected colours, unspecified colour, size, configured delivery, and fallback delivery.');
})().catch(error => { console.error(error); process.exitCode = 1; });
