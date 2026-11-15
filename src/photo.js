// Rozpoznawanie modelu / EAN ze zdjęcia – wersja serwerowa (Node).
// Wersja GitHub robi to samo w przeglądarce telefonu (public/photo-browser.js), z tą samą logiką z plate.js.
// 1) kody kreskowe i QR – zxing-wasm   2) tekst – Tesseract OCR (lokalnie, bez wysyłania zdjęć)
const fs = require('fs');
const { isEan, ocrRegions, barcodeBox, vote, candidatesFromText } = require('./plate');

let zx = null;
async function zxing() {
  if (zx) return zx;
  zx = require('zxing-wasm/reader');
  const wasmPath = require.resolve('zxing-wasm/reader/zxing_reader.wasm');
  await zx.prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(wasmPath) }, fireImmediately: true });
  return zx;
}

let workerP = null;
function ocrWorker() {
  if (workerP) return workerP;
  const { createWorker } = require('tesseract.js');
  const data = require('@tesseract.js-data/eng');
  workerP = createWorker('eng', 1, { langPath: data.langPath, gzip: data.gzip, cacheMethod: 'none' }).catch(e => { workerP = null; throw e; });
  return workerP;
}

// skala szarości, rozsądny rozmiar, zamalowanie kodów kreskowych (Tesseract gubi się na paskach), wycinki
async function prepareForOcr(buf, boxes) {
  let Jimp;
  try { ({ Jimp } = require('jimp')); } catch { return [buf]; }
  let img;
  try { img = await Jimp.read(buf); } catch { return [buf]; }
  const W0 = img.bitmap.width;
  const scale = W0 < 700 ? 1000 / W0 : W0 > 2600 ? 2400 / W0 : 1;
  if (scale !== 1) img.scale(scale);
  img.greyscale();
  const { width: w, height: h } = img.bitmap;
  const sb = boxes.map(b => ({ left: b.left * scale, right: b.right * scale, top: b.top * scale, bottom: b.bottom * scale }));
  for (const b of sb) {
    const x0 = Math.max(0, Math.floor(b.left)), x1 = Math.min(w, Math.ceil(b.right));
    const y0 = Math.max(0, Math.floor(b.top)), y1 = Math.min(h, Math.ceil(b.bottom));
    img.scan(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0), function (x, y, idx) { this.bitmap.data[idx] = this.bitmap.data[idx + 1] = this.bitmap.data[idx + 2] = 255; });
  }
  const out = [await img.getBuffer('image/png')];
  for (const r of ocrRegions({ w, h }, sb)) {
    const c = img.clone().crop({ x: r.left, y: r.top, w: Math.min(r.width, w - r.left), h: Math.min(r.height, h - r.top) });
    out.push(await c.getBuffer('image/png'));
  }
  return out;
}

async function recognize(buffer) {
  const t0 = Date.now();
  const res = { eans: [], codes: [], models: [], text: '', ms: 0, errors: [] };
  const boxes = [];
  try {
    const z = await zxing();
    for (const b of await z.readBarcodes(new Uint8Array(buffer), { tryHarder: true, maxNumberOfSymbols: 8, formats: [] })) {
      const box = barcodeBox(b.position); if (box) boxes.push(box);
      const t = (b.text || '').trim();
      if (!t) continue;
      if (isEan(t)) { if (!res.eans.includes(t)) res.eans.push(t); } else res.codes.push({ format: b.format, text: t });
    }
  } catch (e) { res.errors.push('kody: ' + e.message); }
  try {
    const w = await ocrWorker();
    const texts = [];
    for (const img of (await prepareForOcr(Buffer.from(buffer), boxes)).slice(0, 6)) {
      const { data } = await w.recognize(img);
      if ((data.text || '').trim()) texts.push(data.text.trim());
    }
    res.text = [...new Set(texts)].join('\n---\n').slice(0, 3000);
    const v = vote(texts.concat(res.codes.map(c => c.text)));
    for (const e of v.eans) if (!res.eans.includes(e)) res.eans.push(e);
    res.models = v.models;
  } catch (e) { res.errors.push('OCR: ' + e.message); }
  res.ms = Date.now() - t0;
  return res;
}

async function shutdown() { if (workerP) { const w = await workerP.catch(() => null); if (w) await w.terminate().catch(() => {}); } }

module.exports = { recognize, candidatesFromText, shutdown };
