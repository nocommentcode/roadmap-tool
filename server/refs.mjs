// Every version of the roadmap that exists right now, and where it comes from.
//
// A roadmap has no single truth while work is in flight: the trunk holds what landed,
// each live branch holds its own edits, and a worktree may hold uncommitted ones. The
// merged view unions them, which is right for additive changes (a stage split on one
// branch) and wrong for removals — nothing in a union can express "this stage is gone",
// unless a replacement declares `supersedes:`. So the versions are offered explicitly
// and one can be picked.

import path from 'node:path';
import { sh } from './util.mjs';

export const MERGED = ':merged';
export const WORKTREE_PREFIX = 'worktree:';

/** `worktree:/abs/path` → `/abs/path` */
export const worktreePathOf = (ref) =>
  ref?.startsWith(WORKTREE_PREFIX) ? ref.slice(WORKTREE_PREFIX.length) : null;

async function lastTouched(repo, ref, slug) {
  const out = await sh('git', ['log', '-1', '--format=%cI%x09%s', ref, '--', `docs/roadmaps/${slug}/`], repo);
  const [when, subject] = out.trim().split('\t');
  return { when: when ?? null, subject: subject ?? null };
}

/**
 * @returns [{ ref, kind, label, sublabel, ahead, pr, worktreePath, when, subject }]
 *          ordered like a stack: trunk at the bottom, furthest ahead at the top.
 */
export async function listRoadmapRefs({ repo, slug, trunk }, { head, prs = [], worktrees = [] }) {
  const out = [];

  // the trunk — what has actually landed
  const t = await lastTouched(repo, `origin/${trunk}`, slug);
  out.push({
    ref: trunk,
    kind: 'trunk',
    label: `origin/${trunk}`,
    sublabel: 'landed',
    ahead: 0,
    pr: null,
    worktreePath: null,
    ...t,
  });

  // every live branch carrying roadmap commits the trunk lacks
  for (const c of head?.candidates ?? []) {
    const pr = prs.find((p) => p.headRefName === c.branch && p.state === 'OPEN');
    const wt = worktrees.find((w) => w.branch === c.branch);
    out.push({
      ref: c.branch,
      kind: 'branch',
      label: c.branch,
      sublabel: [
        `+${c.ahead} roadmap commit${c.ahead === 1 ? '' : 's'}`,
        pr ? `PR #${pr.number}` : null,
        wt ? path.basename(wt.path) : null,
      ]
        .filter(Boolean)
        .join(' · '),
      ahead: c.ahead,
      pr: pr?.number ?? null,
      worktreePath: wt?.path ?? null,
      ...(await lastTouched(repo, c.branch, slug)),
    });
  }

  // uncommitted roadmap edits, in any worktree including the main checkout
  for (const w of [{ path: repo, branch: null }, ...worktrees]) {
    if (w.path !== repo && worktrees.every((x) => x.path !== w.path)) continue;
    const dirty = (await sh('git', ['status', '--porcelain', '--', `docs/roadmaps/${slug}/`], w.path)).trim();
    if (!dirty) continue;
    const files = dirty.split('\n').length;
    out.push({
      ref: `${WORKTREE_PREFIX}${w.path}`,
      kind: 'worktree',
      label: path.basename(w.path),
      sublabel: `${files} uncommitted file${files === 1 ? '' : 's'}`,
      ahead: Number.MAX_SAFE_INTEGER,
      pr: null,
      worktreePath: w.path,
      when: null,
      subject: 'uncommitted',
    });
  }

  out.sort((a, b) => a.ahead - b.ahead);

  // the union of all of the above
  out.push({
    ref: MERGED,
    kind: 'merged',
    label: 'Merged view',
    sublabel: `${out.length} version${out.length === 1 ? '' : 's'} combined`,
    ahead: Number.MAX_SAFE_INTEGER,
    pr: null,
    worktreePath: null,
    when: null,
    subject: null,
  });

  return out;
}
