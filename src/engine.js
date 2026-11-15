// Wspólna logika wyszukiwania – używana przez serwer lokalny (server.js) i wersję GitHub (gh/run.js).
const { isEan, modelsFromTitle } = require('./match');
const { optimizeBasket } = require('./promos');
const { offersFromResults } = require('./offers');
const { parseNeed } = require('./need');
const { mergeDiscover } = require('./discover');

async function runPool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; await fn(it); }
  });
  await Promise.all(workers);
}

// searchOne(store, q) -> wynik; emit(event, data) – 'result' | 'resolved'
// Dla EAN: drugi przebieg po modelu odczytanym z trafionej karty produktu.
async function searchAll(q, stores, { searchOne, emit = () => {}, concurrency = 4 }) {
  const results = new Map();
  await runPool(stores, concurrency, async s => { const r = await searchOne(s, q); results.set(s.id, r); emit('result', r); });
  if (isEan(q)) {
    const hit = [...results.values()].find(r => r.status === 'ok' && r.match === 'exact' && !r.aggregator)
      || [...results.values()].find(r => r.status === 'ok' && r.match === 'exact');
    const model = hit ? modelsFromTitle(hit.title)[0] : null;
    if (model) {
      emit('resolved', { ean: q, model, title: hit.title });
      const retry = stores.filter(s => !s.linkOnly && ['not_found', 'no_price'].includes(results.get(s.id)?.status));
      await runPool(retry, concurrency, async s => {
        const r = await searchOne(s, model);
        if (r.status === 'ok') { r.note = [`Znaleziono po modelu ${model} (z EAN ${q}).`, r.note].filter(Boolean).join(' '); results.set(s.id, r); emit('result', r); }
      });
    }
  }
  return [...results.values()];
}

// Koszyk: wyszukanie każdej pozycji + plan zakupu. emit('item', {i, ...wynik})
async function basket(items, stores, { searchOne, emit = () => {}, combine = false, useRaty = true, concurrency = 4, includeUnverified = false }) {
  const products = [];
  for (let i = 0; i < items.length; i++) {
    const results = await searchAll(items[i], stores.filter(s => !s.linkOnly), { searchOne, concurrency, emit: (ev, d) => emit(ev === 'result' ? 'item' : ev, { i, ...d }) });
    products.push({ q: items[i], offers: offersFromResults(results, { includeUnverified }) });
  }
  return { combine, useRaty, ...optimizeBasket(products, { combine, useRaty }), products };
}

// Szukanie po opisie („płyta indukcyjna pięciopolowa”). listOne(store, phrases) -> {status, items}
// emit('store', {storeId, store, status, count}) – postęp; wynik: {need, items, stores}
async function discover(q, stores, { listOne, emit = () => {}, concurrency = 4 }) {
  const need = parseNeed(q);
  const phrases = [need.phrase];
  if (need.q.toLowerCase() !== need.phrase.toLowerCase()) phrases.push(need.q);
  emit('need', need);
  const all = [], status = [];
  await runPool(stores.filter(s => !s.linkOnly), concurrency, async s => {
    const r = await listOne(s, phrases);
    all.push(...(r.items || []));
    const st = { storeId: s.id, store: s.name, status: r.status, count: (r.items || []).length, url: r.searchUrl, note: r.note || null };
    status.push(st);
    emit('store', st);
    emit('partial', { need, items: mergeDiscover(need, all, { limit: 30 }) });
  });
  const links = stores.filter(s => s.linkOnly).map(s => ({ storeId: s.id, store: s.name, status: 'link', url: s.searchUrl(need.phrase) }));
  return { need, items: mergeDiscover(need, all), stores: status.concat(links) };
}

// Podobne, ale tańsze: refs – wyniki wyszukiwania (po jednym na sklep). similarOne(store, ref)
async function similar(refs, stores, { similarOne, emit = () => {}, concurrency = 3 }) {
  const out = [];
  await runPool(refs, concurrency, async ref => {
    const store = stores.find(s => s.id === ref.storeId);
    if (!store) return;
    const r = await similarOne(store, ref);
    out.push(r);
    emit('store', r);
  });
  const items = out.flatMap(r => (r.items || []).map(i => ({ ...i, ref: refs.find(x => x.storeId === r.storeId) })));
  const minRef = Math.min(...refs.map(r => r.price).filter(Boolean));
  for (const i of items) i.savingVsBest = Math.round((minRef - i.price) * 100) / 100;
  items.sort((a, b) => a.price - b.price);
  return { stores: out.map(({ items: _, ...r }) => r), items: items.slice(0, 12) };
}

module.exports = { runPool, searchAll, basket, discover, similar };
