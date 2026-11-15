// Rozpoznawanie EAN / modelu ze zdjęcia w przeglądarce (wersja GitHub – bez serwera).
// Ta sama logika co na serwerze (lib/plate.js): kody kreskowe (zxing) + OCR (Tesseract) z zamalowaniem kodów i głosowaniem.
(function () {
  // Biblioteki z CDN; w testach można podać lokalne: window.LIB_BASE = '/node_modules/'
  const LOCAL = window.LIB_BASE || null;
  const CDN = 'https://cdn.jsdelivr.net/npm/';
  const lib = (pkg, ver, file) => LOCAL ? `${LOCAL}${pkg}/${file}` : `${CDN}${pkg}@${ver}/${file}`;

  let zxP = null, tessP = null;
  function zxing() {
    if (zxP) return zxP;
    zxP = import(lib('zxing-wasm', '3.1.7', 'dist/es/reader/index.js')).then(async zx => {
      await zx.prepareZXingModule({ overrides: { locateFile: (p, prefix) => p.endsWith('.wasm') ? lib('zxing-wasm', '3.1.7', 'dist/reader/' + p) : prefix + p }, fireImmediately: true });
      return zx;
    }).catch(e => { zxP = null; throw e; });
    return zxP;
  }
  function loadScript(src) {
    return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Nie udało się pobrać ' + src)); document.head.appendChild(s); });
  }
  function tesseract() {
    if (tessP) return tessP;
    tessP = (window.Tesseract ? Promise.resolve() : loadScript(lib('tesseract.js', '7.0.0', 'dist/tesseract.min.js'))).then(() => {
      const opts = LOCAL ? {
        workerPath: lib('tesseract.js', '7.0.0', 'dist/worker.min.js'),
        corePath: lib('tesseract.js-core', '7.0.0', ''),
        langPath: lib('@tesseract.js-data/eng', '1.0.0', '4.0.0'),
      } : {};
      return window.Tesseract.createWorker('eng', 1, { ...opts, gzip: true });
    }).catch(e => { tessP = null; throw e; });
    return tessP;
  }

  async function toCanvas(blob, max) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }
  function crop(src, r) {
    const c = document.createElement('canvas'); c.width = r.width; c.height = r.height;
    c.getContext('2d').drawImage(src, r.left, r.top, r.width, r.height, 0, 0, r.width, r.height);
    return c;
  }

  async function recognize(blob, onStatus = () => {}) {
    const t0 = performance.now();
    const res = { eans: [], codes: [], models: [], ms: 0, errors: [] };
    const canvas = await toCanvas(blob, 1600);
    const ctx = canvas.getContext('2d');
    const boxes = [];

    onStatus('Szukam kodu kreskowego…');
    try {
      const zx = await zxing();
      const found = await zx.readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), { tryHarder: true, maxNumberOfSymbols: 8, formats: [] });
      for (const b of found) {
        const box = Plate.barcodeBox(b.position); if (box) boxes.push(box);
        const t = (b.text || '').trim();
        if (!t) continue;
        if (Plate.isEan(t)) { if (!res.eans.includes(t)) res.eans.push(t); } else res.codes.push({ format: b.format, text: t });
      }
    } catch (e) { res.errors.push('kody: ' + e.message); }

    // skala szarości + zamalowanie kodów (Tesseract gubi się na paskach)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = g; }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = '#fff';
    for (const b of boxes) ctx.fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);

    try {
      onStatus('Odczytuję tekst (pierwszy raz pobiera ~5 MB)…');
      const w = await tesseract();
      const variants = [canvas, ...Plate.ocrRegions({ w: canvas.width, h: canvas.height }, boxes).map(r => crop(canvas, r))].slice(0, 6);
      const texts = [];
      for (let i = 0; i < variants.length; i++) {
        onStatus(`Odczytuję tekst ${i + 1}/${variants.length}…`);
        const { data } = await w.recognize(variants[i]);
        if ((data.text || '').trim()) texts.push(data.text.trim());
      }
      const v = Plate.vote(texts.concat(res.codes.map(c => c.text)));
      for (const e of v.eans) if (!res.eans.includes(e)) res.eans.push(e);
      res.models = v.models;
    } catch (e) { res.errors.push('OCR: ' + e.message); }
    res.ms = Math.round(performance.now() - t0);
    return res;
  }

  window.PhotoBrowser = { recognize };
})();
