#!/usr/bin/env node
// One command: the reader/SSE server plus Vite, sharing a terminal and a lifetime.

import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const children = [];

function run(name, cmd, args, colour) {
  const c = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${colour}m${name.padEnd(6)}\x1b[0m │ `;
  const pipe = (stream) =>
    stream.on('data', (b) =>
      String(b)
        .split('\n')
        .filter((l) => l.trim())
        .forEach((l) => process.stdout.write(tag + l + '\n')),
    );
  pipe(c.stdout);
  pipe(c.stderr);
  c.on('exit', (code) => {
    if (code) process.stdout.write(tag + `exited ${code}\n`);
    shutdown();
  });
  children.push(c);
}

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  children.forEach((c) => c.kill('SIGTERM'));
  setTimeout(() => process.exit(0), 200);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('server', process.execPath, ['server/index.mjs', '--no-open', ...process.argv.slice(2)], '36');
run('vite', 'npx', ['vite'], '35');
