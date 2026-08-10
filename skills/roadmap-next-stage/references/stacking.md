# Stacking roadmap stages

Roadmap stages are dependent by construction — 04 needs 03 — so waiting for each PR to
merge before starting the next serialises the whole roadmap behind review latency.
Stacking is how a roadmap moves at more than one stage per review cycle.

Uses the `gh stack` extension. Read the `gh-stack` skill for the full command surface;
this is the roadmap-specific part.

## When to stack

**Stack** when a dependency's PR is open and unmerged, and your stage genuinely builds
on its code. `roadmap-tool` calls this **Ready · stack on 03**.

**Don't stack** when the dependency is merged (branch off the trunk — a stack with a
merged bottom is pure overhead), or when the stages are independent. `Ready` with no
"stack on" means branch off the trunk.

**Don't stack on a draft.** `roadmap-tool` reads a draft PR as Running, not In PR, for
exactly this reason: it is still being written. A stage depending on a draft reads Blocked
until that PR is marked ready.

**With two unmerged dependencies**, prefer the one that already contains the other — a
single chain beats a fork. If they genuinely diverge, wait for one to land rather than
merging them together to manufacture a base. See step 4 of
[roadmap-next-stage](../SKILL.md).

Stacking couples review: the bottom must land first, and a change to the bottom rebases
everything above it. Only pay that when the code dependency is real.

## Setup, once per machine

```bash
gh extension install github/gh-stack
git config rerere.enabled true        # remember conflict resolutions
git config remote.pushDefault origin  # skip the remote picker
```

## Starting a stacked stage

```bash
# the predecessor's branch is the base, not the trunk
git worktree add ../<repo>-worktrees/<key> -b you/<key> you/<predecessor-key>
gh stack init you/<predecessor-key> you/<key>
```

`init` adopts an existing branch as the stack bottom. If the stack already exists, extend
it instead:

```bash
gh stack checkout <predecessor-pr-number>
gh stack add you/<key>
```

Always pass branch names positionally — a bare `gh stack init` or `add` prompts, and a
prompt hangs an agent.

## Submitting

```bash
gh stack submit --auto
```

`--auto` is mandatory (bare `submit` opens a TUI) and creates PRs as drafts, which
matches the convention of opening roadmap PRs as drafts.

`submit` has **no `--title` or `--body` flags**, and `--auto` generates titles from commit
messages. So fix both afterwards — and this is where the trailer goes:

```bash
gh pr edit <n> \
  --title "Stage <nn>: <stage title>" \
  --body "$(printf '%s\n\n## Tasks\n- [ ] …\n\nRoadmap-Stage: <slug>/<key>\n' "<goal>")"
```

**Every PR in the stack needs its own trailer.** A stack of three stages is three PRs
and three trailers; without them the tool cannot tell which layer is which stage.

## Keeping a stack current

```bash
gh stack sync      # cascade-rebase the whole stack onto the updated trunk
gh stack rebase    # when sync hits conflicts
gh stack view --json
```

Never rebase a stacked branch by hand — it desynchronises the tracking state and the
next `sync` fights you.

After review changes a **lower** layer, navigate down rather than patching around it at
the top:

```bash
gh stack down          # or: gh stack checkout <branch>
# fix, commit
gh stack rebase --upstack
gh stack up
```

## Landing

```bash
gh stack merge --yes            # whole stack, bottom to top, atomically
gh stack merge <pr> --yes       # everything up to and including <pr>
```

`gh pr merge` does not work on stacked PRs. The merge is all-or-nothing: if any layer
can't merge, none do.

## Roadmap edits inside a stack

The roadmap itself is edited on these branches, which makes it the most conflict-prone
file in the stack — every layer ticks its own checkbox in the same list.

- Make a roadmap edit **at the layer it belongs to**, not wherever you happen to be
- Prefer edits that don't renumber. [Split by suffix](../../roadmap-format/references/splitting.md)
  (`04a`, `04b`) rather than renumbering everything after — renumbering touches every
  line of the checklist and conflicts with every layer above
- With `rerere.enabled`, the same checklist conflict resolves itself on later rebases

`roadmap-tool` reads the trunk **and every live branch**, so a stage split at the bottom of
a stack shows up immediately, even though the layers above have never heard of it.

## What the tool shows

- **Ready · stack on 03** — the base to branch from
- **In PR** on several consecutive stages — a stack in review
- the provenance line naming the ref the roadmap was read from, which for a stack is its
  tip
- **Two roadmaps in flight** — two branches editing the roadmap outside each other's
  history. That is not a stack; it is a conflict waiting to happen. Resolve it before
  either lands.
