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
import { installSkills, uninstallSkills, missingSkills, WHY } from './skills.mjs';

const ROOT = path.join(import.meta.dirname, '..');

const argv = process.argv.slice(2);

if (argv.includes('--install-skills')) {
  console.log(WHY);
  installSkills();
  process.exit(0);
}

if (argv.includes('--uninstall-skills')) {
  console.log('Removing skill links from ~/.claude/skills:');
  uninstallSkills();
  process.exit(0);
}

const config = await resolveConfig(argv.filter((a) => !a.endsWith('-skills')));
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

  // switch to another roadmap in this repo; body {slug}
  if (url.pathname === '/api/roadmap' && req.method === 'POST') {
    const { slug } = await readJson(req);
    const ok = await state.setSlug(slug);
    res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok, slug: config.slug, roadmaps: config.roadmaps }));
  }

  // pick which version of the roadmap to show; body {ref} — ':merged' for the union
  if (url.pathname === '/api/ref' && req.method === 'POST') {
    const { ref } = await readJson(req);
    state.pinnedRef = ref && ref !== ':merged' ? ref : null;
    log(`roadmap version → ${state.pinnedRef ?? 'merged view'}`);
    await state.refresh('roadmap', 'version picked');
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, pinnedRef: state.pinnedRef }));
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
    return res.end('no dist/ built — run `npm start`, or `npm run dev` for the Vite server');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

/**
 * How to re-invoke this same copy. `roadmap-tool` is only on PATH after a global
 * install — under npx it exists just for the length of that one command, and from a
 * clone it never exists — so telling everyone to run `roadmap-tool …` is wrong for
 * two of the three ways people actually run this.
 */
/** How far behind the built bundle is, or null if it is current. */
function staleBundle() {
  const index = path.join(ROOT, 'dist', 'index.html');
  const src = path.join(ROOT, 'src');
  if (!fs.existsSync(index) || !fs.existsSync(src)) return null;
  const built = fs.statSync(index).mtimeMs;
  let newest = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  walk(src);
  if (newest <= built) return null;
  const hours = Math.round((newest - built) / 3_600_000);
  return hours >= 24 ? `${Math.round(hours / 24)}d` : `${Math.max(1, hours)}h`;
}

function selfCommand(args) {
  const entry = process.argv[1] ?? '';
  if (entry.includes('/_npx/')) return `npx github:nocommentcode/roadmap-tool ${args}`;
  if (entry.includes(`${path.sep}node_modules${path.sep}`) || path.basename(entry) === 'roadmap-tool') {
    // a global install puts the shim on PATH; a local one does not
    return process.env.npm_config_global || !entry.includes('node_modules')
      ? `roadmap-tool ${args}`
      : `${entry} ${args}`;
  }
  return `node ${entry} ${args}`;
}

// Listen first, load second: the page opens immediately and fills in over SSE as each
// source lands, rather than staring at a dead port for the length of a `gh` call.
server.listen(PORT, '127.0.0.1', () => {
  log(`roadmap-tool → http://127.0.0.1:${PORT}`);
  log(`  ${config.repo} · ${config.slug} · trunk ${config.trunk} · branches ${config.handle}/<stage>`);
  if (config.roadmaps.length > 1) log(`  other roadmaps here: ${config.roadmaps.filter((r) => r !== config.slug).join(', ')}`);
  // A bundle older than the source is served silently and looks like the tool ignoring
  // your changes — which is exactly how it went wrong once.
  const stale = staleBundle();
  if (stale) log(`  ⚠ dist/ is ${stale} older than src/ — rebuild with \`npm start\``);
  // mention the skills once, rather than installing them behind your back
  const missing = missingSkills();
  if (missing.length) {
    log(`  ⚠ skills not installed: ${missing.join(', ')}`);
    log(`    "Start this phase" will launch a session that cannot run /roadmap-next-stage.`);
    log(`    Fix with: ${selfCommand('--install-skills')}`);
  }
});

state.start().then(() => {
  const s = state.state;
  log(`ready · ${config.slug} · ${s?.roadmap.stages.length ?? 0} stages · ${s?.prs.length ?? 0} PRs · ` +
      `${s?.sessions.length ?? 0} sessions · ${s?.liveSessions.length ?? 0} live`);
});

// `server.close()` alone waits for open connections to drain, and an SSE stream never
// drains — an open browser tab would hang Ctrl+C forever. Hang up on the streams first,
// then force any remaining sockets, then give it a moment before exiting regardless.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) process.exit(0); // second Ctrl+C = don't wait
  shuttingDown = true;
  state.stop();
  for (const res of clients) res.end();
  clients.clear();
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
