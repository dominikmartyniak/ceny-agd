// Parametry sprzętu z tekstu (karta produktu / kafelek / nazwa) i porównanie „czy to taki sam sprzęt”.
// Wspólne dla serwera i przeglądarki.
(function (root) {
  const num = s => s == null ? null : parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
  const ENERGY = 'ABCDEFG';

  function parseSpecs(text, title) {
    const t = String(text || '').replace(/ /g, ' ');
    const all = t + '\n' + (title || '');
    const s = {};
    let m;
    // pojemność / ładowność (kg) – najpierw z etykiety, potem z nazwy („8kg”)
    if ((m = t.match(/(?:pojemno[śs][ćc]|ładowno[śs][ćc]|wsad)[^:\n]{0,25}:?\s*(\d{1,2}(?:[,.]\d)?)\s*kg/i)) || (m = all.match(/\b(\d{1,2}(?:[,.]\d)?)\s*kg\b/i))) s.kg = num(m[1]);
    // pojemność w litrach (lodówki, piekarniki)
    if ((m = t.match(/pojemno[śs][ćc][^:\n]{0,30}:?\s*(\d{2,4})\s*l\b/i)) || (m = all.match(/\b(\d{2,4})\s*(?:l|litr[óo]w)\b/i))) s.liters = num(m[1]);
    // obroty
    if ((m = all.match(/(\d{3,4})\s*obr/i))) s.rpm = num(m[1]);
    // wymiary GxSxW
    // wymiary w dowolnej kolejności: "(GxSxW): 55 x 60 x 85 cm", "(szer. x gł.): 59,2 x 52,2 cm", "(WxSxG)"
    if ((m = t.match(/\(\s*([a-ząćęłńóśźż.]+(?:\s*x\s*[a-ząćęłńóśźż.]+){1,2})\s*\)\s*:?\s*(\d+(?:[,.]\d+)?)\s*x\s*(\d+(?:[,.]\d+)?)(?:\s*x\s*(\d+(?:[,.]\d+)?))?\s*cm/i))) {
      const keys = m[1].toLowerCase().split(/\s*x\s*/).map(k => k[0] === 'g' ? 'depth' : k[0] === 's' ? 'width' : k[0] === 'w' ? 'height' : null);
      keys.forEach((k, i) => { if (k && m[i + 2]) s[k] = num(m[i + 2]); });
    }
    if (!s.width && (m = t.match(/szeroko[śs][ćc][^:\n]{0,20}:?\s*(\d+(?:[,.]\d)?)\s*cm/i))) s.width = num(m[1]);
    if (!s.height && (m = t.match(/wysoko[śs][ćc][^:\n]{0,20}:?\s*(\d+(?:[,.]\d)?)\s*cm/i))) s.height = num(m[1]);
    if (!s.depth && (m = t.match(/g[łl][ęe]boko[śs][ćc](?! z elementami)[^:\n]{0,20}:?\s*(\d+(?:[,.]\d)?)\s*cm/i))) s.depth = num(m[1]);
    if (!s.width && (m = String(title || '').match(/\b(\d{2}(?:[,.]\d)?)\s*cm\b/i))) s.width = num(m[1]);
    // klasa energetyczna
    if ((m = all.match(/klasa (?:efektywno[śs]ci )?energetyczn[ae][^:\n]{0,10}:?\s*([A-G])\b/i))) s.energy = m[1].toUpperCase();
    // hałas
    if ((m = all.match(/ha[łl]as[^:\n]{0,40}:?\s*(\d{2})\s*dB/i)) || (m = all.match(/\b(\d{2})\s*dB/))) s.noise = num(m[1]);
    // przekątna (TV/monitory)
    if ((m = all.match(/(\d{2,3}(?:[,.]\d)?)\s*(?:"|”|''|cali|cal\b)/i))) s.inch = num(m[1]);
    // płyty – liczba pól
    if ((m = all.match(/pola grzewcze[^:\n]{0,10}:?\s*(\d)/i)) || (m = all.match(/\b(\d)\s*(?:-\s*)?(?:pola|pól|polow)/i))) s.zones = num(m[1]);
    else if ((m = all.match(/(dwu|trzy|cztero|pi[ęe]cio|sze[śs]cio)\s*-?\s*polow/i))) s.zones = { d: 2, t: 3, c: 4, p: 5, s: 6 }[m[1][0].toLowerCase()];
    if (/no ?frost/i.test(all)) s.noFrost = true;
    // zmywarki – komplety
    if ((m = all.match(/(\d{1,2})\s*(?:kpl|kompl)/i))) s.places = num(m[1]);
    // rodzaj sprzętu – pierwsze słowo nazwy (Pralka, Lodówka, Zmywarka, Telewizor…)
    if (title && (m = String(title).trim().match(/^([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż-]{4,})/))) s.kind = m[1].toLowerCase();
    return s;
  }

  // Czy kandydat jest „takim samym” sprzętem (te same kluczowe parametry albo lepsze)?
  // Zwraca { ok, known, matched, diffs:[{label, verdict:'same'|'better'|'worse'|'unknown', a, b}] }
  function compareSpecs(orig, cand) {
    const diffs = [];
    let known = 0, matched = 0, reject = false;
    const add = (label, a, b, verdict, hard) => {
      diffs.push({ label, a, b, verdict });
      if (verdict === 'unknown') return;
      known++;
      if (verdict === 'same' || verdict === 'better') matched++;
      else if (hard) reject = true;
    };
    const cmp = (key, label, rule, hard = true) => {
      if (orig[key] == null) return;
      if (cand[key] == null) return add(label, orig[key], null, 'unknown');
      add(label, orig[key], cand[key], rule(orig[key], cand[key]), hard);
    };
    if (orig.kind && cand.kind && orig.kind.slice(0, 5) !== cand.kind.slice(0, 5)) reject = true;
    cmp('kg', 'Pojemność (kg)', (a, b) => b > a + 0.01 ? 'better' : b >= a - 0.01 ? 'same' : 'worse');
    cmp('liters', 'Pojemność (l)', (a, b) => b > a * 1.03 ? 'better' : b >= a * 0.95 ? 'same' : 'worse');
    cmp('places', 'Komplety', (a, b) => b > a ? 'better' : b === a ? 'same' : 'worse');
    cmp('inch', 'Przekątna', (a, b) => Math.abs(a - b) <= 0.6 ? 'same' : b > a ? 'better' : 'worse');
    cmp('width', 'Szerokość (cm)', (a, b) => Math.abs(a - b) <= 2 ? 'same' : 'worse');           // musi się zmieścić
    cmp('depth', 'Głębokość (cm)', (a, b) => b <= a - 1 ? 'better' : b <= a + 3 ? 'same' : 'worse');
    cmp('height', 'Wysokość (cm)', (a, b) => Math.abs(a - b) <= 3 ? 'same' : b < a ? 'better' : 'worse');
    cmp('rpm', 'Obroty', (a, b) => b > a ? 'better' : b >= a - 1 ? 'same' : 'worse', false);
    cmp('energy', 'Klasa energetyczna', (a, b) => ENERGY.indexOf(b) < ENERGY.indexOf(a) ? 'better' : a === b ? 'same' : 'worse');
    cmp('zones', 'Pola grzewcze', (a, b) => b > a ? 'better' : b === a ? 'same' : 'worse');
    cmp('noise', 'Hałas (dB)', (a, b) => b < a - 1 ? 'better' : b <= a + 2 ? 'same' : 'worse');
    // gorsze obroty: dopuszczalne o max 200
    const r = diffs.find(d => d.label === 'Obroty');
    if (r && r.verdict === 'worse' && r.b < r.a - 200) reject = true;
    return { ok: !reject && matched >= 2 && known - matched <= 1, known, matched, diffs };
  }

  const api = { parseSpecs, compareSpecs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Specs = api;
})(typeof self !== 'undefined' ? self : this);
