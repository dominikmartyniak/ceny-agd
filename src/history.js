// Prosta historia cen w pliku JSON (bez baz danych i kompilacji natywnych modułów)
const fs = require('fs');
const path = require('path');
const { alnum } = require('./match');

const FILE = process.env.HISTORY_FILE || path.join(__dirname, '..', 'data', 'history.json');
const MAX_ENTRIES = 20000;
let data = null;
let saveTimer = null;

function load() {
  if (data) return data;
  try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { data = { entries: [], watch: [] }; }
  data.entries ||= []; data.watch ||= [];
  return data;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    if (data.entries.length > MAX_ENTRIES) data.entries = data.entries.slice(-MAX_ENTRIES);
    fs.writeFileSync(FILE, JSON.stringify(data, null, 1));
  }, 300);
}

const key = q => alnum(q);

// Zapisuje wynik i zwraca poprzednią zapisaną cenę z tego sklepu (starszą niż 10 min)
function record(query, r) {
  load();
  const k = key(query);
  const prev = [...data.entries].reverse().find(e => e.k === k && e.storeId === r.storeId && Date.now() - e.ts > 10 * 60 * 1000);
  const price = r.aggregator ? r.verifiedPrice : r.price; // Ceneo: tylko cena potwierdzona w sklepie
  if (r.status === 'ok' && price) {
    data.entries.push({ k, q: query, storeId: r.storeId, price, url: r.url, title: r.title, ts: Date.now() });
    save();
  }
  return prev ? { price: prev.price, ts: prev.ts } : null;
}

function history(query) {
  load();
  const k = key(query);
  return data.entries.filter(e => e.k === k);
}

function watchList() { return load().watch; }
function addWatch(q, target) {
  load();
  const k = key(q);
  const w = data.watch.find(x => x.k === k);
  if (w) w.target = target ?? w.target; else data.watch.push({ k, q, target: target ?? null, added: Date.now() });
  save();
}
function removeWatch(q) { load(); const k = key(q); data.watch = data.watch.filter(x => x.k !== k); save(); }

module.exports = { record, history, watchList, addWatch, removeWatch };
