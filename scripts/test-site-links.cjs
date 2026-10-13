const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sample = 'P01,4,M,Grey|P03,4,M,|P04,5,M,|P16,2,4,|P02,10,L';
const files = fs.readdirSync('.').filter(name => name.endsWith('.html'));
let whatsappLinks = 0;

for (const file of files) {
  const html = fs.readFileSync(file, 'latin1');
  assert(!/https(?::|%3A)(?:\/\/|%2F%2F)www\.hanekom\.co\.zm\//i.test(html),
    `${file} still links to the unavailable host`);
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = match[1].split(/[?#]/)[0];
    if (target.startsWith('https://wa.me/')) whatsappLinks++;
    if (!target || /^(?:#|https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(target)
      || target.includes("' + ")) continue;
    assert(fs.existsSync(target), `${file} points to missing ${target}`);
  }
}
assert(files.length >= 98 && whatsappLinks >= 700);

function visit(script, origin, hash) {
  const storage = new Map();
  const context = {
    window: {
      HANEKOM_CONFIG: { site: 'https://www.hanekom.co.zm' },
      localStorage: {
        getItem: key => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value)
      }
    },
    location: { protocol: 'https:', origin, pathname: '/quote.html', hash },
    document: {
      addEventListener() {}, dispatchEvent() {}, querySelectorAll() { return []; }
    },
    history: { replaceState() {} },
    CustomEvent: function (type) { this.type = type; }
  };
  vm.runInNewContext(fs.readFileSync('assets/js/products.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), context);
  return context.window;
}

for (const script of ['assets/js/site.js', 'assets/js/site.min.js']) {
  const site = visit(script, 'https://t3nd41.github.io', `#q=${sample}`);
  assert.equal(site.hanekomImportQuote(), true, `${script} did not import the shared list`);
  assert.equal(site.HanekomQuote.count(), 5);
  assert.equal(site.hanekomQuoteLink(), `https://t3nd41.github.io/quote.html#q=${sample},`);
  const product = site.HANEKOM_PRODUCTS.find(item => item.id === 'P01');
  const message = new URL(site.hanekomWaProduct(product, 4)).searchParams.get('text');
  assert(message.includes('https://t3nd41.github.io/' + product.url));
  assert(message.includes('https://t3nd41.github.io/assets/cat/'));
  assert(!message.includes('www.hanekom.co.zm'));
  assert.equal(visit(script, 'https://pages.example', '').hanekomAbs('quote.html'),
    'https://pages.example/quote.html', `${script} must follow the current host`);
}

console.log(`${files.length} pages, ${whatsappLinks} WhatsApp links, exact five-item share link: passed`);
