// Cykliczne sprawdzanie obserwowanych produktów (GitHub Actions, harmonogram).
// Zapisuje historię cen, status w watch-status.json i wysyła powiadomienie na telefon (ntfy), gdy:
//  - cena spadnie poniżej ustawionego progu, albo
//  - najniższa cena spadnie od poprzedniego sprawdzenia.
const STORES = require(process.env.STORES_MODULE ? require('path').resolve(process.env.STORES_MODULE) : '../src/stores');
const scraper = require('../src/scraper');
const engine = require('../src/engine');
const { offersFromResults } = require('../src/offers');
const store = require('./store');
const data = require('./data');

const NTFY = (process.env.NTFY_TOPIC || '').trim();
const NTFY_SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
const [OWNER, REPO_NAME] = String(process.env.GITHUB_REPOSITORY || '/').split('/');
const APP_URL = process.env.APP_URL || (OWNER && REPO_NAME ? `https://${OWNER.toLowerCase()}.github.io/${REPO_NAME}/` : '');
const fmt = n => n.toLocaleString('pl-PL', { maximumFractionDigits: 2 }) + ' zł';

async function notify(title, body, q) {
  if (!NTFY) return;
  try {
    await fetch(`${NTFY_SERVER}/${encodeURIComponent(NTFY)}`, {
      method: 'POST', body,
      headers: { Title: encodeURIComponent(title), Tags: 'moneybag', 'X-Title-Encoding': 'url', ...(APP_URL ? { Click: `${APP_URL}?q=${encodeURIComponent(q)}` } : {}) },
    });
  } catch (e) { console.error('ntfy:', e.message); }
}

async function main() {
  const watch = await data.readWatch();
  const statusFile = await store.getFile('watch-status.json');
  const status = statusFile ? statusFile.json : {};
  const stores = STORES.filter(s => s.enabled && !s.linkOnly);
  for (const w of watch) {
    console.log('Sprawdzam:', w.q);
    const results = await engine.searchAll(w.q, stores, { searchOne: (s, q) => scraper.searchStore(s, q), concurrency: 4 });
    await data.recordHistory(w.q, results).catch(e => console.error('Historia:', e.message));
    const best = offersFromResults(results).sort((a, b) => a.price - b.price)[0];
    const k = data.key(w.q);
    const before = status[k];
    status[k] = { q: w.q, ts: Date.now(), best: best ? { price: best.price, store: best.store, url: best.url } : null };
    if (!best) continue;
    if (w.target && best.price <= w.target && !(before && before.best && before.best.price <= w.target && before.best.price <= best.price)) {
      await notify(`🎯 ${w.q}: ${fmt(best.price)}`, `Poniżej progu ${fmt(w.target)} – ${best.store}`, w.q);
    } else if (before && before.best && best.price < before.best.price * 0.995) {
      await notify(`▼ ${w.q}: ${fmt(best.price)}`, `Taniej o ${fmt(before.best.price - best.price)} – ${best.store}`, w.q);
    }
  }
  await store.updateJson('watch-status.json', cur => ({ ...cur, ...status }), {}, 'status obserwowanych');

  // sprzątanie: wyniki wyszukiwań starsze niż 3 dni
  const files = await store.listDir('results');
  const cutoff = Date.now() - 3 * 864e5;
  for (const f of files) {
    const ts = parseInt(String(f.name).split('-')[0], 36);
    if (ts && ts < cutoff) await store.deleteFile(f.path, f.sha, 'sprzątanie wyników');
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => scraper.close());
