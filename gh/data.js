// Historia cen i lista obserwowanych w repozytorium (wersja GitHub)
const store = require('./store');
const { alnum } = require('../src/match');

const key = q => alnum(q).slice(0, 80) || 'pusty';
const MAX = 3000;

// Zapisuje wyniki do history/<klucz>.json i zwraca mapę storeId -> poprzednia cena (starsza niż 10 min)
async function recordHistory(q, results) {
  const now = Date.now();
  const prev = {};
  const priceOf = r => r.aggregator ? r.verifiedPrice : r.price; // Ceneo: tylko cena potwierdzona w sklepie
  const ok = results.filter(r => r.status === 'ok' && priceOf(r));
  await store.updateJson(`history/${key(q)}.json`, h => {
    for (const r of results) {
      const p = [...h.entries].reverse().find(e => e.storeId === r.storeId && now - e.ts > 10 * 60 * 1000);
      if (p) prev[r.storeId] = { price: p.price, ts: p.ts };
    }
    if (!ok.length) return undefined;
    for (const r of ok) h.entries.push({ storeId: r.storeId, price: priceOf(r), ts: now, url: r.url, title: (r.title || '').slice(0, 120) });
    if (h.entries.length > MAX) h.entries = h.entries.slice(-MAX);
    return h;
  }, { q, entries: [] }, `historia: ${q}`);
  return prev;
}

async function readWatch() { const f = await store.getFile('watch.json'); return f ? f.json : []; }

module.exports = { key, recordHistory, readWatch };
