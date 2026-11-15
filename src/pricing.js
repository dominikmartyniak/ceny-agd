// Odczyt „drobnego druku” cen z tekstu karty produktu / kafelka / strony promocji:
// najniższa cena z 30 dni, cena przed obniżką, cena sugerowana, raty, raty gratis, zwroty i bony.
// Wspólne dla serwera, GitHub Actions i przeglądarki.
(function (root) {
  const AMT = '(\\d{1,3}(?:[ \\u00a0.]\\d{3})+|\\d+)(?:,(\\d{2}|–|-))?';
  const money = (i, d) => { const v = parseFloat(String(i).replace(/[  .]/g, '') + '.' + (d && /\d/.test(d) ? d : '00')); return v > 0 ? v : null; };
  const WORDS = { jedna: 1, jedną: 1, pierwsza: 1, pierwszą: 1, dwie: 2, trzy: 3, cztery: 4, pięć: 5, piec: 5 };
  const wnum = s => WORDS[String(s).toLowerCase()] || parseInt(s, 10) || null;
  const clean = t => String(t || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ');

  function after(t, labelRe) {
    const m = t.match(new RegExp(labelRe.source + '[^\\n\\d]{0,60}?' + AMT + '\\s*zł', 'i'));
    return m ? money(m[1], m[2]) : null;
  }

  function parsePricing(text) {
    const t = clean(text);
    const out = {};
    out.lowest30 = after(t, /najniższa cena(?: z(?: ostatnich)? 30 dni)?(?: przed obniżką)?\s*:?/);
    out.beforeDiscount = after(t, /(?:cena )?przed obniżką\s*:/) || after(t, /cena regularna\s*:?/) || after(t, /cena poprzednia\s*:?/);
    out.noCode = after(t, /cena bez kodu\s*:?/);
    out.srp = after(t, /(?:sugerowana cena(?: detaliczna)?(?: producenta)?|cena sugerowana(?: przez producenta)?)\s*:?/);

    // raty: "66,57 zł × 30 rat 0%" albo "30 rat x 66,57 zł"
    let m, inst = null;
    if ((m = t.match(new RegExp(AMT + '\\s*zł\\s*[x×]\\s*(\\d{1,3})\\s*rat', 'i')))) inst = { monthly: money(m[1], m[2]), count: +m[3] };
    else if ((m = t.match(new RegExp('(\\d{1,3})\\s*rat[a-zy]*\\s*(?:0%\\s*)?[x×po]{1,2}\\s*' + AMT + '\\s*zł', 'i')))) inst = { count: +m[1], monthly: money(m[2], m[3]) };
    if (inst) {
      const rest = t.slice(Math.max(0, (m.index || 0) - 200), (m.index || 0) + 300);
      inst.zero = /0\s*%|rrso\s*0/i.test(rest) || /raty 0\s*%|0% rat/i.test(t);
      const rr = t.match(/RRSO[^\d]{0,10}(\d{1,2}(?:,\d{1,2})?)\s*%/i);
      if (rr) inst.rrso = parseFloat(rr[1].replace(',', '.'));
    }
    const free = t.match(/(?:^|[^\w])(?:(nawet|do)\s+)?(\d{1,2}|jedn[aą]|pierwsz[aą]|dwie|trzy|cztery|pięć)\s+rat[ayę]?\s+gratis/i);
    const firstFree = /pierwsza rata gratis/i.test(t);
    const payOnly = t.match(new RegExp('(?:w ratach )?spłacisz (?:tylko|jedynie)\\s*' + AMT + '\\s*zł', 'i'));
    if (free || firstFree || payOnly) {
      inst = inst || {};
      inst.freeCount = firstFree ? 1 : wnum(free[2]);
      if (free && free[1]) inst.upTo = true; // „nawet 3 raty gratis” – zależy od produktu
      if (payOnly) inst.payOnly = money(payOnly[1], payOnly[2]);
    }
    if (inst) out.installments = inst;

    // zwroty i bony: nie odejmujemy od ceny – to pieniądze po zakupie albo zniżka na kolejne zakupy
    const extras = [];
    const seen = new Set();
    const lineAt = i => t.slice(t.lastIndexOf('\n', i) + 1, (t.indexOf('\n', i) + 1 || t.length + 1) - 1).trim().slice(0, 160);
    const push = (kind, amount, label, upTo) => {
      const k = kind + ':' + amount;
      if (!amount || seen.has(k)) return;
      seen.add(k); extras.push({ kind, amount, upTo: !!upTo, label: label.trim().slice(0, 120), line: lineAt(m.index) });
    };
    const reZwrot = new RegExp('((?:cashback|zwrot(?:u)?(?: pieniędzy| na konto| od producenta)?)\\s*(do|nawet do)?\\s*' + AMT + '\\s*zł)|(' + AMT + '\\s*zł\\s*zwrotu)', 'gi');
    while ((m = reZwrot.exec(t))) {
      if (/zwrot\w* do banku|jako zwrot/i.test(t.slice(Math.max(0, m.index - 15), m.index + m[0].length + 12))) continue; // „zwrot do banku” = mechanizm rat gratis
      if (m[1]) push('zwrot', money(m[3], m[4]), m[0], m[2]); else push('zwrot', money(m[6], m[7]), (/do\s*$/i.test(t.slice(Math.max(0, m.index - 4), m.index)) ? 'do ' : '') + m[0], /do\s*$/i.test(t.slice(Math.max(0, m.index - 4), m.index)));
    }
    const reBon = new RegExp('((?:kod|bon|voucher|karta podarunkowa|e-?bon)[^\\n.]{0,40}?(?:kolejne zakupy|następne zakupy|na zakupy|zalando|podarunk)[^\\n\\d]{0,20}?(do|nawet do)?\\s*' + AMT + '\\s*zł)|((?:zyskaj )?(kod|bon)[^\\n.\\d]{0,20}?(do|nawet do)\\s*' + AMT + '\\s*zł)', 'gi');
    while ((m = reBon.exec(t))) {
      if (m[1]) push('bon', money(m[3], m[4]), m[0], m[2]); else push('bon', money(m[8], m[9]), m[0], m[7]);
    }
    if (extras.length) out.extras = extras;
    for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
    return out;
  }

  // Koszt zakupu na raty. price – cena gotówkowa.
  function installmentCost(price, inst) {
    if (!inst || !price) return null;
    const { monthly, count, freeCount, payOnly } = inst;
    const nominal = monthly && count ? Math.round(monthly * count * 100) / 100 : null;
    if (nominal && Math.abs(nominal - price) > price * 0.2) return null; // kwota raty z innego produktu na stronie
    let total = null, saving = 0;
    if (payOnly && payOnly < price && payOnly > price * 0.6) total = payOnly;
    else if (freeCount && !inst.upTo && monthly && count) total = Math.round(monthly * (count - freeCount) * 100) / 100;
    else if (freeCount && !inst.upTo && count) total = Math.round(price * (count - freeCount) / count * 100) / 100;
    if (total) saving = Math.round((price - total) * 100) / 100;
    const extraCost = nominal && nominal > price * 1.005 && !freeCount ? Math.round((nominal - price) * 100) / 100 : 0;
    return { total: total || nominal || price, saving, nominal, monthly: monthly || null, count: count || null,
      freeCount: freeCount || 0, upTo: !!inst.upTo, extraCost, zero: inst.zero !== false && !extraCost };
  }

  // ---------- promocje sklepu: rodzaj i szczegóły ze strony promocji ----------
  const GROUPS = [
    ['kwota', 'Rabat za kwotę', /\d+\s*zł\s*za\s*(?:każde\s*)?(?:wydane\s*)?\d{3}|\b\d{2,3}\s*za\s*\d{3,4}\b/i],
    ['raty', 'Raty gratis / 0%', /rat[ayę]?\s+gratis|raty 0|0\s*%\s*rat|rata gratis/i],
    ['nty', 'N-ty produkt taniej', /\b(drugi|trzeci|czwarty|piąty|szósty|\d\.)\s*(najtańszy\s*)?(produkt|sprzęt)\s*(za 1 zł|-?\s*\d{1,2}\s*%|taniej)|\b(drugi|trzeci|czwarty|piąty)\s*(najtańszy\s*)?(za 1 zł|-?\s*\d{1,2}\s*%|tańszy|taniej)|na drugi/i],
    ['zwrot', 'Zwrot / cashback', /cashback|zwrot|płaci (twoje )?rachunki|oddajemy/i],
    ['bon', 'Bon / kod na kolejne zakupy', /kod na kolejne|kolejne zakupy|bon|voucher|karta podarunkowa|zalando|code ?back/i],
    ['kod', 'Kod rabatowy', /\bkod\b|kodem/i],
    ['procent', 'Rabat procentowy', /-?\d{1,2}\s*%/],
    ['gratis', 'Gratis / pakiet', /gratis|w zestawie|za 1 ?zł|pakiet/i],
  ];
  function promoGroup(title) {
    for (const [id, label, re] of GROUPS) if (re.test(title)) return { id, label };
    return { id: 'inne', label: 'Inne okazje' };
  }
  const GROUP_LABELS = Object.fromEntries(GROUPS.map(g => [g[0], g[1]]).concat([['inne', 'Inne okazje']]));

  const DATE = '(\\d{1,2})[.\\-/](\\d{1,2})(?:[.\\-/](\\d{2,4}))?';
  function promoDetails(text, now = new Date()) {
    const t = clean(text);
    const d = {};
    let m;
    const mkDate = (dd, mm, yy) => {
      let y = yy ? +yy : now.getFullYear(); if (y < 100) y += 2000;
      const x = new Date(y, +mm - 1, +dd, 23, 59);
      if (!yy && x < now - 200 * 864e5) x.setFullYear(y + 1);
      return isNaN(x) ? null : x.toISOString().slice(0, 10);
    };
    if ((m = t.match(new RegExp('(?:od|w dniach)\\s*' + DATE + '\\s*(?:r\\.?)?\\s*(?:do|-|–)\\s*' + DATE, 'i')))) {
      d.from = mkDate(m[1], m[2], m[3] || m[6]); d.until = mkDate(m[4], m[5], m[6]);
    } else if ((m = t.match(new RegExp('(?:ważn[aey]|obowiązuje|trwa|potrwa|tylko)\\s*(?:\\w+\\s*){0,3}?do\\s*' + DATE, 'i')) || t.match(new RegExp('\\bdo\\s*' + DATE + '\\s*(?:r\\.|roku|włącznie|\\d{1,2}:\\d{2})', 'i')))) {
      d.until = mkDate(m[1], m[2], m[3]);
    }
    if ((m = t.match(/(?:[Kk]od(?:em)?(?: rabatowy)?|[Uu]żyj kodu|[Ww]pisz kod)\s*:?\s*[„"]?([A-Z0-9]*\d[A-Z0-9]*)\b/))) d.code = m[1];
    if (/rabat (naliczamy|naliczany|zostanie naliczony)? ?od razu|naliczany automatycznie|w koszyku|obniżk[ai] w koszyku/i.test(t)) d.form = 'rabat';
    else if (/kod na kolejne zakupy|bon na kolejne|na następne zakupy|e-?bon|karta podarunkowa|voucher/i.test(t)) d.form = 'bon';
    else if (/zwrot(?!\w* do banku)|cashback|przelew(em)? na (twoje )?konto|zarejestruj (zakup|produkt)/i.test(t)) d.form = 'zwrot';
    const ex = t.match(/nie łączy się[^.\n]{0,160}/i) || t.match(/nie (?:sumuje|łączą) się[^.\n]{0,160}/i);
    if (ex) d.exclusions = ex[0].trim();
    if ((m = t.match(/(?:maksymaln[aey]|max\.?)\s*(?:rabat|kwota rabatu|zwrot)?[^\d\n]{0,25}(\d[\d ]{2,7})\s*zł/i))) d.max = money(m[1]);
    if (/rejestracj|zarejestruj/i.test(t)) d.needsRegistration = true;
    return d;
  }

  const api = { parsePricing, installmentCost, promoGroup, promoDetails, GROUP_LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Pricing = api;
})(typeof self !== 'undefined' ? self : this);
