// Actually starting things: worktrees, editors, and Claude sessions.
//
// The UI cannot attach to another process's terminal, so "open a running session" opens
// a NEW terminal running `claude --resume <id>` against the same transcript. That is the
// same conversation, in a window you own.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ok, sh, log } from './util.mjs';

/**
 * How to open a terminal running a command in a directory, per emulator.
 * macOS first when we're on darwin — `open -a` is the only reliable route there
 * because Terminal.app and iTerm take AppleScript, not argv.
 */
const MAC_TERMINALS = [
  {
    bin: 'osascript',
    args: (cwd, cmd) => [
      '-e',
      `tell application "Terminal" to do script ${JSON.stringify(`cd ${JSON.stringify(cwd)} && ${cmd}`)}`,
      '-e', 'tell application "Terminal" to activate',
    ],
  },
];

const TERMINALS = [
  { bin: 'ptyxis', args: (cwd, cmd) => ['--new-window', `--working-directory=${cwd}`, '--', 'bash', '-lc', cmd] },
  { bin: 'kitty', args: (cwd, cmd) => ['--directory', cwd, 'bash', '-lc', cmd] },
  { bin: 'wezterm', args: (cwd, cmd) => ['start', '--cwd', cwd, '--', 'bash', '-lc', cmd] },
  { bin: 'alacritty', args: (cwd, cmd) => ['--working-directory', cwd, '-e', 'bash', '-lc', cmd] },
  { bin: 'foot', args: (cwd, cmd) => [`--working-directory=${cwd}`, 'bash', '-lc', cmd] },
  { bin: 'gnome-terminal', args: (cwd, cmd) => [`--working-directory=${cwd}`, '--', 'bash', '-lc', cmd] },
  { bin: 'konsole', args: (cwd, cmd) => ['--workdir', cwd, '-e', 'bash', '-lc', cmd] },
  { bin: 'xterm', args: (cwd, cmd) => ['-e', 'bash', '-lc', cmd] },
];

let cachedTerminal;
async function findTerminal(preferred) {
  if (preferred) {
    const known = [...TERMINALS, ...MAC_TERMINALS].find((t) => t.bin === preferred);
    // an unknown binary still works if it takes `-e <cmd>`, which most do
    const t = known ?? { bin: preferred, args: (cwd, cmd) => ['-e', 'bash', '-lc', `cd ${JSON.stringify(cwd)} && ${cmd}`] };
    if (await ok('bash', ['-lc', `command -v ${t.bin}`])) return t;
    return null;
  }
  if (cachedTerminal !== undefined) return cachedTerminal;
  const list = process.platform === 'darwin' ? [...MAC_TERMINALS, ...TERMINALS] : TERMINALS;
  for (const t of list) {
    if (await ok('bash', ['-lc', `command -v ${t.bin}`])) {
      cachedTerminal = t;
      return t;
    }
  }
  cachedTerminal = null;
  return null;
}

/**
 * The server may itself have been started from inside a Claude session, which leaves
 * CLAUDECODE / CLAUDE_CODE_CHILD_SESSION / CLAUDE_CODE_SESSION_ID in the environment.
 * Inheriting those makes the spawned Claude think it is a nested child and **turn
 * transcript saving off** — so the session it starts is invisible to this very tool.
 * Strip them so every launched session is a real, recorded, top-level one.
 */
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^CLAUDE(_|CODE)/i.test(k)) delete env[k];
  return env;
}

/** Detach fully — the spawned window must outlive this server. */
function detach(bin, args) {
  const child = spawn(bin, args, { detached: true, stdio: 'ignore', env: cleanEnv() });
  child.unref();
}

/** `bash -lc` keeps the shell open after claude exits, so errors stay readable. */
const keepOpen = (cmd) => `${cmd}; echo; echo "[session ended — press enter to close]"; read`;

export async function openTerminal(cwd, command, preferred) {
  const term = await findTerminal(preferred);
  if (!term)
    return {
      ok: false,
      reason: preferred
        ? `terminal "${preferred}" not found on PATH`
        : 'no terminal emulator found — pass --terminal <bin>',
      command,
      cwd,
    };
  detach(term.bin, term.args(cwd, keepOpen(command)));
  log(`launched ${term.bin} in ${cwd}: ${command}`);
  return { ok: true, via: term.bin, command, cwd };
}

export async function openEditor(cwd) {
  if (await ok('bash', ['-lc', 'command -v code'])) {
    detach('bash', ['-lc', `code ${JSON.stringify(cwd)}`]);
    return { ok: true, via: 'code' };
  }
  return { ok: false, reason: 'no `code` on PATH' };
}

/**
 * Create the worktree for a stage if it isn't there yet.
 * `base` is a branch to stack on, or null for fresh master.
 */
export async function ensureWorktree({ repo, worktreesDir, stageKey, handle, base, trunk = 'master' }) {
  const dest = path.join(worktreesDir, stageKey);
  if (fs.existsSync(dest)) return { ok: true, path: dest, created: false };

  const branch = `${handle}/${stageKey}`;
  const exists = await ok('git', ['show-ref', '--verify', `refs/heads/${branch}`], repo);
  const args = exists
    ? ['worktree', 'add', dest, branch]
    : ['worktree', 'add', dest, '-b', branch, base || `origin/${trunk}`];

  const out = await sh('git', args, repo);
  if (!fs.existsSync(dest)) return { ok: false, reason: `git worktree add failed: ${out.trim() || 'unknown'}` };
  log(`worktree ${dest} on ${branch} (base ${base || `origin/${trunk}`})`);
  return { ok: true, path: dest, branch, created: true };
}

/**
 * Write the preamble to a file rather than inlining it — it is multi-line prose and
 * quoting it through bash -lc through a terminal argv is a shell-injection trap.
 */
function writePreamble(cwd, text) {
  const dir = path.join(cwd, '.roadmap-tool');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `preamble-${Date.now()}.md`);
  fs.writeFileSync(file, text ?? '');
  return file;
}

export async function launch(body, config) {
  const { mode, stageKey, worktreePath, sessionId, preamble, base } = body;
  const handle = body.handle ?? config.handle ?? 'me';

  // 1. where
  let cwd = worktreePath;
  if (!cwd || !fs.existsSync(cwd)) {
    if (!stageKey) return { ok: false, reason: 'no worktree and no stage key' };
    const wt = await ensureWorktree({
      repo: config.repo,
      worktreesDir: config.worktreesDir ?? `${config.repo}-worktrees`,
      stageKey,
      handle,
      base,
      trunk: config.trunk,
    });
    if (!wt.ok) return wt;
    cwd = wt.path;
  }

  // 2. what
  let command;
  if (mode === 'resume' || mode === 'open') {
    if (!sessionId) return { ok: false, reason: 'no session id to resume' };
    command = `claude --resume ${sessionId}`;
  } else if (mode === 'fork') {
    if (!sessionId) return { ok: false, reason: 'no session id to fork' };
    command = `claude --resume ${sessionId} --fork-session`;
  } else {
    // A fresh session with a minted id, so the stage↔session link exists from the
    // first token rather than being inferred afterwards.
    const id = randomUUID();
    const file = writePreamble(cwd, preamble);
    command = `claude --session-id ${id} "$(cat ${JSON.stringify(path.relative(cwd, file))})"`;
  }

  if (body.editor) await openEditor(cwd);
  return openTerminal(cwd, command, config.terminal);
}
