export type Decision = {
  id: string;
  text: string;
  headline: string;
  authoredIn: string;
  boundBy: string[];
};

export type Stage = {
  /** stable identity — the brief stem. Numbers renumber when a stage is split. */
  key: string;
  num: string;
  title: string;
  checked: boolean;
  briefFile: string;
  goal: string;
  decisions: string[];
  dependsOn: string[];
  /** dependsOn resolved to display numbers */
  dependsOnNums: string[];
  dependsFrom: 'frontmatter' | 'config' | 'none';
  /** stages this one replaces (a split declares both halves) */
  supersedes: string[];
  supersedesNums: string[];
  /** which refs describe this stage */
  onRefs: string[];
  /** null when master has it; otherwise the branch proposing it */
  proposedOn: string | null;
  briefLastTouched: string;
  touches: string[];
  /** commits to this stage's files since its brief was last written */
  driftCommits: number;
};

/** An unmerged branch whose Decision index disagrees with master's. */
export type DecisionDrift = {
  branch: string;
  pr: number;
  added: { id: string; headline: string; boundBy: string[] }[];
  changed: { id: string; was: string; now: string; boundBy: string[] }[];
};

export type Check = { name: string; status: string };

export type PR = {
  number: number;
  title: string;
  /** `Roadmap-Stage:` trailers in the PR body — the authoritative stage link */
  roadmapStages: { slug: string; stage: string }[];
  /** roadmap slugs whose docs this PR touches — scopes the title fallback */
  roadmapsTouched: string[];
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  reviewDecision: string | null;
  mergeStateStatus: string;
  mergeable: string;
  checks: Check[];
  checksPassed: number;
  checksTotal: number;
  reviewers: string[];
  humanReviewCount: number;
  botReviewCount: number;
  commentCount: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  mergeCommit: string | null;
  landedOnMaster: boolean;
  behindMaster: number | null;
};

/** A Claude process that is alive right now. `idle` means it's your turn to speak. */
export type LiveSession = {
  pid: number;
  status: 'idle' | 'busy';
  name: string;
  cwd: string;
  startedAt: string;
  statusUpdatedAt: string;
};

export type Session = {
  id: string;
  live: LiveSession | null;
  startedAt: string | null;
  projectDir: string;
  sizeBytes: number;
  mtime: string;
  turns: number;
  aiTitle: string | null;
  lastPrompt: string | null;
  firstPrompt: string | null;
  prNumber: number | null;
  prUrl: string | null;
  cwd: string | null;
  worktreePath: string | null;
  worktreeName: string | null;
  worktreeBranch: string | null;
  /** false when this row came from the live registry with no transcript on disk */
  transcript?: boolean;
};

export type Worktree = {
  path: string;
  head?: string;
  branch?: string;
  prunable?: boolean;
  /** commits on this branch beyond the trunk — 0 means nothing was done here */
  commits?: number;
};

export type Fixture = {
  generatedAt: string;
  repoPath: string;
  nameWithOwner: string;
  masterHead: string;
  trunk: string;
  home: string;
  handle?: string;
  worktreesDir?: string;
  roadmap: {
    slug: string; title: string; blurb: string;
    decisions: Decision[]; stages: Stage[];
    /** the ref treated as newest */
    ref: string;
    /** every ref merged to build this view */
    refs: string[];
    /** stages recorded in prose as needed but not yet in the checklist */
    discovered: { headline: string; body: string }[];
  };
  /** where the newest roadmap lives, and whether anything disagrees */
  head: {
    ref: string; branch: string | null; oid: string; ahead: number;
    alsoOn: string[];
    candidates: { branch: string; ahead: number }[];
    diverged: { branch: string; ahead: number }[];
  };
  pinnedRef: string | null;
  /** every roadmap in this repo */
  roadmaps: string[];
  /** every version of the roadmap that exists right now */
  availableRefs: {
    ref: string;
    kind: 'trunk' | 'branch' | 'worktree' | 'merged';
    label: string;
    sublabel: string;
    ahead: number;
    pr: number | null;
    worktreePath: string | null;
    when: string | null;
    subject: string | null;
  }[];
  decisionDrift: DecisionDrift[];
  liveSessions: LiveSession[];
  worktrees: Worktree[];
  prs: PR[];
  sessions: Session[];
};

/**
 * The five states that matter at a glance.
 *   done    — merged and on master
 *   in_pr   — a PR is open; what matters is CI, review, mergeability
 *   running — someone is working it right now (worktree + session), no PR yet
 *   blocked — a dependency hasn't landed
 *   ready   — startable today
 */
export type Status = 'done' | 'in_pr' | 'running' | 'blocked' | 'ready';

/** Where a stage sits on the pipeline. */
export type Phase = 'landed' | 'in_review' | 'in_flight' | 'ready' | 'blocked';

/** Why it sits there / what starting it would cost. */
export type Verdict = 'landed' | 'active' | 'free' | 'stackable' | 'contested' | 'blocked';

export type Reason = { kind: 'good' | 'warn' | 'bad' | 'info'; text: string };

export type StageView = Stage & {
  status: Status;
  /** the live session waiting on you, if any — drives the "your turn" indicator */
  yourTurn: Session | null;
  /** a live session that is currently working */
  busy: Session | null;
  /** deps whose PR is open but unmerged — you would branch on top of these */
  stackOn: string[];
  /** the actual branches to stack on — what a launch passes as its base */
  stackOnBranches: string[];
  /** deps that haven't landed at all */
  waitingOn: string[];
  waitingOnStages: { num: string; title: string }[];
  phase: Phase;
  verdict: Verdict;
  reasons: Reason[];
  pr: PR | null;
  /** how the PR was found. 'trailer' is declared; the rest are guesses. */
  prMatchedBy: 'trailer' | 'branch' | 'title' | null;
  sessions: Session[];
  worktree: Worktree | null;
  /** stages that cannot start until this one lands */
  unblocks: string[];
  /** in-flight stages sharing a decision with this one */
  contestedWith: { stage: string; decisions: string[] }[];
  depth: number;
};
