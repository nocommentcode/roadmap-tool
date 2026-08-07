// Source: docs/roadmaps/<slug>/ — the stage list, the Decision index, the briefs.
// The stage checklist and the decision table are already machine-readable in the
// repo's existing format; only dependency edges need help (frontmatter, else config).

import fs from 'node:fs';
import path from 'node:path';
import { sh } from '../util.mjs';

/** `| **D2** | text | ADR-0001 | storage, brew-log |` */
export function parseDecisions(md) {
  const out = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*\*\*(D\d+)\*\*\s*\|(.+?)\|(.+?)\|(.+?)\|\s*$/);
    if (!m) continue;
    const [, id, text, authoredIn, bound] = m;
    out.push({
      id,
      text: text.trim(),
      headline: (text.match(/\*\*(.+?)\*\*/)?.[1] ?? text.trim().slice(0, 60)).replace(/\[\[|\]\]/g, ''),
      authoredIn: authoredIn.trim(),
      // keys ("scaffold, storage") preferred; bare numbers still parse for
      // roadmaps that have not migrated the column yet
      boundBy: bound.split(',').map((x) => x.trim().replace(/`|\[\[|\]\]/g, '')).filter(Boolean),
    });
  }
  return out;
}

/** Minimal YAML-ish frontmatter reader — enough for `depends_on: [05, 06]`. */
function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, raw] = kv;
    out[k] = raw.startsWith('[')
      ? (raw.match(/[\w.-]+/g) ?? [])
      : raw.replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * Read a file from a git ref rather than the working tree, so the roadmap can come
 * from wherever it is newest. `master` still reads the checkout, so uncommitted edits
 * show up while you're writing them.
 */
async function readAt(repo, ref, rel, trunk) {
  // reading the trunk means the working tree, so uncommitted edits show up live
  if (!ref || ref === trunk) {
    const p = path.join(repo, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }
  return sh('git', ['show', `${ref}:${rel}`], repo);
}

/**
 * `03-brew-log.md` → `brew-log`, `04a-stats-core.md` → `stats-core`.
 * Survives renumbering and splitting; the number does not.
 */
export const stemOf = (briefFile) => briefFile.replace(/\.md$/, '').replace(/^\d+[a-z]*-/i, '');

export async function readRoadmap({ repo, slug, dependsOn = {}, trunk = 'master' }, ref = trunk) {
  const rel = (f) => `docs/roadmaps/${slug}/${f}`;
  const md = await readAt(repo, ref, rel('ROADMAP.md'), trunk);
  if (!md) throw new Error(`no ROADMAP.md for ${slug} at ${ref}`);

  const title = md.match(/^#\s+(.+)$/m)?.[1] ?? slug;
  const blurb = md.split('\n').slice(1).join('\n').split(/^##\s/m)[0].trim();
  const decisions = parseDecisions(md);

  // `\d+[a-z]*` so a split stage (04a, 04b) is not silently skipped
  const rows = [...md.matchAll(/^- \[([ x])\]\s*(\d+[a-z]*):\s*(.+?)\s*—\s*\[brief\]\((.+?)\)/gm)];
  const briefs = await Promise.all(rows.map(([, , , , briefFile]) => readAt(repo, ref, rel(briefFile), trunk)));

  const stages = [];
  rows.forEach(([, done, num, stageTitle, briefFile], i) => {
    const brief = briefs[i];
    const fm = frontmatter(brief);
    const key = stemOf(briefFile);

    stages.push({
      key,
      num,
      title: stageTitle,
      checked: done === 'x',
      briefFile,
      goal: brief.split(/^##\s+Goal\s*$/m)[1]?.split(/^##\s/m)[0].trim() ?? '',
      decisions: [
        ...new Set([
          ...(brief.match(/\bD\d+\b/g) ?? []),
          ...decisions.filter((d) => d.boundBy.includes(num)).map((d) => d.id),
        ]),
      ].sort((a, b) => +a.slice(1) - +b.slice(1)),
      /** stages this one replaces — set by both halves of a split */
      supersedes: fm?.supersedes ?? [],
      // frontmatter wins; config is the fallback while briefs are unmigrated.
      // Keyed by stem, never by number — numbers shift when a stage is split.
      dependsOn: fm?.depends_on ?? dependsOn[key] ?? [],
      dependsFrom: fm?.depends_on ? 'frontmatter' : dependsOn[key] ? 'config' : 'none',
      touches: [...new Set(brief.match(/`(?:packages|crates|apps)\/[a-z0-9-]+/g) ?? [])].map((s) => s.slice(1)),
      briefLastTouched: '',
      driftCommits: 0,
    });
  });

  // dependsOn is authored in stems; the UI shows numbers
  const numOf = new Map(stages.map((s) => [s.key, s.num]));
  for (const s of stages) s.dependsOnNums = s.dependsOn.map((k) => numOf.get(k) ?? k);

  // a discovered-but-unscheduled stage, recorded in prose rather than the checklist
  const found = md.split(/^##\s+Found while building[^\n]*$/m)[1];
  const discovered = found
    ? found.split(/^##\s/m)[0].trim().split(/\n\n+/).filter(Boolean).map((para) => ({
        headline: (para.match(/\*\*(.+?)\*\*/)?.[1] ?? para.slice(0, 80)).replace(/\[\[|\]\]/g, ''),
        body: para.replace(/\s+/g, ' ').replace(/\*\*/g, '').replace(/\[\[|\]\]/g, ''),
      }))
    : [];

  // git-derived staleness, in parallel
  await Promise.all(
    stages.map(async (s) => {
      s.briefLastTouched = (
        await sh('git', ['log', '-1', '--format=%cI', ref === trunk ? `origin/${trunk}` : ref, '--', rel(s.briefFile)], repo)
      ).trim();
      if (!s.briefLastTouched || !s.touches.length) return;
      const n = (
        await sh('git', ['rev-list', '--count', `--since=${s.briefLastTouched}`, `origin/${trunk}`, '--', ...s.touches], repo)
      ).trim();
      s.driftCommits = /^\d+$/.test(n) ? +n : 0;
    }),
  );

  return { slug, title, blurb, decisions, stages, discovered };
}

/**
 * Does an unmerged branch's Decision index disagree with master's?
 * This is the hazard nothing else surfaces: a decision can move on a branch while
 * four unstarted stages still quote the old wording.
 */
export async function readDecisionDrift({ repo, slug }, openPRs, masterDecisions) {
  const byId = Object.fromEntries(masterDecisions.map((d) => [d.id, d]));
  const out = [];
  await Promise.all(
    openPRs.map(async (pr) => {
      let md = '';
      for (const ref of [pr.headRefName, `origin/${pr.headRefName}`]) {
        md = await sh('git', ['show', `${ref}:docs/roadmaps/${slug}/ROADMAP.md`], repo);
        if (md) break;
      }
      if (!md) return;
      const theirs = Object.fromEntries(parseDecisions(md).map((d) => [d.id, d]));
      const added = Object.keys(theirs).filter((id) => !byId[id]);
      const changed = Object.keys(theirs).filter((id) => byId[id] && byId[id].headline !== theirs[id].headline);
      if (!added.length && !changed.length) return;
      out.push({
        branch: pr.headRefName,
        pr: pr.number,
        added: added.map((id) => ({ id, headline: theirs[id].headline, boundBy: theirs[id].boundBy })),
        changed: changed.map((id) => ({
          id,
          was: byId[id].headline,
          now: theirs[id].headline,
          boundBy: theirs[id].boundBy,
        })),
      });
    }),
  );
  return out.sort((a, b) => a.pr - b.pr);
}
