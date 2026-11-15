// Dopasowanie wyniku wyszukiwania do zapytania.
// Sklepy przy braku modelu podsuwają PODOBNE produkty (np. WW90T534DAE -> WW80T504DAEA),
// więc nie wolno brać pierwszego wyniku w ciemno.

const norm = s => (s || '')
  .toUpperCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/Ł/g, 'L');

const alnum = s => norm(s).replace(/[^A-Z0-9]/g, '');

const STOP = new Set(['I', 'Z', 'W', 'DO', 'NA', 'OD', 'ZE', 'KG', 'CM', 'L', 'OBR', 'MIN']);

// Token "modelowy" = ma litery i cyfry, min. 4 znaki (WW80T504DAEA, UE55M70H, BCS1041WAC, 55C845)
const UNIT_TOKEN = /^\d+(?:[.,]\d+)?(KG|OBR|OBRMIN|CM|MM|L|W|KW|KWH|HZ|GB|TB|MB|MPIX|MP|CALI|CAL|DB|V|MAH|LM|K|ZL|PLN|SZT|RAT)$/;

function isModelToken(t) {
  return t.length >= 4 && /[A-Z]/.test(t) && /\d/.test(t) && !UNIT_TOKEN.test(t);
}

// EAN-8 / UPC-A (12) / EAN-13 / GTIN-14 z poprawną sumą kontrolną
function isEan(q) {
  const s = String(q || '').replace(/\s/g, '');
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)) return false;
  const d = s.split('').map(Number);
  const check = d.pop();
  let sum = 0;
  d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

// Kody modeli wyciągnięte z nazwy produktu ("Pralka Samsung WW80T504DAEA 8kg" -> ["WW80T504DAEA"])
function modelsFromTitle(title) {
  return parseQuery(title || '').models.filter(m => m.length >= 5);
}

function parseQuery(q) {
  const words = norm(q).split(/[\s,;/|]+/).map(w => w.replace(/[^A-Z0-9\-.]/g, '')).filter(Boolean);
  const models = [];
  const plain = [];
  for (const w of words) {
    const a = w.replace(/[^A-Z0-9]/g, '');
    if (!a) continue;
    if (isModelToken(a)) models.push(a);
    else if (!STOP.has(a) && a.length >= 2) plain.push(a);
  }
  return { models, plain };
}

// Zwraca { score 0..100, level: 'exact' | 'close' | 'weak' | 'none' }
function scoreCandidate(query, candidateText) {
  const { models, plain } = typeof query === 'string' ? parseQuery(query) : query;
  const cAl = alnum(candidateText);
  const cWords = new Set(norm(candidateText).split(/[^A-Z0-9]+/).filter(Boolean));

  let plainHits = 0;
  for (const p of plain) if (cWords.has(p) || cAl.includes(p)) plainHits++;
  const plainRatio = plain.length ? plainHits / plain.length : 1;

  if (models.length) {
    let full = 0, partial = 0;
    for (const m of models) {
      if (cAl.includes(m)) full++;
      else if (m.length >= 7 && (cAl.includes(m.slice(0, -1)) || cAl.includes(m.slice(0, -2)))) partial++;
      // np. użytkownik wpisał WW80T504DAEA, sklep ma WW80T504DAE (bez wariantu kolorystycznego)
    }
    if (full === models.length) return { score: 90 + 10 * plainRatio, level: 'exact' };
    if (full + partial === models.length) return { score: 70 + 10 * plainRatio, level: 'close' };
    if (full + partial > 0) return { score: 40 + 10 * plainRatio, level: 'weak' };
    return { score: 5 * plainRatio, level: 'none' };
  }

  // Zapytanie bez kodu modelu ("pralka samsung 8kg") – tylko przybliżenie po słowach
  if (!plain.length) return { score: 0, level: 'none' };
  const score = 60 * plainRatio;
  return { score, level: plainRatio === 1 ? 'close' : plainRatio >= 0.5 ? 'weak' : 'none' };
}

module.exports = { parseQuery, scoreCandidate, alnum, norm, isEan, modelsFromTitle, isModelToken };
