const path = require('path');
const express = require('express');
const STORES = require(process.env.STORES_MODULE ? require('path').resolve(process.env.STORES_MODULE) : './src/stores');
const scraper = require('./src/scraper');
const hist = require('./src/history');
const { isEan } = require('./src/match');
const { optimizeBasket } = require('./src/promos');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';      // 0.0.0.0 = dostęp z telefonu w sieci / w Dockerze
const CACHE_MIN = Number(process.env.CACHE_MIN || 30);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const WATCH_HOURS = Number(process.env.WATCH_HOURS || 0);
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const DEFAULT_CITY = process.env.DEFAULT_CITY || '';

const app = express();
app.disable('x-powered-by');

// --- hasło (obowiązkowe, gdy aplikacja jest wystawiona poza komputer) ---
const PUBLIC = /^\/(manifest\.webmanifest|sw\.js|icons\/.*)$/;
app.use((req, res, next) => {
  if (!APP_PASSWORD || PUBLIC.test(req.path)) return next();
  const h = req.headers.authorization || '';
  const [, b64] = h.split(' ');
  const pass = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
  if (pass === APP_PASSWORD) return next();
  res.set('WWW-Authenticate', 'Basic realm="Porownywarka", charset="UTF-8"').status(401).send('Wymagane hasło');
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
// moduły wspólne dla serwera i przeglądarki
for (const f of ['promos.js', 'offers.js', 'plate.js', 'pricing.js', 'honesty.js', 'need.js', 'specs.js']) app.get('/lib/' + f, (req, res) => res.type('js').sendFile(path.join(__dirname, 'src', f)));

if (!APP_PASSWORD && HOST !== '127.0.0.1' && HOST !== 'localhost') {
  console.warn('UWAGA: aplikacja nasłuchuje w sieci bez hasła. Ustaw APP_PASSWORD.');
}

const cache = new Map(); // `${storeId}|${query}` -> { ts, result }

function pickStores(param) {
  if (!param) return STORES.filter(s => s.enabled);
  const ids = String(param).split(',');
  return STORES.filter(s => ids.includes(s.id));
}

async function searchOne(store, q, fresh) {
  const ck = `${store.id}|${q.toLowerCase()}`;
  const c = cache.get(ck);
  if (!fresh && c && Date.now() - c.ts < CACHE_MIN * 60000) return { ...c.result, cached: true };
  const r = await scraper.searchStore(store, q);
  if (r.status === 'ok' || r.status === 'not_found') cache.set(ck, { ts: Date.now(), result: r });
  r.previous = hist.record(q, r);
  return r;
}

const engine = require('./src/engine');
const runPool = engine.runPool;
const searchAll = (q, stores, fresh, emit) => engine.searchAll(q, stores, { searchOne: (s, qq) => searchOne(s, qq, fresh), emit, concurrency: CONCURRENCY });

function sse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  res.on('close', () => clearInterval(ping));
  return (ev, data) => { if (!res.writableEnded) res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
}

app.get('/config.json', (req, res) => res.json({ mode: 'local' }));
app.get('/api/config', (req, res) => res.json({ defaultCity: DEFAULT_CITY, cacheMin: CACHE_MIN }));

app.get('/api/stores', (req, res) => {
  res.json(STORES.map(({ id, name, domain, verified, enabled, aggregator, linkOnly, kind }) => ({ id, name, domain, verified, enabled, aggregator: !!aggregator, linkOnly: !!linkOnly, kind: kind || null })));
});

// --- wyszukiwanie (strumień SSE) ---
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 2) return res.status(400).json({ error: 'Za krótkie zapytanie' });
  const stores = pickStores(req.query.stores);
  const send = sse(res);
  const t0 = Date.now();
  send('start', { q, ean: isEan(q), stores: stores.map(s => ({ id: s.id, name: s.name })) });
  await searchAll(q, stores, req.query.fresh === '1', send);
  send('done', { ms: Date.now() - t0 });
  res.end();
});

app.get('/api/search.json', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 2) return res.status(400).json({ error: 'Za krótkie zapytanie' });
  const out = await searchAll(q, pickStores(req.query.stores), req.query.fresh === '1', () => {});
  out.sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12));
  res.json({ q, results: out });
});

// --- szukanie po opisie: „płyta indukcyjna pięciopolowa”, „lodówka do 200cm” (SSE) ---
const listCache = new Map();
app.get('/api/discover', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 3) return res.status(400).json({ error: 'Za krótkie zapytanie' });
  const stores = pickStores(req.query.stores);
  const fresh = req.query.fresh === '1';
  const send = sse(res);
  const listOne = async (s, phrases) => {
    const k = s.id + '|' + phrases.join('|').toLowerCase();
    const c = listCache.get(k);
    if (!fresh && c && Date.now() - c.ts < CACHE_MIN * 60000) return c.r;
    const r = await scraper.listStore(s, phrases);
    if (r.status === 'ok') listCache.set(k, { ts: Date.now(), r });
    return r;
  };
  const out = await engine.discover(q, stores, { listOne, emit: send, concurrency: CONCURRENCY });
  send('result', out);
  send('done', {});
  res.end();
});

// --- podobne, ale tańsze (body: {refs:[{storeId,url,title,price,specs,category}]}) ---
app.post('/api/similar', async (req, res) => {
  const refs = (Array.isArray(req.body.refs) ? req.body.refs : []).filter(r => r && r.storeId && r.price).slice(0, 6);
  if (!refs.length) return res.status(400).json({ error: 'Brak wyników do porównania' });
  res.json(await engine.similar(refs, STORES, { similarOne: (s, ref) => scraper.similarStore(s, ref), concurrency: Math.min(CONCURRENCY, 3) }));
});

// --- cena z linku ---
app.get('/api/url', async (req, res) => {
  const u = String(req.query.u || '');
  try { const p = new URL(u); if (!/^https?:$/.test(p.protocol)) throw 0; } catch { return res.status(400).json({ error: 'Nieprawidłowy link' }); }
  const r = await scraper.readUrl(u, STORES);
  r.previous = hist.record(u, r);
  res.json(r);
});

// --- koszyk / porównanie wielu sprzętów (SSE) ---
app.get('/api/basket', async (req, res) => {
  const items = String(req.query.items || '').split('|').map(s => s.trim().slice(0, 120)).filter(s => s.length >= 2).slice(0, 8);
  if (!items.length) return res.status(400).json({ error: 'Pusty koszyk' });
  const stores = pickStores(req.query.stores).filter(s => !s.linkOnly);
  const combine = req.query.combine === '1';
  const fresh = req.query.fresh === '1';
  const send = sse(res);
  send('start', { items, stores: stores.map(s => ({ id: s.id, name: s.name })) });
  const plan = await engine.basket(items, stores, { searchOne: (s, q) => searchOne(s, q, fresh), emit: send, combine, useRaty: req.query.raty !== '0', concurrency: CONCURRENCY, includeUnverified: req.query.unverified === '1' });
  send('plan', plan);
  send('done', {});
  res.end();
});

// Przeliczenie planu bez ponownego pobierania (np. przełącznik "łącz promocje")
app.post('/api/basket/plan', (req, res) => {
  const products = Array.isArray(req.body.products) ? req.body.products : [];
  res.json(optimizeBasket(products, { combine: !!req.body.combine, useRaty: req.body.useRaty !== false }));
});

// --- zdjęcie: model / EAN ---
app.post('/api/photo', express.raw({ type: ['image/*', 'application/octet-stream'], limit: '15mb' }), async (req, res) => {
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'Brak zdjęcia' });
  try {
    const photo = require('./src/photo');
    res.json(await photo.recognize(req.body));
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// --- dostępność w salonie ---
const stockCache = new Map();
app.get('/api/stock', async (req, res) => {
  const url = String(req.query.url || ''), city = String(req.query.city || DEFAULT_CITY).trim().slice(0, 60);
  try { new URL(url); } catch { return res.status(400).json({ error: 'Nieprawidłowy link' }); }
  if (!city) return res.status(400).json({ error: 'Podaj miasto w ustawieniach' });
  const k = `${url}|${city.toLowerCase()}`;
  const c = stockCache.get(k);
  if (c && Date.now() - c.ts < 30 * 60000 && req.query.fresh !== '1') return res.json({ ...c.r, cached: true });
  const r = await scraper.checkStock(url, city);
  if (r.status === 'ok') stockCache.set(k, { ts: Date.now(), r });
  res.json(r);
});

// --- aktualne promocje sklepów (SSE) ---
const promoCache = new Map();
app.get('/api/promos', async (req, res) => {
  const stores = pickStores(req.query.stores).filter(s => !s.aggregator);
  const send = sse(res);
  await runPool(stores, Math.min(CONCURRENCY, 3), async s => {
    const c = promoCache.get(s.id);
    if (c && Date.now() - c.ts < 6 * 3600000 && req.query.fresh !== '1') return send('store', { ...c.r, cached: true });
    const r = await scraper.storePromos(s);
    if (r.status === 'ok') promoCache.set(s.id, { ts: Date.now(), r });
    send('store', r);
  });
  send('done', {});
  res.end();
});

// --- historia i obserwowane ---
app.get('/api/history', (req, res) => res.json(hist.history(String(req.query.q || ''))));
app.get('/api/watch', (req, res) => res.json(hist.watchList()));
app.post('/api/watch', (req, res) => { hist.addWatch(String(req.body.q || ''), req.body.target ? Number(req.body.target) : null); res.json(hist.watchList()); });
app.delete('/api/watch', (req, res) => { hist.removeWatch(String(req.query.q || '')); res.json(hist.watchList()); });

if (WATCH_HOURS > 0) {
  const tick = async () => {
    for (const w of hist.watchList()) {
      const results = await searchAll(w.q, STORES.filter(s => s.enabled), true, () => {});
      const best = results.filter(r => r.status === 'ok' && !r.aggregator).sort((a, b) => a.price - b.price)[0];
      if (best) console.log(`[obserwowane] ${w.q}: najtaniej ${best.price} zł w ${best.store}${w.target && best.price <= w.target ? '  <<< PONIŻEJ PROGU!' : ''}`);
    }
  };
  setInterval(tick, WATCH_HOURS * 3600 * 1000);
  console.log(`Obserwowane produkty będą odświeżane co ${WATCH_HOURS} h`);
}

const server = app.listen(PORT, HOST, () => {
  console.log(`\nPorównywarka AGD/RTV działa: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => {
  server.close();
  await scraper.close();
  try { await require('./src/photo').shutdown(); } catch {}
  process.exit(0);
});
