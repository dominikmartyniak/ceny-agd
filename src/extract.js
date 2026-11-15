// Funkcje uruchamiane WEWNĄTRZ strony (page.evaluate) + parsowanie cen po stronie Node.
// Celowo nie opieramy się na klasach CSS sklepów (zmieniają się co kilka tygodni),
// tylko na: danych strukturalnych JSON-LD, meta-tagach i tekstach linków.

// ---------- w przeglądarce ----------

// Zbiera wszystkie linki ze strony wyników + tekst "kafelka" (najbliższy przodek z ceną)
function collectLinksInPage() {
  const out = [];
  const seen = new Map();
  for (const a of document.querySelectorAll('a[href]')) {
    let href;
    try { href = new URL(a.getAttribute('href'), location.href).href.split('#')[0]; } catch { continue; }
    if (!/^https?:/.test(href)) continue;
    const parts = [a.innerText, a.getAttribute('title'), a.getAttribute('aria-label')];
    for (const img of a.querySelectorAll('img[alt]')) parts.push(img.getAttribute('alt'));
    const text = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

    // tekst kafelka z ceną: idziemy w górę max 8 poziomów aż trafimy na "zł"
    let tile = '';
    let el = a;
    for (let i = 0; i < 8 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      const t = el.innerText || '';
      if (/\d\s*(?:,\d{2}|,–|,-)?\s*zł/i.test(t)) { tile = t.replace(/\s+/g, ' ').slice(0, 800); break; }
      if (t.length > 3000) break;
    }

    if (seen.has(href)) {
      const prev = out[seen.get(href)];
      if (text && !prev.text.includes(text)) prev.text = (prev.text + ' ' + text).slice(0, 500);
      if (!prev.tile && tile) prev.tile = tile;
    } else {
      seen.set(href, out.length);
      out.push({ href, text: text.slice(0, 500), tile });
    }
  }
  return out;
}

// Wyciąga dane produktu z karty produktu
function extractProductInPage() {
  const res = { name: null, price: null, currency: null, availability: null, sku: null, gtin: null,
    image: null, source: null, hasCodePrice: false, codePriceText: null, lowest30: null, blocked: false,
    noCodePrice: null, promoTexts: [], pageGtins: [] };

  const bodyText = (document.body && document.body.innerText) || '';
  const title = document.title || '';
  if (/just a moment|attention required|access denied|nie jesteś robotem|potwierdź, że jesteś człowiekiem|captcha/i.test(title + ' ' + bodyText.slice(0, 1500))
      && !document.querySelector('script[type="application/ld+json"]')) {
    res.blocked = true;
    return res;
  }

  // 1) JSON-LD
  const items = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    items.push(node);
    if (node['@graph']) walk(node['@graph']);
    if (node.mainEntity) walk(node.mainEntity);
    if (node.itemListElement) walk(node.itemListElement);
    if (node.item) walk(node.item);
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(s.textContent)); } catch { /* uszkodzony JSON-LD – pomijamy */ }
  }
  const isType = (n, t) => [].concat(n['@type'] || []).some(x => String(x).toLowerCase() === t);
  const product = items.find(n => isType(n, 'product')) || items.find(n => isType(n, 'productgroup'));
  if (product) {
    res.name = product.name || null;
    res.sku = product.sku || product.mpn || null;
    res.gtin = product.gtin13 || product.gtin || product.gtin8 || null;
    res.image = [].concat(product.image || [])[0] || null;
    if (res.image && typeof res.image === 'object') res.image = res.image.url || res.image.contentUrl || null;
    let offers = [].concat(product.offers || []);
    if (!offers.length && product.hasVariant) offers = [].concat(product.hasVariant).flatMap(v => [].concat(v.offers || []));
    const flat = offers.flatMap(o => (o && o.offers) ? [].concat(o.offers) : [o]).filter(Boolean);
    const prices = [];
    for (const o of flat.concat(offers)) {
      const p = o.price ?? o.lowPrice ?? (o.priceSpecification && [].concat(o.priceSpecification)[0]?.price);
      if (p != null && p !== '') prices.push({ p, cur: o.priceCurrency, av: o.availability });
    }
    if (prices.length) {
      const nums = prices.map(x => ({ ...x, n: parseFloat(String(x.p).replace(/\s/g, '').replace(',', '.')) })).filter(x => x.n > 0);
      nums.sort((a, b) => a.n - b.n);
      if (nums.length) {
        res.price = nums[0].n;
        res.currency = nums[0].cur || 'PLN';
        res.availability = nums[0].av ? String(nums[0].av).split('/').pop() : null;
        res.source = 'json-ld';
      }
    }
  }

  // 2) meta tagi / microdata
  if (res.price == null) {
    const meta = sel => { const m = document.querySelector(sel); return m && (m.getAttribute('content') || m.textContent); };
    const p = meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]')
      || meta('[itemprop="price"][content]') || meta('[itemprop="price"]');
    if (p) {
      const n = parseFloat(String(p).replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
      if (n > 0) { res.price = n; res.currency = 'PLN'; res.source = 'meta'; }
    }
  }
  if (!res.name) {
    const h1 = document.querySelector('h1');
    res.name = (h1 && h1.innerText.trim()) || (document.querySelector('meta[property="og:title"]') || {}).content || title;
  }

  // 3) informacje dodatkowe z tekstu strony
  const m30 = bodyText.match(/najniższa cena[^\n]{0,40}?30 dni[^\n]{0,40}?(\d[\d\s ]*(?:,\d{2})?)\s*zł/i);
  if (m30) res.lowest30 = m30[1];
  const mc = bodyText.match(/cena z kodem[^\n]{0,80}/i) || bodyText.match(/z kodem[:\s]+[A-Z0-9]{4,}/);
  if (mc) { res.hasCodePrice = true; res.codePriceText = mc[0].slice(0, 120); }
  const mnc = bodyText.match(/cena bez kodu:?\s*(\d[\d\s\u00a0]*(?:,\d{2})?)\s*zł/i);
  if (mnc) res.noCodePrice = mnc[1];

  // „drobny druk” cen: linie z kwotami, ratami, kodami, zwrotami (czytane potem przez pricing.js)
  const PL = /zł|\brat|gratis|kod|zwrot|cashback|bon\b|voucher|najniższa|przed obniżką|sugerowana|rrso/i;
  res.priceLines = bodyText.split('\n').map(x => x.trim()).filter(x => x.length > 3 && x.length < 220 && PL.test(x)).slice(0, 140);
  // parametry: <dt>/<dd>, <th>/<td>, wiersze "Etykieta: wartość"
  const pairs = [];
  for (const dt of document.querySelectorAll('dt')) { const dd = dt.nextElementSibling; if (dd && dd.tagName === 'DD') pairs.push(dt.innerText.trim().replace(/:$/, '') + ': ' + dd.innerText.trim()); }
  for (const tr of document.querySelectorAll('tr')) { const c = tr.querySelectorAll('th, td'); if (c.length === 2) pairs.push(c[0].innerText.trim().replace(/:$/, '') + ': ' + c[1].innerText.trim()); }
  for (const line of bodyText.split('\n')) if (/^[A-ZĄĆĘŁŃÓŚŹŻ][^:]{2,45}:\s*\S.{0,60}$/.test(line.trim())) pairs.push(line.trim());
  res.specPairs = [...new Set(pairs.map(x => x.replace(/\s+/g, ' ').slice(0, 140)))].slice(0, 200);
  // okruszki -> kategoria (do „podobne, ale tańsze”)
  const crumbs = [];
  const bl = items.find(n => isType(n, 'breadcrumblist'));
  if (bl && bl.itemListElement) for (const e of [].concat(bl.itemListElement)) {
    const it = e.item || e; const url = typeof it === 'string' ? it : (it['@id'] || it.url);
    if (url) crumbs.push({ name: e.name || it.name || '', url: new URL(url, location.href).href });
  }
  if (!crumbs.length) {
    const nav = document.querySelector('nav[aria-label*="breadcrumb" i], [class*="breadcrumb" i], nav ol, nav ul');
    if (nav) for (const a of nav.querySelectorAll('a[href]')) crumbs.push({ name: a.innerText.trim(), url: a.href });
  }
  res.crumbs = crumbs.filter(c => c.url && c.url !== location.href && !/^https?:\/\/[^/]+\/?$/.test(c.url)).slice(-4);

  // EAN-y widoczne na stronie (dane techniczne: "EAN: 880...")
  const eanRe = /(?:EAN|GTIN|kod kreskowy)[^\d\n]{0,15}(\d{8,14})/gi;
  let em; while ((em = eanRe.exec(bodyText)) && res.pageGtins.length < 5) res.pageGtins.push(em[1]);

  // Plakietki promocyjne: krótkie teksty linków / etykiet / alt obrazków z hasłami promocyjnymi
  const PROMO = /za każde|wydane|za \d{3,4}\b|za 1 zł|produkt za|% na|na drug|w zestawie|multirabat|raty? gratis|taniej|rabat|gratis/i;
  const seen = new Set();
  const cands = document.querySelectorAll('a, button, span, div, p, li, img[alt]');
  for (const el of cands) {
    if (res.promoTexts.length >= 30) break;
    const t = (el.tagName === 'IMG' ? el.getAttribute('alt') : (el.childElementCount <= 3 ? el.innerText : '')) || '';
    const s = t.replace(/\s+/g, ' ').trim();
    if (s.length < 5 || s.length > 90 || !PROMO.test(s) || seen.has(s.toLowerCase())) continue;
    if (/\brat\b.*\d+,\d{2}\s*zł|zł\s*x\s*\d+\s*rat|miesięcznie/i.test(s)) continue; // kwota raty to nie promocja
    seen.add(s.toLowerCase());
    res.promoTexts.push(s);
  }

  return res;
}

// Kafelki produktów z listy (wyniki wyszukiwania / kategoria): dla każdego linku do produktu
// wspinamy się do największego przodka, który nie zawiera linku do INNEGO produktu = cały kafelek.
function collectTilesInPage(hrefSrc) {
  const re = new RegExp(hrefSrc, 'i');
  const key = h => { try { const u = new URL(h, location.href); return u.origin + u.pathname; } catch { return null; } };
  const links = [...document.querySelectorAll('a[href]')].filter(a => re.test(a.href));
  const byKey = new Map();
  for (const a of links) { const k = key(a.href); if (k) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(a); } }
  const out = [];
  for (const [k, as] of byKey) {
    const a = as.slice().sort((x, y) => (y.innerText || '').length - (x.innerText || '').length)[0];
    let el = a, card = a;
    for (let i = 0; i < 12; i++) {
      const p = el.parentElement; if (!p || p === document.body) break;
      const other = [...p.querySelectorAll('a[href]')].some(x => re.test(x.href) && key(x.href) !== k);
      if (other || (p.innerText || '').length > 5000) break;
      el = p; card = p;
    }
    const title = (a.innerText || a.getAttribute('title') || (a.querySelector('img[alt]') || {}).alt || '').replace(/\s+/g, ' ').trim();
    const text = (card.innerText || '').replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n+/g, '\n').slice(0, 2500);
    const alts = [...card.querySelectorAll('img[alt]')].map(i => i.alt).filter(x => x && x.length < 80).join(' | ');
    if (title.length > 8) out.push({ url: k, title: title.slice(0, 200), text: text + (alts ? '\n' + alts : '') });
  }
  return out;
}

// Ceneo: lista ofert sklepów z karty produktu (każda oferta ma link "Idź do sklepu" -> /Click/Offer/)
function extractCeneoOffersInPage() {
  const out = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/Click/Offer/"]')) {
    if (!/idź do sklepu|przejdź do sklepu/i.test(a.innerText || '')) continue;
    let box = a;
    for (let i = 0; i < 10 && box && box.tagName !== 'LI'; i++) box = box.parentElement;
    if (!box || box.tagName !== 'LI') continue; // pomijamy górny box (duplikat) i reklamy
    const shopImg = box.querySelector('a[href*="/Click/Offer/"] img[alt]');
    const shop = ((shopImg && shopImg.getAttribute('alt')) || '').trim().toLowerCase();
    const txt = (box.innerText || '').replace(/\u00a0/g, ' ');
    const m = txt.match(/(?:^|[^\d])((?:\d{1,3}(?:[ ]\d{3})+|\d+),\d{2})\s*zł/);
    if (!shop || !m) continue;
    const price = parseFloat(m[1].replace(/ /g, '').replace(',', '.'));
    const key = shop + '|' + price;
    if (seen.has(key)) continue;
    seen.add(key);
    const titleEl = [...box.querySelectorAll('a[href*="/Click/Offer/"]')].find(x => (x.innerText || '').trim().length > 15 && !/zł|idź do sklepu/i.test(x.innerText));
    const rating = txt.match(/Ocena\s*([\d,]+)\s*\/\s*5/i);
    const reviews = txt.replace(/Ocena\s*[\d,]+\s*\/\s*5/i, ' | ').match(/(\d{1,3}(?: \d{3})*|\d+)\s*opini/i);
    out.push({
      shop, price, url: a.href,
      rating: rating ? parseFloat(rating[1].replace(',', '.')) : null,
      reviews: reviews ? parseInt(reviews[1].replace(/ /g, ''), 10) : null,
      title: titleEl ? titleEl.innerText.trim().slice(0, 160) : null,
      delivery: (txt.match(/darmowa wysyłka|wysyłka[^\n]{0,25}|dostawa[^\n]{0,25}/i) || [null])[0],
    });
  }
  return out.sort((x, y) => x.price - y.price);
}

// Linki promocyjne ze strony głównej / strony promocji sklepu
function harvestPromoLinksInPage() {
  const PROMO = /za każde|wydane|za \d{3,4}\b|za 1 zł|produkt za|%|w zestawie|multirabat|raty? gratis|taniej|rabat|black|promocj|wyprzeda|kod|okazj|gratis|cashback|zwrot/i;
  const out = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const parts = [a.innerText, a.getAttribute('title'), a.getAttribute('aria-label')];
    for (const img of a.querySelectorAll('img[alt]')) parts.push(img.getAttribute('alt'));
    const t = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (t.length < 6 || t.length > 140 || !PROMO.test(t)) continue;
    if (/regulamin|polityka|cookies|newsletter|kontakt|raty 0%$/i.test(t)) continue;
    let href; try { href = new URL(a.getAttribute('href'), location.href).href; } catch { continue; }
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title: t, url: href });
    if (out.length >= 25) break;
  }
  return out;
}

function isBlockedInPage() {
  const t = (document.title || '') + ' ' + ((document.body && document.body.innerText) || '').slice(0, 1500);
  return /just a moment|attention required|access denied|nie jesteś robotem|potwierdź, że jesteś człowiekiem|captcha|request unsuccessful/i.test(t);
}

// ---------- w Node ----------

// "1 997,00 zł" -> 1997 ; "1449,– zł" -> 1449 ; "2.259,99" -> 2259.99
function parsePrice(text) {
  if (text == null) return null;
  if (typeof text === 'number') return text;
  const s = String(text).replace(/ /g, ' ');
  const m = s.match(/(\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.](\d{1,2}|–|-))?\s*(?:zł|pln)/i)
    || s.match(/(\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.](\d{1,2}))?/);
  if (!m) return null;
  const int = m[1].replace(/[ .]/g, '');
  const dec = m[2] && /\d/.test(m[2]) ? m[2].padEnd(2, '0') : '00';
  const n = parseFloat(`${int}.${dec}`);
  return n > 0 ? n : null;
}

// Z tekstu kafelka bierze wszystkie kwoty "… zł" i wybiera sensowną cenę produktu
// (pomija raty "x 30 rat", "miesięcznie", "zyskaj X zł", "X zł za każde 500 zł")
function priceFromTile(tile) {
  if (!tile) return null;
  const re = /(\d{1,3}(?:[  .]\d{3})+|\d+)(?:,(\d{2}|–|-))?\s*zł/gi;
  const found = [];
  let m, prevEnd = 0;
  while ((m = re.exec(tile))) {
    const end = m.index + m[0].length;
    // kontekst: od końca poprzedniej kwoty (max 40 znaków wstecz) do ~25 znaków za kwotą
    // lewy kontekst: od poprzedniej kwoty (max 40 znaków), ale nie dalej niż początek bieżącej linii
    let ls = Math.max(prevEnd, m.index - 40);
    const nl = tile.lastIndexOf('\n', m.index - 1);
    if (nl >= ls) ls = nl + 1;
    const left = tile.slice(ls, m.index).toLowerCase();
    const right = tile.slice(end, end + 15).split('\n')[0].toLowerCase();
    prevEnd = end;
    if (/rat\b|raty|miesi|zyskaj|rabat|za każde|wydane|spłacisz|oszczędzasz|kwh|taniej o|outlet|zwrot|cashback|bon\b|kod na|zalando/.test(left + ' | ' + right)) continue;
    const v = parsePrice(m[0]);
    if (v && v >= 5) found.push({ v, left });
  }
  if (!found.length) return null;
  // "Najniższa cena z 30 dni" i "cena bez kodu" to nie cena aktualna
  const current = found.filter(f => !/najniższa|bez kodu|przed obniżką|poprzednia|regularna/.test(f.left));
  return (current[0] || found[0]).v;
}

module.exports = { collectTilesInPage, collectLinksInPage, extractProductInPage, extractCeneoOffersInPage, harvestPromoLinksInPage, isBlockedInPage, parsePrice, priceFromTile };
