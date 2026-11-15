// Atrapa GitHub API do testów wersji GitHub bez internetu.
// Obsługuje to, czego używa aplikacja i gh/run.js: repo, gałęzie, Contents API (z kontrolą sha),
// uruchamianie workflow (workflow_dispatch -> lokalnie odpala gh/run.js) i listę uruchomień.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

function createMockGithub({ owner = 'o', repo = 'r', token = 'test-token', runEnv = {}, onRun } = {}) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  const files = new Map();          // path -> { content(Buffer), sha }
  let dataBranch = false;
  const runs = [];
  const P = `/repos/${owner}/${repo}`;

  app.use((req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type, X-GitHub-Api-Version', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if ((req.headers.authorization || '') !== `Bearer ${token}`) return res.status(401).json({ message: 'Bad credentials' });
    next();
  });

  app.get(P, (req, res) => res.json({ default_branch: 'main', full_name: `${owner}/${repo}` }));
  app.get(`${P}/git/ref/heads/:b`, (req, res) => (req.params.b === 'main' || (req.params.b === 'data' && dataBranch)) ? res.json({ object: { sha: 'abc' } }) : res.status(404).json({}));
  app.post(`${P}/git/refs`, (req, res) => { dataBranch = true; res.status(201).json({}); });

  const sha = buf => crypto.createHash('sha1').update(buf).digest('hex');
  app.get(`${P}/contents/*`, (req, res) => {
    const p = req.params[0];
    if (!dataBranch) return res.status(404).json({});
    if (files.has(p)) { const f = files.get(p); return res.json({ sha: f.sha, content: f.content.toString('base64'), encoding: 'base64', path: p, name: path.basename(p) }); }
    const dir = [...files.entries()].filter(([k]) => k.startsWith(p + '/')).map(([k, f]) => ({ name: path.basename(k), path: k, sha: f.sha, type: 'file' }));
    return dir.length ? res.json(dir) : res.status(404).json({ message: 'Not Found' });
  });
  app.put(`${P}/contents/*`, (req, res) => {
    const p = req.params[0];
    if (!dataBranch) return res.status(404).json({ message: 'Branch not found' });
    const cur = files.get(p);
    if (cur && req.body.sha !== cur.sha) return res.status(409).json({ message: 'sha mismatch' });
    if (!cur && req.body.sha) return res.status(409).json({ message: 'no such file' });
    const content = Buffer.from(req.body.content, 'base64');
    files.set(p, { content, sha: sha(content) });
    res.status(cur ? 200 : 201).json({ content: { sha: files.get(p).sha, path: p } });
  });
  app.delete(`${P}/contents/*`, (req, res) => { files.delete(req.params[0]); res.json({}); });

  app.get(`${P}/actions/workflows/:wf`, (req, res) => req.params.wf === 'szukaj.yml' ? res.json({ id: 1, name: 'Szukaj' }) : res.status(404).json({}));
  app.post(`${P}/actions/workflows/:wf/dispatches`, (req, res) => {
    const { id, kind, payload } = req.body.inputs || {};
    const apiBase = `${req.protocol}://${req.get('host')}`;
    const run = { id: runs.length + 1, display_title: `${kind} ${id}`, status: 'queued', conclusion: null, html_url: 'http://mock/run' };
    runs.unshift(run);
    res.sendStatus(204);
    // jak GitHub: chwilę w kolejce, potem uruchomienie skryptu
    setTimeout(() => {
      run.status = 'in_progress';
      const child = spawn(process.execPath, [path.join(__dirname, '..', 'gh', 'run.js')], {
        env: { ...process.env, ...runEnv, PROFILE_DIR: path.join(require('os').tmpdir(), 'pw-gh-' + id), GITHUB_API_URL: apiBase, REQ_ID: id, KIND: kind, PAYLOAD: payload, GITHUB_REPOSITORY: `${owner}/${repo}`, GITHUB_TOKEN: token },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
      child.on('exit', code => { run.status = 'completed'; run.conclusion = code === 0 ? 'success' : 'failure'; run.log = log; onRun && onRun(run); });
    }, 800);
  });
  app.get(`${P}/actions/workflows/:wf/runs`, (req, res) => res.json({ workflow_runs: runs }));

  return { app, files, runs, read: p => files.has(p) ? JSON.parse(files.get(p).content) : null };
}

module.exports = { createMockGithub };
