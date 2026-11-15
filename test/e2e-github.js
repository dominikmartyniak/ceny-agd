// Test całości wersji GitHub w widoku telefonu, bez internetu:
//  strona z _site  +  atrapa GitHub API (uruchamia prawdziwy gh/run.js)  +  sklepy testowe.
// Uruchom: BROWSER_CHANNEL=chrome node test/e2e-github.js   (zrzuty ekranu w /tmp/gh-*.png)
const path = require('path');
const fs = require('fs');
const express = require('express');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { createShop } = require('./fakeshop');
const { createMockGithub } = require('./mock-github');

const ROOT = path.join(__dirname, '..');
const listen = app => new Promise(r => { const s = app.listen(0, () => r(s)); });
const shot = process.env.SHOTS !== '0';

(async () => {
  const shop = await listen(createShop());
  const SHOP_PORT = String(shop.address().port);
  const env = { STORES_MODULE: path.join(__dirname, 'fake-stores.js'), SHOP_PORT };
  execFileSync(process.execPath, [path.join(ROOT, 'gh', 'build-site.js')], { env: { ...process.env, ...env }, stdio: 'inherit' });

  const gh = createMockGithub({ runEnv: { ...env, BROWSER_CHANNEL: process.env.BROWSER_CHANNEL || '', CONCURRENCY: '4', CENEO_VERIFY: '4' }, onRun: r => { if (r.conclusion !== 'success') console.log(r.log); } });
  const api = await listen(gh.app);
  const site = express();
  site.use(express.static(path.join(ROOT, '_site')));
  site.use('/node_modules', express.static(path.join(ROOT, 'node_modules'))); // biblioteki OCR lokalnie zamiast CDN
  const web = await listen(site);
  const API = `http://localhost:${api.address().port}`, WEB = `http://localhost:${web.address().port}`;

  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pl-PL' });
  await ctx.addInitScript(() => { window.LIB_BASE = '/node_modules/'; });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  let pass = 0; const ok = (c, m) => { if (!c) throw new Error('NIE: ' + m); pass++; console.log('  ✓', m); };

  console.log('Wersja GitHub (telefon):');
  await p.goto(`${WEB}/?api=${encodeURIComponent(API)}`);
  await p.waitForSelector('#ghBox:not([hidden])');
  ok(!(await p.isHidden('#v-settings')), 'bez tokenu otwierają się Ustawienia');
  await p.fill('#ghOwner', 'o'); await p.fill('#ghRepo', 'r'); await p.fill('#ghToken', 'zly-token');
  await p.click('#ghSave'); await p.waitForSelector('#ghMsg:has-text("❌")');
  ok(/nieprawidłowy/i.test(await p.textContent('#ghMsg')), 'zły token -> czytelny błąd');
  await p.fill('#ghToken', 'test-token'); await p.click('#ghSave'); await p.waitForSelector('#ghMsg:has-text("Połączono")');
  ok(true, 'połączenie z GitHubem');
  if (shot) await p.screenshot({ path: '/tmp/gh-1-ustawienia.png' });
  // link z dostępem: druga osoba otwiera link i od razu może szukać (bez wpisywania tokenu)
  const link = await p.evaluate(() => B.shareLink());
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: 'pl-PL' });
  const p2 = await ctx2.newPage();
  await p2.goto(`${WEB}/?api=${encodeURIComponent(API)}${link.slice(link.indexOf('#'))}`);
  await p2.waitForFunction(() => document.querySelector('#v-search') && !document.querySelector('#v-search').hidden, null, { timeout: 15000 });
  ok(!(await p2.evaluate(() => location.hash)) && (await p2.evaluate(() => JSON.parse(localStorage.getItem('gh')).token)) === 'test-token', 'link z dostępem: od razu wyszukiwarka, token zapisany, znika z paska adresu');
  await ctx2.close();

  // wyszukiwanie
  await p.click('nav.tabs [data-tab="search"]');
  await p.fill('#q', 'WW80T504DAEA'); await p.click('#go');
  await p.waitForSelector('.status-line', { timeout: 10000 });
  const status = await p.textContent('#summary');
  ok(/GitHub|maszyn|Szukam|przeglądark/i.test(status), `status zlecenia widoczny („${status.replace(/\s+/g, ' ').slice(0, 60)}…”)`);
  await p.waitForFunction(() => !document.querySelector('#go').disabled, null, { timeout: 120000 });
  const sum = await p.textContent('#summary');
  ok(/Najtaniej: 1997 zł/.test(sum) && !/1937/.test(sum), `niepotwierdzona cena z Ceneo (1937 zł) nie jest „najtaniej” (${sum.replace(/\s+/g, ' ').slice(0, 70)})`);
  ok(/🔒 allegro\.pl/.test(await p.textContent('.offers')) && /⚠️ euro\.com\.pl/.test(await p.textContent('.offers')), 'oferty z Ceneo oznaczone: 🔒 Allegro, ⚠️ inna cena w sklepie');
  ok(/tylko z linku Ceneo/.test(await p.textContent('.offers')), 'ostrzeżenie: cena tylko z linku Ceneo');
  ok(await p.isVisible('text=Otwórz Allegro – od najtańszych'), 'przycisk Allegro');
  ok((await p.$$('#list .row')).length === 5, '5 wierszy: 3 sklepy + Ceneo + Allegro');
  ok(/zapłacisz 1863,86 zł/.test((await p.textContent('#list')).replace(/\s/g, ' ').replace(/ (?=\d{3},)/g, '')), 'raty gratis na wierszu sklepu: zapłacisz 1863,86 zł');
  ok(/Na raty gratis/.test(await p.textContent('#summary')), 'podsumowanie: raty gratis taniej niż gotówka');
  ok(/zwrot/i.test(await p.textContent('#list .money')) && !/6500/.test(await p.textContent('#list')), 'zwrot producenta osobno, cudzy baner pominięty');
  ok(gh.read('history/WW80T504DAEA.json').entries.length >= 4, 'historia zapisana w repozytorium');
  if (shot) await p.screenshot({ path: '/tmp/gh-2-wyniki.png', fullPage: true });

  // podobne, ale tańsze
  await p.click('#similarBtn');
  await p.waitForSelector('#similarBox .dcard', { timeout: 120000 });
  const simTxt = await p.textContent('#similarBox');
  ok(/Beko/.test(simTxt) && !/Indesit/.test(simTxt), 'podobne, ale tańsze: Beko tak, slim 6 kg nie');
  if (shot) await p.screenshot({ path: '/tmp/gh-2b-podobne.png', fullPage: true });

  // drugie wyszukiwanie -> wykres
  await p.click('#refresh');
  await p.waitForFunction(() => !document.querySelector('#go').disabled && document.querySelector('#historyBox svg'), null, { timeout: 120000 });
  ok(true, 'wykres historii po 2. wyszukiwaniu');

  // obserwowane
  p.once('dialog', d => d.accept('1900'));
  await p.click('#watchBtn'); await p.waitForTimeout(1500);
  ok((gh.read('watch.json') || [])[0]?.target === 1900, 'obserwowany produkt zapisany w repozytorium (próg 1900 zł)');
  await p.click('nav.tabs [data-tab="watch"]'); await p.waitForSelector('#watchList [data-q]');
  ok(true, 'lista obserwowanych');

  // dostępność w salonie
  await p.click('nav.tabs [data-tab="settings"]'); await p.fill('#city', 'Bielsko-Biała'); await p.press('#city', 'Tab');
  await p.click('nav.tabs [data-tab="search"]');
  await p.click('[data-stock="shopa"]');
  await p.waitForSelector('.stock:not(:has(.spin))', { timeout: 120000 });
  ok(/Sarni Stok/.test(await p.textContent('.stock')), 'dostępność w salonie przez GitHub');
  if (shot) await p.screenshot({ path: '/tmp/gh-3-salon-wykres.png', fullPage: true });

  // zdjęcie – rozpoznawanie w przeglądarce
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#camBtn')]);
  await fc.setFiles(path.join(__dirname, 'fixtures', 'tabliczka.jpg'));
  await p.waitForSelector('#photoBox [data-v]', { timeout: 120000 });
  const chips = await p.$$eval('#photoBox [data-v]', els => els.map(e => e.dataset.v));
  ok(chips.includes('5901234123457') && chips.includes('WW80T504DAEA'), `zdjęcie w telefonie: ${chips.join(', ')}`);

  // koszyk
  await p.click('nav.tabs [data-tab="basket"]');
  for (const q of ['WW80T504DAEA', 'KGN39VLCT', 'BDFN26430X']) { await p.fill('#bq', q); await p.press('#bq', 'Enter'); }
  await p.click('#runBasket');
  await p.waitForSelector('#basketOut .card.win', { timeout: 240000 });
  const win = (await p.textContent('#basketOut .card.win h3')).replace(/\s+/g, ' ');
  ok(/zł/.test(win), `plan koszyka: ${win}`);
  if (shot) await p.screenshot({ path: '/tmp/gh-4-koszyk.png', fullPage: true });

  // szukanie po opisie
  await p.click('nav.tabs [data-tab="search"]');
  await p.fill('#q', 'płyta indukcyjna'); await p.click('#go');
  await p.waitForSelector('#disc .dcard', { timeout: 120000 });
  await p.waitForFunction(() => !document.querySelector('#go').disabled, null, { timeout: 120000 });
  const firstCard = await p.textContent('#disc .dcard');
  ok(/Bosch/.test(firstCard) && /563 opinie/.test(firstCard), 'opis „płyta indukcyjna”: pierwsza Bosch (4,88 z 563 opinii)');
  ok(/Pozorna promocja/.test(firstCard), 'pozorna promocja oznaczona');
  ok(!/Samsung/.test(await p.textContent('#disc .dlist')), '„tylko na promocji”: Samsung bez promocji ukryty');
  await p.click('#onlyPromo');
  const titles = await p.$$eval('#disc .dtitle', els => els.map(e => e.textContent));
  ok(titles.length === 4 && /Amica/.test(titles[3]), `po odznaczeniu: 4 płyty, Amica z 1 opinią ostatnia (${titles.map(t => t.split(' ')[2]).join(', ')})`);
  ok(!(await p.isVisible('#toolbar')) && await p.isVisible('#disc'), 'widok propozycji zamiast tabeli cen');
  if (shot) await p.screenshot({ path: '/tmp/gh-5-opis.png', fullPage: true });
  await p.fill('#q', 'płyta indukcyjna pięciopolowa'); await p.click('#go');
  await p.waitForFunction(() => !document.querySelector('#go').disabled && document.querySelector('#disc .dcard'), null, { timeout: 120000 });
  ok((await p.$$('#disc .dcard')).length === 2 && /5 pól grzewczych/.test(await p.textContent('#disc .need')), 'pięciopolowe: 2 płyty');

  // promocje – przycisk na ekranie głównym
  await p.click('#promoNow');
  await p.waitForFunction(() => !document.querySelector('#loadPromos').disabled && !document.querySelector('#promoStores .spin'), null, { timeout: 120000 });
  const promoTxt = await p.textContent('#promoOut');
  ok(/67 ZŁ ZA KAŻDE/i.test(promoTxt) && /67ZA500051126/.test(promoTxt) && /nie łączy się/.test(promoTxt), 'promocje: kod, „nie łączy się z ratami”');
  ok(/Raty gratis/.test(promoTxt) && /Rabat za kwotę/.test(promoTxt), 'promocje pogrupowane');
  if (shot) await p.screenshot({ path: '/tmp/gh-6-promocje.png', fullPage: true });

  ok(!errs.length, 'brak błędów JS na stronie' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(`\nWersja GitHub OK (${pass})`);
  await b.close(); shop.close(); api.close(); web.close();
  fs.rmSync(path.join(ROOT, '_site'), { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.error('\nBŁĄD:', e.message); process.exit(1); });
