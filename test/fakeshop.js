// Lokalne "sklepy" do testów offline. Zachowują się jak prawdziwe:
// - wyszukiwarka podsuwa podobne modele, wyniki doładowuje JS,
// - cena w JSON-LD + EAN, plakietki promocji (jak Euro / Media Markt),
// - okno "Sprawdź dostępność w sklepach" z polem miasta i listą salonów (jak Euro),
// - strona główna z banerami promocji, strona anty-bot.
const express = require('express');

const CATALOG = {
  // id: [nazwa, ean, ceny w sklepach a/b/c]
  1: ['Pralka Samsung WW80T504DAEA 8kg 1400obr/min', '8806090963070', { a: 1997, b: 2049, c: 2099 }],
  2: ['Lodówka Bosch KGN39VLCT No Frost 203cm', '4242005224456', { a: 2899, b: 2799, c: 2999 }],
  3: ['Zmywarka Beko BDFN26430X 60cm', '8690842512346', { a: 1399, b: 1449, c: 1299 }],
  4: ['Pralka Samsung WW90CGC04DAH 9kg', '8806094900002', { a: 1799, b: 1749, c: 1849 }],
};
// Płyty, lodówki, pralki z parametrami i opiniami – do „szukania po opisie” i „podobne, ale tańsze”
Object.assign(CATALOG, {
  11: ['Płyta indukcyjna Bosch PVQ631HC1E 59,2cm', '4242005311111', { a: 1897, b: 1949 }],
  12: ['Płyta indukcyjna Amica PI6541 60cm', '5906006111112', { a: 999 }],
  13: ['Płyta indukcyjna Electrolux EIV835 80cm', '7332543111113', { a: 2499, b: 2549 }],
  14: ['Płyta indukcyjna Samsung NZ84F7NC6AB 80cm', '8806088111114', { a: 2299 }],
  15: ['Zestaw garnków Tefal Ingenio do indukcji', '3168430111115', { a: 399 }],
  16: ['Płyta gazowa Amica PGA6110 60cm', '5906006111116', { a: 799 }],
  17: ['Lodówka Samsung RB34T600FSA 186cm No Frost', '8801643111117', { a: 2399, b: 2449 }],
  18: ['Pralka Beko B5WFU78415WB 8kg 1400obr/min', '8690842111118', { a: 1499 }],
  19: ['Pralka Indesit MTWSE61294 Slim 6kg 1200obr/min', '8050147111119', { a: 999 }],
  20: ['Pralka LG F4WR510S0W 10kg 1400obr/min', '8806091111120', { a: 1899 }],
});
const WASH = (kg, d, rpm, en, db) => `Wymiary (GxSxW): ${d} x 60 x 85 cm\nPojemność: ${kg} kg\nKlasa energetyczna: ${en}\nMaksymalna prędkość wirowania: ${rpm} obr/min\nPoziom hałasu - wirowanie: ${db} dB`;
const META = {
  1: { cat: 'pralki', spec: WASH(8, 55, 1400, 'A', 72), rating: { a: [4.7, 812] } },
  2: { cat: 'lodowki', spec: 'Wymiary (GxSxW): 66,5 x 60 x 203 cm\nKlasa energetyczna: C\nBezszronowa (No Frost): pełny No Frost', rating: { a: [4.8, 640], b: [4.7, 90] } },
  4: { cat: 'pralki', spec: WASH(9, 55, 1400, 'A', 74), rating: { a: [4.5, 75] } },
  11: { cat: 'plyty', spec: 'Wymiary (szer. x gł.): 59,2 x 52,2 cm\nPola grzewcze: 4 pola indukcyjne', rating: { a: [4.9, 463], b: [4.8, 100] },
    lines: { a: ['bestseller', 'NAWET 3 RATY GRATIS', 'TANIEJ Z KODEM', 'Cena z kodem RBF1011171126C3', 'Najniższa cena z 30 dni przed obniżką: 1 898 zł', 'Cena bez kodu: 2 399 zł', 'RATY: 63,23 zł x 30 rat 0%'] } },
  12: { cat: 'plyty', spec: 'Wymiary (szer. x gł.): 59 x 52 cm\nPola grzewcze: 4 pola indukcyjne', rating: { a: [5.0, 1] }, lines: { a: ['NAWET 3 RATY GRATIS'] } },
  13: { cat: 'plyty', spec: 'Wymiary (szer. x gł.): 80 x 52 cm\nPola grzewcze: 5 pól indukcyjnych', rating: { a: [4.6, 120] },
    lines: { a: ['67 ZŁ ZA KAŻDE WYDANE 500 ZŁ', 'Najniższa cena z 30 dni przed obniżką: 2 799 zł', 'Przed obniżką: 2 899 zł'], b: ['70 za 500'] } },
  14: { cat: 'plyty', spec: 'Wymiary (szer. x gł.): 80 x 51 cm\nPola grzewcze: 5 pól indukcyjnych', rating: { a: [4.3, 40] } },
  15: { cat: 'plyty', spec: '', rating: { a: [4.9, 900] }, lines: { a: ['NAWET 3 RATY GRATIS'] } },
  16: { cat: 'plyty', spec: 'Pola grzewcze: 4 pola gazowe', rating: { a: [4.8, 300] }, lines: { a: ['NAWET 3 RATY GRATIS'] } },
  17: { cat: 'lodowki', spec: 'Wymiary (GxSxW): 65,8 x 59,5 x 185,3 cm\nKlasa energetyczna: D\nBezszronowa (No Frost): pełny No Frost', rating: { a: [4.7, 210] }, lines: { a: ['DO 1000 ZŁ ZWROTU', 'NAWET 3 RATY GRATIS'] } },
  18: { cat: 'pralki', spec: WASH(8, 55, 1400, 'A', 73), rating: { a: [4.6, 300] } },
  19: { cat: 'pralki', spec: 'Wymiary (GxSxW): 42 x 60 x 85 cm\nPojemność: 6 kg\nKlasa energetyczna: B\nMaksymalna prędkość wirowania: 1200 obr/min', rating: { a: [4.4, 50] } },
  20: { cat: 'pralki', spec: 'Wymiary (GxSxW): 56,5 x 60 x 85 cm\nPojemność: 10 kg\nKlasa energetyczna: A\nMaksymalna prędkość wirowania: 1400 obr/min\nPoziom hałasu - wirowanie: 71 dB', rating: { a: [4.8, 150] } },
};
const CAT_OF = { pralk: 'pralki', lodowk: 'lodowki', 'lodówk': 'lodowki', plyt: 'plyty', 'płyt': 'plyty' };

const BADGES = {
  a: ['67 ZŁ ZA KAŻDE WYDANE 500 ZŁ', 'PIĄTY PRODUKT ZA 1 ZŁ!', 'NAWET 3 RATY GRATIS'],
  b: ['70 za 500', '4 raty gratis!'],
  c: ['Drugi produkt -50%'],
};

function createShop() {
  const app = express();
  const richTile = (s, id) => {
    const [name, , prices] = CATALOG[id];
    const m = META[id], rt = m.rating[s];
    const lines = (m.lines && m.lines[s]) || [];
    const dl = m.spec ? `<dl>${m.spec.split('\n').map(l => { const [k, ...v] = l.split(':'); return `<div><dt>${k}:</dt><dd>${v.join(':').trim()}</dd></div>`; }).join('')}</dl>` : '';
    return `<div class="tile"><div class="head"><h2><a href="/${s}/p/${id}-${name.toLowerCase().replace(/\W+/g, '-')}.html">${name}</a></h2>
      ${rt ? `<div class="rating"><span>${rt[0].toFixed(1)}</span><span>${rt[0].toFixed(1)} gwiazdek</span><button>( ${rt[1]} ${rt[1] === 1 ? 'opinia' : 'opinii'} )</button></div>` : ''}</div>
      ${dl}${lines.map(l => `<div>${l}</div>`).join('')}<div class="price">Cena ${prices[s].toLocaleString('pl-PL')} zł</div></div>`;
  };
  // kategoria (jak Euro: /pralki.bhtml i /pralki,najtansze.bhtml)
  app.get('/:s/kat/:cat', (req, res) => {
    const s = req.params.s, cat = req.params.cat.replace(/,najtansze$/, '');
    let ids = Object.keys(META).filter(id => META[id].cat === cat && CATALOG[id][2][s]);
    if (/,najtansze$/.test(req.params.cat)) ids.sort((x, y) => CATALOG[x][2][s] - CATALOG[y][2][s]);
    res.send(`<html><body><nav aria-label="breadcrumb"><a href="/">Strona główna</a><a href="/${s}/kat/${cat}">${cat}</a></nav><div id="r"></div>
      <script>setTimeout(()=>{document.getElementById('r').innerHTML=${JSON.stringify(ids.map(id => richTile(s, id)).join(''))}},400)</script></body></html>`);
  });
  const tile = (s, id) => {
    if (META[id] && META[id].rating[s]) return richTile(s, id);
    const [name, , prices] = CATALOG[id];
    return `<div class="tile"><h2><a href="/${s}/p/${id}-${name.toLowerCase().replace(/\W+/g, '-')}.html">${name}</a></h2>
      <div class="badges">${BADGES[s].map(b => `<div><a href="/${s}/promo">${b}</a></div>`).join('')}</div>
      <span>Cena: ${prices[s].toLocaleString('pl-PL')},00 zł</span><span>${(prices[s] / 30).toFixed(2).replace('.', ',')} zł x 30 rat</span></div>`;
  };
  // --- atrapa Ceneo: wyszukiwarka + karta produktu z listą ofert wielu sklepów ---
  app.get('/ceneo/szukaj', (req, res) => {
    const q = String(req.query.q || '').toUpperCase().replace(/\s/g, '');
    const ids = Object.keys(CATALOG).filter(id => CATALOG[id][0].toUpperCase().replace(/\s/g, '').includes(q) || CATALOG[id][1] === q);
    res.send(`<html><body><a href="/ceneo/999999">Reklama: Odkurzacz XYZ od 429 zł</a>${ids.map(id => `<div><strong><a href="/ceneo/1000${id}">${CATALOG[id][0]}</a></strong><a href="/ceneo/1000${id}">od ${(Math.min(...Object.values(CATALOG[id][2])) - 60)},00zł</a></div>`).join('')}</body></html>`);
  });
  // Oferty na Ceneo celowo "podchwytliwe" – jak w życiu:
  //  allegro.pl  – najtańsza, ale link prowadzi na CAPTCHA (nie da się potwierdzić)
  //  euro.com.pl – Ceneo pokazuje 20 zł mniej niż sklep (nieaktualny feed)
  //  empik.com   – pod linkiem inny produkt
  //  sklep-b.pl  – cena prawdziwa, ale tylko po wejściu z Ceneo (bez Ceneo drożej)
  const ceneoOffers = id => {
    const p = CATALOG[id][2];
    return [
      ['allegro.pl', p.a - 60, '/blok/x', 4.9, 120000],
      ['euro.com.pl', p.a - 20, `/a/p/${id}-x.html?from=ceneo`, 4.6, 1602],
      ['empik.com', p.a - 10, `/c/p/4-x.html?utm_source=ceneo`, 4.2, 15],
      ['sklep-b.pl', p.b - 50, `/b/p/${id}-x.html?from=ceneo&utm_source=ceneo`, 4.8, 900],
    ];
  };
  app.get('/ceneo/:pid', (req, res) => {
    const id = String(req.params.pid).replace(/^1000/, '');
    if (!CATALOG[id]) return res.status(404).send('brak');
    const [name, , prices] = CATALOG[id];
    const li = ([shop, price, , rating, reviews], i) => `<li><div><div>Firma <a href="/Click/Offer/?e=${i}-${id}"><img alt="${shop}" src="x.png"></a>
      <span>Ocena ${String(rating).replace('.', ',')} / 5</span><span>${reviews} opinii</span></div>
      <div><a href="/Click/Offer/?e=${i}-${id}">${name} – oferta ${shop}</a></div>
      <div><a href="/Click/Offer/?e=${i}-${id}">${price.toLocaleString('pl-PL')},00zł</a><span>Darmowa wysyłka</span></div></div>
      <a href="/Click/Offer/?e=${i}-${id}">Idź do sklepu</a></li>`;
    res.send(`<html><head><title>${name} - Ceneo</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, offers: { '@type': 'AggregateOffer', lowPrice: String(prices.a - 60), priceCurrency: 'PLN' } })}</script></head>
      <body><h1>${name}</h1><div><a href="/Click/Offer/?e=0-${id}">${prices.a - 60},00zł</a><a href="/Click/Offer/?e=0-${id}">Idź do sklepu</a></div>
      <ul>${ceneoOffers(id).map(li).join('')}</ul></body></html>`);
  });
  app.get('/Click/Offer/', (req, res) => {
    const [i, id] = String(req.query.e || '').split('-');
    const o = CATALOG[id] && ceneoOffers(id)[+i];
    return o ? res.redirect(o[2]) : res.send('przekierowanie do sklepu');
  });

  app.get('/:s/szukaj', (req, res) => {
    const s = req.params.s, q = String(req.query.q || '').toUpperCase().replace(/\s/g, '');
    let ids = Object.keys(CATALOG).filter(id => (CATALOG[id][0].toUpperCase().replace(/\s/g, '').includes(q) || CATALOG[id][1] === q) && CATALOG[id][2][s]);
    // opis zamiast modelu ("płyta indukcyjna pięciopolowa") – jak Euro: przekierowanie do kategorii
    const cat = Object.entries(CAT_OF).find(([k]) => q.toLowerCase().includes(k.toUpperCase().toLowerCase()) || q.includes(k.toUpperCase()));
    if (cat && !ids.some(id => !META[id])) ids = Object.keys(META).filter(id => META[id].cat === cat[1] && CATALOG[id][2][s]);
    if (!ids.length) ids = ['4']; // jak prawdziwe sklepy: podsuń coś podobnego
    if (s === 'b' && q === '4242005224456') ids = ['2', '4']; // EAN -> kilka wyników, trzeba sprawdzić karty
    const html = ids.map(id => tile(s, id)).join('');
    res.send(`<html><body><h1>Wyniki</h1><div id="r"></div>
      <script>setTimeout(()=>{document.getElementById('r').innerHTML=${JSON.stringify(html)}},500)</script></body></html>`);
  });
  app.get('/:s/p/:slug', (req, res) => {
    const s = req.params.s, id = req.params.slug.split('-')[0];
    if (!CATALOG[id] || !CATALOG[id][2][s]) return res.status(404).send('brak');
    const [name, ean, basePrices] = CATALOG[id];
    const m = META[id];
    // sklep B daje niższą cenę tylko wchodzącym z Ceneo
    const prices = { ...basePrices, b: basePrices.b - (s === 'b' && req.query.from === 'ceneo' ? 50 : 0) };
    const showEan = s !== 'c'; // sklep c nie podaje EAN w JSON-LD, tylko w danych technicznych
    res.send(`<html><head><title>${name}</title><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Product', name, sku: 'SKU' + id, ...(showEan ? { gtin13: ean } : {}),
      offers: { '@type': 'Offer', price: String(prices[s]), priceCurrency: 'PLN', availability: 'https://schema.org/InStock' } })}</script></head>
      <body><nav aria-label="breadcrumb"><a href="/${s}/">Strona główna</a>${m ? `<a href="/${s}/kat/${m.cat}">${m.cat}</a>` : ''}</nav><h1>${name}</h1>
      ${m && m.spec ? `<table>${m.spec.split('\n').map(l => { const [k, ...v] = l.split(':'); return `<tr><th>${k}</th><td>${v.join(':').trim()}</td></tr>`; }).join('')}</table>` : ''}
      ${s === 'a' && id === '1' ? '<p>Przed obniżką: 2 249,00 zł</p><p>66,57 zł × 30 rat 0%</p><p>Dwie raty gratis! W ratach spłacisz tylko 1 863,86 zł</p><p>Spłacimy za Ciebie jako zwrot do banku</p><div><a href="/a/promo">Siemens – Zwrot do 6500 zł</a></div><div>Samsung: 200 zł zwrotu na konto</div>' : ''}
      <div class="badges">${BADGES[s].map(b => `<a href="/${s}/promo">${b}</a>`).join('')}</div>
      ${s === 'a' ? '<p>Najniższa cena z 30 dni przed obniżką: 2 049,00 zł</p>' : ''}
      ${s === 'c' ? `<ul><li>EAN: ${ean}</li></ul>` : ''}
      <div id="cookie" style="position:fixed;inset:0;background:rgba(0,0,0,.5)"><button>AKCEPTUJ</button></div>
      <button id="dost">Sprawdź dostępność w sklepach</button>
      <div id="dlg"></div>
      <script>
      document.getElementById('dost').onclick = () => {
        document.getElementById('dlg').innerHTML = '<div role="dialog"><input placeholder="Wpisz miejscowość lub kod pocztowy"><ul id="sug"></ul><div id="shops"></div></div>';
        const inp = document.querySelector('#dlg input');
        inp.oninput = () => { document.getElementById('sug').innerHTML = inp.value.length > 3 ? '<li><button id="pick">Bielsko-Biała</button></li>' : '';
          const p = document.getElementById('pick'); if (p) p.onclick = () => {
            document.getElementById('shops').innerHTML = '<h2>Sklepy w: Bielsko-Biała</h2>'
              + '<div class="shop"><p>Centrum Handlowe Sarni Stok</p><p>ul. Sarni Stok 2, 43-300 Bielsko-Biała</p><ul><li>Dostępny w sklepie od ręki</li></ul><p>Godziny otwarcia</p></div>'
              + '<div class="shop"><p>Galeria Sfera</p><p>ul. Mostowa 5, 43-300 Bielsko-Biała</p><ul><li>Towar nie jest dostępny w tym sklepie</li><li>Odbiór w sklepie: już pojutrze!</li></ul></div>'; }; };
      };
      </script></body></html>`);
  });
  app.get('/:s/', (req, res) => {
    const s = req.params.s;
    if (!BADGES[s]) return res.status(404).send('brak');
    res.send(`<html><body><h1>Sklep ${s}</h1>${BADGES[s].map(b => `<a href="/${s}/promo"><img alt="${b}" src="x.png"></a>`).join('')}
      <a href="/${s}/promo/bf">Black Weeks – rabaty do 70%</a><a href="/${s}/raty">Nawet 3 raty gratis!</a><a href="/${s}/regulamin">Regulamin</a><a href="/${s}/kontakt">Kontakt</a></body></html>`);
  });
  app.get('/:s/promo', (req, res) => res.send(`<html><body><h1>67 zł za każde wydane 500 zł</h1>
    <p>Rabat naliczamy od razu! Promocja trwa od 05.11.2026 do 17.11.2026 23:45. Kod: 67ZA500051126.</p>
    <p>Promocja nie łączy się z promocjami 3 raty gratis, 2 raty gratis, pierwsza rata gratis. Maksymalny rabat 2680 zł.</p></body></html>`));
  app.get('/:s/raty', (req, res) => res.send(`<html><body><h1>Nawet 3 raty gratis</h1><p>Promocja ważna do 30.11.2026. Raty spłacamy za Ciebie jako zwrot do banku.</p></body></html>`));
  app.get('/blok/*', (req, res) => res.send('<html><head><title>Just a moment...</title></head><body>Potwierdź, że nie jesteś robotem</body></html>'));
  return app;
}

function storesFor(base) {
  return ['a', 'b', 'c'].map((s, i) => ({
    id: 'shop' + s, name: ['Sklep A', 'Sklep B', 'Sklep C'][i], domain: 'localhost',
    searchUrl: q => `${base}/${s}/szukaj?q=${encodeURIComponent(q)}`,
    productHref: new RegExp(`/${s}/p/\\d+-[^?#]+\\.html`),
    promoUrls: [`${base}/${s}/`], verified: true, enabled: true,
  })).concat([
    { id: 'ceneo', name: 'Ceneo', domain: 'localhost', kind: 'ceneo', aggregator: true, verified: true, enabled: true,
      searchUrl: q => `${base}/ceneo/szukaj?q=${encodeURIComponent(q)}`, productHref: /\/ceneo\/\d{5,}$/ },
    { id: 'allegro', name: 'Allegro', domain: 'allegro.pl', linkOnly: true, verified: true, enabled: true,
      searchUrl: q => `https://allegro.pl/listing?string=${encodeURIComponent(q)}&order=p`, productHref: /allegro/ },
  ]);
}

module.exports = { createShop, storesFor, CATALOG };

if (require.main === module) {
  const port = Number(process.env.SHOP_PORT || 4100);
  createShop().listen(port, () => console.log('fake shop on', port));
}
