// Uruchamiane przez GitHub Actions (workflow "Szukaj"). Wejście w zmiennych środowiskowych:
//   REQ_ID   – identyfikator zlecenia (z aplikacji)
//   KIND     – search | basket | stock | promos | url | discover | similar
//   PAYLOAD  – JSON z parametrami
// Wynik trafia do results/<REQ_ID>.json na gałęzi "data"; aplikacja odpytuje ten plik co kilka sekund.
const STORES = require(process.env.STORES_MODULE ? require('path').resolve(process.env.STORES_MODULE) : '../src/stores');
const scraper = require('../src/scraper');
const engine = require('../src/engine');
const store = require('./store');
const data = require('./data');

const ID = String(process.env.REQ_ID || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
const KIND = String(process.env.KIND || 'search');
let P = {};
try { P = JSON.parse(process.env.PAYLOAD || '{}'); } catch { P = {}; }
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const PATH = `results/${ID}.json`;

const pick = ids => {
  const list = Array.isArray(ids) && ids.length ? STORES.filter(s => ids.includes(s.id)) : STORES.filter(s => s.enabled);
  return list;
};
const clip = (s, n = 120) => String(s || '').trim().slice(0, n);

// --- zapis wyniku: na bieżąco (żeby telefon widział postęp), ale nie częściej niż co ~2 s ---
const out = { id: ID, kind: KIND, status: 'running', startedAt: Date.now(), payload: P, results: [], events: [] };
let sha = null, writing = Promise.resolve(), lastWrite = 0, dirty = false, timer = null;
function flush(force) {
  dirty = true;
  if (!force && Date.now() - lastWrite < 2000) { if (!timer) timer = setTimeout(() => { timer = null; flush(true); }, 2000); return writing; }
  writing = writing.then(async () => {
    if (!dirty) return;
    dirty = false; lastWrite = Date.now();
    for (let i = 0; i < 3; i++) {
      const w = await store.putFile(PATH, out, sha, `wynik ${ID}`);
      if (!w.conflict) { sha = w.sha; return; }
      const cur = await store.getFile(PATH); sha = cur && cur.sha;
    }
  }).catch(e => console.error('Zapis wyniku:', e.message));
  return writing;
}

async function main() {
  if (!ID) throw new Error('Brak REQ_ID');
  await flush(true);
  const searchOne = (s, q) => scraper.searchStore(s, q);

  if (KIND === 'search') {
    const q = clip(P.q);
    out.q = q;
    const results = await engine.searchAll(q, pick(P.stores), {
      searchOne, concurrency: CONCURRENCY,
      emit: (ev, d) => {
        if (ev === 'result') { out.results = out.results.filter(r => r.storeId !== d.storeId).concat(d); }
        else out.events.push({ ev, ...d });
        if (ev === 'resolved') out.resolved = d;
        flush();
      },
    });
    const prev = await data.recordHistory(q, results).catch(e => { console.error('Historia:', e.message); return {}; });
    for (const r of out.results) if (prev[r.storeId]) r.previous = prev[r.storeId];
  } else if (KIND === 'basket') {
    const items = (Array.isArray(P.items) ? P.items : []).map(x => clip(x)).filter(x => x.length >= 2).slice(0, 8);
    out.items = items;
    const plan = await engine.basket(items, pick(P.stores), {
      searchOne, combine: !!P.combine, useRaty: P.useRaty !== false, concurrency: CONCURRENCY, includeUnverified: !!P.includeUnverified,
      emit: (ev, d) => { if (ev === 'item') out.results.push({ i: d.i, storeId: d.storeId, store: d.store, status: d.status, price: d.price }); flush(); },
    });
    out.plan = plan;
  } else if (KIND === 'stock') {
    out.stock = await scraper.checkStock(String(P.url || ''), clip(P.city, 60));
  } else if (KIND === 'url') {
    out.results = [await scraper.readUrl(String(P.u || ''), STORES)];
  } else if (KIND === 'promos') {
    out.promos = [];
    await engine.runPool(pick(P.stores).filter(s => !s.aggregator && !s.linkOnly), 3, async s => { out.promos.push(await scraper.storePromos(s)); flush(); });
  } else if (KIND === 'discover') {
    const q = clip(P.q);
    out.q = q;
    out.discover = await engine.discover(q, pick(P.stores), {
      listOne: (s, phrases) => scraper.listStore(s, phrases), concurrency: CONCURRENCY,
      emit: (ev, d) => {
        if (ev === 'need') out.need = d;
        if (ev === 'store') out.events.push(d);
        if (ev === 'partial') { out.partial = d.items; flush(); }
      },
    });
  } else if (KIND === 'similar') {
    const refs = (Array.isArray(P.refs) ? P.refs : []).filter(r => r && r.storeId && r.price).slice(0, 6);
    out.similar = await engine.similar(refs, STORES, { similarOne: (s, ref) => scraper.similarStore(s, ref), concurrency: 3, emit: d => { out.events.push({ storeId: d.storeId, status: d.status }); flush(); } });
  } else throw new Error('Nieznany rodzaj zlecenia: ' + KIND);

  out.status = 'done';
}

main()
  .catch(e => { out.status = 'error'; out.error = String(e.message || e).slice(0, 300); console.error(e); })
  .finally(async () => {
    out.finishedAt = Date.now();
    clearTimeout(timer);
    await writing; await flush(true);
    await scraper.close();
    console.log(`Gotowe: ${out.status} (${((out.finishedAt - out.startedAt) / 1000).toFixed(1)} s)`);
    process.exit(0);
  });
