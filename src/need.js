// Wyszukiwanie „po opisie”: „płyta indukcyjna”, „lodówka do 200cm”, „płyta indukcyjna pięciopolowa”,
// „pralka 8kg do 2000 zł”. Zamienia opis na frazę dla sklepów + filtry parametrów.
(function (root) {
  const CATS = [
    { id: 'lodowka', name: 'Lodówka', re: /lod[óo]w|ch[łl]odziar/i, title: /lod[óo]wk|ch[łl]odziar/i, cm: 'height' },
    { id: 'zamrazarka', name: 'Zamrażarka', re: /zamra[żz]ar/i, title: /zamra[żz]ar/i, cm: 'height' },
    { id: 'pralkosuszarka', name: 'Pralko-suszarka', re: /pralko-?\s*suszar/i, title: /pralko-?\s*suszar/i, cm: 'depth' },
    { id: 'pralka', name: 'Pralka', re: /pralk/i, title: /pralk/i, cm: 'depth' },
    { id: 'suszarka', name: 'Suszarka', re: /suszark[ai]? (do ubra|bębnow)|suszark[aię]$/i, title: /suszark/i, cm: 'depth' },
    { id: 'zmywarka', name: 'Zmywarka', re: /zmywar/i, title: /zmywar/i, cm: 'width' },
    { id: 'plyta', name: 'Płyta', re: /p[łl]yt[ay]?\b|p[łl]yt[ay]? (indukc|gaz|ceram|elektr)/i, title: /p[łl]yt[ay]? (?!do zmywar)|p[łl]yta$/i, cm: 'width' },
    { id: 'piekarnik', name: 'Piekarnik', re: /piekarnik/i, title: /piekarnik/i, cm: 'width' },
    { id: 'kuchenka', name: 'Kuchnia wolnostojąca', re: /kuchni[ae] (gaz|elektr|wolno|indukc)|kuchenk[ai] (gaz|elektr|indukc)/i, title: /kuchni|kuchenk/i, cm: 'width' },
    { id: 'mikrofala', name: 'Kuchenka mikrofalowa', re: /mikrofal/i, title: /mikrofal/i, cm: 'width' },
    { id: 'okap', name: 'Okap', re: /okap/i, title: /okap/i, cm: 'width' },
    { id: 'telewizor', name: 'Telewizor', re: /telewizor|\btv\b/i, title: /telewizor|\btv\b/i },
    { id: 'odkurzacz', name: 'Odkurzacz', re: /odkurzacz/i, title: /odkurzacz/i },
    { id: 'ekspres', name: 'Ekspres do kawy', re: /ekspres/i, title: /ekspres/i },
    { id: 'monitor', name: 'Monitor', re: /monitor/i, title: /monitor/i },
    { id: 'laptop', name: 'Laptop', re: /laptop|notebook/i, title: /laptop|notebook/i },
    { id: 'smartfon', name: 'Smartfon', re: /smartfon|telefon/i, title: /smartfon|telefon/i },
  ];
  const BRANDS = ['Samsung', 'LG', 'Bosch', 'Siemens', 'Electrolux', 'AEG', 'Whirlpool', 'Beko', 'Candy', 'Hoover', 'Gorenje', 'Amica', 'Indesit',
    'Hotpoint', 'Miele', 'Haier', 'Sharp', 'Philips', 'Sony', 'TCL', 'Hisense', 'Panasonic', 'Xiaomi', 'De\'Longhi', 'DeLonghi', 'Krups', 'Neff',
    'Teka', 'Smeg', 'Liebherr', 'Grundig', 'Dyson', 'Hyundai', 'Ciarko', 'Akpo', 'Faber', 'Elica', 'Toshiba', 'Apple', 'Lenovo', 'Asus', 'Acer', 'HP', 'Dell'];
  const ZONE_WORD = { d: 2, t: 3, c: 4, p: 5, s: 6 };
  const DIM_LABEL = { height: 'wysokość', width: 'szerokość', depth: 'głębokość' };
  const num = s => parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));

  function isDescriptive(q, models) {
    const s = String(q || '').trim();
    if (!s || /^https?:\/\//i.test(s) || /^\d{8,14}$/.test(s.replace(/\s/g, ''))) return false;
    return !(models && models.length) && /[a-ząćęłńóśźż]{3,}/i.test(s);
  }

  function parseNeed(q) {
    let rest = ' ' + String(q || '').replace(/ /g, ' ') + ' ';
    const f = {};
    const chips = [];
    const cut = re => { rest = rest.replace(re, ' '); };
    let m;

    const cat = CATS.find(c => c.re.test(rest)) || null;

    // cena
    if ((m = rest.match(/\b(?:do|max\.?|maks\.?|poniżej|ponizej|najwyżej)\s*(\d[\d\s]*(?:[.,]\d+)?)\s*(tys\.?|k\b)?\s*(?:zł|zl|pln|złotych)?(?=\s|$)(?!\s*(?:cm|kg|cali|l\b))/i)) && (m[2] || /zł|zl|pln/i.test(m[0]) || num(m[1]) >= 300)) {
      f.priceMax = num(m[1]) * (m[2] ? 1000 : 1); cut(m[0]); chips.push(`do ${f.priceMax} zł`);
    }
    if ((m = rest.match(/\b(?:od|min\.?|powyżej)\s*(\d[\d\s]*)\s*(tys\.?|k\b)?\s*(?:zł|zl|pln)/i))) { f.priceMin = num(m[1]) * (m[2] ? 1000 : 1); cut(m[0]); chips.push(`od ${f.priceMin} zł`); }

    // wymiary: "do 200cm", "szerokość 45", "60 cm"
    const dimRe = /\b(szer\w*|wys\w*|g[łl][ęe]b\w*)?\s*(do|max\.?|maks\.?|poniżej|od|min\.?|powyżej)?\s*(\d{2,3}(?:[.,]\d)?)\s*cm\b/i;
    while ((m = rest.match(dimRe))) {
      const dim = m[1] ? ({ s: 'width', w: 'height', g: 'depth' })[m[1][0].toLowerCase()] : (cat && cat.cm) || 'width';
      const v = num(m[3]);
      const op = m[2] ? (/^(do|max|maks|poni)/i.test(m[2]) ? 'max' : 'min') : 'eq';
      f[dim] = { op, v };
      chips.push(`${DIM_LABEL[dim]} ${op === 'max' ? '≤ ' : op === 'min' ? '≥ ' : '≈ '}${v} cm`);
      cut(m[0]);
    }
    if ((m = rest.match(/\b(szer\w*|wys\w*|g[łl][ęe]b\w*)\s*(do|od)?\s*(\d{2,3})\b/i))) {
      const dim = ({ s: 'width', w: 'height', g: 'depth' })[m[1][0].toLowerCase()];
      f[dim] = { op: m[2] ? (m[2].toLowerCase() === 'do' ? 'max' : 'min') : 'eq', v: num(m[3]) };
      chips.push(`${DIM_LABEL[dim]} ${f[dim].op === 'max' ? '≤ ' : f[dim].op === 'min' ? '≥ ' : '≈ '}${f[dim].v} cm`); cut(m[0]);
    }
    // pola grzewcze
    if ((m = rest.match(/\b(\d)\s*-?\s*(?:pol\w*|pól)\b/i))) { f.zones = +m[1]; cut(m[0]); }
    else if ((m = rest.match(/\b(dwu|trzy|cztero|pi[ęe]cio|sze[śs]cio)\s*-?\s*polow\w*/i))) { f.zones = ZONE_WORD[m[1][0].toLowerCase()]; cut(m[0]); }
    if (f.zones) chips.push(`${f.zones} pól grzewczych`);
    // kg, cale, komplety
    if ((m = rest.match(/\b(?:(do|max|od|min)\s*)?(\d{1,2}(?:[.,]\d)?)\s*kg\b/i))) { f.kg = { op: m[1] && /^(do|max)/i.test(m[1]) ? 'max' : 'min', v: num(m[2]) }; chips.push(`${f.kg.op === 'max' ? '≤' : '≥'} ${f.kg.v} kg`); cut(m[0]); }
    if ((m = rest.match(/\b(?:(do|max|od|min)\s*)?(\d{2,3})\s*(?:"|”|''|cal[ie]?\b|cala\b)/i))) { f.inch = { op: m[1] ? (/^(do|max)/i.test(m[1]) ? 'max' : 'min') : 'eq', v: +m[2] }; chips.push(`${f.inch.op === 'max' ? '≤ ' : f.inch.op === 'min' ? '≥ ' : ''}${f.inch.v}"`); cut(m[0]); }
    if ((m = rest.match(/\b(\d{1,2})\s*(?:kpl|kompl\w*)/i))) { f.places = +m[1]; chips.push(`${f.places} kompletów`); cut(m[0]); }
    if (/no\s*-?\s*frost/i.test(rest)) { f.noFrost = true; chips.push('No Frost'); }
    if ((m = rest.match(/\bklas[aya]?\s*(?:energetyczn\w*\s*)?([A-G])\b/i))) { f.energyMax = m[1].toUpperCase(); chips.push(`klasa ${f.energyMax} lub lepsza`); cut(m[0]); }
    // marka
    const brand = BRANDS.find(b => new RegExp('\\b' + b.replace(/[.'-]/g, '.?') + '\\b', 'i').test(rest));
    if (brand) { f.brand = brand; chips.push(brand); }
    // tani / najtańsze -> sortuj po cenie
    let sort = 'rating';
    if (/\bnajta[ńn]sz\w*|\btani[aey]?\b|\bbudżetow\w*/i.test(rest)) { sort = 'price'; cut(/\bnajta[ńn]sz\w*|\btani[aey]?\b|\bbudżetow\w*/gi); }
    cut(/\b(promocj\w*|na promocji|okazj\w*|najlepsz\w*|dobr[aey]|polecan\w*|jak\w*|szukam|chc[ęe]|kupi[ćc]|ranking)\b/gi);

    const phrase = rest.replace(/\s+/g, ' ').trim();
    return { q: String(q || '').trim(), phrase: phrase || (cat ? cat.name : String(q || '').trim()), category: cat && { id: cat.id, name: cat.name, cm: cat.cm || null },
      filters: f, chips, sort };
  }

  const ENERGY = 'ABCDEFG';
  // Czy produkt spełnia opis? specs – z Specs.parseSpecs, price – najniższa cena
  function checkNeed(need, specs, price, title) {
    const f = need.filters || {};
    const failed = [], unknown = [];
    const cat = need.category && CATS.find(c => c.id === need.category.id);
    if (cat && title && !cat.title.test(title)) failed.push('inny rodzaj sprzętu');
    if (cat && cat.id === 'plyta' && /indukc/i.test(need.phrase) && title && !/indukc/i.test(title)) failed.push('nie indukcyjna');
    if (f.brand && title && !new RegExp(f.brand.replace(/[.'-]/g, '.?'), 'i').test(title)) failed.push('inna marka');
    if (f.priceMax && price && price > f.priceMax) failed.push('za drogo');
    if (f.priceMin && price && price < f.priceMin) failed.push('za tanio');
    const dim = (key, label, tol) => {
      const want = f[key]; if (!want) return;
      const v = specs[key];
      if (v == null) return unknown.push(label);
      if (want.op === 'max' && v > want.v + 0.5) failed.push(`${label} ${v} cm`);
      if (want.op === 'min' && v < want.v - 0.5) failed.push(`${label} ${v} cm`);
      if (want.op === 'eq' && Math.abs(v - want.v) > tol) failed.push(`${label} ${v} cm`);
    };
    dim('height', 'wysokość', 3); dim('width', 'szerokość', 2.5); dim('depth', 'głębokość', 3);
    if (f.zones) { if (specs.zones == null) unknown.push('liczba pól'); else if (specs.zones !== f.zones) failed.push(`${specs.zones} pola`); }
    if (f.kg) { if (specs.kg == null) unknown.push('pojemność'); else if (f.kg.op === 'min' ? specs.kg < f.kg.v : specs.kg > f.kg.v) failed.push(`${specs.kg} kg`); }
    if (f.inch) {
      if (specs.inch == null) unknown.push('przekątna');
      else if ((f.inch.op === 'eq' && Math.abs(specs.inch - f.inch.v) > 1) || (f.inch.op === 'max' && specs.inch > f.inch.v + 0.6) || (f.inch.op === 'min' && specs.inch < f.inch.v - 0.6)) failed.push(`${specs.inch}"`);
    }
    if (f.places) { if (specs.places == null) unknown.push('komplety'); else if (specs.places < f.places) failed.push(`${specs.places} kpl.`); }
    if (f.noFrost && !specs.noFrost) unknown.push('No Frost');
    if (f.energyMax) { if (!specs.energy) unknown.push('klasa energetyczna'); else if (ENERGY.indexOf(specs.energy) > ENERGY.indexOf(f.energyMax)) failed.push(`klasa ${specs.energy}`); }
    return { ok: !failed.length, failed, unknown };
  }

  // Ocena „z poprawką na liczbę opinii” (średnia bayesowska):
  // 1 opinia 5,0 nie wygra z 400 opiniami 4,8. m – ile opinii „waży” średnia kategorii.
  const PRIOR = 4.2, M = 25, MIN_REVIEWS = 10;
  function trustScore(rating, reviews) {
    if (!rating || !reviews) return PRIOR - 0.6; // brak opinii = poniżej przeciętnej
    return (rating * reviews + PRIOR * M) / (reviews + M);
  }

  const api = { parseNeed, checkNeed, isDescriptive, trustScore, MIN_REVIEWS, CATS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Need = api;
})(typeof self !== 'undefined' ? self : this);
