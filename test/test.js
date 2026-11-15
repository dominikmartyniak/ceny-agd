// Testy offline – bez internetu. Uruchom: npm test
// (wymaga przeglądarki Playwright albo BROWSER_CHANNEL=chrome)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { scoreCandidate, isEan, modelsFromTitle } = require('../src/match');
const { parsePrice, priceFromTile } = require('../src/extract');
const { parsePromos, storeTotal, optimizeBasket } = require('../src/promos');
const { createShop, storesFor } = require('./fakeshop');
process.env.CENEO_VERIFY = '4';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓', m); };

console.log('Dopasowanie modeli / EAN:');
ok(scoreCandidate('WW80T504DAEA', 'Pralka Samsung WW80T504DAEA Funkcje AI 8kg').level === 'exact', 'dokładny model');
ok(scoreCandidate('WW90T534DAE', 'Pralka Samsung WW80T504DAEA').level === 'none', 'podobny model ≠ trafienie');
ok(scoreCandidate('WW80T504DAEA', 'Pralka Samsung WW80T504DAE biała').level === 'close', 'wariant = przybliżone');
ok(isEan('5901234123457') && !isEan('5901234123458') && !isEan('8806090963079'), 'suma kontrolna EAN');
ok(JSON.stringify(modelsFromTitle('Pralka Samsung WW80T504DAEA Funkcje AI 8kg 1400obr/min')) === '["WW80T504DAEA"]', 'model z nazwy (bez 8kg/1400obr)');

console.log('Ceny:');
ok(parsePrice('1 997,00 zł') === 1997 && parsePrice('1449,– zł') === 1449 && parsePrice('2.259,99 zł') === 2259.99, 'formaty cen');
ok(priceFromTile('Cena 1 997 zł 1 997 00 zł Najniższa cena z 30 dni przed obniżką: 1 998 zł Cena bez kodu: 2 259,99 zł 66,57 zł x 30 rat 0%') === 1997, 'kafelek Euro');
ok(priceFromTile('ZYSKAJ 268 ZŁ RABATU 67 ZŁ ZA KAŻDE WYDANE 500 ZŁ Cena: 1 899,00 zł') === 1899, 'pomija promocje w kafelku');

console.log('Promocje:');
const pe = parsePromos(['ZYSKAJ 268 ZŁ RABATU', '67 ZŁ ZA KAŻDE WYDANE 500 ZŁ', 'PIĄTY PRODUKT ZA 1 ZŁ!', 'NAWET 3 RATY GRATIS']).map(r => r.key);
ok(pe.includes('per_spend:67:500') && pe.includes('nth_for_1:5') && pe.length === 3, 'Euro: 67/500, 5. za 1 zł, raty (bez podwójnego "zyskaj 268")');
ok(parsePromos(['70 za 500', '66,57 zł x 30 rat']).map(r => r.key).join() === 'per_spend:70:500', 'Media Markt: "70 za 500", raty ignorowane');
ok(parsePromos(['Drugi produkt -50%']).map(r => r.key).join() === 'nth_percent:2:50', 'drugi produkt -50%');
const r67 = { key: 'per_spend:67:500', type: 'per_spend', get: 67, per: 500, label: '67/500' };
ok(storeTotal([{ price: 1997, promos: [r67] }, { price: 1499, promos: [r67] }, { price: 899, promos: [] }]).discount === 402, '67 zł za każde 500 zł tylko na objęte produkty (3496 -> 402)');
const n5 = { key: 'nth_for_1:5', type: 'nth_for_1', n: 5, label: '5 za 1' };
ok(storeTotal([1000, 900, 800, 700, 600].map(p => ({ price: p, promos: [n5] }))).discount === 599, '5. najtańszy za 1 zł');
const both = [1000, 900, 800, 700, 600].map(p => ({ price: p, promos: [n5, r67] }));
ok(storeTotal(both, false).discount === 599 && storeTotal(both, true).discount === 599 + 536, 'bez łączenia = najlepsza jedna; z łączeniem = suma');
const plan = optimizeBasket([
  { q: 'A', offers: [{ storeId: 'x', store: 'X', price: 1000, promos: [r67] }, { storeId: 'y', store: 'Y', price: 950, promos: [] }] },
  { q: 'B', offers: [{ storeId: 'x', store: 'X', price: 1000, promos: [r67] }, { storeId: 'y', store: 'Y', price: 980, promos: [] }] },
]);
ok(plan.single[0].stores[0] === 'X' && plan.single[0].total === 1732, 'jeden sklep: X z promocją (2000-268=1732) wygrywa z Y (1930)');
ok(plan.split.total === 1732, 'najlepszy podział uwzględnia promocję koszykową');

console.log('Raty, zwroty, fałszywe promocje:');
const { parsePricing, installmentCost, promoDetails, promoGroup } = require('../src/pricing');
const { promoVerdict } = require('../src/honesty');
const pp = parsePricing('66,57 zł × 30 rat 0%\nDwie raty gratis! W ratach spłacisz tylko 1 863,86 zł\nSpłacimy za Ciebie jako zwrot do banku\nZyskaj kod na kolejne zakupy nawet do 300 zł\nDO 3000 ZŁ ZWROTU');
const ic = installmentCost(1997, pp.installments);
ok(ic.total === 1863.86 && ic.saving === 133.14 && ic.freeCount === 2, '2 raty gratis: 1997 zł -> zapłacisz 1863,86 zł');
ok(pp.extras.length === 2 && pp.extras.some(e => e.kind === 'bon' && e.amount === 300) && pp.extras.some(e => e.kind === 'zwrot' && e.amount === 3000 && e.upTo), 'bon 300 zł i zwrot do 3000 zł osobno („zwrot do banku” to nie cashback)');
ok(installmentCost(1997, parsePricing('Nawet 3 raty gratis').installments).saving === 0, '„nawet 3 raty gratis” bez konkretów = brak pewnej oszczędności');
ok(installmentCost(1000, parsePricing('35,00 zł x 30 rat RRSO 9,5%').installments).extraCost === 50, 'raty płatne: dopłata 50 zł widoczna');
const it = (price, inst, promos) => ({ price, promos, installments: inst });
const rr = storeTotal([it(1997, ic, [r67]), it(1499, null, [r67])]);
ok(rr.method === 'cash' && rr.total === 3496 - 402 && rr.ratyTotal === 3496 - 133.14, 'raty gratis vs 67/500: nie łączą się – wybrany tańszy wariant (rabat)');
ok(storeTotal([it(1997, ic, [])]).method === 'raty' && storeTotal([it(1997, ic, [])], false, false).total === 1997, 'bez rabatu: raty gratis tańsze; wyłączenie rat = cena gotówkowa');
ok(promoVerdict({ price: 1897, regularPrice: 2399, lowest30: 1898 }).level === 'fake', 'Euro „−502 zł”, a najniższa z 30 dni 1898 zł = pozorna promocja');
ok(promoVerdict({ price: 2499, regularPrice: 2899, lowest30: 2799 }).level === 'real', 'prawdziwa obniżka względem 30 dni');
const now = Date.now();
ok(promoVerdict({ price: 2049, regularPrice: 2249 }, [{ price: 1899, ts: now - 20 * 864e5 }, { price: 2249, ts: now - 8 * 864e5 }], now).level === 'raised', 'historia: podniesiona przed „promocją”');
const pd = promoDetails('Rabat naliczamy od razu! Promocja trwa od 05.11.2026 do 17.11.2026. Kod: 67ZA500051126. Promocja nie łączy się z promocjami 3 raty gratis.', new Date('2026-11-15'));
ok(pd.until === '2026-11-17' && pd.code === '67ZA500051126' && pd.form === 'rabat' && /raty gratis/.test(pd.exclusions), 'strona promocji: do kiedy, kod, rabat od razu, z czym się nie łączy');
ok(['67 zł za każde wydane 500 zł', 'Nawet 3 raty gratis!', 'Piąty produkt za 1 zł', 'Siemens zwrot do 6500 zł', 'Kod na kolejne zakupy do 300 zł', 'Black Weeks – rabaty do 70%'].map(t => promoGroup(t).id).join() === 'kwota,raty,nty,zwrot,bon,procent', 'grupy promocji');

console.log('Szukanie po opisie:');
const { parseNeed, checkNeed, trustScore } = require('../src/need');
const n1 = parseNeed('lodówka do 200cm'), n2 = parseNeed('płyta indukcyjna pięcio polowa'), n3 = parseNeed('pralka 8kg do 2000 zł');
ok(n1.phrase === 'lodówka' && n1.filters.height.op === 'max' && n1.filters.height.v === 200, '„lodówka do 200cm” = wysokość ≤ 200 cm');
ok(n2.phrase === 'płyta indukcyjna' && n2.filters.zones === 5, '„pięcio polowa” = 5 pól');
ok(n3.filters.priceMax === 2000 && n3.filters.kg.v === 8, '„pralka 8kg do 2000 zł”');
ok(!checkNeed(n1, { height: 203 }, 2899, 'Lodówka Bosch 203cm').ok && checkNeed(n1, { height: 185.3 }, 2399, 'Lodówka Samsung').ok, '203 cm odpada, 185 cm pasuje');
ok(!checkNeed(parseNeed('płyta indukcyjna'), {}, 399, 'Zestaw garnków do indukcji').ok && !checkNeed(parseNeed('płyta indukcyjna'), {}, 799, 'Płyta gazowa Amica').ok, 'garnki i płyta gazowa odpadają');
ok(trustScore(5, 1) < trustScore(4.3, 40) && trustScore(4.9, 463) > trustScore(4.6, 120), '1 opinia 5/5 przegrywa z 40 opiniami 4,3');

(async () => {
  const shopSrv = createShop().listen(0);
  const base = `http://localhost:${shopSrv.address().port}`;
  const [A, B, C, CEN, ALG] = storesFor(base);
  const { offersFromResults } = require('../src/offers');
  const scraper = require('../src/scraper');

  console.log('Scraper (lokalne sklepy):');
  const r1 = await scraper.searchStore(A, 'WW80T504DAEA');
  ok(r1.status === 'ok' && r1.price === 1997 && r1.match === 'exact', `model -> 1997 zł exact (${r1.status} ${r1.price} ${r1.note || ''})`);
  ok(r1.promos.some(p => p.key === 'per_spend:67:500') && r1.promos.some(p => p.key === 'nth_for_1:5'), 'plakietki promocji z karty produktu');
  ok(r1.gtin === '8806090963070' && r1.lowest30 === 2049, 'EAN i najniższa z 30 dni');
  const r2 = await scraper.searchStore(A, 'WW90T534DAE');
  ok(r2.status === 'not_found', 'nieistniejący model -> not_found (mimo podsuniętych podobnych)');
  const r3 = await scraper.searchStore(B, '4242005224456');
  ok(r3.status === 'ok' && r3.match === 'exact' && r3.price === 2799, `EAN: sklep pokazał 2 wyniki, wybrany właściwy po gtin (${r3.status} ${r3.price})`);
  const r4 = await scraper.searchStore(C, '8806090963070');
  ok(r4.status === 'ok' && r4.match === 'exact', 'EAN tylko w danych technicznych strony (bez JSON-LD)');
  const r5 = await scraper.searchStore({ ...A, searchUrl: () => `${base}/blok/x` }, 'WW80T504DAEA');
  ok(r5.status === 'blocked', 'ochrona anty-bot -> blocked');

  console.log('Ceneo + Allegro:');
  const rc = await scraper.searchStore(CEN, 'WW80T504DAEA');
  ok(rc.status === 'ok' && rc.offers.length === 4 && rc.offers[0].shop === 'allegro.pl' && rc.price === 1937, `Ceneo: 4 oferty, na Ceneo najtaniej allegro.pl 1937 zł (${rc.status} ${rc.price})`);
  const vs = Object.fromEntries(rc.offers.map(o => [o.shop, o.verify]));
  ok(vs['allegro.pl'].status === 'blocked', 'Allegro z Ceneo: niepotwierdzone (CAPTCHA)');
  ok(vs['euro.com.pl'].status === 'diff' && vs['euro.com.pl'].shopPrice === 1997, 'euro: Ceneo 1977 zł, w sklepie naprawdę 1997 zł');
  ok(vs['empik.com'].status === 'wrong', 'empik: pod linkiem inny produkt');
  ok(vs['sklep-b.pl'].status === 'ok' && vs['sklep-b.pl'].ceneoOnly && vs['sklep-b.pl'].cleanPrice === 2049, 'sklep B: 1999 zł tylko z linku Ceneo (bez Ceneo 2049 zł)');
  ok(rc.verifiedPrice === 1997, 'najniższa potwierdzona cena z Ceneo: 1997 zł (nie 1937)');
  const ra = await scraper.searchStore(ALG, 'WW80T504DAEA');
  ok(ra.status === 'link' && /allegro\.pl\/listing\?string=WW80T504DAEA&order=p/.test(ra.url), 'Allegro: link do wyników od najtańszych');
  const offs = offersFromResults([r1, rc, ra]);
  ok(offs.some(o => o.storeId === 'shopa' && o.promos.length) && offs.some(o => o.storeId === 'ceneo:euro.com.pl' && o.price === 1997)
    && !offs.some(o => o.storeId === 'ceneo:allegro.pl' || o.storeId === 'ceneo:empik.com'), 'koszyk: tylko potwierdzone oferty z Ceneo, z ceną ze sklepu');
  const offsAll = offersFromResults([r1, rc, ra], { includeUnverified: true });
  ok(offsAll.some(o => o.storeId === 'ceneo:allegro.pl' && !o.verified) && !offsAll.some(o => o.storeId === 'ceneo:empik.com'), 'opcja „licz niepotwierdzone”: Allegro tak, inny produkt nigdy');

  console.log('Raty / zwroty / parametry z karty:');
  ok(r1.installments && r1.installments.total === 1863.86 && r1.regularPrice === 2249, 'karta: 2 raty gratis i cena „przed obniżką”');
  ok(r1.extras.length === 1 && r1.extras[0].amount === 200, 'zwrot Samsunga tak, baner „Siemens zwrot do 6500 zł” na karcie Samsunga – nie');
  ok(r1.specs.kg === 8 && r1.specs.width === 60 && r1.specs.energy === 'A' && /kat\/pralki/.test(r1.category.url), 'parametry i kategoria z okruszków');

  console.log('Podobne, ale tańsze:');
  const engine = require('../src/engine');
  const sim = await engine.similar([{ storeId: A.id, url: r1.url, title: r1.title, price: r1.price, specs: r1.specs, category: r1.category }], [A], { similarOne: (s, ref) => scraper.similarStore(s, ref) });
  const simT = sim.items.map(i => i.title).join(' | ');
  ok(/Beko/.test(simT) && /LG/.test(simT) && !/Indesit/.test(simT) && !/WW80T504DAEA/.test(simT), `tańsze z tymi samymi lub lepszymi parametrami, bez slim 6 kg (${simT})`);

  console.log('Szukanie po opisie (sklepy):');
  const listOne = (s, ph) => scraper.listStore(s, ph);
  const d1 = await engine.discover('płyta indukcyjna', [A, B, ALG], { listOne });
  const t1 = d1.items.map(i => i.title.split(' ')[2]);
  ok(t1[0] === 'Bosch' && t1.indexOf('Amica') > t1.indexOf('Samsung') && !t1.includes('Tefal') && !d1.items.some(i => /gazowa/.test(i.title)), `kolejność po opiniach, Amica z 1 opinią na końcu (${t1.join(', ')})`);
  const bosch = d1.items[0];
  ok(bosch.reviews === 563 && bosch.offers.length === 2 && bosch.price === 1897 && bosch.verdict.level === 'fake', 'Bosch: opinie z 2 sklepów, najniższa cena, pozorna promocja wykryta');
  ok(d1.items.find(i => /Amica/.test(i.title)).fewReviews && !d1.items.find(i => /Samsung/.test(i.title)).promo, 'oznaczenia: mało opinii / bez promocji');
  const d2 = await engine.discover('płyta indukcyjna pięciopolowa', [A], { listOne });
  ok(d2.items.length === 2 && d2.items.every(i => i.specs.zones === 5), 'pięciopolowe: tylko 5 pól');
  const d3 = await engine.discover('lodówka do 200cm', [A, B], { listOne });
  ok(d3.items.length === 1 && /186cm/.test(d3.items[0].title) && d3.items[0].promoLabels.some(l => /zwrot/.test(l)), 'lodówka ≤ 200 cm (203 cm odpada), zwrot widoczny');

  console.log('Dostępność w salonie:');
  const st = await scraper.checkStock(r1.url, 'Bielsko-Biała');
  ok(st.status === 'ok' && st.shops.length === 2, `znalezione 2 salony (${st.status} ${st.note || ''})`);
  ok(st.shops.some(s => s.status === 'yes') && st.shops.some(s => s.status === 'no'), 'statusy: dostępny / niedostępny');

  console.log('Promocje sklepu:');
  const pr = await scraper.storePromos(A);
  ok(pr.status === 'ok' && pr.rules.some(r => r.key === 'per_spend:67:500') && !pr.items.some(i => /regulamin|kontakt/i.test(i.title)), 'banery promocji ze strony głównej');
  const p67 = pr.items.find(i => /67/.test(i.title));
  ok(p67 && p67.group === 'kwota' && p67.details.code === '67ZA500051126' && p67.details.form === 'rabat' && /raty gratis/.test(p67.details.exclusions), 'szczegóły promocji: kod, rabat od razu, nie łączy się z ratami');
  ok(pr.items.some(i => i.group === 'raty' && i.details && i.details.until === '2026-11-30'), 'raty gratis: ważne do 30.11');

  console.log('Zdjęcie:');
  const img = path.join(__dirname, 'fixtures', 'tabliczka.jpg');
  if (fs.existsSync(img)) {
    const photo = require('../src/photo');
    const ph = await photo.recognize(fs.readFileSync(img));
    ok(ph.eans.includes('5901234123457'), 'kod EAN-13 ze zdjęcia');
    ok(ph.models.some(m => m.startsWith('WW80T504DAEA')), `model z tabliczki (${ph.models.join(', ')})`);
    await photo.shutdown();
  } else console.log('  (pominięto – brak test/fixtures/tabliczka.jpg)');

  await scraper.close();
  shopSrv.close();
  console.log(`\nWszystkie testy OK (${pass})`);
})().catch(e => { console.error('\nBŁĄD:', e.message); process.exit(1); });
