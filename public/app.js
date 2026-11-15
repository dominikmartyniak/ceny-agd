'use strict';
// ====================== narzędzia ======================
const $ = s => document.querySelector(s);
const fmt = n => n == null || isNaN(n) ? '–' : n.toLocaleString('pl-PL', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' zł';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
function toast(msg, ms = 2400) {
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.querySelectorAll('.toast').forEach(x => x.remove());
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, ms);
}
const avail = a => ({ InStock: 'dostępny online', OutOfStock: 'niedostępny', PreOrder: 'przedsprzedaż', LimitedAvailability: 'ograniczona dostępność', BackOrder: 'na zamówienie' }[a] || a);

let B = null; // backend: lokalny serwer albo GitHub
let STORES = [], CONFIG = {};
const settings = Object.assign({ city: '', stores: null, combine: false, includeUnverified: false, useRaty: true, onlyPromo: true }, ls.get('settings', {}));
const saveSettings = () => ls.set('settings', settings);
let basket = ls.get('basket', []);
const saveBasket = () => { ls.set('basket', basket); const c = $('#basketCount'); c.hidden = !basket.length; c.textContent = basket.length; };

const selectedStores = () => settings.stores || STORES.filter(s => s.enabled).map(s => s.id);
const storeById = id => STORES.find(s => s.id === id) || {};
const storeName = id => storeById(id).name || String(id).replace(/^ceneo:/, '') + (String(id).startsWith('ceneo:') ? ' (Ceneo)' : '');
// kolor wykresu przypisany na stałe do sklepu (nie do kolejności wyników)
const storeColor = id => {
  const order = STORES.filter(s => !s.aggregator && !s.linkOnly).map(s => s.id);
  const i = order.indexOf(id);
  return i >= 0 && i < 8 ? `var(--s${i + 1})` : 'var(--s9)';
};
const needSetup = () => { if (B.needsSetup()) { toast('Najpierw połącz aplikację z GitHubem'); showTab('settings'); return true; } return false; };

// ====================== zakładki ======================
const TABS = ['search', 'basket', 'promos', 'watch', 'settings'];
let currentTab = 'search';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function moveInk() {
  const b = document.querySelector(`nav.tabs button[data-tab="${currentTab}"]`), ink = document.querySelector('nav.tabs .ink');
  if (!b || !ink) return;
  const nb = b.getBoundingClientRect(), nr = b.parentElement.getBoundingClientRect();
  ink.style.transform = `translateX(${nb.left - nr.left + (nb.width - ink.offsetWidth) / 2}px)`;
}
addEventListener('resize', moveInk);
function showTab(name) {
  const dir = TABS.indexOf(name) >= TABS.indexOf(currentTab) ? '18px' : '-18px';
  const changed = name !== currentTab;
  currentTab = name;
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  moveInk();
  document.querySelectorAll('.view').forEach(v => {
    const show = v.id === 'v-' + name;
    v.hidden = !show;
    if (show && changed) { v.style.setProperty('--dir', dir); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); }
  });
  if (name === 'watch') loadWatch();
  if (name === 'basket') renderBasketList();
  scrollTo(0, 0);
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });

// ====================== start ======================
async function init() {
  B = await Backends.detect();
  [STORES, CONFIG] = await Promise.all([B.stores(), B.config()]);
  requestAnimationFrame(moveInk);
  if (!settings.city && CONFIG.defaultCity) { settings.city = CONFIG.defaultCity; saveSettings(); }
  $('#city').value = settings.city;
  renderStoreChips();
  saveBasket();
  $('#combine').checked = !!settings.combine;
  $('#unverified').checked = !!settings.includeUnverified;
  $('#useRaty').checked = settings.useRaty !== false;
  if (B.mode === 'github') setupGithubBox();
  const p = new URLSearchParams(location.search);
  if (B.needsSetup()) { showTab('settings'); $('#ghMsg').textContent = 'Uzupełnij token, żeby zacząć (instrukcja w README).'; return; }
  if (p.get('q')) { $('#q').value = p.get('q'); run(p.get('q')); }
  else if (p.get('tab')) showTab(p.get('tab'));
}

function setupGithubBox() {
  $('#ghBox').hidden = false;
  const c = B.cfg();
  $('#ghOwner').value = c.owner || ''; $('#ghRepo').value = c.repo || ''; $('#ghToken').value = c.token || '';
  $('#ghSave').addEventListener('click', async () => {
    B.saveCfg({ owner: $('#ghOwner').value.trim(), repo: $('#ghRepo').value.trim(), token: $('#ghToken').value.trim() });
    $('#ghMsg').innerHTML = '<span class="spin"></span> Sprawdzam…';
    try { await B.test(); $('#ghMsg').innerHTML = '<span class="save">✅ Połączono. Możesz wyszukiwać.</span>'; }
    catch (e) { $('#ghMsg').innerHTML = `<span style="color:var(--bad)">❌ ${esc(e.message)}</span>`; }
  });
}

$('#shareAccess').addEventListener('click', async () => {
  if (B.mode !== 'github' || B.needsSetup()) { toast('Najpierw połącz aplikację z GitHubem'); return; }
  if (!confirm('Link zawiera Twój token. Każdy, kto go dostanie, będzie mógł korzystać z aplikacji (i uruchamiać wyszukiwania na Twoim koncie GitHub). Skopiować?')) return;
  const link = B.shareLink();
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Ceny AGD i RTV', url: link });
    else { await navigator.clipboard.writeText(link); toast('Skopiowano link z dostępem'); }
  } catch { prompt('Skopiuj link:', link); }
});

function renderStoreChips() {
  const sel = selectedStores();
  $('#stores').innerHTML = STORES.map(s => `<label class="chip ${s.verified ? '' : 'unv'}"><input type="checkbox" value="${s.id}" ${sel.includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('');
}
$('#stores').addEventListener('change', () => { settings.stores = [...document.querySelectorAll('#stores input:checked')].map(i => i.value); saveSettings(); });
$('#city').addEventListener('change', e => { settings.city = e.target.value.trim(); saveSettings(); toast('Zapisano miasto'); });
$('#unverified').addEventListener('change', e => { settings.includeUnverified = e.target.checked; saveSettings(); if (results.size) render(); });
$('#combine').addEventListener('change', e => { settings.combine = e.target.checked; saveSettings(); if (lastPlanProducts) replan(); });
$('#useRaty').addEventListener('change', e => { settings.useRaty = e.target.checked; saveSettings(); if (lastPlanProducts) replan(); });
$('#clearLocal').addEventListener('click', () => { if (confirm('Wyczyścić koszyk i ustawienia na tym urządzeniu (także token)?')) { localStorage.clear(); location.reload(); } });

// ====================== zdjęcie -> model / EAN ======================
async function resizeImage(file, max = 2000) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  } finally { URL.revokeObjectURL(url); }
}

function photoFlow(btn, box, onPick) {
  const input = $('#camInput');
  btn.addEventListener('click', () => {
    input.value = '';
    input.onchange = async () => {
      const f = input.files[0]; if (!f) return;
      const say = t => { box.innerHTML = `<p class="hint"><span class="spin"></span> ${esc(t)}</p>`; };
      say('Odczytuję kod kreskowy i tekst ze zdjęcia…');
      try {
        const blob = await resizeImage(f);
        const r = B.mode === 'github' ? await window.PhotoBrowser.recognize(blob, say) : await B.photo(blob);
        const picks = [...(r.eans || []).map(v => ({ v, k: 'EAN' })), ...(r.models || []).map(v => ({ v: v.replace(/\/.*$/, '').length >= 5 ? v.replace(/\/.*$/, '') : v, k: 'model' }))]
          .filter((x, i, a) => a.findIndex(y => y.v === x.v) === i);
        if (!picks.length) { box.innerHTML = `<p class="hint">Nie rozpoznano modelu ani kodu. Zrób zdjęcie bliżej, prosto i bez odblasków – albo wpisz ręcznie.${r.errors && r.errors.length ? '<br>' + esc(r.errors.join('; ')) : ''}</p>`; return; }
        box.innerHTML = `<p class="hint">Rozpoznano (${(r.ms / 1000).toFixed(1)} s) – wybierz:</p><div class="chips">${picks.map(p => `<button type="button" class="chip pick" data-v="${esc(p.v)}">${esc(p.v)} <small>${p.k}</small></button>`).join('')}</div>`;
        box.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { box.innerHTML = ''; onPick(b.dataset.v); }));
      } catch (e) { box.innerHTML = `<p class="hint" style="color:var(--bad)">Błąd rozpoznawania: ${esc(e.message)}</p>`; }
    };
    input.click();
  });
}
photoFlow($('#camBtn'), $('#photoBox'), v => { $('#q').value = v; run(v); });
photoFlow($('#bCamBtn'), $('#bPhotoBox'), v => addToBasket(v));

// ====================== wyszukiwanie ======================
let results = new Map(), currentQ = '', stopSearch = null, resolvedInfo = null, statusText = '', searchError = '';
const stockState = new Map();

$('#f').addEventListener('submit', e => { e.preventDefault(); run($('#q').value.trim()); $('#q').blur(); });
$('#refresh').addEventListener('click', () => run(currentQ, true));

function run(q, fresh = false) {
  if (!q || q.length < 2) return;
  showTab('search');
  if (needSetup()) return;
  if (/^https?:\/\//i.test(q)) return runUrl(q);
  if (isDescriptive(q)) return runDiscover(q, fresh);
  setMode('price');
  currentQ = q; resolvedInfo = null; stockState.clear(); statusText = ''; searchError = ''; lastHistory = null;
  history.replaceState(null, '', '?q=' + encodeURIComponent(q));
  if (stopSearch) stopSearch();
  results = new Map();
  const ids = selectedStores();
  STORES.filter(s => ids.includes(s.id)).forEach(s => results.set(s.id, { storeId: s.id, store: s.name, status: 'loading' }));
  render(); $('#historyBox').innerHTML = '';
  $('#toolbar').hidden = false; $('#go').disabled = true;
  stopSearch = B.search(q, { stores: ids, fresh }, {
    onResult: r => { results.set(r.storeId, r); render(); },
    onResolved: d => { resolvedInfo = d; statusText = `Szukam dalej po modelu ${d.model} w pozostałych sklepach…`; render(); },
    onStatus: t => { statusText = t; render(); },
    onError: msg => { searchError = msg; },
    onDone: ms => {
      $('#go').disabled = false; statusText = '';
      for (const r of results.values()) if (r.status === 'loading') Object.assign(r, { status: 'error', note: searchError || 'Brak odpowiedzi.' });
      render(ms); loadHistory(q);
    },
  });
}

async function runUrl(u) {
  setMode('price');
  currentQ = u; results = new Map([['url', { storeId: 'url', store: 'Link', status: 'loading' }]]);
  render(); $('#toolbar').hidden = false; $('#go').disabled = true;
  try { const r = await B.url(u); results = new Map([[r.storeId, r]]); }
  catch (e) { results = new Map([['url', { storeId: 'url', store: 'Link', status: 'error', note: String(e.message || e) }]]); }
  $('#go').disabled = false; render();
}

// model w zapytaniu (WW80T504DAEA, 55C845) = porównanie cen; sam opis = propozycje
const hasModel = q => String(q).split(/[\s,;/|]+/).some(t => window.Plate.isModelToken(t.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '')));
const isDescriptive = q => window.Need.isDescriptive(q, hasModel(q) ? ['m'] : []);
let mode = 'price';
function setMode(m) {
  mode = m;
  $('#disc').hidden = m !== 'discover';
  $('#list').hidden = $('#similarBox').hidden = $('#historyBox').hidden = m === 'discover';
  if (m === 'discover') $('#toolbar').hidden = true; else { $('#similarBox').innerHTML = ''; }
}

const statusOrder = { ok: 0, no_price: 1, loading: 2, link: 3, not_found: 4, blocked: 5, error: 6 };

// „Klasa cenowa” jak na etykiecie energetycznej: A = najtaniej, każda kolejna litera = drożej
const CLASSES = [['A', 0.005, '--eA'], ['B', 0.02, '--eB'], ['C', 0.04, '--eC'], ['D', 0.07, '--eD'], ['E', 0.10, '--eE'], ['F', 0.15, '--eF'], ['G', Infinity, '--eG']];
function priceClass(price, min) {
  if (!price || !min) return null;
  const pct = (price - min) / min;
  const i = CLASSES.findIndex(c => pct <= c[1]);
  return { letter: CLASSES[i][0], color: `var(${CLASSES[i][2]})`, idx: i, dark: i === 3 || i === 4 };
}
const effPrice = r => r.aggregator ? r.verifiedPrice : (r.status === 'ok' ? r.price : null);
const revealed = new Set();

function render(ms) {
  const arr = [...results.values()].sort((a, b) => (statusOrder[a.status] - statusOrder[b.status]) || ((effPrice(a) ?? 1e12) - (effPrice(b) ?? 1e12)));
  // najniższa cena: sklepy sprawdzone bezpośrednio + potwierdzone oferty z Ceneo
  const offers = window.Offers.offersFromResults(arr, { includeUnverified: settings.includeUnverified });
  const best = offers.slice().sort((a, b) => a.price - b.price)[0];
  const max = offers.length ? Math.max(...offers.map(o => o.price)) : null;
  const pending = arr.filter(r => r.status === 'loading').length;
  const min = best ? best.price : null;

  let sum = '';
  if (resolvedInfo) sum += `<div class="sum-line">EAN ${esc(resolvedInfo.ean)} to model <b style="color:var(--ink)">${esc(resolvedInfo.model)}</b></div>`;
  if (best) {
    sum += `<div class="best-tag"><span class="arrow" aria-hidden="true">A</span><span><span class="bt-label">Najtaniej: </span><span class="bt-price">${fmt(best.price)}</span></span>
      <span class="bt-store"><b>${esc(best.store)}</b>${max > best.price ? `, najdrożej ${fmt(max)} (o <b class="save">${fmt(max - best.price)}</b> więcej)` : ''}</span></div>`;
    const raty = arr.filter(r => r.status === 'ok' && r.installments && r.installments.saving > 0 && !r.installments.upTo)
      .map(r => ({ r, total: r.installments.total })).sort((a, b) => a.total - b.total)[0];
    if (raty && raty.total < best.price - 0.5) sum += `<div class="sum-line">Na raty gratis: <b class="save">${fmt(raty.total)}</b> w ${esc(raty.r.store)} (${raty.r.installments.freeCount} rat${raty.r.installments.freeCount > 1 ? 'y' : 'a'} spłaca sklep) – taniej niż gotówką o ${fmt(best.price - raty.total)}.</div>`;
    sum += `<div class="sum-line">Porównano ${offers.length} potwierdzonych ofert${pending ? `, czekam jeszcze na ${pending} sklep(y)` : ''}${ms ? ` w ${(ms / 1000).toFixed(0)} s` : ''}.</div>`;
  } else sum += `<div class="sum-line">${pending ? `Szukam w ${pending} sklepach…` : 'Brak potwierdzonych cen do porównania.'}</div>`;
  if (statusText) sum += `<div class="status-line"><span class="spin"></span>${esc(statusText)}</div>`;
  if (searchError) sum += `<div class="status-line" style="color:var(--bad)">${esc(searchError)}</div>`;
  $('#summary').innerHTML = sum;

  // --- lista: aktualizacja po kluczu + płynne przesuwanie (FLIP), zamiast przebudowy całości
  const list = $('#list');
  const before = new Map([...list.children].map(el => [el.dataset.key, el.getBoundingClientRect().top]));
  const keep = new Set();
  for (const r of arr) {
    const key = r.storeId; keep.add(key);
    let el = [...list.children].find(c => c.dataset.key === key);
    const isNew = !el;
    if (isNew) { el = document.createElement('div'); el.dataset.key = key; if (before.size || arr.length) el.classList.add('enter'); }
    const pc = priceClass(effPrice(r), min);
    const html = rowHtml(r, pc, min);
    if (el.dataset.sig !== html) {
      const wasLoading = el.dataset.status === 'loading';
      el.innerHTML = html; el.dataset.sig = html; el.dataset.status = r.status;
      if ((isNew || wasLoading) && effPrice(r)) countUp(el.querySelector('.pnum'), effPrice(r));
    }
    el.className = 'row' + (isNew ? ' enter' : el.classList.contains('enter') ? ' enter' : '');
    list.appendChild(el);
  }
  [...list.children].forEach(el => { if (!keep.has(el.dataset.key)) el.remove(); });
  if (!reduceMotion.matches) for (const el of list.children) {
    const prev = before.get(el.dataset.key); if (prev == null) continue;
    const dy = prev - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  // płynne rozwinięcie nowych paneli (oferty, dostępność)
  list.querySelectorAll('.reveal:not(.open)').forEach(p => {
    if (revealed.has(p.dataset.rid)) p.classList.add('open');
    else requestAnimationFrame(() => requestAnimationFrame(() => { p.classList.add('open'); revealed.add(p.dataset.rid); }));
  });
}

function countUp(el, to) {
  if (!el || reduceMotion.matches) return;
  const from = to * 0.82, t0 = performance.now(), dur = 520;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(k < 1 ? Math.round(from + (to - from) * e) : to);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function rowHtml(r, pc, min) {
  if (r.status === 'loading') {
    return `<div class="rank none" aria-hidden="true"></div><div class="store">${esc(r.store)}<small><span class="skel w60" style="width:70px;margin-top:6px"></span></small></div>
      <div class="price"><span class="skel price"></span></div><div class="title"><span class="skel w60"></span><span class="skel w40"></span></div>`;
  }
  let badge = '';
  if (r.status === 'ok') badge = r.aggregator ? `<span class="badge b-ok">${(r.offers || []).length} ofert</span>` : r.match === 'exact' ? `<span class="badge b-ok">${r.byEan ? 'EAN ✓' : 'model ✓'}</span>` : '<span class="badge b-warn">podobny model</span>';
  else if (r.status === 'not_found') badge = '<span class="badge b-muted">brak modelu</span>';
  else if (r.status === 'blocked') badge = '<span class="badge b-bad">zablokowane</span>';
  else if (r.status === 'error') badge = '<span class="badge b-bad">błąd</span>';
  else if (r.status === 'no_price') badge = '<span class="badge b-warn">bez ceny</span>';
  else if (r.status === 'link') badge = '<span class="badge b-muted">sprawdź sam</span>';
  if (r.cached) badge += '<span class="badge b-muted">z pamięci</span>';

  let sub = '';
  if (r.regularPrice && r.price && r.regularPrice > r.price) sub += `<s>${fmt(r.regularPrice)}</s>`;
  if (pc && pc.idx > 0 && min) sub += `<small class="plus">+${fmt(effPrice(r) - min)}</small>`;
  if (r.previous && r.price && r.previous.price !== r.price) {
    const d = r.price - r.previous.price;
    sub += `<small class="${d < 0 ? 'diff-down' : 'diff-up'}">${d < 0 ? '▼' : '▲'} ${fmt(Math.abs(d))} od ${new Date(r.previous.ts).toLocaleDateString('pl-PL')}</small>`;
  } else if (r.lowest30) sub += `<small>min. 30 dni: ${fmt(r.lowest30)}</small>`;
  else if (r.availability && !pc?.idx) sub += `<small>${esc(avail(r.availability))}</small>`;

  const link = r.url || r.searchUrl;
  const title = r.title || (r.status === 'not_found' ? 'Nie znaleziono tego modelu' : 'Otwórz wyszukiwanie w sklepie');
  const promos = (r.promos || []).length ? `<div class="full promos">${r.promos.map(p => `<span class="promo ${p.type === 'info' ? 'info' : ''}">${esc(p.label)}</span>`).join('')}</div>` : '';
  const alts = (r.alternatives || []).length && r.status !== 'ok'
    ? `<div class="full alts">Podobne: ${r.alternatives.map(a => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title.slice(0, 60))}</a>${a.price ? ' (' + fmt(a.price) + ')' : ''}`).join(', ')}</div>` : '';
  const offers = (r.offers || []).length ? `<div class="full reveal" data-rid="of-${esc(r.storeId)}"><div><div class="offers">${r.offers.slice(0, 8).map(offerHtml).join('')}
    <div class="legend-ceneo">✅ cena potwierdzona w sklepie, ⚠️ w sklepie inna cena, ❌ w sklepie inny produkt, 🔒 sklep blokuje sprawdzenie</div></div></div></div>` : '';
  const money = r.status === 'ok' && !r.aggregator ? financeHtml(r) : '';
  const st = stockState.get(r.storeId);
  const actions = r.status === 'ok' && r.url && !r.aggregator
    ? `<div class="full actions"><button class="ghost small" data-stock="${esc(r.storeId)}">Dostępność w salonie${settings.city ? ': ' + esc(settings.city) : ''}</button></div>`
    : r.status === 'link' ? `<div class="full actions"><a class="linkbtn" href="${esc(r.url)}" target="_blank" rel="noopener">Otwórz ${esc(r.store)} – od najtańszych ↗</a></div>` : '';
  const rank = pc ? `<div class="rank${pc.dark ? ' dark' : ''}" style="--c:${pc.color};--w:${34 + pc.idx * 4}px" title="Klasa cenowa ${pc.letter}">${pc.letter}</div>` : `<div class="rank none" aria-hidden="true">–</div>`;
  const priceHtml = r.status === 'link' ? '' : r.aggregator ? ceneoPrice(r) : `<span class="pnum">${fmt(r.price)}</span>`;
  return `${rank}
    <div class="store">${esc(r.store)}<small>${badge}</small></div>
    <div class="price">${priceHtml}${sub}</div>
    <div class="title">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(title)}</a>` : esc(title)}</div>
    ${r.note ? `<div class="full note">${esc(r.note)}</div>` : ''}${promos}${money}${offers}${alts}${actions}
    ${st ? `<div class="full reveal" data-rid="st-${esc(r.storeId)}-${st.loading ? 'l' : 'd'}"><div><div class="stock">${stockHtml(st)}</div></div></div>` : ''}`;
}

// Raty, zwroty, bony i ocena promocji (prawdziwa / pozorna)
function financeHtml(r) {
  const out = [];
  const v = window.Honesty.promoVerdict(r, (lastHistory || []).filter(e => e.storeId === r.storeId));
  if (v) out.push(`<div class="verdict v-${v.level}">${{ real: '✔', fake: '✖', raised: '✖', higher: '▲', info: 'ⓘ' }[v.level]} ${esc(v.text)}</div>`);
  const i = r.installments;
  if (i) {
    let t = i.count && i.monthly ? `${i.count} × ${fmt(i.monthly)}${i.zero ? ' (0%)' : ''}` : 'Raty';
    if (i.saving > 0 && !i.upTo) t += ` · <b class="save">${i.freeCount} rat${i.freeCount > 1 ? 'y' : 'a'} gratis → zapłacisz ${fmt(i.total)} (−${fmt(i.saving)})</b>`;
    else if (i.freeCount && i.upTo) t += ` · nawet ${i.freeCount} raty gratis (ile – zależy od produktu, sprawdź na karcie)`;
    if (i.extraCost > 0) t += ` · <span style="color:var(--bad)">raty kosztują ${fmt(i.extraCost)} więcej niż gotówka</span>`;
    out.push(`<div class="fin">💳 ${t}</div>`);
  }
  for (const e of r.extras || []) out.push(`<div class="fin">${e.kind === 'zwrot' ? '↩️ Zwrot' : '🎟️ Bon'} ${e.upTo ? 'do ' : ''}${fmt(e.amount)} <span class="muted">– ${e.kind === 'zwrot' ? 'od producenta po zakupie (zwykle trzeba zarejestrować)' : 'na kolejne zakupy, nie obniża tej ceny'}; nie odejmujemy od ceny</span></div>`);
  return out.length ? `<div class="full money">${out.join('')}</div>` : '';
}

function ceneoPrice(r) {
  if (r.verifiedPrice) return `<small>od, potwierdzone</small><span class="pnum">${fmt(r.verifiedPrice)}</span>`;
  return r.price ? `<small>od, niepotwierdzone</small><span class="muted">${fmt(r.price)}</span>` : '–';
}
function offerHtml(o) {
  const v = o.verify || {};
  const icon = { ok: '✅', diff: '⚠️', wrong: '❌', blocked: '🔒', noprice: '❔', error: '❔', unchecked: '·' }[v.status] || '·';
  let right = `<b>${fmt(o.price)}</b>`;
  if (v.status === 'diff') right = `<span><s class="muted">${fmt(o.price)}</s> <b>${fmt(v.shopPrice)}</b></span>`;
  if (v.status === 'wrong') right = `<span class="muted">inny produkt</span>`;
  const warn = [];
  if (v.ceneoOnly) warn.push(`taniej tylko z linku Ceneo (wejście bezpośrednie: ${fmt(v.cleanPrice)})`);
  if (o.rating != null && (o.rating < 4.5 || (o.reviews != null && o.reviews < 30))) warn.push(`sklep: ${String(o.rating).replace('.', ',')}/5, ${o.reviews ?? '?'} opinii`);
  if (v.status === 'blocked') warn.push('nie da się potwierdzić – sprawdź sam');
  const cls = v.status === 'ok' || v.status === 'diff' ? 'hl' : v.status === 'wrong' ? 'muted' : '';
  return `<a href="${esc(o.url)}" target="_blank" rel="noopener" class="${cls}"><span>${icon} ${esc(o.shop)}${o.delivery ? ' · <span class="muted">' + esc(o.delivery) + '</span>' : ''}${warn.length ? `<br><small style="color:var(--warn)">${esc(warn.join(' · '))}</small>` : ''}</span>${right}</a>`;
}

// ====================== dostępność w salonie ======================
$('#list').addEventListener('click', async e => {
  const b = e.target.closest('[data-stock]'); if (!b) return;
  if (!settings.city) { toast('Ustaw miasto w Ustawieniach'); showTab('settings'); $('#city').focus(); return; }
  const r = results.get(b.dataset.stock); if (!r) return;
  stockState.set(r.storeId, { loading: true, text: '' }); render();
  try {
    const d = await B.stock(r.url, settings.city, t => { stockState.set(r.storeId, { loading: true, text: t }); render(); });
    stockState.set(r.storeId, d);
  } catch (err) { stockState.set(r.storeId, { status: 'error', note: String(err.message || err) }); }
  render();
});

function stockHtml(s) {
  if (s.loading) return `<span class="spin"></span> Sprawdzam salony w: ${esc(settings.city)}… ${esc(s.text || '(do 30 s)')}`;
  if (s.status !== 'ok') return esc(s.note || s.error || 'Nie udało się sprawdzić.');
  const icon = { yes: '✅', no: '❌', order: '🚚', unknown: '❔' };
  return s.shops.map(x => `<div>${icon[x.status]} ${x.lines.map(esc).join(' · ')}</div>`).join('')
    + `<div class="muted" style="font-size:11.5px">🚚 = do zamówienia z odbiorem w salonie · odczyt automatyczny, potwierdź na stronie sklepu</div>`;
}

// ====================== historia ceny – wykres ======================
let lastHistory = null;
async function loadHistory(q) {
  try { lastHistory = await B.history(q); renderChart($('#historyBox'), lastHistory); if (mode === 'price') render(); } catch { /* brak historii */ }
}
addEventListener('resize', () => { clearTimeout(window._rz); window._rz = setTimeout(() => { if (lastHistory && !$('#v-search').hidden) renderChart($('#historyBox'), lastHistory); }, 200); });

function renderChart(box, entries) {
  if (!entries || !entries.length) { box.innerHTML = ''; return; }
  const series = new Map();
  for (const e of entries) { if (!series.has(e.storeId)) series.set(e.storeId, []); series.get(e.storeId).push(e); }
  for (const s of series.values()) s.sort((a, b) => a.ts - b.ts);
  const times = [...new Set(entries.map(e => e.ts))].sort((a, b) => a - b);
  if (times.length < 2) {
    box.innerHTML = `<h2>Historia ceny</h2><p class="hint">Wykres pojawi się po kolejnym sprawdzeniu ceny (np. jutro, albo dodaj produkt do obserwowanych).</p>`;
    return;
  }
  // wymiary w pikselach ekranu – tekst osi ma zawsze czytelne 11 px (też na telefonie)
  const W = Math.max(300, Math.min(940, (box.clientWidth || 640) - 26)), H = W < 500 ? 220 : 260, L = 50, R = 12, T = 12, B2 = 28;
  let yMin = Math.min(...entries.map(e => e.price)), yMax = Math.max(...entries.map(e => e.price));
  const pad = Math.max((yMax - yMin) * 0.08, yMax * 0.01);
  yMin -= pad; yMax += pad;
  const step = niceStep((yMax - yMin) / 4);
  yMin = Math.floor(yMin / step) * step; yMax = Math.ceil(yMax / step) * step;
  const t0 = times[0], t1 = times[times.length - 1];
  const x = t => L + (W - L - R) * (t - t0) / Math.max(1, t1 - t0);
  const y = v => T + (H - T - B2) * (1 - (v - yMin) / (yMax - yMin));

  let grid = '';
  for (let v = yMin; v <= yMax + 0.001; v += step) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/>`
      + `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--text-secondary)">${Math.round(v).toLocaleString('pl-PL')}</text>`;
  }
  const nT = Math.min(W < 500 ? 4 : 6, times.length);
  for (let i = 0; i < nT; i++) {
    const t = t0 + (t1 - t0) * i / Math.max(1, nT - 1);
    grid += `<text x="${x(t)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === nT - 1 ? 'end' : 'middle'}" font-size="11" fill="var(--text-secondary)">${new Date(t).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })}</text>`;
  }
  let lines = '';
  for (const [id, pts] of series) {
    const c = storeColor(id);
    let d = '';
    pts.forEach((p, i) => { d += i ? ` H${x(p.ts).toFixed(1)} V${y(p.price).toFixed(1)}` : `M${x(p.ts).toFixed(1)} ${y(p.price).toFixed(1)}`; });
    d += ` H${(W - R).toFixed(1)}`;
    lines += `<path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`;
    lines += pts.map(p => `<circle cx="${x(p.ts)}" cy="${y(p.price)}" r="4" fill="${c}" stroke="var(--surface-1)" stroke-width="2"/>`).join('');
  }
  const ids = [...series.keys()];
  const legend = ids.length >= 2 ? `<div class="legend">${ids.map(id => `<span style="--c:${storeColor(id)}">${esc(storeName(id))}</span>`).join('')}</div>` : '';
  const rows = entries.slice().sort((a, b) => b.ts - a.ts).slice(0, 60)
    .map(e => `<tr><td>${new Date(e.ts).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(storeName(e.storeId))}</td><td>${fmt(e.price)}</td></tr>`).join('');
  box.innerHTML = `<h2>Historia ceny${ids.length === 1 ? ' – ' + esc(storeName(ids[0])) : ''}</h2>
    <div class="chart-card">${legend}
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Historia ceny w sklepach">${grid}${lines}
        <line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B2}" stroke="var(--text-secondary)" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>
      </svg><div class="tip" hidden></div>
    </div>
    <details><summary>Tabela</summary><div class="scroll-x"><table class="matrix"><thead><tr><th>Data</th><th>Sklep</th><th>Cena</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;

  const svg = box.querySelector('svg'), tip = box.querySelector('.tip'), xh = box.querySelector('.xh'), card = box.querySelector('.chart-card');
  svg.querySelectorAll('path').forEach(p => { try { p.style.setProperty('--len', Math.ceil(p.getTotalLength())); } catch {} });
  const move = ev => {
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const t = times.reduce((bst, tt) => Math.abs(x(tt) - p.x) < Math.abs(x(bst) - p.x) ? tt : bst, times[0]);
    xh.setAttribute('x1', x(t)); xh.setAttribute('x2', x(t)); xh.setAttribute('visibility', 'visible');
    const vals = ids.map(id => { const s = series.get(id).filter(e => e.ts <= t); return s.length ? { id, price: s[s.length - 1].price } : null; }).filter(Boolean).sort((a, b) => a.price - b.price);
    tip.innerHTML = `<b>${new Date(t).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })}</b>` + vals.map(v => `<div><i style="background:${storeColor(v.id)}"></i>${esc(storeName(v.id))}<span class="v">${fmt(v.price)}</span></div>`).join('');
    tip.hidden = false;
    const cr = card.getBoundingClientRect();
    let left = ev.clientX - cr.left + 12; if (left + 190 > cr.width) left = ev.clientX - cr.left - 200;
    tip.style.left = Math.max(4, left) + 'px'; tip.style.top = Math.max(4, ev.clientY - cr.top - 20) + 'px';
  };
  const hide = () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', hide);
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

// ====================== CSV / obserwowane ======================
$('#csv').addEventListener('click', () => {
  const rows = [['Sklep', 'Produkt', 'Cena', 'Cena regularna', 'Dopasowanie', 'Promocje', 'Status', 'Link']];
  for (const r of results.values()) {
    rows.push([r.store, r.title || '', r.price ?? '', r.regularPrice ?? '', r.match || '', (r.promos || []).map(p => p.label).join(', '), r.status, r.url || r.searchUrl || '']);
    for (const o of r.offers || []) rows.push([o.shop + ' (Ceneo)', o.title || '', (o.verify && o.verify.shopPrice) || o.price, o.price, '', '', 'Ceneo: ' + ((o.verify && o.verify.status) || 'niesprawdzone'), o.url]);
  }
  downloadCsv(rows, `ceny-${currentQ.replace(/\W+/g, '_')}.csv`);
});
function downloadCsv(rows, name) {
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: name }).click();
}

$('#watchBtn').addEventListener('click', async () => {
  if (!currentQ || /^https?:/.test(currentQ)) return;
  const t = prompt('Powiadom, gdy cena spadnie poniżej (zł) – opcjonalnie:', '');
  if (t === null) return;
  try { await B.addWatch(resolvedInfo ? resolvedInfo.model : currentQ, t ? Number(t.replace(',', '.')) : null); toast('Dodano do obserwowanych'); }
  catch (e) { toast('Błąd: ' + e.message, 4000); }
});
async function loadWatch() {
  $('#watchList').innerHTML = '<p class="hint"><span class="spin"></span></p>';
  try {
    const [list, st] = await Promise.all([B.watchList(), B.watchStatus()]);
    $('#watchList').innerHTML = list.length ? list.map(w => {
      const s = st[w.k];
      return `<div class="basket-item">
        <span class="q"><span class="link" data-q="${esc(w.q)}">${esc(w.q)}</span>${s && s.best ? `<br><small class="muted">${fmt(s.best.price)} – ${esc(s.best.store)} · ${new Date(s.ts).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}</small>` : ''}</span>
        ${w.target ? `<span class="muted">próg ${fmt(w.target)}</span>` : ''}
        <button class="ghost small" data-del="${esc(w.q)}" aria-label="Przestań obserwować">Usuń</button></div>`;
    }).join('') : '<p class="hint">Brak. Wyszukaj produkt i kliknij „☆ Obserwuj”.</p>';
  } catch (e) { $('#watchList').innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
}
$('#watchList').addEventListener('click', async e => {
  if (e.target.dataset.q) { $('#q').value = e.target.dataset.q; run(e.target.dataset.q); }
  if (e.target.dataset.del) { try { await B.removeWatch(e.target.dataset.del); } catch (err) { toast(err.message); } loadWatch(); }
});

// ====================== koszyk ======================
$('#addBasket').addEventListener('click', () => { if (currentQ && !/^https?:/.test(currentQ)) addToBasket(resolvedInfo ? resolvedInfo.model : currentQ); });
$('#bf').addEventListener('submit', e => { e.preventDefault(); addToBasket($('#bq').value.trim()); $('#bq').value = ''; });

function addToBasket(q) {
  if (!q || q.length < 2) return;
  if (basket.some(b => b.toLowerCase() === q.toLowerCase())) { toast('Już jest w koszyku'); return; }
  if (basket.length >= 8) { toast('Maksymalnie 8 pozycji'); return; }
  basket.push(q); saveBasket(); renderBasketList(); toast(`Dodano: ${q}`);
}
function renderBasketList() {
  $('#basketList').innerHTML = basket.length ? basket.map((q, i) => `<div class="basket-item"><span class="num">${i + 1}</span><span class="q">${esc(q)}</span><button class="ghost small" data-rm="${i}" aria-label="Usuń ${esc(q)}">Usuń</button></div>`).join('')
    : '<p class="hint">Dodaj kilka sprzętów (np. pralka, lodówka, zmywarka). Aplikacja policzy, gdzie wyjdzie najtaniej z promocjami koszykowymi – w jednym sklepie albo z podziałem.</p>';
  $('#runBasket').disabled = !basket.length;
}
$('#basketList').addEventListener('click', e => { if (e.target.dataset.rm != null) { basket.splice(+e.target.dataset.rm, 1); saveBasket(); renderBasketList(); } });

let lastPlanProducts = null, stopBasket = null;
$('#runBasket').addEventListener('click', () => {
  if (!basket.length || needSetup()) return;
  if (stopBasket) stopBasket();
  const ids = selectedStores().filter(id => !storeById(id).linkOnly);
  const total = basket.length * ids.length; let done = 0;
  const prog = $('#bProg'); prog.hidden = false; prog.firstElementChild.style.width = '2%';
  $('#basketOut').innerHTML = ''; $('#runBasket').disabled = true;
  $('#bStatus').textContent = `Sprawdzam ${basket.length} sprzęt(y) w ${ids.length} sklepach… (1–3 min)`;
  stopBasket = B.basket(basket.slice(), { stores: ids, combine: settings.combine, includeUnverified: settings.includeUnverified, useRaty: settings.useRaty !== false }, {
    onItem: r => {
      done = Math.min(total, done + 1);
      prog.firstElementChild.style.width = Math.round(100 * done / total) + '%';
      $('#bStatus').textContent = `${done}/${total} · ${basket[r.i] || ''} · ${r.store}: ${r.status === 'ok' ? fmt(r.price) : 'brak'}`;
    },
    onStatus: t => { if (!done) $('#bStatus').textContent = '⏳ ' + t; },
    onPlan: d => { lastPlanProducts = d.products; renderPlan(d); },
    onError: msg => { $('#basketOut').innerHTML = `<p class="hint" style="color:var(--bad)">${esc(msg)}</p>`; },
    onDone: () => { prog.hidden = true; $('#runBasket').disabled = false; $('#bStatus').textContent = ''; },
  });
});

function replan() { renderPlan({ ...window.Promos.optimizeBasket(lastPlanProducts, { combine: settings.combine, useRaty: settings.useRaty !== false }), products: lastPlanProducts }); }

function extrasHtml(ex) {
  if (!ex || !ex.length) return '';
  return `<div class="muted" style="font-size:12.5px;margin-top:6px">Dodatkowo (nie odjęte od sumy): ${ex.map(e => `${e.kind === 'zwrot' ? 'zwrot' : 'bon'} ${e.upTo ? 'do ' : ''}${fmt(e.amount)}${e.store ? ' – ' + esc(e.store) : ''}`).join(', ')}</div>`;
}
function renderPlan(d) {
  const { single = [], split, missing = [], products = [] } = d;
  let h = '';
  if (missing.length) h += `<div class="card" style="border-color:var(--warn)"><b>Nie znaleziono w żadnym sklepie:</b> ${missing.map(esc).join(', ')}<br><span class="muted">Sprawdź pisownię modelu albo użyj EAN.</span></div>`;
  const bestSingle = single[0];
  if (split) {
    const saving = bestSingle ? bestSingle.total - split.total : 0;
    const oneStore = split.byStore.length === 1;
    h += `<h2>Najlepsza opcja</h2><div class="card win"><h3><span>${oneStore ? 'Wszystko w: ' + esc(split.stores[0]) : 'Podział: ' + split.stores.map(esc).join(' + ')}</span><span class="tot">${fmt(split.total)}</span></h3>
      ${split.discount ? `<div class="save">Promocje: −${fmt(split.discount)}</div>` : ''}
      ${!oneStore && saving > 0.5 ? `<div class="save">Taniej o ${fmt(saving)} niż wszystko w jednym sklepie (${esc(bestSingle.stores[0])})</div>` : ''}
      ${!oneStore && bestSingle && saving <= 0.5 ? `<div class="muted">Podział nic nie daje – kup wszystko w ${esc(bestSingle.stores[0])}.</div>` : ''}
      <ul>${split.lines.map(l => `<li>${esc(l.q)} → <b>${esc(l.store)}</b> ${fmt(l.price)} <a class="link" href="${esc(l.url)}" target="_blank" rel="noopener">otwórz</a></li>`).join('')}</ul>
      ${split.byStore.filter(b => b.applied.length).map(b => `<div class="muted" style="margin-top:6px">${esc(b.store)}: ${b.applied.map(a => `${esc(a.label)} −${fmt(a.amount)}`).join(', ')}</div>`).join('')}
      ${split.byStore.filter(b => b.method === 'raty').map(b => `<div class="save" style="margin-top:6px">${esc(b.store)}: na raty gratis ${fmt(b.ratyTotal)} (gotówką z rabatem byłoby ${fmt(b.cashTotal)})</div>`).join('')}
      ${extrasHtml(split.extras)}
    </div>`;
  }
  if (single.length) {
    h += `<h2>Wszystko w jednym sklepie</h2>` + single.slice(0, 8).map((p, i) => `<div class="card ${!split && i === 0 ? 'win' : ''}">
      <h3><span>${esc(p.stores[0])}</span><span class="tot">${fmt(p.total)}</span></h3>
      ${p.discount ? `<div><span class="muted">bez promocji ${fmt(p.subtotal)}</span> · <span class="save">${p.applied.map(a => `${esc(a.label)}: −${fmt(a.amount)}`).join(', ')}</span></div>` : '<div class="muted">brak promocji koszykowych na te produkty</div>'}
      ${p.other && p.other.length ? `<div class="muted" style="font-size:12.5px">Inne promocje (zwykle się nie łączą): ${p.other.map(a => `${esc(a.label)} −${fmt(a.amount)}`).join(', ')}</div>` : ''}
      ${p.ratyTotal ? `<div style="font-size:13px">${p.method === 'raty' ? '<b class="save">Wybrano raty gratis</b>' : 'Raty gratis'}: ${fmt(p.ratyTotal)} · gotówką z rabatem: ${fmt(p.cashTotal)} <span class="muted">(nie łączą się)</span></div>` : ''}
      ${extrasHtml(p.extras)}
    </div>`).join('');
  } else if (products.length > 1) h += `<p class="hint">Żaden sklep nie ma wszystkich pozycji – zobacz podział powyżej.</p>`;

  const order = STORES.map(s => s.id);
  const storeIds = [...new Set(products.flatMap(p => p.offers.map(o => o.storeId)))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  if (storeIds.length) {
    const cell = (p, id) => p.offers.filter(o => o.storeId === id).sort((a, b) => a.price - b.price)[0];
    const label = id => { const o = products.flatMap(p => p.offers).find(o => o.storeId === id); return o ? o.store : storeName(id); };
    h += `<h2>Porównanie cen</h2><div class="scroll-x"><table class="matrix"><thead><tr><th>Sprzęt</th>${storeIds.map(id => `<th>${esc(label(id))}</th>`).join('')}</tr></thead><tbody>`
      + products.map(p => {
        const min = p.offers.length ? Math.min(...p.offers.map(o => o.price)) : null;
        return `<tr><td title="${esc(p.q)}">${esc(p.q)}</td>${storeIds.map(id => { const o = cell(p, id); return o ? `<td class="${o.price === min ? 'min' : ''}"><a href="${esc(o.url)}" target="_blank" rel="noopener" style="color:inherit">${fmt(o.price)}</a>${(o.promos || []).some(r => r.type !== 'info') ? ' %' : ''}</td>` : '<td class="muted">–</td>'; }).join('')}</tr>`;
      }).join('')
      + `</tbody><tfoot><tr><td>Po promocjach</td>${storeIds.map(id => { const s = single.find(x => x.byStore[0].storeId === id); return `<td>${s ? fmt(s.total) : '<span class="muted">niepełny</span>'}</td>`; }).join('')}</tr></tfoot></table></div>
      <p class="hint">% = produkt objęty promocją koszykową. „(Ceneo)” = oferta znaleziona przez Ceneo (np. Allegro). Wyliczenia są szacunkiem na podstawie plakietek sklepów – przed zakupem sprawdź regulamin promocji.</p>
      <button class="ghost small" id="basketCsv">CSV</button>`;
  }
  $('#basketOut').innerHTML = h || '<p class="hint">Brak wyników.</p>';
  const bc = $('#basketCsv');
  if (bc) bc.onclick = () => downloadCsv([['Sprzęt', ...storeIds.map(storeName)], ...products.map(p => [p.q, ...storeIds.map(id => { const o = p.offers.filter(o => o.storeId === id).sort((a, b) => a.price - b.price)[0]; return o ? o.price : ''; })])], 'koszyk.csv');
}

// ====================== promocje sklepów ======================
// Grupy: rabat za kwotę (67 zł za 500), raty gratis, N-ty produkt, zwroty, bony, kody, % – z filtrem
let stopPromos = null, promoData = new Map(), promoGroupsOn = new Set();
const FORM = { rabat: 'rabat od razu w koszyku', bon: 'bon / kod na KOLEJNE zakupy', zwrot: 'zwrot po zakupie (zwykle rejestracja)' };
function loadPromos(fresh) {
  if (needSetup()) return;
  if (stopPromos) stopPromos();
  showTab('promos');
  const ids = selectedStores().filter(id => !storeById(id).aggregator && !storeById(id).linkOnly);
  promoData = new Map(ids.map(id => [id, { storeId: id, store: storeName(id), loading: true }]));
  $('#loadPromos').disabled = true;
  renderPromos('Sprawdzam strony promocji…');
  stopPromos = B.promos(ids, fresh, {
    onStatus: t => renderPromos(t),
    onStore: st => { promoData.set(st.storeId, st); renderPromos(); },
    onDone: err => {
      $('#loadPromos').disabled = false;
      for (const v of promoData.values()) if (v.loading) Object.assign(v, { loading: false, status: 'error', note: err || 'brak odpowiedzi' });
      renderPromos(err ? '❌ ' + err : '');
    },
  });
}
function renderPromos(status = '') {
  const G = window.Pricing.GROUP_LABELS;
  const all = [];
  for (const st of promoData.values()) for (const it of st.items || []) all.push({ ...it, group: it.group || window.Pricing.promoGroup(it.title).id, store: st.store, storeId: st.storeId });
  const counts = {};
  for (const it of all) counts[it.group] = (counts[it.group] || 0) + 1;
  const groups = Object.keys(G).filter(g => counts[g]);
  const f = $('#promoFilter');
  f.hidden = !groups.length;
  f.innerHTML = groups.map(g => `<label class="chip"><input type="checkbox" value="${g}" ${!promoGroupsOn.size || promoGroupsOn.has(g) ? 'checked' : ''}> ${esc(G[g])} <small>${counts[g]}</small></label>`).join('');
  $('#promoStores').innerHTML = `<div class="store-status">${[...promoData.values()].map(v => `<span class="${v.loading ? '' : v.status === 'ok' ? 'ok' : 'bad'}">${v.loading ? '<span class="spin"></span>' : v.status === 'ok' ? '✓' : '✕'} ${esc(v.store)}${v.status === 'blocked' ? ' (blokada)' : ''}</span>`).join('')}</div>${status ? `<p class="hint">${esc(status)}</p>` : ''}`;
  const today = new Date().toISOString().slice(0, 10);
  const on = g => !promoGroupsOn.size || promoGroupsOn.has(g);
  $('#promoOut').innerHTML = groups.filter(on).map(g => `<section class="pgroup"><h2>${esc(G[g])}</h2>${all.filter(i => i.group === g).map(i => {
    const d = i.details || {};
    const meta = [];
    if (d.until) meta.push(`<span class="${d.until < today ? 'bad' : ''}">${d.until < today ? 'zakończona' : 'do'} ${new Date(d.until).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })}</span>`);
    if (d.code) meta.push(`<span>kod <b class="code">${esc(d.code)}</b></span>`);
    if (d.form) meta.push(`<span>${esc(FORM[d.form])}</span>`);
    if (d.max) meta.push(`<span>max ${fmt(d.max)}</span>`);
    return `<div class="pitem"><div><a class="link" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a><div class="pmeta"><span class="pstore">${esc(i.store)}</span>${meta.join('')}</div>
      ${d.exclusions ? `<div class="pex">⚠ ${esc(d.exclusions)}</div>` : ''}</div></div>`;
  }).join('')}</section>`).join('') || (all.length ? '' : '');
}
$('#promoFilter').addEventListener('change', () => {
  const boxes = [...document.querySelectorAll('#promoFilter input')];
  const sel = boxes.filter(b => b.checked).map(b => b.value);
  promoGroupsOn = sel.length === boxes.length ? new Set() : new Set(sel);
  renderPromos();
});
$('#loadPromos').addEventListener('click', () => loadPromos(false));
$('#refreshPromos').addEventListener('click', () => loadPromos(true));
$('#promoNow').addEventListener('click', () => loadPromos(false));

// ====================== szukanie po opisie ======================
// „płyta indukcyjna”, „lodówka do 200cm”, „płyta indukcyjna pięciopolowa”
let disc = null, stopDisc = null;
function runDiscover(q, fresh) {
  setMode('discover');
  currentQ = q;
  history.replaceState(null, '', '?q=' + encodeURIComponent(q));
  if (stopSearch) stopSearch();
  if (stopDisc) stopDisc();
  const ids = selectedStores();
  disc = { q, need: window.Need.parseNeed(q), items: [], stores: new Map(), total: ids.filter(id => !storeById(id).linkOnly).length, status: '', done: false, error: '' };
  $('#go').disabled = true;
  renderDisc();
  stopDisc = B.discover(q, { stores: ids, fresh }, {
    onNeed: n => { disc.need = n; renderDisc(); },
    onStore: st => { disc.stores.set(st.storeId, st); disc.status = ''; renderDisc(); },
    onPartial: items => { disc.items = items; renderDisc(); },
    onResult: r => { disc.items = r.items; for (const st of r.stores) disc.stores.set(st.storeId, st); disc.need = r.need; renderDisc(); },
    onStatus: t => { disc.status = t; renderDisc(); },
    onDone: err => { disc.done = true; disc.error = err || ''; $('#go').disabled = false; renderDisc(); },
  });
}

const stars = r => { const full = Math.round(r * 2) / 2; let h = ''; for (let i = 1; i <= 5; i++) h += `<i class="${full >= i ? 'f' : full >= i - 0.5 ? 'h' : ''}"></i>`; return `<span class="stars" aria-hidden="true">${h}</span>`; };
const opinie = n => n === 1 ? 'opinia' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'opinie' : 'opinii';

function renderDisc() {
  if (!disc) return;
  const n = disc.need || {};
  const checked = [...disc.stores.values()].filter(x => x.status !== 'link');
  const okStores = checked.filter(x => x.status === 'ok').length;
  const shown = disc.items.filter(x => !settings.onlyPromo || x.promo);
  const hiddenNoPromo = disc.items.length - shown.length;
  const head = `<div class="disc-head">
      <div class="need">${n.category ? `<b>${esc(n.category.name)}</b>` : `<b>${esc(n.phrase || disc.q)}</b>`}${(n.chips || []).map(c => `<span class="chip-s">${esc(c)}</span>`).join('')}</div>
      <div class="sum-line">${disc.done ? `Sprawdzono ${okStores} z ${disc.total} sklepów` : `<span class="spin"></span>${esc(disc.status || `Przeglądam sklepy… ${checked.length}/${disc.total}`)}`}${disc.items.length ? ` · ${disc.items.length} pasujących modeli` : ''}</div>
      <label class="toggle"><input type="checkbox" id="onlyPromo" ${settings.onlyPromo ? 'checked' : ''}> Tylko na promocji${hiddenNoPromo ? ` <span class="muted">(ukryto ${hiddenNoPromo} bez promocji)</span>` : ''}</label>
      <p class="hint">Kolejność: najlepsze opinie <b>z poprawką na ich liczbę</b> – model z 1 opinią 5/5 nie wyprzedzi takiego z 400 opiniami po 4,8. Produkty z mniej niż ${window.Need.MIN_REVIEWS} opiniami są oznaczone.</p>
    </div>`;
  const cards = shown.map((x, i) => discCard(x, i)).join('');
  const blocked = checked.filter(x => x.status === 'blocked').map(x => x.store);
  const foot = (disc.done && !shown.length ? `<p class="hint">${disc.error ? '❌ ' + esc(disc.error) : disc.items.length ? 'Nic na promocji – odznacz „Tylko na promocji”.' : 'Nie znaleziono pasujących produktów. Spróbuj prościej, np. samą nazwę sprzętu.'}</p>` : '')
    + (blocked.length ? `<p class="hint">Zablokowały sprawdzanie: ${blocked.map(esc).join(', ')}.</p>` : '')
    + `<div class="chips">${[...disc.stores.values()].filter(x => x.url).map(x => `<a class="chip" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.store)} ↗</a>`).join('')}</div>`;
  const box = $('#disc');
  const before = new Map([...box.querySelectorAll('.dcard')].map(el => [el.dataset.key, el.getBoundingClientRect().top]));
  box.innerHTML = head + `<div class="dlist">${cards}</div>` + foot;
  if (!reduceMotion.matches) box.querySelectorAll('.dcard').forEach(el => {
    const prev = before.get(el.dataset.key);
    if (prev == null) el.classList.add('enter');
    else { const dy = prev - el.getBoundingClientRect().top; if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
  });
  $('#onlyPromo').onchange = e => { settings.onlyPromo = e.target.checked; saveSettings(); renderDisc(); };
}

function discCard(x, i) {
  const rating = x.rating ? `${stars(x.rating)} <b>${String(x.rating).replace('.', ',')}</b> <span class="muted">(${x.reviews} ${opinie(x.reviews)})</span>` : '<span class="muted">brak opinii</span>';
  const few = x.reviews && x.fewReviews ? `<span class="badge b-warn">mało opinii – ocena niepewna</span>` : '';
  const best = x.offers[0];
  const v = x.verdict;
  const offers = x.offers.map(o => {
    const inst = o.installments && o.installments.freeCount ? ` · ${o.installments.upTo ? 'nawet ' : ''}${o.installments.freeCount} raty gratis` : '';
    return `<a href="${esc(o.url)}" target="_blank" rel="noopener"><span>${esc(o.store)}${o.aggregator ? ' <span class="muted">(cena z Ceneo, niesprawdzona)</span>' : ''}${o.code ? ` <span class="muted">z kodem ${esc(o.code)}</span>` : ''}${inst}${o.lowest30 ? `<br><small class="muted">min. 30 dni: ${fmt(o.lowest30)}${o.regularPrice ? ` · „przed”: ${fmt(o.regularPrice)}` : ''}</small>` : ''}</span><b>${fmt(o.price)}</b></a>`;
  }).join('');
  const src = x.ratingSources && x.ratingSources.length > 1 ? `<small class="muted">opinie: ${x.ratingSources.map(s => `${esc(s.store)} ${String(s.rating).replace('.', ',')} (${s.reviews})`).join(', ')}</small>` : '';
  return `<article class="dcard" data-key="${esc(x.key)}">
    <div class="dnum">${i + 1}</div>
    <div class="dmain">
      <a class="dtitle" href="${esc(best ? best.url : '#')}" target="_blank" rel="noopener">${esc(x.title)}</a>
      <div class="drating">${rating} ${few}</div>${src}
      ${x.promoLabels.length ? `<div class="promos">${x.promoLabels.map(l => `<span class="promo">${esc(l)}</span>`).join('')}</div>` : ''}
      ${v ? `<div class="verdict v-${v.level}">${esc(v.text)}</div>` : ''}
      ${x.unknown && x.unknown.length ? `<div class="muted" style="font-size:12.5px">Nie udało się sprawdzić: ${x.unknown.map(esc).join(', ')} – zobacz na karcie produktu.</div>` : ''}
      <details class="doffers"><summary>${x.offers.length > 1 ? `Ceny w ${x.offers.length} sklepach` : 'Oferta'}</summary><div class="offers">${offers}</div></details>
      <div class="actions">${x.model ? `<button class="ghost small" data-cmp="${esc(x.model)}">Porównaj ceny modelu</button><button class="ghost small" data-add="${esc(x.model)}">Do koszyka</button>` : ''}</div>
    </div>
    <div class="dprice"><small>od</small><span class="pnum">${fmt(x.price)}</span>${best ? `<small>${esc(best.store)}</small>` : ''}</div>
  </article>`;
}
$('#disc').addEventListener('click', e => {
  const c = e.target.closest('[data-cmp]'); if (c) { $('#q').value = c.dataset.cmp; run(c.dataset.cmp); return; }
  const a = e.target.closest('[data-add]'); if (a) addToBasket(a.dataset.add);
});
document.querySelectorAll('[data-ex]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); $('#q').value = a.dataset.ex; run(a.dataset.ex); }));

// ====================== podobne, ale tańsze ======================
$('#similarBtn').addEventListener('click', async () => {
  const refs = [...results.values()].filter(r => r.status === 'ok' && !r.aggregator && r.url && r.price && r.match !== 'none')
    .map(r => ({ storeId: r.storeId, url: r.url, title: r.title, price: r.price, specs: r.specs || null, category: r.category || null }));
  const box = $('#similarBox');
  if (!refs.length) { toast('Najpierw znajdź produkt w sklepie'); return; }
  box.innerHTML = `<h2>Podobne, ale tańsze</h2><p class="hint"><span class="spin"></span> Przeglądam kategorię w ${refs.length} sklep(ach) i porównuję parametry…</p>`;
  box.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  try {
    const d = await B.similar(refs, t => { const h = box.querySelector('.hint'); if (h) h.innerHTML = `<span class="spin"></span> ${esc(t)}`; });
    renderSimilar(d, refs);
  } catch (e) { box.innerHTML = `<h2>Podobne, ale tańsze</h2><p class="hint" style="color:var(--bad)">${esc(e.message)}</p>`; }
});
function renderSimilar(d, refs) {
  const box = $('#similarBox');
  const minRef = Math.min(...refs.map(r => r.price));
  const verdictIcon = { same: '=', better: '▲', worse: '▼', unknown: '?' };
  const items = (d.items || []).filter(x => x.price < minRef);
  const notes = (d.stores || []).filter(s => s.status !== 'ok').map(s => `${esc(s.store)}: ${esc(s.note || ({ blocked: 'zablokowane', no_category: 'brak kategorii' })[s.status] || s.status)}`);
  box.innerHTML = `<h2>Podobne, ale tańsze</h2>
    <p class="hint">Te same kluczowe parametry (pojemność, szerokość, klasa energetyczna, hałas…) albo lepsze, a cena niższa niż najtańsza oferta Twojego modelu (${fmt(minRef)}).</p>`
    + (items.length ? items.map(x => `<article class="dcard">
      <div class="dmain"><a class="dtitle" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>
        <div class="drating">${x.rating ? `${stars(x.rating)} ${String(x.rating).replace('.', ',')} <span class="muted">(${x.reviews || 0} ${opinie(x.reviews || 0)})</span>${x.reviews && x.reviews < window.Need.MIN_REVIEWS ? ' <span class="badge b-warn">mało opinii</span>' : ''}` : '<span class="muted">brak opinii</span>'}</div>
        <div class="specdiff">${x.diffs.map(f => `<span class="sd sd-${f.verdict}" title="${esc(f.label)}">${verdictIcon[f.verdict]} ${esc(f.label)}${f.b != null ? ': ' + esc(String(f.b).replace('.', ',')) : ''}</span>`).join('')}</div>
        <div class="actions">${(x.title.match(/\b[A-Z0-9]*\d[A-Z0-9]{4,}\b/) || [])[0] ? `<button class="ghost small" data-cmp="${esc(x.title.match(/\b[A-Z0-9]*\d[A-Z0-9]{4,}\b/)[0])}">Porównaj ceny modelu</button>` : ''}</div>
      </div>
      <div class="dprice"><span class="pnum">${fmt(x.price)}</span><small class="save">−${fmt(minRef - x.price)}</small><small>${esc(x.store)}</small></div>
    </article>`).join('') : '<p class="hint">Nie znaleziono tańszego modelu o tych samych parametrach.</p>')
    + (notes.length ? `<p class="hint">${notes.join(' · ')}</p>` : '')
    + `<p class="hint">= taki sam · ▲ lepszy · ? nie podano na liście (sprawdź na karcie)</p>`;
  box.querySelectorAll('[data-cmp]').forEach(b => b.addEventListener('click', () => { $('#q').value = b.dataset.cmp; run(b.dataset.cmp); }));
}

// ====================== PWA ======================
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => { if (installEvt) { installEvt.prompt(); installEvt = null; $('#installBtn').hidden = true; } });

init().catch(e => { document.body.insertAdjacentHTML('afterbegin', `<p class="hint" style="color:var(--bad);padding:12px">Błąd startu: ${esc(e.message)}</p>`); });
