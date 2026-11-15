// Buduje statyczną stronę dla GitHub Pages do katalogu _site
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, '_site');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });
fs.mkdirSync(path.join(out, 'lib'), { recursive: true });
for (const f of ['promos.js', 'offers.js', 'plate.js', 'pricing.js', 'honesty.js', 'need.js', 'specs.js']) fs.copyFileSync(path.join(root, 'src', f), path.join(out, 'lib', f));
const stores = require(process.env.STORES_MODULE ? path.resolve(process.env.STORES_MODULE) : '../src/stores').map(({ id, name, domain, verified, enabled, aggregator, linkOnly, kind }) =>
  ({ id, name, domain, verified, enabled, aggregator: !!aggregator, linkOnly: !!linkOnly, kind: kind || null }));
fs.writeFileSync(path.join(out, 'stores.json'), JSON.stringify(stores));
fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({ mode: 'github', builtAt: new Date().toISOString() }));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('Strona zbudowana w _site/');
