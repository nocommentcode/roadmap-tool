# Splitting a stage

A stage splits when you start it and find it is two things — usually because half can
land now and half needs something that isn't ready.

## Suffix, don't renumber

`03-brew-log.md` becomes:

```
03a-brew-log-write.md
03b-brew-log-read.md
```

Stages 04 onward **do not move**. This is the whole point: renumbering rewrites every
file in the roadmap, and on a branch that means a conflict with every other branch in
flight. A suffix touches only the stage being split.

Suffixes are `a`, `b`, `c`… in dependency order. Sorting is natural: `03` < `03a` <
`03b` < `04`.

## Declare what it replaces

Each half declares the stage it came from:

```markdown
---
stage: brew-log-write
supersedes: [brew-log]
depends_on: [storage]
decisions: [D2, D3]
---
```

```markdown
---
stage: brew-log-read
supersedes: [brew-log]
depends_on: [brew-log-write]
decisions: [D3]
---
```

`supersedes:` is what lets a tool reading several branches at once understand that
`brew-log` is gone and these two took its place — **without needing every branch to
agree**. A branch that has never heard of the split still names `brew-log` in its
`depends_on:`, and that keeps working: an edge to a superseded stage resolves to its
replacements.

## Repoint dependencies deliberately

Every stage that depended on the original now depends on… which half? Think about each
one; the default is rarely right for all of them.

```yaml
# 04-stats: needed the reading half only
depends_on: [brew-log-read]
```

Stages on **other branches** that you cannot edit keep pointing at `brew-log`. That is
fine — the edge resolves through `supersedes:` to both halves, which is the conservative
reading (blocked until all of it lands). Repoint them when those branches rebase.

## Split the decision index

Open each Decision row whose "Bound by" contains the original key and decide which half
each decision binds. A decision that binds both keeps both.

## The checklist

```markdown
- [x] 03a: Logging a brew — [brief](03a-brew-log-write.md)
- [ ] 03b: Reading the log back — [brief](03b-brew-log-read.md)
- [ ] 04: Summary statistics — [brief](04-stats.md)
```

## Opening a PR for one half

The whole reason to split is to land one half early. The PR for `03a` carries only its
own trailer:

```
Roadmap-Stage: espresso/brew-log-write
```

It also carries the split itself in its diff — the two new briefs, the deleted original,
the checklist change. Call that out under `## Roadmap changes` in the body, because it
affects everyone else's in-flight branches.

## Why the tool reads more than one branch

After this PR is open, the truth is genuinely in two places:

- **the trunk** still describes a single `brew-log` stage
- **the `03a` branch** describes `brew-log-write` and `brew-log-read`
- **a third branch** for stage 06, cut before the split, knows nothing about either

No single ref is correct. `roadmap-tool` therefore reads the trunk **and every live
branch**, and merges by stage key:

- a stage on the trunk and unchanged → shown as is
- a stage that exists only on a branch → shown, marked **proposed on `<branch>`**
- a stage named in another stage's `supersedes:` → hidden, and its replacements say
  what they replaced
- the same stage described differently on two branches → the deepest branch in the stack
  wins, and the row says where the description came from

So splitting does not need coordination. Split on your branch, open the PR for the half
that is ready, and the board reflects it immediately — while still showing the other
branches the stages they actually know about.

## Merging a split back

Nothing special. When the `03a` PR merges, the trunk gains the split, and every other
branch picks it up on its next rebase. Until then the tool has been showing the merged
view all along, so nothing changes visually when it lands.
