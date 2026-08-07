# The pull request body format

A roadmap stage's PR is read by people **and** by `roadmap-tool`. The trailer is the
machine-readable part; everything above it is for reviewers.

## Template

```markdown
<one paragraph: what exists once this lands, lifted from the brief's Goal>

## Tasks

- [x] The first chunk of work
- [x] The second
- [ ] Deliberately deferred — say why, or delete the line

## Decisions settled here

- **D6** — <headline>. Added to the Decision index in this PR.
- **D2** — reworded: was "<old>", now "<new>". Also binds: sync, tui.

## Roadmap changes

<Only when the roadmap itself moved. Splits, renames, renumbering, new discovered
work. Reviewers need this called out — it is the part that affects other people's
in-flight branches.>

## Review notes

<Anything a reviewer needs that the diff doesn't say. Where to start, what is
mechanical, what is load-bearing.>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Roadmap-Stage: espresso/brew-log
```

## The trailer

```
Roadmap-Stage: <roadmap-slug>/<stage-key>
```

Rules, all of them load-bearing:

1. **Last block of the body**, after any generated-with line. Trailers go at the bottom,
   like `Co-Authored-By`.
2. **Its own line**, nothing before it on that line. A mention inside a sentence is
   deliberately not matched, so you can write *about* the trailer in prose.
3. **`<slug>/<key>`** — the roadmap directory name, then the stage key. Not the number.
   `espresso/brew-log`, never `espresso/03`.
4. **Repeat for several stages.** One line each:
   ```
   Roadmap-Stage: espresso/scaffold
   Roadmap-Stage: espresso/storage
   ```
5. **Add it when the PR is opened**, not when it is finished. It is a link, and a link
   is worth most while the work is in flight.

## Why it exists

Without it, a tool has to guess which PR belongs to which stage, and every available
guess is wrong sooner or later:

| Guess | Fails when |
|---|---|
| branch name == stage key | the stage is renamed after the branch exists, leaving the branch named for the stage it used to be |
| "Stage 06" in the title | any split renumbers it; the title now points at a different stage |
| the brief's filename | it has a number prefix, which changes |

All three of these failed on a real roadmap inside one week. The trailer is the only
link that survives a rename, a renumber, and a rebase.

## Adding it to an existing PR

```bash
gh pr edit <n> --body "$(gh pr view <n> --json body --jq .body)

Roadmap-Stage: espresso/brew-log"
```

Check it took:

```bash
gh pr view <n> --json body --jq '.body' | grep '^Roadmap-Stage:'
```

## Auditing a whole roadmap

Every open PR for a stage should carry one:

```bash
gh pr list --state open --json number,title,body \
  --jq '.[] | select((.body // "") | test("(?m)^Roadmap-Stage:") | not) | "#\(.number) \(.title)"'
```

Anything listed is a PR the tool is guessing about. `roadmap-tool` also flags it on the
row: *"matched by title only — add Roadmap-Stage: …"*.

## Titles

Titles are for humans, so keep the number in them:

```
Stage 03: logging a brew
```

The tool falls back to parsing `Stage <nn>` from the title when there is no trailer, but
treats it as a warning, not an answer.
