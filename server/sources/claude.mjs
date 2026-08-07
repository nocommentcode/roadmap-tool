// Source: ~/.claude. Two very different reads.
//
//   sessions/<pid>.json  — tiny, watched. status idle|busy per LIVE process.
//                          idle + pid alive  ⇒  Claude is waiting on you.
//   projects/**/*.jsonl  — large (multi-MB) transcripts. Scanned only when their
//                          mtime moves, and cached by (mtime, size) in between.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CLAUDE_HOME = path.join(os.homedir(), '.claude');
export const SESSIONS_DIR = path.join(CLAUDE_HOME, 'sessions');
export const PROJECTS_DIR = path.join(CLAUDE_HOME, 'projects');

/** Live process registry. Cheap — safe to re-read on every watch event. */
export function readLiveSessions() {
  const live = new Map();
  if (!fs.existsSync(SESSIONS_DIR)) return live;
  for (const f of fs.readdirSync(SESSIONS_DIR)) {
    if (!f.endsWith('.json')) continue;
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8')); } catch { continue; }
    if (!d?.sessionId || !d.pid) continue;
    try { process.kill(d.pid, 0); } catch { continue; } // stale file, process gone
    live.set(d.sessionId, {
      pid: d.pid,
      status: d.status === 'busy' ? 'busy' : 'idle',
      name: d.name ?? null,
      cwd: d.cwd ?? null,
      startedAt: new Date(d.startedAt).toISOString(),
      statusUpdatedAt: new Date(d.statusUpdatedAt ?? d.updatedAt ?? d.startedAt).toISOString(),
    });
  }
  return live;
}

// path → { mtimeMs, size, meta }
const transcriptCache = new Map();

/** Full scan of one transcript for the handful of typed records we care about. */
function scanTranscript(fp, id, projectDir) {
  const s = {
    id,
    projectDir,
    turns: 0,
    startedAt: null,
    aiTitle: null,
    lastPrompt: null,
    firstPrompt: null,
    prNumber: null,
    prUrl: null,
    cwd: null,
    worktreePath: null,
    worktreeName: null,
    worktreeBranch: null,
  };
  for (const line of fs.readFileSync(fp, 'utf8').split('\n')) {
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    switch (d.type) {
      case 'ai-title': s.aiTitle = d.aiTitle; break;
      case 'last-prompt': s.lastPrompt = d.lastPrompt; break;
      case 'pr-link': s.prNumber = d.prNumber; s.prUrl = d.prUrl; break;
      case 'relocated': s.cwd = d.relocatedCwd; break;
      case 'worktree-state': {
        const w = d.worktreeSession ?? {};
        s.worktreePath = w.worktreePath ?? s.worktreePath;
        s.worktreeName = w.worktreeName ?? s.worktreeName;
        s.worktreeBranch = w.worktreeBranch ?? s.worktreeBranch;
        break;
      }
      case 'user': {
        s.turns++;
        if (!s.startedAt && d.timestamp) s.startedAt = d.timestamp;
        if (!s.firstPrompt) {
          const c = d.message?.content;
          const txt = typeof c === 'string' ? c : Array.isArray(c) ? (c[0]?.text ?? '') : '';
          if (txt && !txt.startsWith('<local-command') && !txt.startsWith('<system-reminder')) {
            s.firstPrompt = txt.slice(0, 400);
          }
        }
        break;
      }
    }
  }
  return s;
}

const slugOf = (p) => p.replace(/[/.]/g, '-');

/**
 * Every session belonging to `repo` or any of its worktrees. Each worktree gets its
 * own project directory, all sharing the repo path as a prefix — which is exactly why
 * `claude --resume`, scoped to one cwd, can't show you the session you're looking for.
 */
export function readSessions({ repo, minBytes = 4096 }) {
  const prefix = slugOf(repo);
  const live = readLiveSessions();
  const sessions = [];
  if (!fs.existsSync(PROJECTS_DIR)) return { sessions, liveSessions: [...live.values()] };

  for (const projectDir of fs.readdirSync(PROJECTS_DIR)) {
    if (!projectDir.startsWith(prefix)) continue;
    const dir = path.join(PROJECTS_DIR, projectDir);
    let entries;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      entries = fs.readdirSync(dir);
    } catch { continue; }

    for (const file of entries) {
      if (!file.endsWith('.jsonl')) continue;
      const fp = path.join(dir, file);
      let stat;
      try { stat = fs.statSync(fp); } catch { continue; }
      if (stat.size < minBytes) continue;

      const cached = transcriptCache.get(fp);
      let meta;
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        meta = cached.meta;
      } else {
        meta = scanTranscript(fp, file.replace('.jsonl', ''), projectDir);
        transcriptCache.set(fp, { mtimeMs: stat.mtimeMs, size: stat.size, meta });
      }

      sessions.push({
        ...meta,
        sizeBytes: stat.size,
        mtime: stat.mtime.toISOString(),
        live: live.get(meta.id) ?? null,
      });
    }
  }

  // A live process with no transcript on disk still exists and is still resumable —
  // transcript saving can be off, or the file may not have been flushed yet. Synthesize
  // a row from the registry so the session is visible and has an "open" button.
  const seen = new Set(sessions.map((s) => s.id));
  for (const [id, l] of live) {
    if (seen.has(id)) continue;
    if (!l.cwd || !l.cwd.startsWith(repo)) continue;
    sessions.push({
      id,
      projectDir: null,
      sizeBytes: 0,
      mtime: l.statusUpdatedAt,
      turns: 0,
      startedAt: l.startedAt,
      aiTitle: l.name ?? 'live session',
      lastPrompt: null,
      firstPrompt: null,
      prNumber: null,
      prUrl: null,
      cwd: l.cwd,
      worktreePath: l.cwd,
      worktreeName: l.cwd.split('/').pop(),
      worktreeBranch: null,
      live: l,
      transcript: false,
    });
  }

  sessions.sort((a, b) => Number(!!b.live) - Number(!!a.live) || b.mtime.localeCompare(a.mtime));
  return { sessions, liveSessions: [...live.values()] };
}
