// Composes the four sources into one state object and tells listeners when it moves.
//
// Each source refreshes on its own cadence, because they cost wildly different amounts:
//   claude   — watched (fs.watch on the live registry), ~1ms
//   git      — polled every 5s, ~20ms
//   roadmap  — watched (fs.watch on docs/roadmaps/<slug>), ~200ms
//   github   — polled every 60s, ~2s
//
// A refresh only notifies if the composed state actually changed, so an idle repo is
// silent no matter how often we poll.

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { readRoadmap, readDecisionDrift, WORKTREE_PREFIX } from './sources/roadmap.mjs';
import { listRoadmapRefs, MERGED } from './refs.mjs';
import { mergeRoadmaps } from './merge.mjs';
import { readGit, resolveRoadmapHead, fetchTrunk } from './sources/git.mjs';
import { readGithub } from './sources/github.mjs';
import { readSessions, SESSIONS_DIR } from './sources/claude.mjs';
import { debounce, hash, log } from './util.mjs';

export class RoadmapState extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.parts = {
      roadmap: null, git: null, github: null, claude: null,
      decisionDrift: [], head: null, refs: [],
    };
    /** which version the UI picked; null = the merged view */
    this.pinnedRef = null;
    this.state = null;
    this.stateHash = null;
    this.timers = [];
    this.watchers = [];
    this.refreshing = new Set();
    /** a refresh asked for while one was in flight — run it after, don't drop it */
    this.pending = new Set();
  }

  compose() {
    const { roadmap, git, github, claude, decisionDrift, head, refs } = this.parts;
    if (!roadmap || !git || !github || !claude) return null;
    return {
      generatedAt: new Date().toISOString(),
      repoPath: this.config.repo,
      nameWithOwner: github.nameWithOwner,
      trunk: this.config.trunk,
      home: this.config.home,
      handle: this.config.handle,
      worktreesDir: this.config.worktreesDir,
      masterHead: git.masterHead,
      head: head ?? { ref: this.config.trunk, ahead: 0, candidates: [], diverged: [] },
      pinnedRef: this.pinnedRef,
      availableRefs: refs,
      roadmap,
      decisionDrift,
      liveSessions: claude.liveSessions,
      worktrees: git.worktrees,
      prs: github.prs,
      sessions: claude.sessions,
    };
  }

  /** Recompose and emit only if something actually moved. `generatedAt` is excluded. */
  publish(reason) {
    const next = this.compose();
    if (!next) return;
    const { generatedAt, ...material } = next;
    const h = hash(material);
    if (h === this.stateHash) return;
    this.stateHash = h;
    this.state = next;
    log(`state changed (${reason})`);
    this.emit('change', next);
  }

  /** Recompute which ref holds the newest roadmap. Returns true if it moved. */
  async resolveHead() {
    const prs = this.parts.github?.prs ?? [];
    const head = await resolveRoadmapHead(this.config, {
      openPRBranches: prs.filter((p) => p.state === 'OPEN').map((p) => p.headRefName),
      mergedPRBranches: prs.filter((p) => p.state === 'MERGED').map((p) => p.headRefName),
      worktreeBranches: (this.parts.git?.worktrees ?? []).map((w) => w.branch).filter(Boolean),
    });
    const moved = head.ref !== this.parts.head?.ref || head.oid !== this.parts.head?.oid;
    this.parts.head = head;
    if (moved) log(`roadmap head → ${head.ref}${head.ahead ? ` (+${head.ahead} ahead of master)` : ''}`);
    return moved;
  }

  async refresh(source, reason = source) {
    // A slow gh call must not stack up — but a request that arrives mid-flight cannot
    // just be dropped either. Dropping it lost the roadmap re-read whenever the head
    // moved during the initial parallel load, leaving the roadmap on the trunk alone.
    if (this.refreshing.has(source)) {
      this.pending.add(source);
      return;
    }
    this.refreshing.add(source);
    const t0 = Date.now();
    try {
      switch (source) {
        case 'claude':
          this.parts.claude = readSessions({ repo: this.config.repo });
          break;
        case 'git':
          this.parts.git = await readGit(this.config);
          // Re-resolving is cheap; re-reading the roadmap is not. Only re-read when the
          // resolved head actually moved — a new commit on the stack, or a new stack.
          if (await this.resolveHead()) await this.refresh('roadmap', 'roadmap head moved');
          break;
        case 'roadmap': {
          if (!this.parts.head) await this.resolveHead();
          this.parts.refs = await listRoadmapRefs(this.config, {
            head: this.parts.head,
            prs: this.parts.github?.prs ?? [],
            worktrees: this.parts.git?.worktrees ?? [],
          });

          // A pinned version is read alone. That is the point: the merged view unions
          // everything and so cannot represent a stage a branch DELETED, unless its
          // replacement declares `supersedes:`.
          if (this.pinnedRef && this.pinnedRef !== MERGED) {
            this.parts.roadmap = await readRoadmap(this.config, this.pinnedRef);
            this.parts.roadmap.ref = this.pinnedRef;
            this.parts.roadmap.refs = [this.pinnedRef];
            break;
          }
          // Read master AND every live branch: a stage can split itself on its own
          // branch, so no single ref describes the whole roadmap.
          const head = this.parts.head;
          const trunk = this.config.trunk;
          const refs = [...new Set([head?.ref, ...(head?.candidates ?? []).map((c) => c.branch)])]
            .filter((r) => r && r !== trunk);
          const [base, ...rest] = await Promise.all([
            readRoadmap(this.config, trunk).catch(() => null),
            ...refs.map((ref) =>
              readRoadmap(this.config, ref).then((roadmap) => ({ ref, roadmap })).catch(() => null),
            ),
          ]);
          const overlays = rest.filter(Boolean).map((o) => ({
            ...o,
            depth: head?.candidates?.find((c) => c.branch === o.ref)?.ahead ?? 0,
          }));

          // Uncommitted edits, in any worktree, as the deepest overlays — you should
          // see a roadmap you are part-way through editing.
          for (const r of this.parts.refs.filter((x) => x.kind === 'worktree')) {
            const wt = await readRoadmap(this.config, r.ref).catch(() => null);
            if (wt) overlays.push({ ref: r.ref, roadmap: wt, depth: Number.MAX_SAFE_INTEGER });
          }
          this.parts.roadmap = mergeRoadmaps(base, overlays, trunk);
          this.parts.roadmap.ref = head?.ref ?? trunk;
          break;
        }
        case 'github':
          // origin/<trunk> is only as fresh as the last fetch, and everything is
          // measured against it — so refresh the refs on the same slow cadence.
          if (this.config.fetch !== false) await fetchTrunk(this.config.repo, this.config.trunk);
          this.parts.github = await readGithub(this.config);
          // PR state decides which branches count as alive
          if (await this.resolveHead()) await this.refresh('roadmap', 'roadmap head moved');
          break;
      }
      // Once the roadmap is read from the newest ref, "drift" means only genuine
      // divergence: another live branch editing the roadmap outside this one's history.
      if ((source === 'github' || source === 'roadmap') && this.parts.github && this.parts.roadmap) {
        const diverged = this.parts.head?.diverged ?? [];
        this.parts.decisionDrift = diverged.length
          ? await readDecisionDrift(
              this.config,
              this.parts.github.prs.filter((p) => diverged.some((d) => d.branch === p.headRefName)),
              this.parts.roadmap.decisions,
            )
          : [];
      }
      const ms = Date.now() - t0;
      if (ms > 500) log(`refresh(${source}) ${ms}ms`);
      this.publish(reason);
    } catch (e) {
      log(`refresh(${source}) failed:`, e.message);
    } finally {
      this.refreshing.delete(source);
      if (this.pending.delete(source)) await this.refresh(source, `${reason} (coalesced)`);
    }
  }

  async start() {
    const t0 = Date.now();
    // roadmap + git first so drift can compute on github's arrival
    await Promise.all([this.refresh('roadmap'), this.refresh('git'), this.refresh('claude')]);
    await this.refresh('github');
    log(`initial read in ${Date.now() - t0}ms`);

    // ── watch: the live registry. This is what makes "your turn" feel instant.
    const onClaude = debounce(() => this.refresh('claude', 'claude session'), 120);
    if (fs.existsSync(SESSIONS_DIR)) {
      this.watchers.push(fs.watch(SESSIONS_DIR, onClaude));
    }
    // transcripts move constantly while a session runs; a slow tick is enough, and the
    // (mtime, size) cache means unchanged files are never re-read.
    this.timers.push(setInterval(() => this.refresh('claude', 'transcripts'), 2000));

    // ── watch: the roadmap docs
    const docs = path.join(this.config.repo, 'docs/roadmaps', this.config.slug);
    if (fs.existsSync(docs)) {
      const onDocs = debounce(() => this.refresh('roadmap', 'roadmap docs'), 300);
      this.watchers.push(fs.watch(docs, onDocs));
    }

    // ── poll: git and github
    this.timers.push(setInterval(() => this.refresh('git'), this.config.poll?.git ?? 5000));
    this.timers.push(setInterval(() => this.refresh('github'), this.config.poll?.github ?? 60000));
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.watchers.forEach((w) => w.close());
  }
}
