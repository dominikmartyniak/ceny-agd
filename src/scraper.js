const path = require('path');
const { chromium } = require('playwright');
const { scoreCandidate, parseQuery, isEan, modelsFromTitle } = require('./match');
const { collectTilesInPage, collectLinksInPage, extractProductInPage, extractCeneoOffersInPage, harvestPromoLinksInPage, isBlockedInPage, parsePrice, priceFromTile } = require('./extract');
const { parsePromos } = require('./promos');
const { parsePricing, installmentCost, promoGroup, promoDetails } = require('./pricing');
const { parseSpecs, compareSpecs } = require('./specs');
const { parseTile } = require('./discover');

const HEADLESS = process.env.HEADLESS !== 'false';
const CHANNEL = process.env.BROWSER_CHANNEL || undefined;        // np. "chrome" lub "msedge"
const HUMAN_WAIT_S = Number(process.env.HUMAN_WAIT_S || 60);       // ile czekać na ręczne potwierdzenie w trybie z oknem
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT_MS || 30000);
const PROFILE_DIR = process.env.PROFILE_DIR || path.join(__dirname, '..', 'browser-profile');

let ctxPromise = null;

async function getContext() {
  if (ctxPromise) return ctxPromise;
  ctxPromise = (async () => {
    const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: HEADLESS,
      channel: CHANNEL,
      locale: 'pl-PL',
      timezoneId: 'Europe/Warsaw',
      viewport: { width: 1366, height: 900 },
      args: process.env.IN_DOCKER ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });
    // tryb headless przedstawia się jako "HeadlessChrome" – podajemy zwykły identyfikator Chrome
    const page = ctx.pages()[0] || await ctx.newPage();
    ctx._ua = (await page.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome');
    await ctx.setExtraHTTPHeaders({ 'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.6' });
    ctx.on('close', () => { ctxPromise = null; });
    return ctx;
  })().catch(e => { ctxPromise = null; throw e; });
  return ctxPromise;
}

async function newPage({ images = false } = {}) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  if (HEADLESS && ctx._ua) {
    const cdp = await ctx.newCDPSession(page).catch(() => null);
    if (cdp) await cdp.send('Network.setUserAgentOverride', { userAgent: ctx._ua, acceptLanguage: 'pl-PL' }).catch(() => {});
  }
  // przyspieszenie: bez obrazków, fontów i wideo
  await page.route('**/*', route => {
    const t = route.request().resourceType();
    if ((!images && t === 'image') || t === 'font' || t === 'media') return route.abort();
    return route.continue();
  });
  page.setDefaultTimeout(NAV_TIMEOUT);
  return page;
}

async function withPage(fn, opts) {
  let page;
  try { page = await newPage(opts); return await fn(page); }
  finally { if (page) page.close().catch(() => {}); }
}

async function waitIfBlocked(page) {
  if (!(await page.evaluate(isBlockedInPage).catch(() => false))) return false;
  if (HEADLESS) return true;
  // tryb z oknem: dajemy człowiekowi czas na potwierdzenie w otwartym oknie
  const deadline = Date.now() + HUMAN_WAIT_S * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    if (!(await page.evaluate(isBlockedInPage).catch(() => true))) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return false;
    }
  }
  return true;
}

// Czeka aż na stronie pojawią się linki do produktów (wyniki ładowane JS-em)
async function waitForProducts(page, store, maxMs = 12000) {
  const src = store.productHref.source, flags = store.productHref.flags;
  await page.waitForFunction(([s, f]) => {
    const re = new RegExp(s, f);
    return [...document.querySelectorAll('a[href]')].some(a => re.test(a.href))
      || /nie znaleźliśmy|brak wyników|nie znaleziono|0 produktów|brak produktów/i.test(document.body.innerText || '');
  }, [src, flags], { timeout: maxMs, polling: 400 }).catch(() => {});
  await page.waitForTimeout(600); // dociągnięcie cen w kafelkach
}

function sameDomain(href, domain) {
  try { const h = new URL(href).hostname; return h === domain || h.endsWith('.' + domain); } catch { return false; }
}

function slugText(href) {
  try { return decodeURIComponent(new URL(href).pathname).replace(/[\/_.-]+/g, ' '); } catch { return ''; }
}

function productLinks(links, store) {
  let pool = links.filter(l => sameDomain(l.href, store.domain) && store.productHref.test(l.href));
  if (!pool.length) pool = links.filter(l => sameDomain(l.href, store.domain));
  return pool;
}

function rankCandidates(links, store, query) {
  const q = parseQuery(query);
  return productLinks(links, store)
    .map(l => ({ ...l, ...scoreCandidate(q, `${l.text} ${slugText(l.href)}`), tilePrice: priceFromTile(l.tile) }))
    .filter(c => c.level !== 'none')
    .sort((a, b) => b.score - a.score || (a.tilePrice ?? 1e12) - (b.tilePrice ?? 1e12));
}

async function readProductPage(page, url) {
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (await waitIfBlocked(page)) return { blocked: true };
  await page.waitForFunction(() => document.querySelector('script[type="application/ld+json"]') || document.querySelector('h1'),
    null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
  return page.evaluate(extractProductInPage);
}

const digits = s => String(s || '').replace(/\D/g, '');
const gtinEq = (a, b) => a && b && digits(a).replace(/^0+/, '') === digits(b).replace(/^0+/, '');

// Główna funkcja: wyszukaj produkt (model / nazwa / EAN) w jednym sklepie
async function searchStore(store, query) {
  const t0 = Date.now();
  const ean = isEan(query) ? digits(query) : null;
  const base = { storeId: store.id, store: store.name, searchUrl: store.searchUrl(query), aggregator: !!store.aggregator, byEan: !!ean };
  if (store.linkOnly) {
    return { ...base, status: 'link', url: base.searchUrl, title: `Otwórz wyniki w ${store.name} (od najtańszych)`,
      note: `${store.name} blokuje automatyczne sprawdzanie – oferty z ${store.name} pokazuje Ceneo (jeśli są), a przycisk otwiera wyniki posortowane po cenie.`, ms: 0 };
  }
  try {
    return await withPage(async page => {
      await page.goto(base.searchUrl, { waitUntil: 'domcontentloaded' });
      if (await waitIfBlocked(page)) {
        return { ...base, status: 'blocked', note: 'Sklep zablokował automatyczne zapytanie (ochrona anty-bot). Otwórz link wyszukiwania ręcznie albo uruchom aplikację z HEADLESS=false.', ms: Date.now() - t0 };
      }

      // Część sklepów przy dokładnym trafieniu przekierowuje od razu na kartę produktu
      const direct = await page.evaluate(extractProductInPage).catch(() => null);
      if (direct && direct.price && direct.source === 'json-ld' && store.productHref.test(page.url())) {
        const m = ean ? { level: (gtinEq(direct.gtin, ean) || direct.pageGtins.some(g => gtinEq(g, ean))) ? 'exact' : 'close' }
          : scoreCandidate(query, `${direct.name} ${direct.sku || ''} ${slugText(page.url())}`);
        if (m.level !== 'none') return store.kind === 'ceneo' ? ceneoResult(base, page, direct, { text: direct.name }, m.level, t0, query) : finish(base, direct, page.url(), m, null, [], t0);
      }

      await waitForProducts(page, store);
      const links = await page.evaluate(collectLinksInPage);

      // --- wyszukiwanie po EAN: link nie zawiera EAN, więc sprawdzamy karty pierwszych wyników ---
      if (ean) {
        const pool = productLinks(links, store).filter(l => l.text.length > 8).slice(0, 3);
        if (!pool.length) return { ...base, status: 'not_found', note: 'Sklep nie znalazł tego kodu EAN.', alternatives: [], ms: Date.now() - t0 };
        let fallback = null;
        for (const cand of pool) {
          const prod = await readProductPage(page, cand.href);
          if (prod.blocked) return { ...base, status: 'blocked', url: cand.href, note: 'Karta produktu zablokowana przez ochronę anty-bot.', ms: Date.now() - t0 };
          if (prod.price == null && cand.tilePrice) { prod.price = cand.tilePrice; prod.source = 'wyniki'; }
          const hit = gtinEq(prod.gtin, ean) || prod.pageGtins.some(g => gtinEq(g, ean));
          const cTile = { ...cand, tilePrice: priceFromTile(cand.tile) };
          if (hit) return store.kind === 'ceneo' ? ceneoResult(base, page, prod, cTile, 'exact', t0, query) : finish(base, prod, page.url(), { level: 'exact' }, cTile, [], t0, null, cand.tile);
          if (!fallback && pool.length === 1 && !prod.gtin) fallback = { prod, url: page.url(), cand: cTile };
        }
        if (fallback && store.kind === 'ceneo') { await page.goto(fallback.url, { waitUntil: 'domcontentloaded' }); return ceneoResult(base, page, fallback.prod, fallback.cand, 'close', t0, query); }
        if (fallback) return finish(base, fallback.prod, fallback.url, { level: 'close' }, fallback.cand, [], t0,
          'Sklep nie podaje EAN na karcie – jedyny wynik wyszukiwania, sprawdź model.', fallback.cand.tile);
        return { ...base, status: 'not_found', note: 'Wyniki wyszukiwania mają inny EAN.', alternatives: pool.map(c => ({ title: c.text.slice(0, 140), url: c.href, price: priceFromTile(c.tile) })), ms: Date.now() - t0 };
      }

      const ranked = rankCandidates(links, store, query);
      const alternatives = ranked.slice(1, 4).map(c => ({ title: c.text.slice(0, 140), url: c.href, price: c.tilePrice, level: c.level }));
      const best = ranked[0];
      if (!best || best.level === 'weak') {
        return {
          ...base, status: 'not_found',
          note: best ? 'Brak dokładnego modelu – sklep pokazuje tylko podobne produkty.' : 'Brak wyników.',
          alternatives: ranked.slice(0, 3).map(c => ({ title: c.text.slice(0, 140), url: c.href, price: c.tilePrice, level: c.level })),
          ms: Date.now() - t0,
        };
      }

      const prod = await readProductPage(page, best.href);
      if (prod.blocked) {
        if (best.tilePrice) return finish(base, { name: best.text, price: best.tilePrice, source: 'wyniki', promoTexts: [] }, best.href, best, best, alternatives, t0,
          'Karta produktu zablokowana – cena z listy wyników.', best.tile);
        return { ...base, status: 'blocked', url: best.href, note: 'Karta produktu zablokowana przez ochronę anty-bot.', ms: Date.now() - t0 };
      }
      const verify = scoreCandidate(query, `${prod.name || ''} ${prod.sku || ''} ${slugText(page.url())}`);
      const level = rank(verify.level) >= rank(best.level) ? verify.level : best.level;
      if (store.kind === 'ceneo') return ceneoResult(base, page, prod, best, level, t0, query);
      if (prod.price == null && best.tilePrice) { prod.price = best.tilePrice; prod.source = 'wyniki'; }
      return finish(base, prod, page.url(), { level }, best, alternatives, t0, null, best.tile);
    });
  } catch (e) {
    return { ...base, status: 'error', note: shortErr(e), ms: Date.now() - t0 };
  }
}

// Ceneo: zamiast jednej ceny – lista ofert sklepów.
// Ceneo pokazuje ceny z plików od sklepów – bywają nieaktualne, dotyczą innego wariantu albo obowiązują
// tylko po wejściu z Ceneo. Dlatego najtańsze oferty sprawdzamy w samym sklepie.
const CENEO_VERIFY = Number(process.env.CENEO_VERIFY ?? 3);

async function ceneoResult(base, page, prod, best, level, t0, query) {
  await page.waitForSelector('a[href*="/Click/Offer/"]', { timeout: 6000 }).catch(() => {});
  const offers = await page.evaluate(extractCeneoOffersInPage).catch(() => []);
  const ceneoUrl = cleanUrl(page.url());
  // model do weryfikacji: z nazwy produktu na Ceneo (działa też, gdy szukano po EAN)
  const verifyQ = modelsFromTitle(prod.name || best.text || '')[0] || query;
  for (const o of offers.slice(0, CENEO_VERIFY)) o.verify = await verifyOffer(page, o, verifyQ);
  for (const o of offers.slice(CENEO_VERIFY)) o.verify = { status: 'unchecked' };
  const trusted = offers.filter(o => o.verify && (o.verify.status === 'ok' || o.verify.status === 'diff'));
  const minTrusted = trusted.length ? Math.min(...trusted.map(o => o.verify.shopPrice)) : null;
  const price = offers.length ? offers[0].price : (prod.price ?? best.tilePrice ?? null);
  const bad = offers.filter(o => o.verify && ['diff', 'wrong'].includes(o.verify.status)).length;
  return {
    ...base, status: price ? 'ok' : 'no_price', title: prod.name || best.text, price, verifiedPrice: minTrusted,
    url: ceneoUrl, match: level, offers, gtin: prod.gtin || null, image: prod.image || null, promos: [],
    note: offers.length ? `${offers.length} ofert w Ceneo, sprawdzone w sklepach: ${Math.min(CENEO_VERIFY, offers.length)}${bad ? ` – ${bad} z nich ma w sklepie inną cenę albo inny produkt` : ''}` : null,
    alternatives: [], ms: Date.now() - t0,
  };
}

async function verifyOffer(page, o, q) {
  try {
    await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const finalUrl = page.url();
    const shop = new URL(finalUrl).hostname.replace(/^www\./, '');
    if (await page.evaluate(isBlockedInPage).catch(() => false)) return { status: 'blocked', shop, note: 'sklep blokuje automatyczne sprawdzenie' };
    const sp = await readProductPage(page, null);
    if (sp.blocked) return { status: 'blocked', shop };
    const m = scoreCandidate(q, `${sp.name || ''} ${sp.sku || ''} ${slugText(finalUrl)}`);
    if (m.level === 'none' || m.level === 'weak') return { status: 'wrong', shop, title: (sp.name || '').slice(0, 120), note: 'w sklepie jest inny produkt' };
    const shopPrice = sp.price;
    if (!shopPrice) return { status: 'noprice', shop };
    const v = { status: Math.abs(shopPrice - o.price) <= Math.max(1, o.price * 0.005) ? 'ok' : 'diff', shop, shopPrice, url: cleanUrl(finalUrl) };
    // cena tylko po wejściu z Ceneo? – sprawdź ten sam produkt bez parametrów z Ceneo
    const u = new URL(finalUrl);
    if ([...u.searchParams.keys()].some(k => /ceneo|^from$|^utm_/i.test(k) || /ceneo/i.test(u.searchParams.get(k)))) {
      const clean = u.origin + u.pathname;
      await page.goto(clean, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      const cp = await readProductPage(page, null).catch(() => ({}));
      if (cp && cp.price && cp.price > shopPrice * 1.005) { v.cleanPrice = cp.price; v.ceneoOnly = true; }
    }
    return v;
  } catch (e) {
    return { status: 'error', note: shortErr(e) };
  }
}

function rank(l) { return { exact: 3, close: 2, weak: 1, none: 0 }[l] || 0; }

function finish(base, prod, url, match, best, alternatives, t0, extraNote, tileText) {
  const notes = [];
  if (extraNote) notes.push(extraNote);
  const listPrice = best ? best.tilePrice : null;
  const noCode = parsePrice(prod.noCodePrice);
  // Cena efektywna = najniższa z: karta produktu, lista wyników (często cena z kodem)
  let price = prod.price ?? null;
  let codePrice = null;
  if (listPrice && price && listPrice < price * 0.995) { codePrice = listPrice; }
  if (noCode && price && noCode > price * 1.005) { codePrice = price; } // karta pokazuje cenę z kodem jako główną
  if (prod.hasCodePrice) notes.push(`Cena z kodem rabatowym${prod.codePriceText && /[A-Z0-9]{6,}/.test(prod.codePriceText) ? ' (' + (prod.codePriceText.match(/[A-Z0-9]{6,}/) || [''])[0] + ')' : ''} – kod trzeba wpisać w koszyku.`);
  if (match.level === 'close') notes.push('Dopasowanie przybliżone (inny wariant/kolor modelu?) – sprawdź.');
  if (codePrice && codePrice !== price) notes.push(`Na liście wyników: ${codePrice.toFixed(2)} zł (cena z kodem/promocja).`);
  const effective = codePrice ? Math.min(codePrice, price) : price;

  const promos = parsePromos([...(prod.promoTexts || []), tileText || '']);
  const pr = parsePricing([...(prod.priceLines || []), tileText || ''].join('\n'));
  const specs = parseSpecs((prod.specPairs || []).join('\n') + '\n' + (tileText || ''), prod.name || (best && best.text) || '');
  const regular = noCode || pr.noCode || pr.beforeDiscount || (codePrice ? price : null);
  const inst = installmentCost(effective, pr.installments);
  // zwroty/bony z banerów innych marek to nie ten produkt
  const name = (prod.name || (best && best.text) || '').toLowerCase();
  const extras = (pr.extras || []).filter(e => { const b = (e.line || e.label).toLowerCase().match(BRAND_RE); return !b || name.includes(b[0]); });
  const crumbs = prod.crumbs || [];
  return {
    ...base,
    status: price ? 'ok' : 'no_price',
    title: prod.name || (best && best.text) || null,
    price: effective,
    regularPrice: regular && regular > effective * 1.005 ? regular : null,
    srp: pr.srp || null,
    installments: inst,
    extras,
    specs,
    category: crumbs.length ? crumbs[crumbs.length - 1] : null,
    listPrice,
    currency: prod.currency || 'PLN',
    availability: prod.availability || null,
    lowest30: pr.lowest30 || (prod.lowest30 ? parsePrice(prod.lowest30) : null),
    gtin: prod.gtin || (prod.pageGtins && prod.pageGtins[0]) || null,
    url: cleanUrl(url),
    image: prod.image || null,
    match: match.level,
    priceSource: prod.source || null,
    promos,
    note: notes.join(' ') || (price ? null : 'Nie udało się odczytać ceny.'),
    alternatives: alternatives || [],
    ms: Date.now() - t0,
  };
}

const BRAND_RE = /\b(samsung|siemens|bosch|lg|electrolux|aeg|whirlpool|beko|candy|hoover|gorenje|amica|indesit|hotpoint|miele|haier|sharp|philips|sony|tcl|hisense|panasonic|xiaomi|fiskars|neff|teka|smeg|liebherr|grundig|dyson|ciarko|akpo|elica|maan|faber)\b/;

function cleanUrl(u) {
  try { const x = new URL(u); ['cid', 'eid', 'utm_source', 'utm_medium', 'utm_campaign', 'link'].forEach(p => x.searchParams.delete(p)); return x.href; }
  catch { return u; }
}

function shortErr(e) {
  const m = String(e && e.message || e);
  if (/Timeout/i.test(m)) return 'Przekroczono czas oczekiwania na stronę sklepu.';
  if (/net::ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|TUNNEL|PROXY|CONNECTION)/i.test(m)) return 'Brak połączenia ze sklepem (sieć/DNS/proxy).';
  if (/net::ERR_/i.test(m)) return 'Błąd sieci: ' + (m.match(/net::ERR_[A-Z_]+/) || [''])[0];
  if (/Executable doesn't exist|browserType.launch/i.test(m)) return 'Brak przeglądarki Playwright – uruchom: npx playwright install chromium';
  return m.split('\n')[0].slice(0, 200);
}

// Odczyt ceny z podanego bezpośrednio linku produktu
async function readUrl(url, stores) {
  const store = stores.find(s => sameDomain(url, s.domain));
  const base = { storeId: store ? store.id : 'inny', store: store ? store.name : new URL(url).hostname, searchUrl: null };
  const t0 = Date.now();
  try {
    return await withPage(async page => {
      const prod = await readProductPage(page, url);
      if (prod.blocked) return { ...base, status: 'blocked', url, note: 'Strona zablokowała automatyczne zapytanie.', ms: Date.now() - t0 };
      return finish(base, prod, page.url(), { level: 'exact' }, null, [], t0);
    });
  } catch (e) {
    return { ...base, status: 'error', url, note: shortErr(e), ms: Date.now() - t0 };
  }
}

// ---------------- Dostępność w sklepie stacjonarnym ----------------
// Ogólny automat: przycisk "Sprawdź dostępność w sklepach" / "Wybierz sklep" -> pole miasta -> lista salonów.
// Sprawdzony na Euro (11.2026). Dla innych sklepów działa heurystycznie (beta).
async function checkStock(url, city) {
  const t0 = Date.now();
  try {
    return await withPage(async page => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (await waitIfBlocked(page)) return { status: 'blocked', note: 'Strona zablokowana przez ochronę anty-bot.', url };
      await page.waitForTimeout(1500);

      const BTN = /sprawdź dostępność w sklep|dostępność w sklepach|sprawdź dostępność|sprawdź w sklepie|wybierz (swój )?sklep|odbiór w sklepie|dostępność w salon|znajdź w sklepie/i;
      // klik przez DOM – omija nakładki (np. baner cookies), bez akceptowania czegokolwiek
      const clicked = await page.evaluate(src => {
        const re = new RegExp(src, 'i');
        const els = [...document.querySelectorAll('button, a, [role="button"]')].filter(e => re.test((e.innerText || e.getAttribute('aria-label') || '').trim()));
        const el = els.find(e => e.offsetParent !== null) || els[0];
        if (!el) return null;
        el.scrollIntoView({ block: 'center' }); el.click();
        return (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 60);
      }, BTN.source);
      if (!clicked) return { status: 'unsupported', note: 'Na karcie produktu nie ma przycisku dostępności w salonach.', url, ms: Date.now() - t0 };

      const INPUT = 'input[placeholder*="miejscow" i], input[aria-label*="miejscow" i], input[placeholder*="miast" i], input[placeholder*="kod pocztowy" i], input[aria-label*="kod pocztowy" i], input[placeholder*="lokaliz" i], input[placeholder*="adres" i], [role="dialog"] input[type="text"], [role="dialog"] input[type="search"]';
      const input = await page.waitForSelector(INPUT, { timeout: 8000, state: 'visible' }).catch(() => null);
      if (input) {
        await input.click({ force: true }).catch(() => {});
        await input.fill('');
        await input.type(city, { delay: 60 });
        await page.waitForTimeout(1800);
        // podpowiedź z nazwą miasta (np. Euro) – kliknij; w przeciwnym razie Enter
        const sug = await page.evaluate(c => {
          const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').trim();
          const want = norm(c);
          let els = [...document.querySelectorAll('button, li, [role="option"], a')].filter(e => e.offsetParent !== null && norm(e.innerText || '').startsWith(want) && (e.innerText || '').length < 80);
          els = els.filter(e => !els.some(o => o !== e && e.contains(o))); // najgłębszy element (przycisk, nie <li>)
          if (els[0]) { els[0].click(); return true; }
          return false;
        }, city);
        if (!sug) await input.press('Enter').catch(() => {});
      }
      await page.waitForTimeout(3500);

      // zbierz bloki salonów zawierające nazwę miasta
      const shops = await page.evaluate(c => {
        const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
        const want = norm(c).split(/[\s-]/)[0];
        const blocks = new Map();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          if (!norm(n.textContent).includes(want)) continue;
          if (n.parentElement.closest('button, [role="option"], h1, h2, h3, title, script, label')) continue; // podpowiedzi i nagłówki to nie salony
          let el = n.parentElement;
          // wspinamy się do bloku, który zawiera też informację o dostępności/odbiorze
          for (let i = 0; i < 6 && el; i++) {
            const t = el.innerText || '';
            if (/dostępn|odbi[oó]r|w magazynie|na półce|od ręki|brak|niedostępn/i.test(t) && t.length < 900) break;
            el = el.parentElement;
          }
          if (!el || blocks.has(el) || el.querySelector('input, h1') || el === document.body) continue;
          const t = (el.innerText || '').replace(/\n{2,}/g, '\n').trim();
          if (t.length > 900 || t.length < 10) continue;
          if (/^(input|textarea)$/i.test(el.tagName)) continue;
          blocks.set(el, t);
        }
        // odrzuć bloki zawierające inne bloki (zostaw najmniejsze)
        const els = [...blocks.keys()];
        return els.filter(e => !els.some(o => o !== e && e.contains(o))).map(e => blocks.get(e)).slice(0, 10);
      }, city);

      const result = shops.map(t => {
        const lines = t.split('\n').map(s => s.trim()).filter(Boolean)
          .filter(s => !/^(godziny otwarcia|do koszyka|poniedziałek|wtorek|środa|czwartek|piątek|sobota|niedziela|\d{1,2}:\d{2})/i.test(s));
        const status = /nie jest dostępny|niedostępn|brak (towaru|w sklepie|produktu)|nie ma/i.test(t) ? 'no'
          : /dostępny w sklepie|dostępny od ręki|od ręki|na półce|w magazynie sklepu|dostępny dziś|dostępne|jest dostępny/i.test(t) ? 'yes'
          : /odbi[oó]r/i.test(t) ? 'order' : 'unknown';
        return { status, lines: lines.slice(0, 5) };
      });
      return { status: result.length ? 'ok' : 'empty', city, button: clicked, shops: result, url, note: result.length ? null : `Nie znaleziono salonów w: ${city}`, ms: Date.now() - t0 };
    });
  } catch (e) {
    return { status: 'error', note: shortErr(e), url, ms: Date.now() - t0 };
  }
}

// ---------------- Listy produktów (szukanie po opisie, podobne) ----------------
async function tilesFrom(page, store, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (await waitIfBlocked(page)) return { blocked: true, tiles: [] };
  await waitForProducts(page, store);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 2500).catch(() => {}); await page.waitForTimeout(500); }
  let tiles = await page.evaluate(collectTilesInPage, store.productHref.source).catch(() => []);
  if (!tiles.length) { await page.waitForTimeout(2500); tiles = await page.evaluate(collectTilesInPage, store.productHref.source).catch(() => []); }
  return { tiles, finalUrl: page.url() };
}

async function listStore(store, phrases) {
  const t0 = Date.now();
  const base = { storeId: store.id, store: store.name, searchUrl: store.searchUrl(phrases[0]) };
  if (store.linkOnly) return { ...base, status: 'link', items: [] };
  try {
    return await withPage(async page => {
      const items = [];
      for (const ph of phrases) {
        const r = await tilesFrom(page, store, store.searchUrl(ph));
        if (r.blocked) return { ...base, status: 'blocked', items, ms: Date.now() - t0 };
        for (const t of r.tiles) if (!items.some(i => i.url === t.url)) items.push(parseTile(t, store));
      }
      return { ...base, status: items.length ? 'ok' : 'not_found', items, ms: Date.now() - t0 };
    });
  } catch (e) {
    return { ...base, status: 'error', note: shortErr(e), items: [], ms: Date.now() - t0 };
  }
}

// Kategoria z okruszków -> tańsze modele o tych samych (albo lepszych) kluczowych parametrach.
// ref: { url, title, price, specs, category:{url,name} } – wynik wyszukiwania z jednego sklepu
async function similarStore(store, ref) {
  const t0 = Date.now();
  const base = { storeId: store.id, store: store.name };
  try {
    return await withPage(async page => {
      let { specs, category } = ref;
      if ((!specs || Object.keys(specs).length < 3 || !category) && ref.url) {
        const prod = await readProductPage(page, ref.url);
        if (prod.blocked) return { ...base, status: 'blocked', items: [] };
        specs = parseSpecs((prod.specPairs || []).join('\n'), prod.name || ref.title);
        category = (prod.crumbs || []).slice(-1)[0] || category;
      }
      if (!category) return { ...base, status: 'no_category', note: 'Nie znaleziono kategorii produktu.', items: [] };
      const urls = [category.url];
      if (/\.bhtml$/.test(category.url)) urls.unshift(category.url.replace(/\.bhtml$/, ',najtansze.bhtml')); // Euro / OleOle: lista od najtańszych
      const seen = new Set(), items = [];
      const model = (ref.title || '').toUpperCase();
      for (const u of urls) {
        const r = await tilesFrom(page, store, u);
        if (r.blocked) break;
        for (const t of r.tiles) {
          if (seen.has(t.url) || t.url === ref.url) continue;
          seen.add(t.url);
          const p = parseTile(t, store);
          if (!p.price || p.price >= ref.price * 0.99) continue;
          const tok = (p.title.match(/[A-Z0-9]{6,}/g) || []).find(x => /\d/.test(x) && /[A-Z]/.test(x));
          if (tok && model.includes(tok)) continue;
          const cmp = compareSpecs(specs, p.specs);
          if (!cmp.ok) continue;
          items.push({ ...p, saving: Math.round((ref.price - p.price) * 100) / 100, diffs: cmp.diffs });
        }
      }
      const unk = x => x.diffs.filter(d => d.verdict === 'unknown').length;
      items.sort((a, b) => (unk(a) >= 2) - (unk(b) >= 2) || a.price - b.price);
      return { ...base, status: 'ok', category, refSpecs: specs, items: items.slice(0, 8), ms: Date.now() - t0 };
    });
  } catch (e) {
    return { ...base, status: 'error', note: shortErr(e), items: [] };
  }
}

// ---------------- Aktualne promocje sklepu ----------------
async function storePromos(store) {
  const urls = store.promoUrls || [`https://www.${store.domain}/`];
  const items = [];
  for (const u of urls) {
    try {
      const r = await withPage(async page => {
        await page.goto(u, { waitUntil: 'domcontentloaded' });
        if (await waitIfBlocked(page)) return { blocked: true };
        await page.waitForTimeout(2500);
        return { links: await page.evaluate(harvestPromoLinksInPage) };
      });
      if (r.blocked) return { storeId: store.id, store: store.name, status: 'blocked', items: [] };
      for (const l of r.links) if (!items.some(i => i.url === l.url || i.title === l.title)) items.push(l);
    } catch (e) { if (!items.length) return { storeId: store.id, store: store.name, status: 'error', note: shortErr(e), items: [] }; }
  }
  const rules = parsePromos(items.map(i => i.title));
  for (const i of items) i.group = promoGroup(i.title).id;
  // reguły koszykowe najpierw
  items.sort((a, b) => score(b.title) - score(a.title));
  const top = items.slice(0, 20);
  // szczegóły (ważne do, kod, forma: rabat/bon/zwrot, z czym się nie łączy) – z podstron najważniejszych promocji
  const detailN = Number(process.env.PROMO_DETAILS ?? 6);
  const toOpen = top.filter(i => i.group !== 'inne' && sameDomain(i.url, store.domain)).slice(0, detailN);
  if (toOpen.length) {
    await withPage(async page => {
      for (const it of toOpen) {
        try {
          await page.goto(it.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          if (await waitIfBlocked(page)) break;
          await page.waitForTimeout(800);
          const text = await page.evaluate(() => (document.body && document.body.innerText || '').slice(0, 30000));
          it.details = promoDetails(text);
        } catch { /* pojedyncza strona promocji nie działa – pomijamy */ }
      }
    }).catch(() => {});
  }
  return { storeId: store.id, store: store.name, status: 'ok', items: top, rules };
}
function score(t) { return (/za każde|za \d{3,4}|za 1 zł|na drug|w zestawie|multirabat|%/i.test(t) ? 2 : 0) + (/black|wyprzeda|okazj/i.test(t) ? 1 : 0); }

async function close() {
  if (ctxPromise) { const c = await ctxPromise.catch(() => null); if (c) await c.close().catch(() => {}); }
}

module.exports = { searchStore, readUrl, checkStock, storePromos, listStore, similarStore, close, rankCandidates };
