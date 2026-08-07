# Design notes

Why this looks the way it does. Written during a UI prototype and kept because the
rejections are more useful than the result.

## The question

> Working a multi-stage roadmap is hard. What should a UI look like that shows where we
> are, tells me **what is safe to run in parallel**, survives pulling a later stage
> forward, links each stage to its PR, and lets me find and launch the Claude session
> that belongs to it?

Three structurally different variants were built and flipped between: a wavefront list
grouped by readiness, a dependency-graph canvas, and a swimlane board. The list won,
but only after two rejections.

## What the rejections taught

1. **Grouping by readiness was wrong.** Stages must always render in phase order —
   position has to be stable enough to build muscle memory on. Readiness is colour and
   wording, never sort order. The "focus startable" affordance dims; it does not re-sort.
2. **Cards and badge strips were unreadable.** The first pass had up to 17 elements per
   row in six colours at 10px. Density killed it. The fix was one plain-English status
   per row and detail chosen by that status.
3. **Tracks complicated more than they explained.** Dropped entirely.
4. **Badges lost to coloured bold text.** Same information, same colour meanings, none
   of the pill chrome.

Final shape: 17px semibold titles, airy rows, five statuses (Done / In PR / Running /
Blocked / Ready), a "your turn" marker, and an expansion whose *content is chosen by
status* rather than one fixed layout.

## Things that turned out to be true

**Claude sessions are already labelled on disk.** Every transcript in
`~/.claude/projects/` carries typed records — `worktree-state`, `pr-link`, `ai-title`,
`last-prompt` — so linking a session to a branch and a PR needs no new instrumentation.
`claude --resume` can't show you them across worktrees only because it is scoped to one
directory.

**"Whose turn is it" is a real reading, not a heuristic.**
`~/.claude/sessions/<pid>.json` carries `status: "idle" | "busy"` per live process. Idle
plus a live pid means Claude has finished its turn and is waiting on you.

**"Merged" is not "landed".** A PR can be merged while its merge commit is not an
ancestor of the trunk — squash-merges, re-landings, rewritten history. Checking ancestry
caught a real instance on the first run.

**No single git ref describes the roadmap.** Working a stage rewrites the roadmap, and a
stage can split itself on its own branch while the trunk and every other branch still
describe the original. The tool therefore reads the trunk *and* every live branch and
merges them by stage key.

**Guessing which PR belongs to which stage never works.** Branch names go stale on a
rename; titles go stale on a renumber; filenames carry a number prefix. All three failed
on a real roadmap inside one week, and the fuzzy version was worse than useless — it
reported unbuilt stages as landed. Hence the `Roadmap-Stage:` trailer.

**Launched sessions inherited their parent's environment.** If the server is started
from inside a Claude session, `CLAUDE_CODE_CHILD_SESSION` and friends leak into the
spawned Claude, which then disables transcript saving — so the tool could not see the
session it had just started. Stripped in `launch.mjs`.

## Deliberate non-goals

- **The UI does not edit the roadmap.** Claude owns roadmap changes; the tool's job is
  to launch a session with the right context. Read-only over your files, by design.
- **No database.** Everything is derived from git, `gh`, the roadmap docs and
  `~/.claude`. Nothing to sync, nothing to drift.
- **No attaching to a running session.** "Open" spawns a second process on the same
  transcript rather than attaching to the first. Real re-attachment would mean running
  sessions inside tmux; not done.
