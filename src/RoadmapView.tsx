// A — Phase outline.
// Stage order, always. Big bold titles, airy rows, one clear status per row.
// Expanded content is chosen by status: a blocked stage explains the block, an
// in-PR stage shows checks and review, a running stage shows runtime and whose
// turn it is, a ready stage shows how to start.

import { useState } from 'react';
import type { Fixture, Session, StageView, Status } from './types';
import { ago, launchCommand, preambleFor, tilde } from './lib/derive';

/* ── helpers ─────────────────────────────────────────────────────────── */

const STATUS: Record<Status, { label: string; fg: string; dot: string }> = {
  done:    { label: 'Done',    fg: 'text-zinc-500',    dot: 'bg-zinc-700' },
  in_pr:   { label: 'In PR',   fg: 'text-violet-300',  dot: 'bg-violet-400' },
  running: { label: 'Running', fg: 'text-sky-300',     dot: 'bg-sky-400' },
  blocked: { label: 'Blocked', fg: 'text-zinc-600',    dot: 'bg-zinc-800' },
  ready:   { label: 'Ready',   fg: 'text-emerald-300', dot: 'bg-emerald-400' },
};

function runtime(from: string | null | undefined): string {
  if (!from) return '—';
  const mins = Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${String(mins % 60).padStart(2, '0')}m`;
}

const YourTurn = ({ small = false }: { small?: boolean }) => (
  <span className={`inline-flex shrink-0 items-center gap-1.5 font-semibold text-amber-400 ${small ? 'text-[13px]' : 'text-sm'}`}>
    <span className="relative flex size-1.5">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
      <span className="relative inline-flex size-1.5 rounded-full bg-amber-400" />
    </span>
    your turn
  </span>
);

const Check = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <div className="flex items-baseline gap-2 text-sm">
    <span className={`w-3 shrink-0 ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>{ok ? '✓' : '✗'}</span>
    <span className={ok ? 'text-zinc-400' : 'text-zinc-300'}>{children}</span>
  </div>
);

const Btn = ({
  kind = 'ghost', children, onClick, disabled,
}: {
  kind?: 'primary' | 'amber' | 'ghost';
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) => {
  const c = {
    primary: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30 hover:bg-emerald-500/25',
    amber: 'bg-amber-400/15 text-amber-200 ring-amber-400/30 hover:bg-amber-400/25',
    ghost: 'text-zinc-400 ring-zinc-700 hover:bg-zinc-800 hover:text-zinc-200',
  }[kind];
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      disabled={disabled}
      className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition disabled:cursor-wait disabled:opacity-50 ${c}`}
    >
      {children}
    </button>
  );
};

/** POST /api/launch — spawns a terminal running claude in the stage's worktree. */
function useLaunch() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/launch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) setError(json.reason ?? 'launch failed');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return { go, busy, error };
}

const H = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-600">{children}</div>
);

/* ── page ────────────────────────────────────────────────────────────── */

export function RoadmapView({
  views, fx, connection, onRefresh, onPickRef, onPickRoadmap,
}: {
  views: StageView[];
  fx: Fixture;
  connection: 'connecting' | 'live' | 'reconnecting';
  onRefresh: () => void;
  onPickRef: (ref: string) => void;
  onPickRoadmap: (slug: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const ready = views.filter((v) => v.status === 'ready');
  const done = views.filter((v) => v.status === 'done').length;
  const going = views.filter((v) => v.status === 'running' || v.status === 'in_pr').length;
  const turns = views.filter((v) => v.yourTurn);

  return (
    <div className="flex min-h-screen">
      <VersionRail fx={fx} onPickRef={onPickRef} onPickRoadmap={onPickRoadmap} />

      <div className="mx-auto max-w-3xl flex-1 px-8 py-12 pb-32">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-50">{fx.roadmap.title}</h1>
        <button
          onClick={onRefresh}
          title={`${fx.nameWithOwner} · ${fx.trunk} ${fx.masterHead} · read ${ago(fx.generatedAt)}`}
          className="mt-2 flex shrink-0 cursor-pointer items-center gap-2 text-xs text-zinc-600 hover:text-zinc-400"
        >
          <span
            className={`size-1.5 rounded-full ${
              connection === 'live' ? 'bg-emerald-400' : connection === 'reconnecting' ? 'bg-amber-400' : 'bg-zinc-600'
            }`}
          />
          {connection === 'live' ? 'live' : connection}
        </button>
      </div>
      <p className="mt-2 text-[15px] text-zinc-400">
        {done} of {views.length} done · {going} in progress ·{' '}
        {ready.length ? (
          <>you can start <span className="font-semibold text-emerald-300">{ready.map((v) => v.num).join(', ')}</span> today</>
        ) : (
          'nothing new to start'
        )}
      </p>

      <Provenance fx={fx} />

      {turns.length > 0 && (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-amber-400/10 px-4 py-3 ring-1 ring-inset ring-amber-400/20">
          <YourTurn />
          <span className="text-sm text-amber-100/80">
            {turns.map((v) => `${v.num} ${v.title}`).join(' · ')} — Claude is waiting on you
          </span>
        </div>
      )}

      <div className="mt-10 divide-y divide-zinc-900">
        {views.map((v) => (
          <Row key={v.key} v={v} fx={fx} open={open === v.key} onToggle={() => setOpen(open === v.key ? null : v.key)} />
        ))}
      </div>

      {fx.roadmap.discovered?.length > 0 && (
        <section className="mt-10 border-t border-zinc-900 pt-6">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-600">
            Found while building — needs its own stage
          </div>
          {fx.roadmap.discovered.map((d, i) => (
            <details key={i} className="group border-l-2 border-zinc-800 pl-4">
              <summary className="cursor-pointer list-none text-[15px] font-medium text-zinc-300 hover:text-zinc-100">
                {d.headline}
              </summary>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-zinc-500">{d.body}</p>
            </details>
          ))}
        </section>
      )}
      </div>
    </div>
  );
}

/**
 * Every version of the roadmap, oldest at the bottom like a stack. Clicking one shows
 * that version alone — which is the only way to see a stage a branch DELETED, since the
 * merged view is a union and a union cannot subtract.
 */
function VersionRail({
  fx, onPickRef, onPickRoadmap,
}: {
  fx: Fixture;
  onPickRef: (ref: string) => void;
  onPickRoadmap: (slug: string) => void;
}) {
  const refs = [...(fx.availableRefs ?? [])].reverse(); // newest first
  const active = fx.pinnedRef ?? ':merged';
  const roadmaps = fx.roadmaps ?? [fx.roadmap.slug];

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-r border-zinc-900 px-4 py-12 lg:block">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-600">Roadmap</div>
      {roadmaps.length > 1 ? (
        <select
          value={fx.roadmap.slug}
          onChange={(e) => onPickRoadmap(e.target.value)}
          className="mb-8 w-full cursor-pointer rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-[13px] font-semibold text-zinc-200 outline-none hover:border-zinc-700 focus:border-zinc-600"
        >
          {roadmaps.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      ) : (
        <div className="mb-8 text-[13px] font-semibold text-zinc-300">{fx.roadmap.slug}</div>
      )}

      <div className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-600">
        Version
      </div>

      <div className="relative">
        {/* the spine */}
        <div className="absolute bottom-2 left-[5px] top-2 w-px bg-zinc-900" />

        {refs.map((r) => {
          const on = r.ref === active;
          const tone =
            r.kind === 'merged' ? 'text-zinc-300'
            : r.kind === 'worktree' ? 'text-amber-300'
            : r.kind === 'branch' ? 'text-violet-300'
            : 'text-zinc-400';
          return (
            <button
              key={r.ref}
              onClick={() => onPickRef(r.ref)}
              title={r.subject ?? undefined}
              className="group relative block w-full cursor-pointer py-2 pl-6 pr-1 text-left"
            >
              <span
                className={`absolute left-0 top-[13px] size-[11px] rounded-full border-2 ${
                  on
                    ? 'border-zinc-100 bg-zinc-100'
                    : 'border-zinc-700 bg-zinc-950 group-hover:border-zinc-500'
                }`}
              />
              <span className={`block truncate text-[13px] font-semibold ${on ? 'text-zinc-50' : tone}`}>
                {r.label}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-zinc-600">{r.sublabel}</span>
              {r.when && <span className="block text-[11px] text-zinc-700">{ago(r.when)}</span>}
            </button>
          );
        })}
      </div>

      <p className="mt-6 border-t border-zinc-900 pt-4 text-[11px] leading-relaxed text-zinc-600">
        The merged view unions every version, so it shows stages a branch has{' '}
        <em>removed</em> as well as added. Pick a single version to see it exactly.
      </p>
    </aside>
  );
}

/** Where this roadmap was read from. The trunk goes stale the moment a stage starts. */
function Provenance({ fx }: { fx: Fixture }) {
  const { head, roadmap } = fx;
  const onBranch = roadmap.ref !== 'master';
  return (
    <div className="mt-4 text-sm">
      {onBranch ? (
        <div className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-violet-400/5 px-4 py-3 ring-1 ring-inset ring-violet-400/20">
          <span className="text-violet-200">
            Reading the roadmap from <span className="font-semibold">{roadmap.ref}</span>
          </span>
          <span className="text-zinc-500">
            — {head.ahead} commit{head.ahead === 1 ? '' : 's'} of roadmap edits master doesn't have yet
          </span>
          {head.alsoOn?.length > 0 && (
            <span className="text-zinc-600">· also on {head.alsoOn.join(', ')}</span>
          )}
        </div>
      ) : (
        <div className="text-zinc-600">Roadmap from master · no branch has changed it</div>
      )}

      {head.diverged?.length > 0 && (
        <div className="mt-2 rounded-lg bg-amber-400/10 px-4 py-3 text-amber-100/80 ring-1 ring-inset ring-amber-400/20">
          <span className="font-semibold text-amber-300">Two roadmaps in flight.</span>{' '}
          {head.diverged.map((d) => `${d.branch} (+${d.ahead})`).join(' and ')} also edit it, outside{' '}
          {roadmap.ref}'s history — they will conflict on merge.
        </div>
      )}
    </div>
  );
}

/* ── the row ─────────────────────────────────────────────────────────── */

function Row({ v, fx, open, onToggle }: { v: StageView; fx: Fixture; open: boolean; onToggle: () => void }) {
  const s = STATUS[v.status];
  return (
    <div>
      <button
        onClick={onToggle}
        className="group flex w-full cursor-pointer items-center gap-5 py-5 text-left"
      >
        <span className="w-6 shrink-0 text-sm font-medium tabular-nums text-zinc-700">{v.num}</span>

        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[17px] font-semibold leading-snug ${
              v.status === 'done' ? 'text-zinc-500' : v.status === 'blocked' ? 'text-zinc-500' : 'text-zinc-50'
            } group-hover:text-white`}
          >
            {v.title}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-3.5">
          {v.proposedOn && (
            <span
              className="shrink-0 text-[13px] font-semibold text-violet-400/80"
              title={`This stage exists only on ${v.proposedOn} — master does not have it yet`}
            >
              proposed
            </span>
          )}
          {v.yourTurn && <YourTurn small />}
          <RowBadges v={v} />
          {/* fixed width so every status word lines up in one column */}
          <span className={`w-16 shrink-0 text-right text-sm font-semibold ${s.fg}`}>{s.label}</span>
          <span className={`size-2 shrink-0 rounded-full ${s.dot}`} />
        </span>
      </button>

      {open && (
        <div className="pb-8 pl-11 pr-2">
          <Expanded v={v} fx={fx} />
        </div>
      )}
    </div>
  );
}

/* ── badges ──────────────────────────────────────────────────────────── */

const TONES = {
  violet: 'text-violet-300',
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  rose: 'text-rose-400',
  sky: 'text-sky-300',
  zinc: 'text-zinc-500',
} as const;

function Badge({
  tone = 'zinc', title, children,
}: { tone?: keyof typeof TONES; title?: string; children: React.ReactNode }) {
  return (
    <span title={title} className={`shrink-0 text-[13px] font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/** CI as one badge: green when all pass, rose on a failure, amber while pending. */
function ciBadge(pr: NonNullable<StageView['pr']>) {
  if (!pr.checksTotal) return <Badge key="ci" tone="zinc" title="no checks reported">no CI</Badge>;
  const failed = pr.checks.filter((c) => c.status === 'FAILURE' || c.status === 'ERROR').length;
  const pending = pr.checksTotal - pr.checksPassed - failed;
  const title = pr.checks.map((c) => `${c.name}: ${c.status.toLowerCase()}`).join('\n');
  if (failed) return <Badge key="ci" tone="rose" title={title}>✕ CI {pr.checksPassed}/{pr.checksTotal}</Badge>;
  if (pending) return <Badge key="ci" tone="amber" title={title}>◌ CI {pr.checksPassed}/{pr.checksTotal}</Badge>;
  return <Badge key="ci" tone="emerald" title={title}>✓ CI</Badge>;
}

/** Review as one badge, distinguishing "nobody looked" from "a bot commented". */
function reviewBadge(pr: NonNullable<StageView['pr']>) {
  const humans = pr.reviewers.filter((r) => r !== 'coderabbitai');
  if (pr.reviewDecision === 'APPROVED')
    return <Badge key="rv" tone="emerald" title={humans.join(', ')}>✓ approved</Badge>;
  if (pr.reviewDecision === 'CHANGES_REQUESTED')
    return <Badge key="rv" tone="rose" title={humans.join(', ')}>changes requested</Badge>;
  if (pr.humanReviewCount)
    return <Badge key="rv" tone="sky" title={humans.join(', ')}>◇ {pr.humanReviewCount} review{pr.humanReviewCount > 1 ? 's' : ''}</Badge>;
  return (
    <Badge key="rv" tone="amber" title={pr.botReviewCount ? `${pr.botReviewCount} bot comments, no human review` : 'nobody has looked yet'}>
      no review
    </Badge>
  );
}

/** The detail beside the status word. Badges, chosen by status. */
function RowBadges({ v }: { v: StageView }) {
  const pr = v.pr;
  const out: React.ReactNode[] = [];

  if (v.status === 'in_pr' && pr) {
    if (pr.isDraft) out.push(<Badge key="d" tone="zinc">draft</Badge>);
    out.push(ciBadge(pr), reviewBadge(pr));
    if (pr.mergeable === 'CONFLICTING') out.push(<Badge key="m" tone="rose">conflicts</Badge>);
    out.push(<Badge key="pr" tone="violet" title={pr.title}>#{pr.number}</Badge>);
  } else if (v.status === 'done') {
    if (pr && !pr.landedOnMaster)
      out.push(<Badge key="nm" tone="rose" title={`merge commit ${pr.mergeCommit?.slice(0, 7)} is not an ancestor of master`}>not in master</Badge>);
    if (pr) out.push(<Badge key="pr" tone="zinc" title={`merged ${ago(pr.mergedAt)}`}>#{pr.number}</Badge>);
  } else if (v.status === 'running') {
    const live = v.yourTurn ?? v.busy;
    if (live) out.push(<Badge key="rt" tone="sky" title={`session ${live.id.slice(0, 8)}`}>{runtime(live.live!.startedAt)}</Badge>);
    else if (v.sessions[0]) out.push(<Badge key="rt" tone="zinc">last {ago(v.sessions[0].mtime)}</Badge>);
    if (v.worktree) out.push(<Badge key="wt" tone="zinc" title={v.worktree.path}>{v.worktree.path.split('/').pop()}</Badge>);
  } else if (v.status === 'blocked') {
    out.push(<Badge key="b" tone="zinc" title={v.waitingOnStages.map((d) => `${d.num} ${d.title}`).join('\n')}>by {v.waitingOn.join(', ')}</Badge>);
  } else if (v.status === 'ready' && v.stackOn.length) {
    out.push(<Badge key="s" tone="amber" title="its dependency is in review, not merged — branch on top of it">stack on {v.stackOn.join(', ')}</Badge>);
  }

  return <>{out}</>;
}

/* ── expanded, by status ─────────────────────────────────────────────── */

function Expanded({ v, fx }: { v: StageView; fx: Fixture }) {
  const goal = v.goal.replace(/\*\*/g, '').replace(/\[\[|\]\]/g, '').split('\n\n')[0].replace(/\s+/g, ' ');
  return (
    <div className="space-y-7">
      <p className="max-w-prose text-[15px] leading-relaxed text-zinc-400">{goal}</p>

      {(v.proposedOn || v.supersedes.length > 0) && (
        <section>
          <H>Where this stage comes from</H>
          <div className="space-y-1 text-sm text-zinc-400">
            {v.proposedOn && (
              <div>
                Only <span className="font-medium text-violet-300">{v.proposedOn}</span> describes it — master and
                the other live branches still have the stage it replaces.
              </div>
            )}
            {v.supersedes.length > 0 && (
              <div>
                Replaces{' '}
                <span className="font-medium text-zinc-200">
                  {v.supersedes.map((k, i) => `${v.supersedesNums[i] ?? ''} ${k}`.trim()).join(', ')}
                </span>
                . Branches that still depend on it resolve through to this one.
              </div>
            )}
          </div>
        </section>
      )}

      {v.status === 'blocked' && <BlockedBody v={v} fx={fx} />}
      {v.status === 'ready' && <ReadyBody v={v} fx={fx} />}
      {v.status === 'running' && <RunningBody v={v} fx={fx} />}
      {v.status === 'in_pr' && <InPRBody v={v} fx={fx} />}
      {v.status === 'done' && <DoneBody v={v} fx={fx} />}
    </div>
  );
}

function Heads({ v, fx }: { v: StageView; fx: Fixture }) {
  const stale = v.reasons.filter((r) => r.kind === 'bad' && r.text.includes('moved on'));
  const contested = v.contestedWith;
  if (!stale.length && !contested.length) return null;
  return (
    <section>
      <H>Heads up</H>
      <div className="space-y-2 border-l-2 border-amber-500/40 pl-4">
        {fx.decisionDrift.map((dd) => {
          const changed = dd.changed.filter((c) => v.decisions.includes(c.id));
          const added = dd.added.filter((a) => a.boundBy.includes(v.num));
          if (!changed.length && !added.length) return null;
          return (
            <div key={dd.pr} className="text-sm leading-relaxed text-zinc-300">
              {changed.map((c) => (
                <div key={c.id}>
                  <span className="font-semibold text-amber-300">{c.id}</span> was rewritten on the unmerged{' '}
                  <span className="text-violet-300">#{dd.pr}</span> — this brief still says “{c.was}”, but it now
                  reads “{c.now}”.
                </div>
              ))}
              {added.map((a) => (
                <div key={a.id}>
                  <span className="font-semibold text-amber-300">{a.id}</span> is new on{' '}
                  <span className="text-violet-300">#{dd.pr}</span> and binds this stage: {a.headline}.
                </div>
              ))}
            </div>
          );
        })}
        {contested.map((c) => (
          <div key={c.stage} className="text-sm leading-relaxed text-zinc-300">
            Stage <span className="font-semibold text-zinc-100">{c.stage}</span> is in progress and shares{' '}
            <span className="font-semibold text-fuchsia-300">{c.decisions.join(', ')}</span> — if those move, you both rework.
          </div>
        ))}
      </div>
    </section>
  );
}

function BlockedBody({ v, fx }: { v: StageView; fx: Fixture }) {
  return (
    <>
      <section>
        <H>Waiting on</H>
        <div className="space-y-2">
          {v.waitingOnStages.map((d) => (
            <div key={d.num} className="flex items-baseline gap-3 text-sm">
              <span className="w-6 shrink-0 tabular-nums text-zinc-600">{d.num}</span>
              <span className="text-zinc-200">{d.title}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 max-w-prose text-sm text-zinc-500">
          Nothing to do here until {v.waitingOn.length > 1 ? 'those land' : 'that lands'}. It unblocks{' '}
          {v.unblocks.length ? v.unblocks.join(', ') : 'nothing further'}.
        </p>
      </section>
      <Heads v={v} fx={fx} />
    </>
  );
}

function ReadyBody({ v, fx }: { v: StageView; fx: Fixture }) {
  const cmd = launchCommand(v, fx);
  return (
    <>
      <section>
        <H>How it starts</H>
        <div className="space-y-1.5 text-sm text-zinc-400">
          <div>
            Branch <span className="font-medium text-zinc-200">{fx.handle ?? 'me'}/{v.key}</span>{' '}
            {v.stackOn.length ? (
              <>stacked on <span className="text-amber-300">{v.stackOn.join(', ')}</span> — its PR is open, not merged</>
            ) : (
              <>off fresh {fx.trunk}</>
            )}
          </div>
          <div className="text-zinc-500">{tilde(cmd.worktree, fx.home)}</div>
        </div>
      </section>
      <Heads v={v} fx={fx} />
      <StartSession v={v} fx={fx} />
    </>
  );
}

function RunningBody({ v, fx }: { v: StageView; fx: Fixture }) {
  const live = v.yourTurn ?? v.busy;
  return (
    <>
      <section>
        <H>In progress</H>
        <div className="grid max-w-lg grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
          {live && (
            <>
              <span className="text-zinc-600">Running for</span>
              <span className="text-zinc-200">{runtime(live.live!.startedAt)}</span>
              <span className="text-zinc-600">Claude</span>
              <span>
                {live.live!.status === 'idle' ? (
                  <span className="text-amber-300">waiting on you — idle {ago(live.live!.statusUpdatedAt)}</span>
                ) : (
                  <span className="text-sky-300">working · last activity {ago(live.live!.statusUpdatedAt)}</span>
                )}
              </span>
            </>
          )}
          <span className="text-zinc-600">Branch</span>
          <span className="text-zinc-200">{v.worktree?.branch ?? '—'}</span>
          <span className="text-zinc-600">Worktree</span>
          <span className="text-zinc-300">{v.worktree ? tilde(v.worktree.path, fx.home) : '—'}</span>
          <span className="text-zinc-600">PR</span>
          <span className="text-zinc-400">not pushed yet</span>
        </div>
      </section>
      <SessionSection v={v} />
      <Heads v={v} fx={fx} />
      <StartSession v={v} fx={fx} />
    </>
  );
}

function InPRBody({ v, fx }: { v: StageView; fx: Fixture }) {
  const pr = v.pr!;
  const ciOk = pr.checksTotal > 0 && pr.checksPassed === pr.checksTotal;
  return (
    <>
      <section>
        <H>Pull request</H>
        <div className="mb-2 text-sm">
          <a href={pr.url} target="_blank" rel="noreferrer" className="font-semibold text-violet-300 hover:underline">
            #{pr.number}
          </a>
          <span className="ml-2 text-zinc-400">{pr.title}</span>
        </div>
        <div className="mb-3 flex flex-wrap gap-4">
          {pr.isDraft && <Badge tone="zinc">draft</Badge>}
          {ciBadge(pr)}
          {reviewBadge(pr)}
          <Badge tone={pr.mergeable === 'MERGEABLE' ? 'emerald' : 'rose'}>
            {pr.mergeable === 'MERGEABLE' ? '✓ mergeable' : pr.mergeStateStatus.toLowerCase()}
          </Badge>
          {pr.behindMaster ? <Badge tone="amber">behind {pr.behindMaster}</Badge> : null}
          <Badge tone="zinc">+{pr.additions.toLocaleString()} −{pr.deletions.toLocaleString()}</Badge>
        </div>
        <div className="space-y-1.5">
          {pr.checks.map((c) => (
            <Check key={c.name} ok={c.status === 'SUCCESS'}>
              {c.name} — {c.status.toLowerCase()}
            </Check>
          ))}
          {!pr.checksTotal && <Check ok={false}>no CI checks reported</Check>}
          <Check ok={pr.humanReviewCount > 0}>
            {pr.humanReviewCount
              ? `reviewed by ${pr.reviewers.filter((r) => r !== 'coderabbitai').join(', ')}`
              : `no human review yet${pr.botReviewCount ? ` (${pr.botReviewCount} bot comments)` : ''}`}
          </Check>
          <Check ok={pr.mergeable === 'MERGEABLE' && ciOk}>
            {pr.mergeable === 'MERGEABLE' ? (ciOk ? 'ready to merge' : 'merges cleanly, but CI is not green') : 'has conflicts'}
            {pr.behindMaster ? ` · behind master by ${pr.behindMaster}` : ''}
          </Check>
        </div>
        <div className="mt-3 text-sm text-zinc-600">
          +{pr.additions.toLocaleString()} −{pr.deletions.toLocaleString()} across {pr.changedFiles} files · opened {ago(pr.createdAt)}
        </div>
      </section>
      <SessionSection v={v} />
      <Heads v={v} fx={fx} />
      <StartSession v={v} fx={fx} />
    </>
  );
}

function DoneBody({ v, fx }: { v: StageView; fx: Fixture }) {
  const pr = v.pr;
  return (
    <section>
      <H>Landed</H>
      <div className="space-y-1.5">
        {pr && (
          <Check ok>
            <a href={pr.url} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">#{pr.number}</a>{' '}
            merged {ago(pr.mergedAt)}
          </Check>
        )}
        {pr && !pr.landedOnMaster && (
          <Check ok={false}>
            its merge commit {pr.mergeCommit?.slice(0, 7)} is not in {fx.trunk}'s history — re-landed on another PR
          </Check>
        )}
        {pr && !v.checked && <Check ok={false}>the ROADMAP.md checkbox is still unticked</Check>}
        {v.worktree && !v.worktree.prunable && (
          <Check ok={false}>worktree still on disk — {tilde(v.worktree.path, fx.home)}</Check>
        )}
        {v.unblocks.length > 0 && <Check ok>unblocked {v.unblocks.join(', ')}</Check>}
      </div>
    </section>
  );
}

/* ── sessions & CTAs ─────────────────────────────────────────────────── */

function SessionSection({ v }: { v: StageView }) {
  if (!v.sessions.length) return null;
  return (
    <section>
      <H>Claude sessions</H>
      <div className="space-y-2">
        {v.sessions.slice(0, 4).map((s) => <SessionLine key={s.id} s={s} cwd={v.worktree?.path ?? null} />)}
      </div>
    </section>
  );
}

function SessionLine({ s, cwd }: { s: Session; cwd: string | null }) {
  const { go, busy, error } = useLaunch();
  return (
    <div>
      <div className="flex items-center gap-3">
        <span
          className={`size-2 shrink-0 rounded-full ${
            s.live?.status === 'idle' ? 'bg-amber-400' : s.live ? 'bg-sky-400' : 'bg-zinc-700'
          }`}
        />
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{s.aiTitle ?? 'untitled session'}</span>
        <span className="shrink-0 text-sm text-zinc-600">
          {s.live ? `${runtime(s.live.startedAt)} · ${s.live.status === 'idle' ? 'idle' : 'working'}` : ago(s.mtime)}
        </span>
        <Btn
          kind={s.live?.status === 'idle' ? 'amber' : 'ghost'}
          disabled={busy}
          onClick={() => go({ mode: 'resume', sessionId: s.id, worktreePath: s.live?.cwd ?? s.worktreePath ?? cwd })}
        >
          {busy ? 'opening…' : s.live ? 'open' : 'resume'}
        </Btn>
      </div>
      {error && <div className="mt-1 pl-5 text-xs text-rose-400">{error}</div>}
    </div>
  );
}

function StartSession({ v, fx }: { v: StageView; fx: Fixture }) {
  const [show, setShow] = useState(false);
  const [preamble, setPreamble] = useState(() => preambleFor(v, fx));
  const { go, busy, error } = useLaunch();
  const live = v.yourTurn ?? v.busy;
  const last = v.sessions[0];

  // a stage whose dependency is only in review branches on that dependency, not master
  const base = v.stackOn.length
    ? fx.prs.find((p) => p.state === 'OPEN' && v.stackOn.includes(
        fx.roadmap.stages.find((st) => (p.roadmapStages ?? []).some((r) => r.stage === st.key))?.num ?? '',
      ))?.headRefName ?? null
    : null;

  const common = { stageKey: v.key, worktreePath: v.worktree?.path ?? null, base };

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        {live && (
          <Btn
            kind={live.live!.status === 'idle' ? 'amber' : 'ghost'}
            disabled={busy}
            onClick={() => go({ ...common, mode: 'resume', sessionId: live.id, worktreePath: live.live!.cwd })}
          >
            Open running session
          </Btn>
        )}
        {!live && last && (
          <Btn kind="ghost" disabled={busy} onClick={() => go({ ...common, mode: 'resume', sessionId: last.id })}>
            Resume last session
          </Btn>
        )}
        <Btn
          kind={v.status === 'ready' ? 'primary' : 'ghost'}
          disabled={busy}
          onClick={() => go({ ...common, mode: 'new', preamble })}
        >
          {busy ? 'launching…' : v.status === 'ready' ? 'Start this phase' : 'Start a fresh session'}
        </Btn>
        {v.worktree && (
          <Btn kind="ghost" disabled={busy} onClick={() => go({ editorOnly: true, worktreePath: v.worktree!.path })}>
            Open in VS Code
          </Btn>
        )}
        <button onClick={() => setShow((x) => !x)} className="cursor-pointer text-sm text-zinc-600 hover:text-zinc-400">
          {show ? 'hide' : 'edit'} preamble
        </button>
      </div>
      {error && <div className="mt-2 text-sm text-rose-400">{error}</div>}
      {show && (
        <textarea
          value={preamble}
          onChange={(e) => setPreamble(e.target.value)}
          spellCheck={false}
          rows={preamble.split('\n').length + 1}
          className="mono mt-3 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-[12px] leading-relaxed text-zinc-300 outline-none focus:border-zinc-600"
        />
      )}
    </section>
  );
}


