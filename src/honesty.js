// Czy promocja jest prawdziwa? Porównanie z ceną z ostatnich 30 dni (dyrektywa Omnibus),
// ceną „przed obniżką” / „bez kodu”, ceną sugerowaną producenta i własną historią cen.
(function (root) {
  const zl = n => n.toLocaleString('pl-PL', { maximumFractionDigits: 2 }) + ' zł';
  const day = ts => new Date(ts).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });

  // r: wynik sklepu { price, regularPrice, lowest30, srp }
  // hist: [{price, ts}] – historia tego produktu w tym sklepie (z aplikacji), najstarsze pierwsze
  // Zwraca { level: 'real'|'fake'|'higher'|'raised'|'info', text } albo null
  function promoVerdict(r, hist, now = Date.now()) {
    const price = r && r.price;
    if (!price) return null;
    const tol = Math.max(1, price * 0.005);
    const claimed = r.regularPrice && r.regularPrice > price + tol ? r.regularPrice - price : 0;

    // 1) własna historia: podniesiona przed promocją albo było taniej
    const h = (hist || []).filter(e => e.price && now - e.ts <= 60 * 864e5).sort((a, b) => a.ts - b.ts);
    if (h.length >= 2) {
      const prev = h.filter(e => now - e.ts > 6 * 3600e3);
      const min = prev.reduce((m, e) => (!m || e.price < m.price ? e : m), null);
      const max = prev.reduce((m, e) => (!m || e.price > m.price ? e : m), null);
      if (claimed && min && max && max.ts > min.ts && max.price > min.price * 1.05 && price >= min.price - tol) {
        return { level: 'raised', text: `Cena podniesiona przed promocją: ${day(min.ts)} było ${zl(min.price)}, ${day(max.ts)} ${zl(max.price)}, teraz ${zl(price)}.` };
      }
      if (min && price > min.price * 1.03) return { level: 'higher', text: `Było taniej: ${zl(min.price)} (${day(min.ts)}).` };
    }

    // 2) najniższa cena z 30 dni (sklep musi ją podawać przy obniżce)
    if (r.lowest30) {
      const real = r.lowest30 - price;
      if (claimed && real <= tol) {
        return { level: 'fake', text: `Pozorna promocja: sklep pokazuje −${zl(claimed)}, ale w ostatnich 30 dniach cena była ${zl(r.lowest30)} – realnie ${real < -tol ? 'drożej o ' + zl(-real) : 'bez obniżki'}.` };
      }
      if (real > tol) return { level: 'real', text: `Prawdziwa obniżka: −${zl(real)} względem najniższej ceny z 30 dni (${zl(r.lowest30)}).` };
      if (price > r.lowest30 + tol) return { level: 'higher', text: `W ostatnich 30 dniach było taniej: ${zl(r.lowest30)}.` };
    }
    if (claimed && !r.lowest30) return { level: 'info', text: `Sklep pokazuje −${zl(claimed)}, ale nie podał najniższej ceny z 30 dni – nie da się sprawdzić, czy obniżka jest prawdziwa.` };
    if (r.srp && r.srp > price * 1.05) return { level: 'info', text: `„Cena sugerowana producenta” ${zl(r.srp)} to cena katalogowa – rabat od niej zwykle nie jest prawdziwą obniżką.` };
    return null;
  }

  const api = { promoVerdict };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Honesty = api;
})(typeof self !== 'undefined' ? self : this);
