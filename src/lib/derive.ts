// Turns the raw state into the view model the page renders.
// This is the part that answers "what is safe to start right now, and why".

import type { Fixture, PR, Phase, Reason, Session, Stage, StageView, Status, Verdict, Worktree } from '../types';

/** `you/brew-log` → `brew-log` */
const branchStem = (b: string) => b.replace(/^[^/]+\//, '');

/**
 * PROTOTYPE join, exact on the brief stem. The real tool records the branch on the
 * stage when /roadmap-next-stage creates the worktree, so none of this guessing is needed.
 *
 * Deliberately NOT fuzzy: token-overlap matching once claimed a multi-stage
 * re-landing PR for an unrelated stage and reported two unbuilt stages as landed.
 * A wrong "done" is worse than a missing link.
 */
function matchPR(stage: Stage, prs: PR[], slug: string): { pr: PR; how: 'trailer' | 'branch' | 'title' } | null {
  // 1. Declared. `Roadmap-Stage: <slug>/<key>` in the PR body — see the roadmap-format
  //    skill. This is the only link that survives a stage being renamed.
  const declared = prs.filter((p) =>
    (p.roadmapStages ?? []).some((r) => r.stage === stage.key && (!r.slug || r.slug === slug)),
  );
  if (declared.length) return { pr: pickBest(declared), how: 'trailer' };

  // 2. Branch convention `<handle>/<stage-key>`.
  const exact = prs.filter((p) => branchStem(p.headRefName) === stage.key);
  if (exact.length) return { pr: pickBest(exact), how: 'branch' };

  // 3. Last resort: the PR title keeps the stage number ("Stage 06: …"). Scoped to PRs
  //    that actually touch THIS roadmap's docs — a bare number matches stage 06 of every
  //    roadmap in the repo otherwise. Only helps until the next renumber; the row says
  //    when this is what matched.
  const num = stage.num.match(/^\d+/)?.[0] ?? stage.num;
  const byTitle = prs.filter(
    (p) =>
      (p.roadmapsTouched ?? []).includes(slug) &&
      new RegExp(`^stage\\s*0*${Number(num)}[a-z]?\\b`, 'i').test(p.title),
  );
  return byTitle.length ? { pr: pickBest(byTitle), how: 'title' } : null;
}
// prefer an open PR over a merged one; otherwise the most recent
const pickBest = (ps: PR[]) =>
  [...ps].sort(
    (a, b) => Number(b.state === 'OPEN') - Number(a.state === 'OPEN') || b.number - a.number,
  )[0];

function matchWorktree(stage: Stage, pr: PR | null, wts: Worktree[]): Worktree | null {
  return (
    wts.find((w) => pr && w.branch === pr.headRefName) ??
    wts.find((w) => w.branch && branchStem(w.branch) === stage.key) ??
    wts.find((w) => w.path.endsWith('/' + stage.key)) ??
    null
  );
}

/** PR number wins, then branch, then worktree path (incl. a live process's cwd). */
function matchSessions(pr: PR | null, wt: Worktree | null, sessions: Session[]): Session[] {
  const hit = sessions.filter(
    (s) =>
      (pr && s.prNumber === pr.number) ||
      (pr && s.worktreeBranch === pr.headRefName) ||
      (wt && (s.worktreePath === wt.path || s.worktreeBranch === wt.branch || s.live?.cwd === wt.path)),
  );
  // live sessions first, then most recent
  return hit.sort(
    (a, b) => Number(!!b.live) - Number(!!a.live) || b.mtime.localeCompare(a.mtime),
  );
}

/**
 * Is there actual work here, or just the shell of an abandoned start?
 *
 * Creating a session creates a worktree, so a worktree alone proves nothing — stop and
 * close that session and the directory stays behind. Running needs a live session, a
 * pushed PR, or commits on the branch.
 */
const hasWork = (pr: PR | null, wt: Worktree | null, sessions: Session[]) =>
  !!pr || sessions.some((s) => s.live) || (wt?.commits ?? 0) > 0;

function phaseOf(stage: Stage, pr: PR | null, wt: Worktree | null, sessions: Session[]): Phase {
  // merged is merged — whether the merge commit survived into master is a
  // separate (and interesting) question, raised as a reason rather than a demotion.
  if (pr?.state === 'MERGED') return 'landed';
  // An open PR outranks a ticked checkbox. Reading the roadmap from a branch means
  // stages get ticked the moment their work is committed — but "committed on the
  // branch" is not "landed", and the PR still needs review and a merge.
  if (pr?.state === 'OPEN' && !pr.isDraft) return 'in_review';
  if (pr?.state === 'OPEN') return 'in_flight';
  if (stage.checked) return 'landed';
  if (wt && !wt.prunable && hasWork(pr, wt, sessions)) return 'in_flight';
  return 'blocked'; // upgraded to 'ready' once deps are checked
}

/** Why a dependency isn't satisfied yet, in the words that tell you what to wait for. */
const depState = (d: { phase: Phase; pr: PR | null }) =>
  d.pr?.isDraft ? 'draft, not ready for review'
  : d.phase === 'in_flight' ? 'in progress'
  : 'not started';

export function derive(fx: Fixture) {
  const stages = fx.roadmap.stages;
  const byKey = new Map(stages.map((s) => [s.key, s]));

  // pass 1 — attach real-world state
  const base = stages.map((s) => {
    const m = matchPR(s, fx.prs, fx.roadmap.slug);
    const pr = m?.pr ?? null;
    const worktree = matchWorktree(s, pr, fx.worktrees);
    const sessions = matchSessions(pr, worktree, fx.sessions);
    return { ...s, pr, prMatchedBy: m?.how ?? null, worktree, sessions, phase: phaseOf(s, pr, worktree, sessions) };
  });
  const state = new Map(base.map((s) => [s.key, s]));

  // depth = longest dependency chain, for graph layout and wave ordering
  const depth = new Map<string, number>();
  const depthOf = (key: string, seen = new Set<string>()): number => {
    if (depth.has(key)) return depth.get(key)!;
    if (seen.has(key)) return 0;
    seen.add(key);
    const d = Math.max(0, ...(byKey.get(key)?.dependsOn ?? []).map((p) => depthOf(p, seen) + 1));
    depth.set(key, d);
    return d;
  };
  stages.forEach((s) => depthOf(s.key));

  const activePhases: Phase[] = ['in_flight', 'in_review'];
  const active = base.filter((s) => activePhases.includes(s.phase));

  // pass 2 — the verdict
  const views: StageView[] = base.map((s) => {
    const reasons: Reason[] = [];
    let verdict: Verdict;
    let phase = s.phase;

    const deps = s.dependsOn.map((d) => state.get(d)!).filter(Boolean);
    const unlanded = deps.filter((d) => d.phase !== 'landed');
    // Only stack on a dependency whose PR is READY. A draft is still being written, so
    // its shape is still moving — stacking on it means rebasing onto a moving target.
    const reviewable = unlanded.filter((d) => d.phase === 'in_review');
    const notReady = unlanded.filter((d) => d.phase !== 'in_review');

    const contestedWith = active
      .filter((o) => o.key !== s.key)
      .map((o) => ({ stage: o.num, decisions: s.decisions.filter((d) => o.decisions.includes(d)) }))
      .filter((x) => x.decisions.length > 0);

    if (s.phase === 'landed') {
      verdict = 'landed';
      reasons.push({
        kind: 'good',
        text: s.pr ? `#${s.pr.number} merged ${ago(s.pr.mergedAt)}` : 'ticked in ROADMAP.md',
      });
      if (s.pr?.state === 'MERGED' && !s.pr.landedOnMaster)
        reasons.push({
          kind: 'bad',
          text: `merge commit ${s.pr.mergeCommit?.slice(0, 7)} is NOT in the trunk's history — re-landed elsewhere?`,
        });
      if (s.pr?.state === 'MERGED' && !s.checked)
        reasons.push({ kind: 'warn', text: 'ROADMAP.md checkbox still unticked' });
      if (s.worktree && !s.worktree.prunable)
        reasons.push({ kind: 'info', text: 'worktree not torn down' });
    } else if (activePhases.includes(s.phase)) {
      verdict = 'active';
      if (s.pr) {
        if (s.pr.checksTotal && s.pr.checksPassed < s.pr.checksTotal)
          reasons.push({ kind: 'warn', text: `CI ${s.pr.checksPassed}/${s.pr.checksTotal}` });
        if (!s.pr.humanReviewCount)
          reasons.push({ kind: 'info', text: 'no human review yet' });
        if (s.pr.behindMaster) reasons.push({ kind: 'info', text: `behind trunk by ${s.pr.behindMaster}` });
      } else {
        reasons.push({ kind: 'info', text: 'worktree open, no PR yet' });
      }
    } else if (notReady.length) {
      verdict = 'blocked';
      phase = 'blocked';
      reasons.push({
        kind: 'bad',
        text: `needs ${notReady.map((d) => `${d.num} (${depState(d)})`).join(', ')}`,
      });
    } else if (reviewable.length) {
      verdict = 'stackable';
      phase = 'ready';
      reasons.push({
        kind: 'warn',
        text: `stack on ${reviewable.map((d) => d.pr!.headRefName).join(' + ')} — ready for review, not merged`,
      });
    } else {
      verdict = 'free';
      phase = 'ready';
      reasons.push({
        kind: 'good',
        text: deps.length ? `deps ${deps.map((d) => d.num).join(', ')} landed` : 'no dependencies',
      });
    }

    if ((verdict === 'free' || verdict === 'stackable') && contestedWith.length) {
      verdict = 'contested';
      for (const c of contestedWith)
        reasons.push({
          kind: 'warn',
          text: `shares ${c.decisions.join(' + ')} with ${c.stage}, in flight`,
        });
    }

    // decision drift — a bound decision has already moved on an unmerged branch
    for (const dd of fx.decisionDrift) {
      const moved = [...dd.changed.map((c) => c.id), ...dd.added.filter((a) => a.boundBy.includes(s.num)).map((a) => a.id)];
      const hits = [...new Set(moved.filter((id) => s.decisions.includes(id) || dd.added.some((a) => a.id === id)))];
      const relevant = hits.filter(
        (id) => s.decisions.includes(id) || dd.added.find((a) => a.id === id)?.boundBy.includes(s.num),
      );
      if (relevant.length && s.phase !== 'landed')
        reasons.push({ kind: 'bad', text: `${relevant.join(', ')} moved on #${dd.pr} — brief is stale` });
    }

    if (s.prMatchedBy === 'title' && s.pr)
      reasons.push({
        kind: 'warn',
        text: `#${s.pr.number} matched by title only — add "Roadmap-Stage: ${fx.roadmap.slug}/${s.key}" to its body`,
      });
    if (s.prMatchedBy === 'branch' && s.pr && branchStem(s.pr.headRefName) !== s.key)
      reasons.push({ kind: 'info', text: `#${s.pr.number} matched by branch name` });
    if (s.checked && s.pr?.state === 'OPEN')
      reasons.push({ kind: 'info', text: `ticked done on ${fx.roadmap.ref}, but #${s.pr.number} is still open` });

    if (s.phase !== 'in_flight' && s.phase !== 'landed' && s.worktree && !s.worktree.prunable)
      reasons.push({
        kind: 'info',
        text: `worktree exists but is empty — ${s.worktree.path.split('/').pop()}`,
      });

    if (s.driftCommits > 20 && s.phase !== 'landed')
      reasons.push({ kind: 'info', text: `${s.driftCommits} commits to its files since the brief` });

    // The five at-a-glance states.
    //
    // A DRAFT PR counts as Running, not In PR. Claude typically opens the draft early
    // and pushes into it incrementally, so a draft says "being written", not "awaiting
    // review" — which is the distinction In PR exists to make.
    const status: Status =
      phase === 'landed' ? 'done'
      : s.pr?.state === 'OPEN' && !s.pr.isDraft ? 'in_pr'
      : phase === 'in_flight' ? 'running'
      : verdict === 'blocked' ? 'blocked'
      : 'ready';

    return {
      ...s,
      status,
      yourTurn: s.sessions.find((x) => x.live?.status === 'idle') ?? null,
      busy: s.sessions.find((x) => x.live?.status === 'busy') ?? null,
      stackOn: reviewable.map((d) => d.num).sort(),
      stackOnBranches: reviewable.map((d) => d.pr?.headRefName).filter(Boolean) as string[],
      waitingOn: unlanded.map((d) => d.num).sort(),
      waitingOnStages: unlanded.map((d) => ({ num: d.num, title: d.title })),
      phase,
      verdict,
      reasons,
      contestedWith,
      depth: depth.get(s.key) ?? 0,
      unblocks: stages.filter((o) => o.dependsOn.includes(s.key)).map((o) => o.num),
    };
  });

  return { views, byNum: new Map(views.map((v) => [v.num, v])) };
}

export const VERDICT_META: Record<Verdict, { label: string; dot: string; text: string; ring: string; bg: string }> = {
  landed:    { label: 'Landed',    dot: 'bg-zinc-500',    text: 'text-zinc-400',    ring: 'ring-zinc-700/60',    bg: 'bg-zinc-800/30' },
  active:    { label: 'In flight', dot: 'bg-sky-400',     text: 'text-sky-300',     ring: 'ring-sky-500/40',     bg: 'bg-sky-500/5' },
  free:      { label: 'Free',      dot: 'bg-emerald-400', text: 'text-emerald-300', ring: 'ring-emerald-500/40', bg: 'bg-emerald-500/5' },
  stackable: { label: 'Stackable', dot: 'bg-amber-400',   text: 'text-amber-300',   ring: 'ring-amber-500/40',   bg: 'bg-amber-500/5' },
  contested: { label: 'Contested', dot: 'bg-fuchsia-400', text: 'text-fuchsia-300', ring: 'ring-fuchsia-500/40', bg: 'bg-fuchsia-500/5' },
  blocked:   { label: 'Blocked',   dot: 'bg-zinc-600',    text: 'text-zinc-500',    ring: 'ring-zinc-800',       bg: 'bg-transparent' },
};

/** `/home/x/src/app` → `~/src/app`, using the home the server reported. */
export const tilde = (p: string, home?: string) => (home && p.startsWith(home) ? '~' + p.slice(home.length) : p);

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** A preview of what the server will run when you press the button. */
export function launchCommand(v: StageView, fx: Fixture) {
  const wtPath = v.worktree?.path ?? `${fx.worktreesDir ?? fx.repoPath + '-worktrees'}/${v.key}`;
  const stacked = v.stackOnBranches.length > 0;
  const base = stacked ? v.stackOnBranches[0] : `origin/${fx.trunk}`;
  const branch = v.worktree?.branch ?? `${fx.handle ?? 'me'}/${v.key}`;
  return {
    worktree: wtPath,
    branch,
    base,
    stacked,
    steps: [
      `git worktree add ${wtPath} -b ${branch} ${base}${stacked ? '   # stacked, not off the trunk' : ''}`,
      stacked ? `gh stack init ${base} ${branch}` : `# not stacked: every dependency is merged`,
      `code ${wtPath}`,
      `claude --session-id $(uuidgen) "$(cat .roadmap-tool/preamble.md)"`,
    ],
  };
}

export function preambleFor(v: StageView, fx: Fixture): string {
  const drift = fx.decisionDrift.flatMap((dd) => [
    ...dd.changed.filter((c) => v.decisions.includes(c.id)).map((c) => `  - ${c.id} changed on #${dd.pr}: "${c.was}" → "${c.now}"`),
    ...dd.added.filter((a) => a.boundBy.includes(v.num)).map((a) => `  - ${a.id} is NEW on #${dd.pr}: ${a.headline}`),
  ]);
  const deps = v.dependsOn.length ? v.dependsOn.join(', ') : 'none';
  return [
    `/roadmap-next-stage ${fx.roadmap.slug} ${v.num}`,
    ``,
    `Brief: docs/roadmaps/${fx.roadmap.slug}/${v.briefFile}`,
    `Depends on: ${deps}. Base: ${
      v.stackOnBranches.length ? `stacked on ${v.stackOnBranches.join(' + ')} (open PR, not merged)` : 'fresh master'
    }.`,
    `Decisions in force: ${v.decisions.join(', ')}`,
    ``,
    ...(drift.length
      ? [
          `BEFORE PLANNING — the decision index has moved since this brief was written:`,
          ...drift,
          `Re-ground the brief against those before proposing tasks.`,
          ``,
        ]
      : []),
    ...(v.contestedWith.length
      ? [
          `In flight alongside you: ${v.contestedWith.map((c) => `${c.stage} (shares ${c.decisions.join(', ')})`).join('; ')}.`,
          `Coordinate rather than assume those decisions are settled.`,
          ``,
        ]
      : []),
    `Work the brief's "Re-verify at start" section first.`,
  ].join('\n');
}
