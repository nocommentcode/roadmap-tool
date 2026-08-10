import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

/**
 * Everything here is a read of somebody's live repository, so two guards:
 *
 * GIT_OPTIONAL_LOCKS=0 — `git status` normally takes the index lock to refresh it, which
 *   is a WRITE, and this polls every few seconds against a repo you are working in. With
 *   the lock disabled those commands skip the refresh instead of contending with your own
 *   git, at the cost of being very slightly slower.
 * GIT_TERMINAL_PROMPT=0 — `git fetch` must never sit waiting for credentials on a stdin
 *   nobody is attached to. It fails instead, and a failed fetch is handled.
 */
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

/** Run a command, returning stdout. Never throws — a failed command is empty output. */
export async function sh(cmd, args, cwd) {
  try {
    const { stdout } = await pexec(cmd, args, {
      cwd, encoding: 'utf8', maxBuffer: 64 << 20, env: GIT_ENV,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return stdout;
  } catch (e) {
    return e.stdout ?? '';
  }
}

/** True only if the command exits 0. */
export async function ok(cmd, args, cwd) {
  try {
    await pexec(cmd, args, { cwd, env: GIT_ENV, stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

export const hash = (v) => createHash('sha1').update(JSON.stringify(v)).digest('hex');

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
