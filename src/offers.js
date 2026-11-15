// Zamiana wyników sklepów na listę ofert do koszyka.
// Oferty z Ceneo dochodzą jako osobne "sklepy" (np. allegro.pl, empik.com), jeśli nie sprawdziliśmy ich bezpośrednio.
(function (root) {
  const DOMAIN_TO_STORE = {
    'euro.com.pl': 'euro', 'mediaexpert.pl': 'mediaexpert', 'neonet.pl': 'neonet', 'mediamarkt.pl': 'mediamarkt',
    'oleole.pl': 'oleole', 'x-kom.pl': 'xkom', 'komputronik.pl': 'komputronik', 'morele.net': 'morele',
  };
  const shopKey = s => String(s || '').toLowerCase().replace(/^www\./, '').replace(/\s+/g, '');

  // Oferty z Ceneo liczą się tylko, gdy sklep potwierdził cenę i model (status ok / diff – wtedy cena ze sklepu).
  // includeUnverified: dołącz też niepotwierdzone (np. Allegro, które blokuje sprawdzanie) – oznaczone.
  function offersFromResults(results, opts = {}) {
    const direct = results.filter(r => r.status === 'ok' && r.price && !r.aggregator && (r.match === 'exact' || r.match === 'close'));
    const covered = new Set(direct.map(r => r.storeId));
    const out = direct.map(r => ({ storeId: r.storeId, store: r.store, price: r.price, promos: r.promos || [], url: r.url, title: r.title, match: r.match,
      installments: r.installments || null, extras: r.extras || [] }));
    for (const r of results) {
      if (!r.aggregator || r.status !== 'ok' || !(r.match === 'exact' || r.match === 'close')) continue;
      for (const o of r.offers || []) {
        const k = shopKey(o.shop);
        const mapped = DOMAIN_TO_STORE[k];
        if (mapped && covered.has(mapped)) continue; // ten sklep sprawdziliśmy bezpośrednio (z promocjami)
        const v = o.verify || {};
        if (v.status === 'wrong') continue;                        // inny produkt – nigdy
        const trusted = v.status === 'ok' || v.status === 'diff';
        if (!trusted && !opts.includeUnverified) continue;
        out.push({ storeId: 'ceneo:' + k, store: o.shop + ' (Ceneo)', price: trusted ? v.shopPrice : o.price, ceneoPrice: o.price,
          promos: [], url: o.url, title: o.title || r.title, match: r.match, via: 'ceneo', verified: trusted, ceneoOnly: !!v.ceneoOnly });
      }
    }
    return out;
  }

  const api = { offersFromResults, DOMAIN_TO_STORE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Offers = api;
})(typeof self !== 'undefined' ? self : this);
