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
import { readRoadmap, readDecisionDrift, readStageKeys } from './sources/roadmap.mjs';
import { listRoadmapRefs } from './refs.mjs';
import { readGit, resolveRoadmapHead, fetchTrunk } from './sources/git.mjs';
import { readGithub } from './sources/github.mjs';
import { readSessions, SESSIONS_DIR } from './sources/claude.mjs';
import { listAllRoadmaps } from './config.mjs';
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
    this.docsWatchers = [];
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
      roadmaps: this.config.roadmaps ?? [roadmap.slug],
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
        case 'git': {
          const before = (this.parts.git?.worktrees ?? []).map((w) => w.path).sort().join('\n');
          this.parts.git = await readGit(this.config);
          const wtPaths = this.parts.git.worktrees.map((w) => w.path);

          // A roadmap can exist only in a worktree — authored on a branch that hasn't
          // landed — so the list of roadmaps is a live question, not a startup constant.
          const roadmaps = listAllRoadmaps(this.config.repo, wtPaths);
          if (JSON.stringify(roadmaps) !== JSON.stringify(this.config.roadmaps)) {
            this.config.roadmaps = roadmaps;
          }

          const worktreesChanged = wtPaths.sort().join('\n') !== before;
          if (worktreesChanged) this.watchDocs();
          // Re-resolving is cheap; re-reading the roadmap is not. Re-read when the
          // resolved head actually moved, when the worktree set changed (a worktree ref
          // may have appeared or gone), or when the last read failed and left us empty.
          const headMoved = await this.resolveHead();
          if (headMoved || worktreesChanged || !this.parts.roadmap) {
            const reason = headMoved ? 'roadmap head moved' : worktreesChanged ? 'worktrees changed' : 'roadmap retry';
            await this.refresh('roadmap', reason);
          }
          break;
        }
        case 'roadmap': {
          if (!this.parts.head) await this.resolveHead();
          this.parts.refs = await listRoadmapRefs(this.config, {
            head: this.parts.head,
            prs: this.parts.github?.prs ?? [],
            worktrees: this.parts.git?.worktrees ?? [],
            historyLimit: this.config.historyLimit ?? 40,
          });

          // ONE version, always — never a union. A merge of several refs is a union, and
          // a union cannot express a stage a branch DELETED, so it shows work that no
          // longer exists. Default to the newest live version; the UI can pin any other.
          const trunk = this.config.trunk;
          let ref = this.pinnedRef ?? this.parts.head?.ref ?? trunk;
          let roadmap;
          try {
            roadmap = await readRoadmap(this.config, ref);
          } catch (e) {
            // A roadmap still being authored may not exist at the trunk at all — only in
            // a worktree, possibly uncommitted. Fall back to the newest live version
            // that has it. A pinned ref is the user's explicit choice, so it never falls
            // back silently.
            const alt = this.parts.refs.filter((r) => r.ref !== ref && r.kind !== 'history').at(-1);
            if (this.pinnedRef || !alt) throw e;
            roadmap = await readRoadmap(this.config, alt.ref);
            ref = alt.ref;
          }
          roadmap.ref = ref;
          roadmap.refs = [ref];

          // Which of these stages the trunk doesn't have yet — a comparison, not a merge.
          if (ref !== trunk) {
            const onTrunk = await readStageKeys(this.config, trunk).catch(() => null);
            for (const st of roadmap.stages) st.proposedOn = onTrunk && !onTrunk.has(st.key) ? ref : null;
          } else {
            for (const st of roadmap.stages) st.proposedOn = null;
          }

          this.parts.roadmap = roadmap;
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

    this.watchDocs();

    // ── poll: git and github
    this.timers.push(setInterval(() => this.refresh('git'), this.config.poll?.git ?? 5000));
    this.timers.push(setInterval(() => this.refresh('github'), this.config.poll?.github ?? 60000));
  }

  /**
   * Watch this roadmap's directory in every working tree that has one, replacing any
   * previous watchers. The main checkout is not special: a roadmap may exist only in a
   * worktree, and edits there should show up just as instantly.
   */
  watchDocs() {
    this.docsWatchers.forEach((w) => w.close());
    this.docsWatchers = [];
    const roots = new Set([this.config.repo, ...(this.parts.git?.worktrees ?? []).map((w) => w.path)]);
    const onDocs = debounce(() => this.refresh('roadmap', 'roadmap docs'), 300);
    for (const root of roots) {
      const docs = path.join(root, 'docs/roadmaps', this.config.slug);
      if (!fs.existsSync(docs)) continue;
      try { this.docsWatchers.push(fs.watch(docs, onDocs)); } catch { /* a worktree can vanish mid-scan */ }
    }
  }

  /**
   * Switch to another roadmap in the same repo. Everything roadmap-shaped is derived
   * from the slug, so head, pinned version and the docs watcher all reset.
   */
  async setSlug(slug) {
    if (!this.config.roadmaps?.includes(slug) || slug === this.config.slug) return false;
    log(`roadmap → ${slug}`);
    this.config.slug = slug;
    this.pinnedRef = null;
    this.parts.head = null;
    this.parts.refs = [];
    this.watchDocs();
    await this.refresh('roadmap', 'roadmap switched');
    return true;
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.watchers.forEach((w) => w.close());
    this.docsWatchers.forEach((w) => w.close());
  }
}
