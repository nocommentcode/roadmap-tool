# roadmap-tool

See where a multi-stage roadmap actually is: which stage is done, which is in review,
which is running right now, which is blocked and by what — and open the Claude session
attached to any of them.

Reads three sources and keeps no database of its own:

- `docs/roadmaps/<slug>/` — stages, dependencies, the decision index
- `git` + `gh` — worktrees, branches, PRs, checks, reviews
- `~/.claude/` — sessions, including which are live and whose turn it is

## Install

Nothing to configure; everything below is detected.

```bash
npm install -g github:nocommentcode/roadmap-tool
cd ~/src/your-repo
roadmap-tool
```

Or without installing:

```bash
npx github:nocommentcode/roadmap-tool
```

Or from a clone, for hacking on it:

```bash
git clone https://github.com/nocommentcode/roadmap-tool && cd roadmap-tool
npm install
npm run dev        # Vite + server, hot reload
```

### Requirements

- **Node 20+**
- **`gh`**, authenticated (`gh auth login`) — PR state comes from it
- **Claude Code**, for the session features
- a terminal emulator, for launching sessions. Linux: ptyxis, kitty, wezterm,
  alacritty, foot, gnome-terminal, konsole, xterm. macOS: Terminal.app via
  `osascript`. Override with `--terminal <bin>`.

## Usage

```
roadmap-tool [options]

  -C, --repo <path>        Repository to read. Default: the current directory.
  -r, --roadmap <slug>     Which roadmap under docs/roadmaps/. Default: the only
                           one, or list them and exit if there are several.
  -p, --port <n>           HTTP port. Default: 5290.
      --trunk <branch>     Trunk branch. Default: detected from origin/HEAD.
      --handle <name>      Branch prefix for new branches, as <handle>/<stage>.
                           Default: the prefix your existing branches use.
      --worktrees <path>   Where to create worktrees.
                           Default: <repo>-worktrees alongside the repo.
      --terminal <bin>     Terminal emulator to launch sessions in.
      --no-open            Don't open a browser on start.
```

Detection means teammates usually need no flags: trunk comes from `origin/HEAD` (so
`main` works), the handle from the prefix your branches already use, and the roadmap
from the only one in the repo.

Two roadmaps? It lists them and asks. Run one server per roadmap on different ports.

### Optional config

`roadmap.config.json` **in the repo being read** — every field is optional and every one
has a flag:

```json
{
  "slug": "espresso",
  "trunk": "main",
  "handle": "tobi",
  "worktreesDir": "/home/tobi/worktrees",
  "poll": { "git": 5000, "github": 60000 }
}
```

## The skills — install these

The tool ships two Claude Code skills, and **it does not work properly without them.**
They are what write the format it reads, and the *Start this phase* button hands its
generated preamble straight to `/roadmap-next-stage`. Without them installed, a launched
session opens with `Unknown command: /roadmap-next-stage` and no idea what it is meant
to do.

```bash
roadmap-tool --install-skills
```

Not automatic: installing a CLI shouldn't rewrite your Claude config behind your back.
It symlinks into `~/.claude/skills`, refuses to touch anything it didn't create, and the
tool prints a reminder on startup while they're missing.

Undo with `roadmap-tool --uninstall-skills` — it removes only links it created.

Both names are prefixed `roadmap-` so they don't collide with a `/next-stage` you may
already have.

- **`/roadmap-format`** — ROADMAP.md structure, brief frontmatter, the decision index,
  the `Roadmap-Stage:` PR trailer, splitting, and a maintenance/audit reference
- **`/roadmap-next-stage`** — starting a stage: pick the ref, re-ground the brief, create
  the worktree on the right base, open the draft PR with its trailer

## The roadmap format, in short

```markdown
---
stage: brew-log          # identity — the filename stem, never the number
depends_on: [storage]    # stage KEYS; the single source of blocked status
decisions: [D2, D3]
---
```

and every PR ends with

```
Roadmap-Stage: espresso/brew-log
```

`depends_on` is what makes "Blocked by 04" correct. The trailer is what makes
"this PR is stage 03" correct without guessing.

**Claude owns roadmap edits, not this UI.** The tool is read-only over your files; when
something needs changing it launches a session with the context to change it.

## What it does that git and GitHub don't

- **Reads the roadmap from wherever it is newest.** Working a stage rewrites the
  roadmap, so trunk's copy is stale the moment anyone starts. It reads trunk *and* every
  live branch and merges them, so a stage split on one branch shows up even though no
  other branch has heard of it.
- **Knows whose turn it is.** `~/.claude/sessions` says whether each live Claude is
  working or waiting on you.
- **Distinguishes merged from landed.** A merge commit that isn't in the trunk's
  history is flagged, not counted.
- **Finds sessions across worktrees.** `claude --resume` is scoped to one directory;
  this isn't.

## Uninstalling

```bash
roadmap-tool --uninstall-skills      # first: remove the ~/.claude/skills links
npm uninstall -g roadmap-tool        # if you installed globally
```

If you ran it with `npx`, there is nothing to uninstall — but the download stays in
npm's cache, and any skill links point *into* that cache. Remove the links first, then:

```bash
npm cache clean --force              # clears the whole npm cache, npx entries included
```

Order matters: uninstall the skills **before** removing the package, or the links are
left dangling and `--uninstall-skills` can no longer identify them as its own.

## Development

```bash
npm run dev          # Vite (5290) + server (5291)
npm run typecheck
npm run snapshot     # dump current state to JSON, for offline work
```

`NOTES.md` records the UI design decisions and why the rejected variants were rejected.
