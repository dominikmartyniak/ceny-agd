// Warstwa komunikacji. Dwa tryby z tym samym interfejsem:
//  - LocalBackend: aplikacja uruchomiona na komputerze (server.js) – odpowiedzi na żywo (SSE)
//  - GithubBackend: aplikacja na GitHub Pages – zlecenie trafia do GitHub Actions, wynik czytany z gałęzi "data"
(function () {
  'use strict';
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  // ten sam klucz co alnum() w src/match.js
  const keyOf = q => String(q || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Ł/g, 'L').replace(/[^A-Z0-9]/g, '').slice(0, 80) || 'pusty';

  // ======================= LOKALNY SERWER =======================
  function LocalBackend() {
    const sse = (url, handlers) => {
      const es = new EventSource(url);
      let closed = false;
      for (const [ev, fn] of Object.entries(handlers)) if (ev !== 'error') es.addEventListener(ev, e => { if (ev === 'done') { closed = true; es.close(); } fn(JSON.parse(e.data)); });
      es.onerror = () => { es.close(); if (!closed) { closed = true; handlers.error && handlers.error(); } };
      return () => es.close();
    };
    const j = async (u, o) => { const r = await fetch(u, o); if (!r.ok && r.status !== 400) throw new Error('HTTP ' + r.status); return r.json(); };
    return {
      mode: 'local',
      needsSetup: () => false,
      stores: () => j('api/stores'),
      config: () => j('api/config'),
      search(q, { stores, fresh }, h) {
        return sse(`api/search?q=${encodeURIComponent(q)}&stores=${stores.join(',')}${fresh ? '&fresh=1' : ''}`, {
          result: h.onResult, resolved: h.onResolved, done: d => h.onDone(d.ms), error: () => h.onDone(),
        });
      },
      url: u => j('api/url?u=' + encodeURIComponent(u)),
      discover(q, { stores, fresh }, h) {
        return sse(`api/discover?q=${encodeURIComponent(q)}&stores=${stores.join(',')}${fresh ? '&fresh=1' : ''}`, {
          need: h.onNeed, store: h.onStore, partial: d => h.onPartial(d.items), result: h.onResult, done: () => h.onDone(), error: () => h.onDone('Połączenie przerwane'),
        });
      },
      similar: refs => j('api/similar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refs }) }),
      basket(items, { stores, combine, includeUnverified, useRaty }, h) {
        return sse(`api/basket?items=${encodeURIComponent(items.join('|'))}&stores=${stores.join(',')}&combine=${combine ? 1 : 0}&unverified=${includeUnverified ? 1 : 0}&raty=${useRaty === false ? 0 : 1}`, {
          item: h.onItem, plan: h.onPlan, done: () => h.onDone(), error: () => h.onDone(),
        });
      },
      async photo(blob) {
        const r = await fetch('api/photo', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
        const d = await r.json(); if (d.error) throw new Error(d.error); return d;
      },
      stock: (url, city) => j(`api/stock?url=${encodeURIComponent(url)}&city=${encodeURIComponent(city)}`),
      promos(stores, fresh, h) {
        return sse(`api/promos?stores=${stores.join(',')}${fresh ? '&fresh=1' : ''}`, { store: h.onStore, done: () => h.onDone(), error: () => h.onDone() });
      },
      history: q => j('api/history?q=' + encodeURIComponent(q)),
      watchList: () => j('api/watch'),
      addWatch: (q, target) => j('api/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q, target }) }),
      removeWatch: q => j('api/watch?q=' + encodeURIComponent(q), { method: 'DELETE' }),
      watchStatus: async () => ({}),
    };
  }

  // ======================= GITHUB (Pages + Actions) =======================
  function GithubBackend() {
    // Link z dostępem: https://…/ceny-agd/#dostep=<base64url {o,r,t}> – zapisuje dane w tej przeglądarce i znika z paska adresu.
    // Fragment po # nie jest wysyłany do serwera GitHub Pages.
    const m = location.hash.match(/dostep=([A-Za-z0-9_-]+)/);
    if (m) {
      try {
        const j = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
        if (j.t) lsSet('gh', { ...lsGet('gh', {}), owner: j.o, repo: j.r, token: j.t });
      } catch { /* uszkodzony link */ }
      history.replaceState(null, '', location.pathname + location.search);
    }
    const cfg = () => {
      const c = lsGet('gh', {});
      // adres strony https://<login>.github.io/<repo>/ -> właściciel i repozytorium
      if (!c.owner && /\.github\.io$/.test(location.hostname)) c.owner = location.hostname.split('.')[0];
      if (!c.repo && /\.github\.io$/.test(location.hostname)) c.repo = location.pathname.split('/').filter(Boolean)[0] || `${c.owner}.github.io`;
      const p = new URLSearchParams(location.search);
      if (p.get('api')) { c.api = p.get('api'); lsSet('gh', { ...lsGet('gh', {}), api: c.api }); } // tylko testy
      return { api: 'https://api.github.com', branch: 'data', workflow: 'szukaj.yml', ...c };
    };
    const headers = () => ({ Authorization: `Bearer ${cfg().token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
    const repoUrl = p => { const c = cfg(); return `${c.api}/repos/${c.owner}/${c.repo}${p}`; };
    async function gh(p, opts = {}) {
      const r = await fetch(repoUrl(p), { cache: 'no-store', ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
      return r;
    }
    let defaultBranch = null;
    async function getDefaultBranch() {
      if (defaultBranch) return defaultBranch;
      const r = await gh('');
      if (r.status === 401) throw new Error('Token GitHub jest nieprawidłowy albo wygasł – popraw w Ustawieniach.');
      if (r.status === 404) throw new Error('Nie widzę repozytorium – sprawdź nazwę i uprawnienia tokenu w Ustawieniach.');
      defaultBranch = (await r.json()).default_branch || 'main';
      return defaultBranch;
    }
    const b64ToText = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
    const textToB64 = t => { let s = ''; new TextEncoder().encode(t).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };

    async function readJson(path) {
      const r = await gh(`/contents/${path}?ref=${cfg().branch}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      const j = await r.json();
      return { sha: j.sha, json: JSON.parse(j.content ? b64ToText(j.content) : await (await fetch(j.download_url, { cache: 'no-store' })).text()) };
    }
    async function writeJson(path, mutate, fallback, message) {
      for (let i = 0; i < 4; i++) {
        const cur = await readJson(path);
        const next = mutate(cur ? cur.json : fallback);
        const r = await gh(`/contents/${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, branch: cfg().branch, content: textToB64(JSON.stringify(next)), ...(cur ? { sha: cur.sha } : {}) }) });
        if (r.ok) return next;
        if (r.status === 404) throw new Error('Brak gałęzi "data" – uruchom najpierw dowolne wyszukiwanie.');
        if (![409, 422].includes(r.status)) throw new Error(`GitHub ${r.status}`);
      }
      throw new Error('Konflikt zapisu – spróbuj ponownie');
    }

    // Zlecenie: uruchom workflow "Szukaj" i śledź plik results/<id>.json
    async function dispatch(kind, payload) {
      if (!cfg().token) throw new Error('Najpierw połącz aplikację z GitHubem (Ustawienia).');
      const ref = await getDefaultBranch();
      const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      const r = await gh(`/actions/workflows/${cfg().workflow}/dispatches`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref, inputs: { id, kind, payload: JSON.stringify(payload) } }) });
      if (r.status === 404) throw new Error('Nie znaleziono workflow "szukaj.yml" – czy pliki z .github/workflows są w repozytorium?');
      if (r.status === 403) throw new Error('Token nie ma uprawnienia „Actions: Read and write”.');
      if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 120)}`);
      return id;
    }
    function track(id, onUpdate, onStatus) {
      let stopped = false, n = 0;
      const t0 = Date.now();
      (async () => {
        while (!stopped && Date.now() - t0 < 25 * 60000) {
          n++;
          try {
            const f = await readJson(`results/${id}.json`);
            if (f) {
              onUpdate(f.json);
              if (f.json.status === 'done' || f.json.status === 'error') return;
              onStatus(`Szukam w sklepach… ${Math.round((Date.now() - t0) / 1000)} s`);
            } else if (n % 3 === 1) {
              const r = await gh(`/actions/workflows/${cfg().workflow}/runs?per_page=15&event=workflow_dispatch`);
              const run = r.ok ? ((await r.json()).workflow_runs || []).find(x => (x.display_title || x.name || '').includes(id)) : null;
              if (run && run.status === 'completed' && run.conclusion !== 'success') { onUpdate({ status: 'error', error: `Zadanie na GitHubie nie powiodło się (${run.conclusion}). Szczegóły: ${run.html_url}` }); return; }
              onStatus(!run ? 'Wysłano zlecenie do GitHuba…' : run.status === 'queued' ? 'Czekam na wolną maszynę GitHuba…' : `Uruchamiam przeglądarkę na GitHubie… ${Math.round((Date.now() - t0) / 1000)} s`);
            }
          } catch (e) { onStatus('Problem z połączeniem – ponawiam… (' + e.message + ')'); }
          await new Promise(r => setTimeout(r, n < 5 ? 4000 : 3000));
        }
        if (!stopped) onUpdate({ status: 'error', error: 'Przekroczono czas oczekiwania na wynik.' });
      })();
      return () => { stopped = true; };
    }
    const once = (kind, payload, onStatus = () => {}) => new Promise(async (ok, fail) => {
      try { const id = await dispatch(kind, payload); track(id, d => { if (d.status === 'done') ok(d); else if (d.status === 'error') fail(new Error(d.error || 'Błąd')); }, onStatus); }
      catch (e) { fail(e); }
    });

    return {
      mode: 'github',
      needsSetup: () => !cfg().token || !cfg().owner || !cfg().repo,
      cfg, saveCfg: c => { lsSet('gh', { ...lsGet('gh', {}), ...c }); defaultBranch = null; },
      shareLink() {
        const c = cfg();
        const b = new TextEncoder().encode(JSON.stringify({ o: c.owner, r: c.repo, t: c.token }));
        let bin = ''; b.forEach(x => { bin += String.fromCharCode(x); });
        return `${location.origin}${location.pathname}#dostep=${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
      },
      async test() {
        await getDefaultBranch();
        const r = await gh(`/actions/workflows/${cfg().workflow}`);
        if (!r.ok) throw new Error('Repozytorium OK, ale brak workflow "szukaj.yml" albo token nie ma dostępu do Actions.');
        return true;
      },
      stores: async () => (await fetch('stores.json', { cache: 'no-store' })).json(),
      config: async () => ({ defaultCity: '' }),
      search(q, { stores, fresh }, h) {
        let stop = () => {}, cancelled = false;
        const seen = new Map();
        (async () => {
          try {
            h.onStatus && h.onStatus('Wysyłam zlecenie do GitHuba…');
            const id = await dispatch('search', { q, stores, fresh: !!fresh });
            if (cancelled) return;
            const t0 = Date.now();
            stop = track(id, d => {
              for (const r of d.results || []) { const k = JSON.stringify(r).length + ':' + r.status; if (seen.get(r.storeId) !== k) { seen.set(r.storeId, k); h.onResult(r); } }
              if (d.resolved) h.onResolved(d.resolved);
              if (d.status === 'done') h.onDone(Date.now() - t0);
              if (d.status === 'error') { h.onError && h.onError(d.error); h.onDone(); }
            }, s => h.onStatus && h.onStatus(s));
          } catch (e) { h.onError && h.onError(e.message); h.onDone(); }
        })();
        return () => { cancelled = true; stop(); };
      },
      url: async u => (await once('url', { u })).results[0],
      discover(q, { stores }, h) {
        let stop = () => {}, nEv = 0, lastPartial = '', needSent = false;
        (async () => {
          try {
            h.onStatus && h.onStatus('Wysyłam zlecenie do GitHuba…');
            const id = await dispatch('discover', { q, stores });
            stop = track(id, d => {
              if (d.need && !needSent) { needSent = true; h.onNeed && h.onNeed(d.need); }
              const ev = d.events || [];
              while (nEv < ev.length) h.onStore(ev[nEv++]);
              if (d.partial) { const k = JSON.stringify(d.partial).length; if (k !== lastPartial) { lastPartial = k; h.onPartial(d.partial); } }
              if (d.status === 'done') { h.onResult(d.discover); h.onDone(); }
              if (d.status === 'error') h.onDone(d.error);
            }, s => h.onStatus && h.onStatus(s));
          } catch (e) { h.onDone(e.message); }
        })();
        return () => stop();
      },
      similar: async (refs, onStatus) => (await once('similar', { refs }, onStatus)).similar,
      basket(items, { stores, combine, includeUnverified, useRaty }, h) {
        let stop = () => {}, cnt = 0;
        (async () => {
          try {
            const id = await dispatch('basket', { items, stores, combine, includeUnverified: !!includeUnverified, useRaty: useRaty !== false });
            stop = track(id, d => {
              const res = d.results || [];
              while (cnt < res.length) h.onItem(res[cnt++]);
              if (d.status === 'done') { h.onPlan(d.plan); h.onDone(); }
              if (d.status === 'error') { h.onError && h.onError(d.error); h.onDone(); }
            }, s => h.onStatus && h.onStatus(s));
          } catch (e) { h.onError && h.onError(e.message); h.onDone(); }
        })();
        return () => stop();
      },
      photo: blob => window.PhotoBrowser.recognize(blob),
      stock: async (url, city, onStatus) => (await once('stock', { url, city }, onStatus)).stock,
      promos(stores, fresh, h) {
        let stop = () => {}; const got = new Set();
        (async () => {
          try {
            const id = await dispatch('promos', { stores });
            stop = track(id, d => {
              for (const p of d.promos || []) if (!got.has(p.storeId)) { got.add(p.storeId); h.onStore(p); }
              if (d.status === 'done' || d.status === 'error') h.onDone(d.error);
            }, s => h.onStatus && h.onStatus(s));
          } catch (e) { h.onDone(e.message); }
        })();
        return () => stop();
      },
      async history(q) { if (!cfg().token) return []; const f = await readJson(`history/${keyOf(q)}.json`).catch(() => null); return f ? f.json.entries : []; },
      async watchList() { if (!cfg().token) return []; const f = await readJson('watch.json').catch(() => null); return f ? f.json : []; },
      addWatch: (q, target) => writeJson('watch.json', list => {
        const k = keyOf(q); const w = list.find(x => x.k === k);
        if (w) w.target = target ?? w.target; else list.push({ k, q, target: target ?? null, added: Date.now() });
        return list;
      }, [], `obserwuj: ${q}`),
      removeWatch: q => writeJson('watch.json', list => list.filter(x => x.k !== keyOf(q)), [], `nie obserwuj: ${q}`),
      async watchStatus() { const f = await readJson('watch-status.json').catch(() => null); return f ? f.json : {}; },
    };
  }

  window.Backends = {
    keyOf,
    async detect() {
      try {
        const r = await fetch('config.json', { cache: 'no-store' });
        if (r.ok && (await r.json()).mode === 'github') return GithubBackend();
      } catch { /* brak config.json = serwer lokalny */ }
      return LocalBackend();
    },
  };
})();
