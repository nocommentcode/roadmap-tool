// Source: git. Cheap enough to re-read on a short interval.

import { ok, sh } from '../util.mjs';

export async function readGit({ repo, trunk = 'master' }) {
  const [porcelain, masterHead] = await Promise.all([
    sh('git', ['worktree', 'list', '--porcelain'], repo),
    sh('git', ['rev-parse', '--short', `origin/${trunk}`], repo),
  ]);

  const worktrees = [];
  let cur = {};
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) cur = { path: line.slice(9) };
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5, 12);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '');
    else if (line.startsWith('prunable')) cur.prunable = true;
    else if (line === '' && cur.path) {
      worktrees.push(cur);
      cur = {};
    }
  }
  if (cur.path) worktrees.push(cur);

  return { worktrees, masterHead: masterHead.trim() };
}

/** Is this commit actually in the trunk's history? "Merged" and "landed" differ. */
export const isAncestorOfMaster = (repo, oid, trunk = 'master') =>
  ok('git', ['merge-base', '--is-ancestor', oid, `origin/${trunk}`], repo);

/** Uncommitted roadmap edits in the main checkout. */
export async function roadmapIsDirty(repo, slug) {
  const out = await sh('git', ['status', '--porcelain', '--', `docs/roadmaps/${slug}/`], repo);
  return out.trim().length > 0;
}

/** Update the remote refs everything is measured against. Read-only for the worktree. */
export async function fetchTrunk(repo, trunk) {
  return ok('git', ['fetch', '--quiet', 'origin', trunk], repo);
}

/**
 * Which ref holds the CURRENT roadmap?
 *
 * Everything is measured against `origin/<trunk>`, never the local branch of the same
 * name. A local trunk drifts — 116 commits behind, in the repo this was built against —
 * and a merged branch then still counts as "ahead", so it stays a live roadmap
 * candidate long after it landed.
 *
 * Working a stage rewrites the roadmap itself — stages split, decisions get added,
 * checkboxes get ticked. So the trunk's copy goes stale the moment a stage starts, and
 * reading it shows a roadmap that no longer exists.
 *
 * The rule: among branches that are alive (an open PR, or checked out in a worktree)
 * and that carry roadmap commits the trunk doesn't have, drop any that is an ancestor of
 * another. Stacked work collapses to the tip of the stack. Anything left over is
 * genuine divergence, which we report rather than silently pick between.
 */
export async function resolveRoadmapHead({ repo, slug, trunk = 'master' }, { openPRBranches = [], mergedPRBranches = [], worktreeBranches = [] }) {
  const merged = new Set(mergedPRBranches);
  const alive = [...new Set([...openPRBranches, ...worktreeBranches])].filter((b) => b && !merged.has(b));

  const candidates = [];
  await Promise.all(
    alive.map(async (branch) => {
      const n = (
        await sh('git', ['rev-list', '--count', `origin/${trunk}..${branch}`, '--', `docs/roadmaps/${slug}/`], repo)
      ).trim();
      if (!/^\d+$/.test(n) || +n === 0) return;
      const oid = (await sh('git', ['rev-parse', branch], repo)).trim();
      candidates.push({ branch, oid, ahead: +n });
    }),
  );
  if (!candidates.length) {
    const oid = (await sh('git', ['rev-parse', `origin/${trunk}`], repo)).trim();
    return { ref: trunk, branch: null, oid, ahead: 0, candidates: [], diverged: [], alsoOn: [] };
  }

  // branches sitting on the same commit are the same candidate
  const byOid = new Map();
  for (const c of candidates) {
    const prev = byOid.get(c.oid);
    if (!prev) byOid.set(c.oid, { ...c, branches: [c.branch] });
    else prev.branches.push(c.branch);
  }
  const uniq = [...byOid.values()];

  // keep only the maximal elements of the ancestry order
  const tips = [];
  for (const c of uniq) {
    let dominated = false;
    for (const o of uniq) {
      if (o.oid === c.oid) continue;
      if (await isAncestor(repo, c.oid, o.oid)) { dominated = true; break; }
    }
    if (!dominated) tips.push(c);
  }

  tips.sort((a, b) => b.ahead - a.ahead);
  const head = tips[0];
  return {
    ref: head.branch,
    branch: head.branch,
    oid: head.oid,
    alsoOn: head.branches.filter((b) => b !== head.branch),
    ahead: head.ahead,
    candidates: uniq.map((c) => ({ branch: c.branch, ahead: c.ahead })),
    // more than one tip means two people edited the roadmap on unrelated branches
    diverged: tips.slice(1).map((c) => ({ branch: c.branch, ahead: c.ahead })),
  };
}

const isAncestor = (repo, a, b) => ok('git', ['merge-base', '--is-ancestor', a, b], repo);

export async function behindMaster(repo, branch, trunk = 'master') {
  const n = (await sh('git', ['rev-list', '--count', `${branch}..origin/${trunk}`], repo)).trim();
  return /^\d+$/.test(n) ? +n : null;
}
