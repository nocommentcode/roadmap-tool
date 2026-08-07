#!/usr/bin/env node
// Symlink this repo's skills into ~/.claude/skills so `/next-stage` resolves.
// Idempotent; re-run after adding a skill.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = path.join(import.meta.dirname, '..', 'skills');
const DEST = path.join(os.homedir(), '.claude', 'skills');

fs.mkdirSync(DEST, { recursive: true });
for (const name of fs.readdirSync(SRC)) {
  if (!fs.existsSync(path.join(SRC, name, 'SKILL.md'))) continue;
  const link = path.join(DEST, name);
  const target = path.join(SRC, name);
  const existing = fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false });
  if (existing) {
    const isOurs = fs.lstatSync(link).isSymbolicLink() && fs.readlinkSync(link) === target;
    if (isOurs) { console.log(`  ok       ${name}`); continue; }
    console.log(`  SKIPPED  ${name} — ${link} already exists and is not ours`);
    continue;
  }
  fs.symlinkSync(target, link);
  console.log(`  linked   ${name} → ${target}`);
}
