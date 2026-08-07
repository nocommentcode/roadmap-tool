#!/usr/bin/env node
// Symlink this package's skills into ~/.claude/skills so `/next-stage` resolves.
//
// Deliberately NOT a postinstall hook: installing a CLI should not quietly rewrite
// somebody's Claude Code configuration, and an npx cache that later gets pruned would
// leave dangling links behind. Opt in with `roadmap-tool --install-skills`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = path.join(import.meta.dirname, '..', 'skills');
const DEST = path.join(os.homedir(), '.claude', 'skills');

export function skillNames() {
  if (!fs.existsSync(SRC)) return [];
  return fs.readdirSync(SRC).filter((n) => fs.existsSync(path.join(SRC, n, 'SKILL.md')));
}

/** Which of our skills are not currently linked here. */
export function missingSkills() {
  return skillNames().filter((name) => {
    const link = path.join(DEST, name);
    try {
      return !fs.existsSync(link); // follows the link, so a dangling one counts as missing
    } catch {
      return true;
    }
  });
}

export function installSkills({ log = console.log } = {}) {
  fs.mkdirSync(DEST, { recursive: true });
  let changed = 0;
  for (const name of skillNames()) {
    const target = path.join(SRC, name);
    const link = path.join(DEST, name);
    const stat = fs.lstatSync(link, { throwIfNoEntry: false });

    if (stat) {
      const isLink = stat.isSymbolicLink();
      const points = isLink ? fs.readlinkSync(link) : null;
      if (points === target) { log(`  ok        ${name}`); continue; }
      // a link of ours that has gone stale (moved clone, pruned npx cache) is repointed
      if (isLink && !fs.existsSync(link)) {
        fs.unlinkSync(link);
        fs.symlinkSync(target, link);
        log(`  repointed ${name} (was dangling → ${points})`);
        changed++;
        continue;
      }
      log(`  skipped   ${name} — ${link} exists and is not ours`);
      continue;
    }
    fs.symlinkSync(target, link);
    log(`  linked    ${name}`);
    changed++;
  }
  return changed;
}

// run directly
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  installSkills();
}
