---
name: roadmap-format
description: The file format for multi-stage roadmaps — ROADMAP.md structure, per-brief frontmatter, the decision index, and the PR trailer that links a pull request to the stage it closes. Use when authoring or editing a roadmap, adding or splitting a stage, writing a stage brief, opening a PR for a roadmap stage, or when roadmap-tool reports a stage it cannot resolve.
---

# Roadmap format

A roadmap is a directory of Markdown that is **both** a document people read and a
structure tools parse. Everything below is load-bearing: `roadmap-tool` reads these
files to work out what is done, what is startable, and which pull request belongs to
which stage.

```
docs/roadmaps/<slug>/
├── ROADMAP.md              index: intro, decision index, stage checklist
├── 01-scaffold.md stage briefs, one per stage
├── 02-sandbox-foundation.md
└── …
```

## The one rule that matters

**A stage's identity is its key, never its number.**

The key is the brief's filename stem without the number: `03-brew-log.md` → `brew-log`.

Numbers are display ordering and they *will* change. The first time a real roadmap split
a stage, it renumbered nine stages and every number-keyed reference broke silently at
that moment — while everything keyed on the stem survived untouched. ([Split by
suffix](references/splitting.md) and nothing downstream moves at all.)

So: **never reference a stage by number in machine-read fields.** Prose may say "stage
06" freely — that is for humans.

## Stage brief frontmatter

Every brief opens with frontmatter:

```markdown
---
stage: brew-log
depends_on: [storage]
decisions: [D2, D3, D14, D16, D17, D18, D19]
---

# 06. The hybrid CLI — write verbs and the sentinel channel

## Goal
…
```

| Field | Required | Meaning |
|---|---|---|
| `stage` | yes | The stage key. **Must equal the filename stem.** If they disagree, the filename wins and the tool warns. |
| `supersedes` | no | Stage keys this one replaces. Set by both halves of a [split](references/splitting.md); it is what lets branches that predate the split keep resolving. |
| `depends_on` | yes | Stage **keys** this cannot start before. `[]` for a free-standing stage — write the empty list rather than omitting it, so "no dependencies" is distinguishable from "nobody filled this in". |
| `decisions` | no | Decision IDs binding this stage. Omit and the tool falls back to scanning the body for `D\d+`, which over-matches prose. |

Renaming a stage means renaming the file **and** the `stage:` field **and** every
`depends_on` that names it. Grep for the old key before committing.

The rest of the brief follows [the brief structure](#stage-brief-structure) below.

## ROADMAP.md structure

Four parsed sections. Prose between them is free-form and encouraged — dependency
*reasoning* belongs in prose; dependency *edges* belong in frontmatter.

### 1. Title and intro

```markdown
# Brain Chat parity roadmap

Realizes [the design](../../design/espresso.md) — one paragraph on scope,
then what is deliberately out of scope.
```

### 2. Decision index

The durable part of a roadmap: decisions that outlive any one stage, so that when one
moves you can see what it drags with it.

```markdown
| ID | Decision | Authored in | Bound by |
|---|---|---|---|
| **D2** | The [[Widget Store]] is **default-deny, strictly subtractive…** | ADR-0001 | brew-log, stats, surface-adaptation |
```

- IDs are `D<n>`, allocated once and **never reused**. A retired decision keeps its row
  and says it is retired — D17 retiring the summary table is more useful than D17
  vanishing.
- The first **bold** phrase is the headline the tool shows. Lead with it.
- **"Bound by" holds stage keys, not numbers.** This column is the single biggest source
  of renumbering churn — a renumbering split forces an edit to every row. Keys make it
  edit-free.

### 3. Stage checklist

```markdown
## Stages

- [x] 01: Segment the narration bubble — [brief](01-scaffold.md)
- [ ] 06: The hybrid CLI — write verbs and the sentinel channel — [brief](03-brew-log.md)
```

`- [x]` means the work is committed on this branch. It does **not** mean landed on
the trunk — the tool takes an open PR as outranking a tick; committed is not merged.

### 4. Found while building (optional)

```markdown
## Found while building, needing its own stage

**A masked credential for a `run_as: system` run.** One paragraph: what was found, why
it was left, and what closing it needs.
```

Work discovered mid-stage that deserves its own stage but has not been scheduled. One
bolded headline per paragraph. The tool surfaces these below the checklist so they do
not rot at the bottom of a file nobody reopens.

## Splitting a stage

A stage that turns out to be two things **splits by suffix**, never by renumbering:
`03-brew-log.md` becomes `03a-brew-log-write.md` and `03b-brew-log-read.md`, and stages
04 onward do not move. Both halves declare `supersedes: [brew-log]`.

This matters because a split happens **on one branch** while the trunk and every other live
branch still describe the original stage — so the truth is genuinely in several places
at once. See [splitting.md](references/splitting.md) for the convention and for how the
tool merges the refs.

## The PR trailer

**A pull request declares the stage it closes.** Without it a tool has to guess from
branch names, and branch names go stale the moment a stage is renamed — `06-brew-log`
is still on branch `you/brew-log`.

End the PR body with a trailer, in the style of `Co-Authored-By`:

```
Roadmap-Stage: espresso/brew-log
```

- Format is `<roadmap-slug>/<stage-key>`.
- **Repeat the line** for a PR closing several stages (a re-landing PR, or two stages too
  small to separate). One line each.
- It goes at the **end of the body**, after the prose and any `🤖 Generated with` line.
- The title should still name the stage for humans: `Stage 06: the hybrid CLI — write
  verbs and the sentinel channel`.

Add it when the PR is opened. To add it to an existing PR:

```bash
gh pr edit <n> --body "$(gh pr view <n> --json body --jq .body)

Roadmap-Stage: espresso/brew-log"
```

## Branch naming

`<handle>/<stage-key>` — so `brew-log` gets `you/brew-log`. This is what links a
worktree to a stage **before** a PR exists.

If a stage is renamed while its branch is alive, either rename the branch or rely on the
trailer once the PR is open. The tool reports which mechanism matched, so a stale branch
name shows up as a warning rather than a wrong answer.

## Stage brief structure

Below the frontmatter, briefs use these headings. Only `## Goal` is parsed (it becomes
the stage's description); the rest is for whoever picks the stage up.

```markdown
# 06. The hybrid CLI — write verbs and the sentinel channel

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

## Checklist for a well-formed roadmap

- [ ] Every brief has `stage:` matching its filename stem
- [ ] Every brief has `depends_on:` as a list of keys (`[]` if none)
- [ ] No machine-read field references a stage number
- [ ] Decision "Bound by" column holds keys
- [ ] Decision IDs are unique and never reused
- [ ] Every open PR for a stage carries its `Roadmap-Stage:` trailer
- [ ] Branch names follow `<handle>/<stage-key>`

## Keeping it correct

`depends_on:` is the **single source of truth for blocked status**. One wrong edge and
the board lies — a blocked stage looks startable, or a startable one looks blocked and
nobody picks it up.

A stage key appears in **seven** places (filename, `stage:`, other briefs' `depends_on:`,
the checklist, the decision index, the branch, PR trailers). Any structural change has
to propagate to all of them, and Markdown will not tell you when it hasn't.

[maintenance.md](references/maintenance.md) has the propagation table — what to update
when you rename, split, add a dependency, move a decision, or finish a stage — plus a
copy-pasteable audit script that catches dangling edges, stem/frontmatter mismatches,
numbers where keys belong, and PRs missing their trailer. **Run the audit after any
structural change.**

## Related

- [splitting.md](references/splitting.md) — splitting a stage across branches
- [maintenance.md](references/maintenance.md) — propagation rules and the audit
- [pr-body.md](references/pr-body.md) — the full PR body format
- [next-stage](../next-stage/SKILL.md) — starting a stage in this format
- [next-stage/stacking](../next-stage/references/stacking.md) — stacked stage PRs
- `roadmap.config.json` — the tool's fallback dependency map, for roadmaps not yet
  carrying frontmatter. Every brief migrated is one entry deleted; the goal is an empty map.
