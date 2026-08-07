#!/usr/bin/env node
// Symlink this package's skills into ~/.claude/skills so `/roadmap-next-stage` resolves.
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

export const WHY = `
These two skills are what make the tool work end to end:

  roadmap-format      the format it reads — brief frontmatter, the decision index,
                      and the "Roadmap-Stage:" PR trailer that tells it which pull
                      request closes which stage
  roadmap-next-stage  what "Start this phase" hands its generated preamble to

Without them a launched session opens with "Unknown command:
/roadmap-next-stage" and no idea what it is meant to do, and the tool falls back
to guessing which PR belongs to which stage.
`;

/**
 * A link is ours if it points at a `skills/<name>` directory belonging to *any* copy of
 * this package — not just this one. Links are commonly created by a dev clone and
 * removed by a global install (or vice versa), and an exact-path check would refuse to
 * clean those up, which is precisely when you need it to.
 */
function isOurLink(link, name) {
  const stat = fs.lstatSync(link, { throwIfNoEntry: false });
  if (!stat?.isSymbolicLink()) return false;
  const target = fs.readlinkSync(link);
  return path.basename(target) === name && path.basename(path.dirname(target)) === 'skills';
}

/** Remove only the links we created — never anything we didn't. */
export function uninstallSkills({ log = console.log } = {}) {
  let changed = 0;
  for (const name of skillNames()) {
    const link = path.join(DEST, name);
    if (!fs.lstatSync(link, { throwIfNoEntry: false })) { log(`  absent    ${name}`); continue; }
    if (!isOurLink(link, name)) { log(`  kept      ${name} — not a link we created`); continue; }
    const target = fs.readlinkSync(link);
    fs.unlinkSync(link);
    log(`  removed   ${name}  (was → ${target})`);
    changed++;
  }
  return changed;
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
  if (changed) {
    log('');
    log(`Linked into ${DEST}. Restart Claude Code to pick them up.`);
  }
  return changed;
}
