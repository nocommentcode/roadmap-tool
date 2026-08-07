#!/usr/bin/env node
// Runs as `postinstall`, and by hand via `--install-skills`.
//
// The tool does not work properly without its skills — the launch preamble invokes
// /roadmap-next-stage — so installing the package installs them.
//
// One exception: an `npx` run is a transient fetch into a cache npm may prune later,
// and linking into it would leave broken links behind in ~/.claude/skills. Those runs
// print the command instead, and the server repeats it on startup.

import path from 'node:path';
import { installSkills, WHY } from '../server/skills.mjs';

const here = path.dirname(import.meta.dirname);
const transient = here.includes(`${path.sep}_npx${path.sep}`);
const byHand = process.argv.includes('--by-hand') || !process.env.npm_lifecycle_event;

if (transient) {
  console.log(
    '\nroadmap-tool: skills not linked — this is an npx cache, which npm may prune.\n' +
      '  Run `npx github:nocommentcode/roadmap-tool --install-skills` to link them anyway.\n',
  );
  process.exit(0);
}

if (byHand) console.log(WHY);
else console.log('\nroadmap-tool: linking its Claude Code skills into ~/.claude/skills');

try {
  installSkills();
} catch (e) {
  // never fail an install over this
  console.log(`  could not link skills: ${e.message}`);
  console.log('  run `roadmap-tool --install-skills` later');
}
