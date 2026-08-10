---
name: roadmap-next-stage
description: Start the next stage of a roadmap — resolve where the roadmap is newest, re-ground the brief against the current codebase, create a worktree on the right base (fresh or stacked), and open a draft PR carrying the stage trailer. Use when the user wants to start, pick up, or begin a roadmap stage, says "next stage", or names a stage to work on.
---

# Start a roadmap stage

One stage is one branch is one PR. This skill takes a stage from "listed in the
roadmap" to "worktree open, brief re-grounded, draft PR carrying its trailer" — with no
step where a tool has to guess which branch belongs to which stage.

Read [roadmap-format](../roadmap-format/SKILL.md) first if you have not; this skill
produces that format.

## 1. Find the current roadmap

**Do not read `docs/roadmaps/<slug>/` from the trunk.** Working a stage rewrites the
roadmap itself — stages split, numbers shift, decisions get added and reworded. The trunk's
copy is stale the moment anyone starts.

```bash
# branches that are alive and carry roadmap commits the trunk lacks
gh pr list --state open --json number,headRefName,title
git worktree list --porcelain
git rev-list --count <trunk>..<branch> -- docs/roadmaps/<slug>/
```

Among those branches, drop any that is an ancestor of another (`git merge-base
--is-ancestor a b`). A stack collapses to its tip — read the roadmap from there.

If two branches remain and neither contains the other, **stop and tell the user**: two
people are editing the roadmap on unrelated branches and they will conflict. Do not pick
one silently.

`roadmap-tool` shows this resolution in its header if it is running.

## 2. Choose the stage

Startable means every `depends_on` key is either landed or has an **open PR you can
stack on**. If the user named a stage, sanity-check it against that and say so if it is
blocked — then let them decide.

Prefer a stage whose in-flight neighbours share no decisions with it. Two stages bound by
the same decision, worked at once, rework together when that decision moves.

## 3. Re-ground the brief

The brief was written before the stages ahead of it landed. **Its task chunking is
provisional and its assumptions may be dead.** Work its `## Re-verify at start` section
against the actual codebase before planning anything.

Check specifically:
- Do the files and symbols it names still exist?
- Have any of its `decisions:` been reworded, retired, or superseded since it was written?
- Did an earlier stage already do part of it?

Report what moved. If enough moved, rewrite the brief and say so — an out-of-date brief
silently followed is worse than one openly rewritten.

## 4. Create the branch

Branch name is `<handle>/<stage-key>` — the key from frontmatter, so `brew-log` gets
`you/brew-log`. This is what links the worktree to the stage before a PR exists.

**Fresh** when every dependency is merged:

```bash
git worktree add ../<repo>-worktrees/<stage-key> -b <handle>/<stage-key> origin/<trunk>
```

**Stacked** when a dependency's PR is open but unmerged — branch on it, not on the trunk:

```bash
git worktree add ../<repo>-worktrees/<stage-key> -b <handle>/<stage-key> <predecessor-branch>
gh stack init <predecessor-branch> <handle>/<stage-key>
```

**Stacking is how a roadmap moves faster than its review latency** — without it every
stage waits for the one below to merge. [stacking.md](references/stacking.md) covers
when to stack, submitting with `--auto`, adding the trailer afterwards (`gh stack submit`
has no `--body`), keeping the stack current, landing it, and how to make roadmap edits
inside a stack without conflicting on every layer.

## 5. Open the draft PR with its trailer

Do this **at the start**, right after the first commit — not at the end. The trailer is
what removes the guessing, and it can only help while the work is in flight.

```bash
gh pr create --draft \
  --title "Stage <nn>: <stage title>" \
  --body "$(cat <<'EOF'
<what this stage does, from the brief's Goal>

## Tasks
- [ ] …

Roadmap-Stage: <slug>/<stage-key>
EOF
)"
```

Or `gh stack submit --auto` for a stacked branch, then `gh pr edit` to fix the
generated title and add the trailer — `submit` has no `--title`/`--body` flags.

**The `Roadmap-Stage:` trailer is not optional.** It is the only link that survives a
stage being renamed after its branch exists.

## 6. Keep the roadmap honest as you go

The roadmap is part of the stage's deliverable, edited on the same branch.

**The one that matters: if you discover a dependency, record it.** Working a stage is
when you find out what it actually needs — a stage you assumed was independent turns out
to need the store, or the half of a split you didn't expect. `depends_on:` is the only
source of blocked status, so an edge you learned about and did not write down means the
board tells the next person something false: a blocked stage reading as Ready, and a
failure hours into it. Add the edge to whichever brief needs it, in the same commit as
the discovery.

The rest:

- Tick `- [x]` when the work is committed
- Add a decision to the index when the stage settles one — new ID, never reused
- If the stage splits, **suffix rather than renumber** (`04` → `04a` + `04b`), give both
  halves `supersedes: [<original-key>]`, and grep for the old key — see
  [splitting](../roadmap-format/references/splitting.md)
- Record anything found-but-not-done under `## Found while building, needing its own stage`
- Leave *existing* `depends_on:` edges alone unless they became wrong — dependencies are
  structural, not progress. Ticking a box is how progress is recorded.
- **Run the [audit](../roadmap-format/references/maintenance.md#the-audit) before you
  finish**, and fix what it finds. It catches dangling edges, a `stage:` that no longer
  matches its filename, numbers where keys belong, and PRs missing their trailer.

## Checklist

- [ ] Roadmap read from the newest ref, not the trunk
- [ ] Dependencies checked; stacking decided deliberately
- [ ] Brief re-grounded and what moved reported
- [ ] Worktree on `<handle>/<stage-key>`
- [ ] Draft PR open, titled with the stage, carrying `Roadmap-Stage:`
- [ ] Brief frontmatter present and correct — `stage:` matches the filename stem,
      `depends_on:` lists every real dependency as keys
- [ ] Any dependency discovered while working is written into `depends_on:`
- [ ] The maintenance audit passes

## Related

- [roadmap-format](../roadmap-format/SKILL.md) — the format this produces
- [roadmap-author](../roadmap-author/SKILL.md) — designing a roadmap's stages and its
  dependency graph
- [stacking.md](references/stacking.md) — stacked stage PRs, start to land
- [maintenance](../roadmap-format/references/maintenance.md) — run its audit before finishing
- `gh-stack` — the full command surface and its non-interactive flags
