// Zapis danych w repozytorium przez GitHub Contents API (gałąź "data").
// Bez git checkout/push – brak konfliktów przy kilku wyszukiwaniach naraz.
const API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const REPO = process.env.GITHUB_REPOSITORY;        // "wlasciciel/repo" – ustawia GitHub Actions
const TOKEN = process.env.GITHUB_TOKEN;
const BRANCH = process.env.DATA_BRANCH || 'data';

async function api(path, opts = {}) {
  const r = await fetch(`${API}/repos/${REPO}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  return r;
}

let branchReady = false;
async function ensureBranch() {
  if (branchReady) return;
  let r = await api(`/git/ref/heads/${BRANCH}`);
  if (r.status === 404) {
    const repo = await (await api('')).json();
    const head = await (await api(`/git/ref/heads/${repo.default_branch || 'main'}`)).json();
    r = await api('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: head.object.sha }) });
    if (!r.ok && r.status !== 422) throw new Error(`Nie udało się utworzyć gałęzi ${BRANCH}: ${r.status} ${await r.text()}`);
  } else if (!r.ok) throw new Error(`GitHub API ${r.status}: ${await r.text()}`);
  branchReady = true;
}

const enc = s => encodeURIComponent(s).replace(/%2F/g, '/');

async function getFile(path) {
  await ensureBranch();
  const r = await api(`/contents/${enc(path)}?ref=${BRANCH}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub API ${r.status} przy odczycie ${path}`);
  const j = await r.json();
  let text = Buffer.from(j.content || '', 'base64').toString('utf8');
  if (!j.content && j.download_url) text = await (await fetch(j.download_url)).text(); // pliki > 1 MB
  return { sha: j.sha, json: JSON.parse(text) };
}

async function putFile(path, obj, sha, message) {
  await ensureBranch();
  const body = { message: message || `dane: ${path}`, branch: BRANCH, content: Buffer.from(JSON.stringify(obj)).toString('base64') };
  if (sha) body.sha = sha;
  const r = await api(`/contents/${enc(path)}`, { method: 'PUT', body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (!r.ok) throw new Error(`GitHub API ${r.status} przy zapisie ${path}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return { sha: j.content.sha };
}

// Odczyt-modyfikacja-zapis z ponawianiem przy konflikcie (dwa wyszukiwania naraz)
async function updateJson(path, mutate, fallback, message) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await getFile(path);
    const next = mutate(cur ? cur.json : fallback);
    if (next === undefined) return cur ? cur.json : fallback;
    const w = await putFile(path, next, cur && cur.sha, message);
    if (!w.conflict) return next;
    await new Promise(r => setTimeout(r, 500 + Math.random() * 1500));
  }
  throw new Error(`Konflikt zapisu ${path} – spróbuj ponownie`);
}

async function deleteFile(path, sha, message) {
  const r = await api(`/contents/${enc(path)}`, { method: 'DELETE', body: JSON.stringify({ message: message || `usuń ${path}`, sha, branch: BRANCH }) });
  return r.ok;
}

async function listDir(path) {
  await ensureBranch();
  const r = await api(`/contents/${enc(path)}?ref=${BRANCH}`);
  if (r.status === 404) return [];
  return r.ok ? r.json() : [];
}

module.exports = { getFile, putFile, updateJson, deleteFile, listDir, ensureBranch, BRANCH };
