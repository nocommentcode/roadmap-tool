#!/usr/bin/env node
// The roadmap-tool server. Reads git, gh, the roadmap docs and ~/.claude; serves the
// composed state over HTTP and pushes it over SSE whenever it moves.
//
//   GET /api/state          the current state
//   GET /api/events         SSE — full state on connect, then on every change
//   POST /api/refresh       force a re-read (optionally ?source=github)
//
// Serves dist/ too, so a built bundle needs nothing but `node server/index.mjs`.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { RoadmapState } from './state.mjs';
import { launch, openEditor } from './launch.mjs';
import { log } from './util.mjs';
import { resolveConfig, USAGE } from './config.mjs';
import { installSkills, missingSkills } from '../scripts/install-skills.mjs';

const ROOT = path.join(import.meta.dirname, '..');

const argv = process.argv.slice(2);

if (argv.includes('--install-skills')) {
  console.log('Linking skills into ~/.claude/skills:');
  installSkills();
  process.exit(0);
}

const config = await resolveConfig(argv.filter((a) => a !== '--install-skills'));
if (config.help) { console.log(USAGE); process.exit(0); }
if (config.error) { console.error(`\n  ${config.error}\n`); process.exit(1); }
const PORT = config.port;

const state = new RoadmapState(config);
const clients = new Set();

state.on('change', (s) => {
  const frame = `event: state\ndata: ${JSON.stringify(s)}\n\n`;
  for (const res of clients) res.write(frame);
});

const readJson = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); }
    });
  });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/roadmaps') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ current: config.slug, roadmaps: config.roadmaps, repo: config.repo }));
  }

  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(state.state ?? {}));
  }

  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(`retry: 1000\n\n`);
    if (state.state) res.write(`event: state\ndata: ${JSON.stringify(state.state)}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  if (url.pathname === '/api/launch' && req.method === 'POST') {
    const body = await readJson(req);
    let result;
    try {
      result = body.editorOnly ? await openEditor(body.worktreePath) : await launch(body, config);
    } catch (e) {
      result = { ok: false, reason: e.message };
    }
    // a launch changes worktrees and sessions — pick it up without waiting for a tick
    setTimeout(() => { state.refresh('git', 'launch'); state.refresh('claude', 'launch'); }, 1200);
    res.writeHead(result.ok ? 200 : 500, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(result));
  }

  if (url.pathname === '/api/refresh' && req.method === 'POST') {
    const source = url.searchParams.get('source');
    await Promise.all(
      (source ? [source] : ['roadmap', 'git', 'claude', 'github']).map((s) => state.refresh(s, 'manual')),
    );
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // static: dist/, falling back to index.html
  const dist = path.join(ROOT, 'dist');
  let file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(dist, 'index.html');
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('no dist/ built — run `npm run dev` for the Vite server');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// Listen first, load second: the page opens immediately and fills in over SSE as each
// source lands, rather than staring at a dead port for the length of a `gh` call.
server.listen(PORT, '127.0.0.1', () => {
  log(`roadmap-tool → http://127.0.0.1:${PORT}`);
  log(`  ${config.repo} · ${config.slug} · trunk ${config.trunk} · branches ${config.handle}/<stage>`);
  if (config.roadmaps.length > 1) log(`  other roadmaps here: ${config.roadmaps.filter((r) => r !== config.slug).join(', ')}`);
  // mention the skills once, rather than installing them behind your back
  const missing = missingSkills();
  if (missing.length) log(`  skills not installed (${missing.join(', ')}) — run: roadmap-tool --install-skills`);
});

state.start().then(() => {
  const s = state.state;
  log(`ready · ${config.slug} · ${s?.roadmap.stages.length ?? 0} stages · ${s?.prs.length ?? 0} PRs · ` +
      `${s?.sessions.length ?? 0} sessions · ${s?.liveSessions.length ?? 0} live`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    state.stop();
    server.close(() => process.exit(0));
  });
}
