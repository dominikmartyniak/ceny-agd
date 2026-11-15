// Wyszukiwanie kodów modelu / EAN w tekście z OCR – wspólne dla serwera (Node) i przeglądarki (wersja GitHub).
(function (root) {
  const UNIT_TOKEN = /^\d+(?:[.,]\d+)?(KG|OBR|OBRMIN|CM|MM|L|W|KW|KWH|HZ|GB|TB|MB|MPIX|MP|CALI|CAL|DB|V|MAH|LM|K|ZL|PLN|SZT|RAT)$/;
  const isModelToken = t => t.length >= 4 && /[A-Z]/.test(t) && /\d/.test(t) && !UNIT_TOKEN.test(t);
  function isEan(q) {
    const s = String(q || '').replace(/\s/g, '');
    if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)) return false;
    const d = s.split('').map(Number); const check = d.pop(); let sum = 0;
    d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
    return (10 - (sum % 10)) % 10 === check;
  }
  // słowa z tabliczek, które wyglądają jak kody, a nimi nie są
  const NOISE = /^(IPX\d|IP\d{2}|\d+V|\d+HZ|\d+W|\d+A|\d+MA|AC\d+|DC\d+|CE\d*|ROHS|WEEE|ISO\d+|EN\d+|\d{1,2}\/\d{2,4}|R\d{3}A?|R600A|R134A|R290|[A-Z]?\d{1,3}MM)$/;
  const HINT = /(MODEL|MOD\.?|TYPE|TYP|TYPU|MODEL NO|MODEL NR|REF|E-?NR|PNC|PROD\.? ?NO|ART\.? ?NR|NAZWA)\s*[:.#]?\s*$/i;
  const SERIAL = /(S\/?N|SIN|SERIAL|SER\.? ?NO|NR FABR|NUMER SERYJNY|LOT)\s*[:.#]?\s*$/i;

  function candidatesFromText(text) {
    const out = new Map();
    const add = (value, kind, score) => {
      const k = value.replace(/[^A-Z0-9]/g, '');
      const prev = out.get(k);
      if (!prev || prev.score < score) out.set(k, { value, kind, score });
    };
    for (const line of String(text).split(/\n+/)) {
      const re = /[A-Za-z0-9][A-Za-z0-9\-\/.]{3,24}[A-Za-z0-9]/g;
      let m;
      while ((m = re.exec(line))) {
        const raw = m[0].toUpperCase();
        const tok = raw.replace(/[^A-Z0-9]/g, '');
        if (tok.length < 5 || tok.length > 22) continue;
        if (NOISE.test(tok) || NOISE.test(raw)) continue;
        const before = line.slice(0, m.index);
        if (isEan(tok)) { add(tok, 'ean', 90); continue; }
        if (!isModelToken(tok)) continue;
        let score = 40 + Math.min(tok.length, 14);
        if (HINT.test(before)) score += 50;
        if (SERIAL.test(before)) score -= 60;
        if (/^\d+$/.test(tok)) score -= 30;
        const letters = (tok.match(/[A-Z]/g) || []).length;
        if (letters >= 2 && tok.length - letters >= 2) score += 10;
        add(raw.replace(/[^A-Z0-9\-\/.]/g, ''), 'model', score);
      }
    }
    return [...out.values()].sort((a, b) => b.score - a.score);
  }

  // Obszary do OCR: poza kodami kreskowymi + nachodzące pasy poziome
  function ocrRegions(size, boxes) {
    const regs = [];
    if (!size) return regs;
    const { w, h } = size;
    for (const b of boxes) {
      if (b.top > h * 0.08) regs.push({ left: 0, top: 0, width: w, height: Math.round(b.top) });
      if (b.bottom < h * 0.92) regs.push({ left: 0, top: Math.round(b.bottom), width: w, height: Math.round(h - b.bottom) });
      if (b.left > w * 0.15) regs.push({ left: 0, top: 0, width: Math.round(b.left), height: h });
      if (b.right < w * 0.85) regs.push({ left: Math.round(b.right), top: 0, width: Math.round(w - b.right), height: h });
    }
    for (const [a, z] of [[0, 0.45], [0.3, 0.75], [0.55, 1]]) regs.push({ left: 0, top: Math.round(h * a), width: w, height: Math.round(h * (z - a)) });
    return regs.filter(r => r.width > 40 && r.height > 25);
  }

  // Pozycja kodu z zxing -> prostokąt do zamalowania
  function barcodeBox(position) {
    const pts = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].map(k => position && position[k]).filter(Boolean);
    if (!pts.length) return null;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const pad = Math.max(20, (Math.max(...xs) - Math.min(...xs)) * 0.25); // kod 1D: pozycja to cienka linia
    return { left: Math.min(...xs) - 15, right: Math.max(...xs) + 15, top: Math.min(...ys) - pad, bottom: Math.max(...ys) + pad };
  }

  // Głosowanie: odczyt powtarzający się w kilku wariantach zdjęcia jest pewniejszy
  function vote(texts) {
    const votes = new Map();
    for (const t of texts) for (const c of candidatesFromText(t)) {
      const k = c.value.replace(/[^A-Z0-9]/g, '');
      const v = votes.get(k) || { ...c, n: 0 };
      v.n++; v.score = Math.max(v.score, c.score); votes.set(k, v);
    }
    const cands = [...votes.values()].map(c => ({ ...c, score: c.score + (c.n - 1) * 8 })).sort((a, b) => b.score - a.score);
    return {
      eans: cands.filter(c => c.kind === 'ean').map(c => c.value),
      models: cands.filter(c => c.kind === 'model' && c.score >= 45).map(c => c.value).slice(0, 8),
    };
  }

  const api = { isEan, isModelToken, candidatesFromText, ocrRegions, barcodeBox, vote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Plate = api;
})(typeof self !== 'undefined' ? self : this);
