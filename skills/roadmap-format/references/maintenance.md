# Maintaining a roadmap

A roadmap is a graph stored across many files. Change one node and several files go
stale at once — silently, because Markdown does not typecheck.

**The invariant everything else serves:**

> `depends_on:` is the single source of truth for blocked status. If one edge is wrong,
> the board lies — a blocked stage looks startable, or a startable stage looks blocked
> and nobody picks it up.

So after **any** structural change, run the propagation table below and then the audit.

## Where a stage key appears

Seven places. A rename that misses one leaves a dangling edge:

| # | Place | Looks like |
|---|---|---|
| 1 | brief filename | `03-brew-log.md` |
| 2 | brief frontmatter | `stage: brew-log` |
| 3 | other briefs' frontmatter | `depends_on: [brew-log]` |
| 4 | ROADMAP.md checklist | `- [ ] 03: … — [brief](03-brew-log.md)` |
| 5 | Decision index "Bound by" | `… | brew-log, stats, tui |` |
| 6 | the branch | `you/brew-log` |
| 7 | PR trailers | `Roadmap-Stage: espresso/brew-log` |

Prose mentions ("stage 03 does X") are free-form and do not need to be exact — but fix
them when they become actively misleading.

## Propagation table

### Renaming a stage

1. `git mv` the brief to the new stem
2. Update `stage:` inside it
3. **Grep the old key across the whole roadmap directory** and fix every `depends_on:`
4. Update the checklist line's link
5. Update the Decision index "Bound by" cells
6. Rename the branch (`git branch -m`) or rely on the PR trailer
7. Update the trailer on any open PR

```bash
grep -rn "old-key" docs/roadmaps/<slug>/
gh pr list --state open --json number,body --jq '.[] | select(.body|test("old-key")) | .number'
```

### Splitting a stage

The most common structural change — half a stage lands and the rest becomes its own
thing. Full detail in [splitting.md](splitting.md); the propagation is:

1. **Suffix, don't renumber**: `04-stats.md` → `04a-stats-core.md` + `04b-stats-drift.md`.
   Stages 05 onward do not move
2. Both halves get their own key and `supersedes: [<original-key>]`
3. Repoint each `depends_on:` that named the original at the half it actually needs —
   decide per stage; the default is rarely right for all of them
4. Split the Decision index "Bound by" cells: which half does each decision bind?
5. Replace the checklist line with two, in position

> Renumbering is what makes a split expensive: it rewrites every line of the checklist
> and conflicts with every branch in flight. A suffix touches only the stage being split,
> and branches that never heard of it keep resolving through `supersedes:`.

### Adding or removing a dependency

1. Edit `depends_on:` — **the edge only counts here**
2. Update the "Dependencies" prose so the reasoning matches the edges
3. Check for a cycle (the audit below does this)
4. Re-read anything that just became blocked: is its brief still valid, now that it
   waits on something new?

### Moving a decision

1. Edit the row in the Decision index — keep the ID, never reuse it
2. Update the "Bound by" cell if the set of stages changed
3. **Open every brief in "Bound by"** and update its "Decisions in force" wording. A
   brief quoting the old text is worse than one that omits it
4. For each bound stage that is **already in flight**, say so in the PR — its author is
   working from the old wording right now
5. Retiring a decision keeps its row, marked retired, pointing at whatever replaced it

### Finishing a stage

1. Tick `- [x]` in the checklist on the branch
2. Add any decision the stage settled, with a new ID
3. Record anything found-but-not-done under `## Found while building`
4. Leave `depends_on:` alone — dependencies are structural, not progress

### Discovering new work

Either promote it to a stage (full brief + frontmatter + checklist entry) or record it
under `## Found while building, needing its own stage` with one bolded headline. Do not
leave it only in a PR description; nobody rereads those.

## The audit

Run after any structural change, and before finishing a stage.

```bash
cd docs/roadmaps/<slug>

# 1. every brief has frontmatter, and `stage:` matches its filename stem
for f in [0-9]*.md; do
  stem="${f%.md}"; stem="${stem#*-}"
  decl=$(sed -n 's/^stage: *//p' "$f" | head -1)
  [ "$stem" = "$decl" ] || echo "MISMATCH $f: stem=$stem stage=$decl"
  grep -q '^depends_on:' "$f" || echo "NO depends_on: $f"
done

# 2. every depends_on target exists
keys=$(sed -n 's/^stage: *//p' [0-9]*.md | sort -u)
for f in [0-9]*.md; do
  for d in $(sed -n 's/^depends_on: *\[\(.*\)\]/\1/p' "$f" | tr -d ' ' | tr ',' ' '); do
    echo "$keys" | grep -qx "$d" || echo "DANGLING $f depends_on $d"
  done
done

# 3. no machine-read field references a number
grep -n 'depends_on:.*[0-9][0-9]' [0-9]*.md && echo "^ depends_on holds a number, not a key"

# 4. every checklist entry points at a brief that exists
grep -o '\[brief\]([^)]*)' ROADMAP.md | sed 's/.*(\(.*\))/\1/' |
  while read -r b; do [ -f "$b" ] || echo "MISSING brief: $b"; done

# 5. open PRs carry their trailer
gh pr list --state open --json number,title,body \
  --jq '.[] | select((.body // "") | test("(?m)^Roadmap-Stage:") | not) | "NO TRAILER #\(.number) \(.title)"'
```

Cycles are not caught by the script — `roadmap-tool` shows them as stages that never
become startable. If a stage is `Blocked` and its blockers are also `Blocked` forever,
suspect a cycle.

## When the roadmap lives on a branch

Working a stage rewrites the roadmap, so **the newest roadmap is usually not on the
trunk**. When maintaining:

- Make roadmap edits on the stage branch that motivated them, not on the trunk
- Before editing, check whether a *later* branch in the stack already changed the same
  rows — edit at the top of the stack, or you create a conflict the stack has to resolve
- Two branches editing the roadmap outside each other's history will conflict. If you
  need to, do the roadmap edit as its own tiny PR straight onto the trunk and let the
  stacks rebase

`roadmap-tool`'s header names the ref it is reading and warns when two roadmaps are in
flight.
