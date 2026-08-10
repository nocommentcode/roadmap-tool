---
name: roadmap-format
description: The file format for multi-stage roadmaps — ROADMAP.md structure, per-brief frontmatter, the decision index, and the PR trailer that links a pull request to the stage it closes. Use when authoring or editing a roadmap, adding or splitting a stage, writing a stage brief, opening a PR for a roadmap stage, or when roadmap-tool reports a stage it cannot resolve.
---

# Roadmap format

A roadmap is a directory of Markdown that is **both** a document people read and a
structure tools parse. Everything below is load-bearing: `roadmap-tool` reads these files
to work out what is done, what is startable, and which pull request belongs to which stage.

```
docs/roadmaps/<slug>/
├── ROADMAP.md               index: intro, decision index, stage checklist
├── 01-scaffold.md           stage briefs, one per stage
├── 02-storage.md
├── 03-brew-log.md
└── …
```

## Two rules everything else serves

**1. `depends_on:` is the only source of blocked status.** The tool cannot infer
dependencies — not from stage numbers, not from file order, not from prose. Every
"Blocked by 04", every "Ready", every "stack on 03", and the whole answer to *what can I
safely work on right now* comes from that one field. **This is the feature.** One missing
or wrong edge and the board lies in one of two directions:

- an edge that should exist but doesn't → a **blocked stage advertises itself as Ready**,
  somebody starts it, and it fails on a missing dependency hours in
- an edge that shouldn't exist, or points at a stage that never lands → a **startable
  stage sits marked Blocked** and nobody picks it up

Neither failure announces itself. Markdown does not typecheck, so a dangling
`depends_on` is silent until someone acts on it. Treat editing it with the care you'd
give a function signature everything calls.

**2. A stage's identity is its key, never its number.** The key is the brief's filename
stem without the number: `03-brew-log.md` → `brew-log`.

Numbers are display ordering and they *will* change. The first time a real roadmap split
a stage it renumbered nine of them, and every number-keyed reference broke silently at
that moment — while everything keyed on the stem survived untouched. ([Split by
suffix](references/splitting.md) and nothing downstream moves at all.)

So: **never reference a stage by number in a machine-read field.** Prose may say "stage
03" freely — that is for humans.

## Stage brief frontmatter

Every brief opens with a frontmatter block. This is the part tools read; the prose below
it is for whoever picks the stage up.

```markdown
---
stage: brew-log
depends_on: [storage]
decisions: [D2, D3]
---

# 03. Logging a brew

## Goal
…
```

### `stage:` — required

The stage key. **Must equal the filename stem**, i.e. the filename with its number
prefix and `.md` removed. `03-brew-log.md` → `brew-log`.

If the two disagree the filename wins and the tool warns, because the filename is what
every link in `ROADMAP.md` points at.

Lowercase, hyphenated, and **stable**: this key is what a PR trailer, a branch name and
every other brief's `depends_on:` refer to. Renaming it is a seven-place operation — see
[maintenance.md](references/maintenance.md).

### `depends_on:` — required

A list of stage **keys** this stage cannot start before. Rule 1 above; the field the
whole tool rests on.

```yaml
depends_on: [storage]                    # one dependency
depends_on: [stats-core, hybrid-cli]     # several — all must land
depends_on: []                           # genuinely free-standing
```

Points to get right:

- **Keys, never numbers.** `depends_on: [03]` is broken the moment anything renumbers,
  and broken *silently* — the tool cannot resolve `03` to a stage, so the edge vanishes
  and the stage looks Ready.
- **Write `[]` explicitly** for a stage with no dependencies. An omitted field and an
  empty list look identical to a tool, but they mean different things to a person:
  "nothing blocks this" versus "nobody has filled this in yet". Be explicit so a reviewer
  can tell.
- **Only real code dependencies.** Not "feels like it should come after". An edge that
  isn't real serialises work that could have run in parallel, which is the exact problem
  the tool exists to solve.
- **All of them.** A stage depending on two things that lists one will read as startable
  as soon as that one lands.
- **Edges, not reasoning.** *Why* 04 needs 03 belongs in the ROADMAP prose. The edge
  itself belongs here. The prose is for humans and may be discursive; this must be exact.
- **Re-point it when a dependency splits.** If `stats` becomes `stats-core` +
  `stats-drift`, decide which half you actually need — the answer differs per stage, and
  defaulting to both delays you for no reason. An un-updated edge still resolves, via the
  replacement's `supersedes:`, but conservatively: blocked until *all* halves land.

### `supersedes:` — optional

Stage keys this stage replaces. Set by **both halves of a [split](references/splitting.md)**.

```yaml
stage: stats-core
supersedes: [stats]
```

This is how a removal gets expressed. The tool merges the roadmap across the trunk and
every live branch, and a merge is a *union* — it can add a stage but has no way to know a
branch deleted one. `supersedes:` is that signal. Without it, a stage your branch removed
keeps appearing alongside its replacements, and other branches' `depends_on:` entries
pointing at the old key dangle.

### `decisions:` — optional but recommended

The decision IDs that bind this stage.

```yaml
decisions: [D2, D3]
```

Omit it and the tool falls back to scanning the brief body for `D\d+`, which over-matches
— a passing mention of D7 in a sentence becomes a binding. Listing them explicitly is
what makes "if D2 moves, these stages need re-reading" trustworthy.

## ROADMAP.md structure

Four parsed sections. Prose between them is free-form and encouraged — dependency
*reasoning* belongs in prose, dependency *edges* belong in frontmatter.

### 1. Title and intro

```markdown
# Espresso roadmap

Builds `espresso`, a CLI coffee tracker, from an empty binary to published releases.
One paragraph on scope, then what is deliberately out of scope.
```

### 2. Decision index

The durable part of a roadmap: decisions that outlive any one stage, so that when one
moves you can see what it drags with it.

```markdown
| ID | Decision | Authored in | Bound by |
|---|---|---|---|
| **D2** | **SQLite is the only store.** No JSON files, no config-as-data — one file means one backup story and one migration story. | ADR-0001 | storage, brew-log, sync |
```

- IDs are `D<n>`, allocated once and **never reused**. A retired decision keeps its row
  and says it is retired, pointing at whatever replaced it — a row saying "superseded by
  D9" is far more useful than a gap where D4 used to be.
- The first **bold** phrase is the headline the tool shows. Lead with it.
- **"Bound by" holds stage keys, not numbers** — same reason as `depends_on:`. This column
  is the single biggest source of renumbering churn; keys make it edit-free.

### 3. Stage checklist

```markdown
## Stages

- [x] 01: The CLI skeleton — [brief](01-scaffold.md)
- [x] 02: Local store on SQLite — [brief](02-storage.md)
- [ ] 03: Logging a brew — [brief](03-brew-log.md)
```

`- [x]` means the work is **committed on this branch**. It does *not* mean landed on the
trunk — the tool treats an open PR as outranking a tick, because committed is not merged.

### 4. Found while building (optional)

```markdown
## Found while building, needing its own stage

**A `--dry-run` that actually proves anything.** Every write path grew its own ad-hoc
flag, and none share a code path with the real write. Closing it properly means
threading a transaction-aborting mode through the store. Schedule it before 06.
```

Work discovered mid-stage that deserves its own stage but has not been scheduled. One
bolded headline per paragraph. The tool surfaces these below the checklist so they don't
rot at the bottom of a file nobody reopens.

## Splitting a stage

A stage that turns out to be two things **splits by suffix**, never by renumbering:
`04-stats.md` becomes `04a-stats-core.md` and `04b-stats-drift.md`, and stages 05 onward
do not move. Both halves declare `supersedes: [stats]`.

This matters because a split happens **on one branch** while the trunk and every other
live branch still describe the original stage — so the truth is genuinely in several
places at once. See [splitting.md](references/splitting.md) for the convention and for
how the tool merges the refs.

## The PR trailer

**A pull request declares the stage it closes.** Without it a tool has to guess from
branch names, and a branch name goes stale the moment a stage is renamed — the branch
still carries the name of the stage it used to be.

End the PR body with a trailer, in the style of `Co-Authored-By`:

```
Roadmap-Stage: espresso/brew-log
```

- Format is `<roadmap-slug>/<stage-key>` — the key, never the number.
- **Repeat the line** for a PR closing several stages. One line each.
- It goes at the **end of the body**, after the prose and any `🤖 Generated with` line.
- The title should still name the stage for humans: `Stage 03: logging a brew`.

Add it when the PR is opened. To add it to an existing PR:

```bash
gh pr edit <n> --body "$(gh pr view <n> --json body --jq .body)

Roadmap-Stage: espresso/brew-log"
```

Full body format in [pr-body.md](references/pr-body.md).

## Branch naming

`<handle>/<stage-key>` — so `brew-log` gets `you/brew-log`. This links a worktree to a
stage **before** a PR exists.

If a stage is renamed while its branch is alive, either rename the branch or rely on the
trailer once the PR is open. The tool reports which mechanism matched, so a stale branch
name shows up as a warning rather than a wrong answer.

## Stage brief structure

Below the frontmatter, briefs use these headings. Only `## Goal` is parsed (it becomes
the stage's description); the rest is for whoever picks the stage up.

```markdown
# 03. Logging a brew

## Goal
Two or three sentences. What exists when this stage is done.

## Decisions in force
The decisions this stage must honour, annotated with their IDs, and what each one
constrains here. Note `→ also binds: <keys>` when a decision reaches other stages.

## Proposed tasks (provisional)
A chunking. Explicitly provisional — re-grounded when the stage actually starts.

## If a decision here moves
Which other briefs need editing. The Decision index is the index; this is the detail.

## Re-verify at start
What to check against the codebase before planning, because it may have changed.
```

## Keeping it correct

Rule 1 again, because it is the thing that breaks: **`depends_on:` is the only source of
blocked status, and a wrong edge is silent.**

A stage key appears in **seven** places — the filename, its own `stage:`, other briefs'
`depends_on:`, the checklist link, the decision index, the branch, and PR trailers. Any
structural change has to reach all of them.

[maintenance.md](references/maintenance.md) has the propagation table — what to update
when you rename, split, add a dependency, move a decision, or finish a stage — plus a
copy-pasteable audit script that catches dangling edges, stem/frontmatter mismatches,
numbers where keys belong, and PRs missing their trailer.

**Run that audit after any structural change, and before finishing a stage.**

## Checklist for a well-formed roadmap

- [ ] Every brief has `depends_on:` listing **every** real dependency, as keys, `[]` if none
- [ ] No dangling edge — every key in a `depends_on:` is a stage that exists
- [ ] Every brief has `stage:` matching its filename stem
- [ ] No machine-read field references a stage number
- [ ] Both halves of any split declare `supersedes:`
- [ ] Decision "Bound by" holds keys; IDs are unique and never reused
- [ ] Every open PR for a stage carries its `Roadmap-Stage:` trailer
- [ ] Branch names follow `<handle>/<stage-key>`

## Related

- [splitting.md](references/splitting.md) — splitting a stage across branches
- [maintenance.md](references/maintenance.md) — propagation rules and the audit
- [pr-body.md](references/pr-body.md) — the full PR body format
- [roadmap-next-stage](../roadmap-next-stage/SKILL.md) — starting a stage in this format
- [roadmap-next-stage/stacking](../roadmap-next-stage/references/stacking.md) — stacked stage PRs
- `roadmap.config.json` — the tool's fallback dependency map, for roadmaps not yet
  carrying frontmatter. Every brief migrated is one entry deleted; the goal is an empty map.
