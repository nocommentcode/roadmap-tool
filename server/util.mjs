import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

/** Run a command, returning stdout. Never throws — a failed command is empty output. */
export async function sh(cmd, args, cwd) {
  try {
    const { stdout } = await pexec(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
    return stdout;
  } catch (e) {
    return e.stdout ?? '';
  }
}

/** True only if the command exits 0. */
export async function ok(cmd, args, cwd) {
  try {
    await pexec(cmd, args, { cwd });
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
