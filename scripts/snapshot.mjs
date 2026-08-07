#!/usr/bin/env node
// Dump the current state to a JSON file — for offline work, fixtures, and diffing.
// Uses the same readers as the server, so there is only one implementation.

import fs from 'node:fs';
import path from 'node:path';
import { RoadmapState } from '../server/state.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'roadmap.config.json'), 'utf8'));
if (process.env.ROADMAP_REPO) config.repo = process.env.ROADMAP_REPO;
if (process.env.ROADMAP_SLUG) config.slug = process.env.ROADMAP_SLUG;

const out = process.argv[2] ?? path.join(ROOT, `snapshot-${config.slug}.json`);

const state = new RoadmapState(config);
await Promise.all([state.refresh('roadmap'), state.refresh('git'), state.refresh('claude')]);
await state.refresh('github');
state.stop();

const s = state.state;
if (!s) {
  console.error('no state — check roadmap.config.json');
  process.exit(1);
}
fs.writeFileSync(out, JSON.stringify(s, null, 2));
console.log(
  `${path.relative(process.cwd(), out)}\n` +
    `  ${s.roadmap.stages.length} stages · ${s.roadmap.decisions.length} decisions · ${s.prs.length} PRs · ` +
    `${s.worktrees.length} worktrees · ${s.sessions.length} sessions · ${s.liveSessions.length} live`,
);
process.exit(0);
