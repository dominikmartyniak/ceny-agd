// Szukanie po opisie: kafelki z list sklepów -> produkty z opiniami, promocjami i parametrami.
const { priceFromTile } = require('./extract');
const { parsePromos } = require('./promos');
const { parsePricing } = require('./pricing');
const { parseSpecs } = require('./specs');
const { checkNeed, trustScore, MIN_REVIEWS } = require('./need');
const { promoVerdict } = require('./honesty');
const { modelsFromTitle, alnum } = require('./match');

const NUM = '(\\d{1,3}(?:[ \\u00a0]\\d{3})+|\\d+)';

function parseRating(text) {
  const t = String(text || '').replace(/ /g, ' ');
  let reviews = null, rating = null, m;
  const rv = t.match(new RegExp('\\(?\\s*' + NUM + '\\s*(?:opini[aei]?|recenzj[aei]?|ocen[ay]?)\\b', 'i'));
  if (rv) {
    reviews = parseInt(rv[1].replace(/ /g, ''), 10);
    const before = t.slice(Math.max(0, rv.index - 90), rv.index);
    const cand = [...before.matchAll(/(?:^|[^\d,.])([1-5][.,]\d{1,2})(?![\d,.])/g)].map(x => parseFloat(x[1].replace(',', '.'))).filter(v => v >= 1 && v <= 5);
    if (cand.length) rating = cand[cand.length - 1];
  }
  if (rating == null && (m = t.match(/([1-5][.,]\d{1,2})\s*(?:\/\s*5|gwiazd)/i))) rating = parseFloat(m[1].replace(',', '.'));
  if (rating == null && (m = t.match(/ocena:?\s*([1-5][.,]\d{1,2})/i))) rating = parseFloat(m[1].replace(',', '.'));
  if (rating != null && !reviews) reviews = null;
  return { rating, reviews };
}

function parseTile(tile, store) {
  const text = tile.text || '';
  const lines = text.split('\n');
  const pr = parsePricing(text);
  const price = priceFromTile(text);
  const { rating, reviews } = parseRating(text);
  const code = (text.match(/(?:cena )?z kodem\s*:?\s*([A-Z0-9]*\d[A-Z0-9]{3,})/i) || [])[1] || null;
  return {
    storeId: store.id, store: store.name, aggregator: !!store.aggregator, url: tile.url, title: tile.title,
    price, rating, reviews, code,
    lowest30: pr.lowest30 || null,
    regularPrice: pr.noCode || pr.beforeDiscount || null,
    srp: pr.srp || null,
    installments: pr.installments || null,
    extras: pr.extras || [],
    promos: parsePromos(lines.concat(text)),
    specs: parseSpecs(text, tile.title),
    offersCount: (text.match(/(?:w|ofert[ay]? w)\s*(\d{1,4})\s*sklep/i) || [])[1] ? +(text.match(/(?:w|ofert[ay]? w)\s*(\d{1,4})\s*sklep/i)[1]) : null,
  };
}

const keyOf = title => modelsFromTitle(title)[0] || alnum(title).slice(0, 60);

// items: tiles już sparsowane (z wielu sklepów). Zwraca listę produktów do pokazania.
function mergeDiscover(need, items, { limit = 40 } = {}) {
  const groups = new Map();
  for (const it of items) {
    if (!it.title || (!it.price && !it.rating)) continue;
    const k = keyOf(it.title);
    if (!groups.has(k)) groups.set(k, []);
    const g = groups.get(k);
    if (!g.some(x => x.storeId === it.storeId && x.url === it.url)) g.push(it);
  }
  const out = [];
  for (const [key, arr] of groups) {
    const shop = arr.filter(x => !x.aggregator && x.price);
    const offers = (shop.length ? shop : arr.filter(x => x.price)).slice().sort((a, b) => a.price - b.price);
    // dla każdego sklepu tylko najtańsza oferta
    const seen = new Set();
    const best = offers.filter(o => !seen.has(o.storeId) && seen.add(o.storeId));
    const price = best.length ? best[0].price : null;
    const specs = {};
    for (const x of arr) for (const [k, v] of Object.entries(x.specs || {})) if (specs[k] == null && v != null) specs[k] = v;
    // opinie: średnia ważona liczbą opinii ze wszystkich źródeł (sklepy + Ceneo)
    const src = [];
    const seenSrc = new Set();
    for (const x of arr) if (x.rating && x.reviews && !seenSrc.has(x.storeId)) { seenSrc.add(x.storeId); src.push({ store: x.store, rating: x.rating, reviews: x.reviews }); }
    const reviews = src.reduce((s, x) => s + x.reviews, 0);
    const rating = reviews ? Math.round(src.reduce((s, x) => s + x.rating * x.reviews, 0) / reviews * 100) / 100 : null;
    const title = (shop[0] || arr[0]).title;
    const check = checkNeed(need, specs, price, title);
    if (!check.ok) continue;
    const top = best[0] || arr[0];
    const promoLabels = new Set();
    const has = l => [...promoLabels].some(x => x.toLowerCase() === l.toLowerCase() || (/raty? gratis/i.test(x) && /raty? gratis/i.test(l)));
    for (const o of best) {
      for (const r of o.promos || []) if (!has(r.label)) promoLabels.add(r.label);
      if (o.installments && o.installments.freeCount && !has('raty gratis')) promoLabels.add(`${o.installments.upTo ? 'nawet ' : ''}${o.installments.freeCount} rat${o.installments.freeCount > 1 ? 'y' : 'a'} gratis`);
      for (const e of o.extras || []) promoLabels.add(e.kind === 'zwrot' ? `zwrot ${e.upTo ? 'do ' : ''}${e.amount} zł` : `bon ${e.upTo ? 'do ' : ''}${e.amount} zł`);
      if (o.code) promoLabels.add('cena z kodem');
    }
    const verdict = top && top.price ? promoVerdict(top, null) : null;
    const discounted = best.some(o => o.regularPrice && o.regularPrice > o.price * 1.01);
    const promo = promoLabels.size > 0 || discounted;
    out.push({
      key, title, price, rating, reviews, ratingSources: src,
      fewReviews: reviews < MIN_REVIEWS,
      score: Math.round((trustScore(rating, reviews) - 0.12 * check.unknown.length) * 1000) / 1000,
      unknown: check.unknown, specs, promo, promoLabels: [...promoLabels].slice(0, 6), verdict,
      model: modelsFromTitle(title)[0] || null,
      offers: best.map(o => ({ storeId: o.storeId, store: o.store, price: o.price, url: o.url, aggregator: o.aggregator, lowest30: o.lowest30,
        regularPrice: o.regularPrice, code: o.code, installments: o.installments, extras: o.extras, promos: (o.promos || []).map(r => r.label) })),
      links: arr.filter(x => !best.includes(x)).map(x => ({ store: x.store, url: x.url })).slice(0, 4),
    });
  }
  if (need.sort === 'price') out.sort((a, b) => (b.score >= 4.1) - (a.score >= 4.1) || (a.price ?? 1e9) - (b.price ?? 1e9));
  else out.sort((a, b) => b.score - a.score || (a.price ?? 1e9) - (b.price ?? 1e9));
  return out.slice(0, limit);
}

module.exports = { parseTile, parseRating, mergeDiscover, keyOf };
