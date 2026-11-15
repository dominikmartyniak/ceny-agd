(function (root) {
// Promocje koszykowe: rozpoznawanie z tekstów "plakietek" sklepów + przeliczanie koszyka.
//
// Rozpoznawane wzorce (zebrane z Euro / Media Markt / Neonet, 11.2026):
//   "67 ZŁ ZA KAŻDE WYDANE 500 ZŁ"      -> per_spend  {get:67, per:500}
//   "70 za 500"                          -> per_spend  {get:70, per:500}
//   "PIĄTY PRODUKT ZA 1 ZŁ!"             -> nth_for_1  {n:5}
//   "drugi produkt -50%" / "-30% na drugi" -> nth_percent {n:2, pct:50}
//   "-10% przy zakupie 2 produktów"      -> percent_from_n {n:2, pct:10}
//   "taniej w zestawie", "multirabat", "raty gratis" -> info (bez przeliczenia)
// UWAGA: "ZYSKAJ 268 ZŁ RABATU" w Euro to wyliczenie tej samej promocji 67/500 dla jednej sztuki,
// więc NIE jest liczone osobno (inaczej rabat byłby podwójny).

const ORD = { drugi: 2, druga: 2, trzeci: 3, trzecia: 3, czwarty: 4, czwarta: 4, piąty: 5, piata: 5, piąta: 5, piaty: 5, szósty: 6, szosty: 6 };
const ordNum = s => ORD[String(s).toLowerCase()] || parseInt(s, 10) || null;
const num = s => parseFloat(String(s).replace(/[\s ]/g, '').replace(',', '.'));

function parsePromos(texts) {
  const out = new Map();
  const add = (key, rule) => { if (!out.has(key)) out.set(key, rule); };
  for (const raw of [].concat(texts || [])) {
    if (!raw) continue;
    const t = String(raw).replace(/\s+/g, ' ');
    let m;

    const reSpend = /(\d{1,4})\s*zł\s*za\s*każde\s*(?:wydane\s*)?(\d[\d\s ]{1,6})\s*zł/gi;
    while ((m = reSpend.exec(t))) {
      const get = num(m[1]), per = num(m[2]);
      if (get > 0 && per > get) add(`per_spend:${get}:${per}`, { type: 'per_spend', get, per, label: `${get} zł za każde ${per} zł` });
    }
    const reShort = /(?:^|[^\d])(\d{2,3})\s*(?:zł\s*)?za\s*(\d{3,4})(?![\d,])(?!\s*(?:rat|zł\s*rabatu))(?:\s*zł)?/gi; // MM: "70 za 500"
    while ((m = reShort.exec(t))) {
      const get = num(m[1]), per = num(m[2]);
      if (per >= 100 && get < per / 2) add(`per_spend:${get}:${per}`, { type: 'per_spend', get, per, label: `${get} zł za każde ${per} zł` });
    }
    const reNth1 = /(drug[ia]|trzeci[a]?|czwart[ya]|pi[ąa]t[ya]|sz[óo]st[ya]|\d)\.?\s*(?:najtańszy\s*)?(?:produkt|sprzęt|artykuł)?\s*za\s*1\s*zł/gi;
    while ((m = reNth1.exec(t))) {
      const n = ordNum(m[1]);
      if (n >= 2 && n <= 10) add(`nth_for_1:${n}`, { type: 'nth_for_1', n, label: `${n}. produkt za 1 zł` });
    }
    const reNthPct1 = /(drug[ia]|trzeci[a]?|czwart[ya]|\d)\.?\s*(?:produkt|sprzęt)?\s*(?:-|za|taniej o|rabat)\s*(\d{1,2})\s*%/gi;
    while ((m = reNthPct1.exec(t))) {
      const n = ordNum(m[1]), pct = num(m[2]);
      if (n >= 2 && n <= 6 && pct > 0 && pct < 100) add(`nth_percent:${n}:${pct}`, { type: 'nth_percent', n, pct, label: `${n}. produkt −${pct}%` });
    }
    const reNthPct2 = /-?\s*(\d{1,2})\s*%\s*(?:taniej|rabatu|zniżki)?\s*na\s*(drug[ia]|trzeci[a]?|czwart[ya]|\d)\b/gi;
    while ((m = reNthPct2.exec(t))) {
      const n = ordNum(m[2]), pct = num(m[1]);
      if (n >= 2 && n <= 6 && pct > 0 && pct < 100) add(`nth_percent:${n}:${pct}`, { type: 'nth_percent', n, pct, label: `${n}. produkt −${pct}%` });
    }
    const reFromN = /-?\s*(\d{1,2})\s*%\s*(?:taniej|rabatu|zniżki)?\s*(?:przy zakupie|za zakup|na zestaw z|w zestawie z)\s*(\d)\s*(?:lub więcej\s*)?(?:produkt|sprzęt|urządze)/gi;
    while ((m = reFromN.exec(t))) {
      const n = num(m[2]), pct = num(m[1]);
      if (n >= 2 && pct > 0 && pct < 100) add(`percent_from_n:${n}:${pct}`, { type: 'percent_from_n', n, pct, label: `−${pct}% przy ${n}+ produktach` });
    }
    if (/taniej w zestawie|multirabat|kup w zestawie|zestaw taniej/i.test(t)) add('info:zestaw', { type: 'info', label: 'Taniej w zestawie (szczegóły w sklepie)' });
    if ((m = t.match(/(?:^|[^\d])((?:nawet\s*)?(?:\d{1,2}|dwie|trzy|cztery)\s*raty?\s*gratis)/i))) add('info:raty', { type: 'info', label: m[1].trim() });
  }
  return [...out.entries()].map(([key, r]) => ({ key, ...r }));
}

// Rabat jednej reguły dla listy pozycji (ceny) w jednym sklepie
function ruleDiscount(rule, prices) {
  const p = [...prices].sort((a, b) => b - a);
  switch (rule.type) {
    case 'per_spend': return Math.floor(p.reduce((s, x) => s + x, 0) / rule.per) * rule.get;
    case 'nth_for_1': {
      let d = 0; for (let i = rule.n - 1; i < p.length; i += rule.n) d += Math.max(0, p[i] - 1); return d;
    }
    case 'nth_percent': {
      let d = 0; for (let i = rule.n - 1; i < p.length; i += rule.n) d += p[i] * rule.pct / 100; return d;
    }
    case 'percent_from_n': return p.length >= rule.n ? p.reduce((s, x) => s + x, 0) * rule.pct / 100 : 0;
    default: return 0;
  }
}

// Koszyk w jednym sklepie. items: [{price, promos:[rule], installments:{saving,upTo}, extras:[]}]
// combine=false: liczy tylko NAJLEPSZĄ jedną promocję (bezpieczne założenie – sklepy zwykle nie łączą)
// Raty gratis NIE łączą się z rabatami koszykowymi (np. Euro: „67 zł za 500” nie łączy się z „raty gratis”),
// więc liczymy dwa warianty: gotówka z rabatem albo raty gratis bez rabatu – i bierzemy tańszy.
// Zwroty i bony (cashback, kod na kolejne zakupy) są tylko wypisane – nie odejmujemy ich od ceny.
function storeTotal(items, combine = false, useRaty = true) {
  const subtotal = round(items.reduce((s, i) => s + i.price, 0));
  const rules = new Map();
  for (const it of items) for (const r of it.promos || []) if (r.type !== 'info') rules.set(r.key, r);
  const applied = [];
  for (const r of rules.values()) {
    const eligible = items.filter(i => (i.promos || []).some(x => x.key === r.key)).map(i => i.price);
    const amount = round(ruleDiscount(r, eligible));
    if (amount > 0) applied.push({ key: r.key, label: r.label, amount, items: eligible.length });
  }
  applied.sort((a, b) => b.amount - a.amount);
  const used = combine ? applied : applied.slice(0, 1);
  const discount = round(used.reduce((s, a) => s + a.amount, 0));
  const cashTotal = round(subtotal - discount);
  const ratySaving = round(items.reduce((s, i) => s + (i.installments && !i.installments.upTo && i.installments.saving > 0 ? i.installments.saving : 0), 0));
  const ratyTotal = round(subtotal - ratySaving);
  const method = useRaty && ratySaving > 0 && ratyTotal < cashTotal - 0.005 ? 'raty' : 'cash';
  const extras = [];
  for (const it of items) for (const e of it.extras || []) if (!extras.some(x => x.label === e.label)) extras.push(e);
  return {
    subtotal, discount: method === 'raty' ? 0 : discount, total: method === 'raty' ? ratyTotal : cashTotal,
    applied: method === 'raty' ? [] : used, other: combine ? [] : applied.slice(1),
    cashTotal, ratyTotal: ratySaving > 0 ? ratyTotal : null, ratySaving, method, extras,
  };
}

const round = x => Math.round(x * 100) / 100;

// Optymalizacja koszyka.
// products: [{ q, offers: [{storeId, store, price, promos, url, title}] }]
// Zwraca: plany "wszystko w jednym sklepie" + najlepszy podział między sklepy.
function optimizeBasket(products, { combine = false, useRaty = true } = {}) {
  const stores = new Map();
  products.forEach(p => p.offers.forEach(o => stores.set(o.storeId, o.store)));

  // 1) wszystko w jednym sklepie
  const single = [];
  for (const [storeId, store] of stores) {
    const picks = products.map(p => p.offers.filter(o => o.storeId === storeId).sort((a, b) => a.price - b.price)[0]);
    if (picks.some(x => !x)) continue;
    const t = storeTotal(picks, combine, useRaty);
    single.push({ kind: 'single', stores: [store], ...t, extras: t.extras.map(e => ({ ...e, store })), lines: picks.map((o, i) => line(products[i], o)), byStore: [{ storeId, store, ...t }] });
  }
  single.sort((a, b) => a.total - b.total);

  // 2) najlepszy podział: przegląd wszystkich przydziałów (do 200k), inaczej zachłannie
  const choices = products.map(p => {
    const best = new Map();
    for (const o of p.offers) if (!best.has(o.storeId) || o.price < best.get(o.storeId).price) best.set(o.storeId, o);
    return [...best.values()];
  });
  if (choices.some(c => !c.length)) return { single, split: null, missing: products.filter((p, i) => !choices[i].length).map(p => p.q) };

  const evalAssign = picks => {
    const groups = new Map();
    picks.forEach((o, i) => { if (!groups.has(o.storeId)) groups.set(o.storeId, []); groups.get(o.storeId).push({ o, i }); });
    let total = 0, subtotal = 0, discount = 0;
    const byStore = [];
    for (const [storeId, arr] of groups) {
      const t = storeTotal(arr.map(x => x.o), combine, useRaty);
      total += t.total; subtotal += t.subtotal; discount += t.discount;
      byStore.push({ storeId, store: arr[0].o.store, ...t });
    }
    const extras = byStore.flatMap(b => b.extras.map(e => ({ ...e, store: b.store })));
    return { total: round(total), subtotal: round(subtotal), discount: round(discount), byStore, extras };
  };

  const space = choices.reduce((s, c) => s * c.length, 1);
  let best = null;
  if (space <= 200000) {
    const idx = new Array(choices.length).fill(0);
    for (let k = 0; k < space; k++) {
      let r = k;
      for (let i = 0; i < choices.length; i++) { idx[i] = r % choices[i].length; r = Math.floor(r / choices[i].length); }
      const picks = idx.map((j, i) => choices[i][j]);
      const e = evalAssign(picks);
      if (!best || e.total < best.total - 0.001 || (Math.abs(e.total - best.total) < 0.001 && e.byStore.length < best.byStore.length)) best = { ...e, picks };
    }
  } else {
    // zachłannie: najtaniej każdy, potem poprawki pojedynczych pozycji
    let picks = choices.map(c => [...c].sort((a, b) => a.price - b.price)[0]);
    let cur = evalAssign(picks), improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < choices.length; i++) for (const alt of choices[i]) {
        const trial = picks.slice(); trial[i] = alt;
        const e = evalAssign(trial);
        if (e.total < cur.total - 0.001) { picks = trial; cur = e; improved = true; }
      }
    }
    best = { ...cur, picks };
  }
  const split = { kind: 'split', stores: best.byStore.map(b => b.store), total: best.total, subtotal: best.subtotal, discount: best.discount, extras: best.extras,
    byStore: best.byStore, lines: best.picks.map((o, i) => line(products[i], o)) };
  return { single, split, missing: [] };
}

function line(p, o) { return { q: p.q, storeId: o.storeId, store: o.store, price: o.price, url: o.url, title: o.title, promos: (o.promos || []).map(r => r.label),
  raty: o.installments && o.installments.saving > 0 && !o.installments.upTo ? o.installments : null }; }

const api = { parsePromos, storeTotal, optimizeBasket, ruleDiscount };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Promos = api;
})(typeof self !== 'undefined' ? self : this);
