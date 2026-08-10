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

## The skills

The tool ships three Claude Code skills and **does not work properly without them** —
*Start this phase* hands its generated preamble to `/roadmap-next-stage`, and the format
they define is what the tool reads. So **installing the package installs them**, into
`~/.claude/skills`, as a `postinstall` step. Restart Claude Code to pick them up.

It only ever creates links it can later remove, and refuses to touch anything it didn't
create. To undo: `roadmap-tool --uninstall-skills`.

The one exception is `npx`, which fetches into a cache npm may prune later — linking into
that would leave broken links behind. Those runs print the command instead:

```bash
npx github:nocommentcode/roadmap-tool --install-skills
```

Both names are prefixed `roadmap-` so they don't collide with a `/next-stage` you may
already have.

- **`/roadmap-author`** — designing a roadmap: decomposing into stages and shaping the
  dependency graph so work can run in parallel without breaking cohesive units
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

`roadmap-tool` is only on your `PATH` if you installed it globally. Otherwise use
whichever copy you have:

```bash
roadmap-tool --uninstall-skills                        # global install
npx github:nocommentcode/roadmap-tool --uninstall-skills   # npx
node /path/to/roadmap-tool/server/index.mjs --uninstall-skills   # a clone
```

Then remove the package itself:

```bash
npm uninstall -g roadmap-tool        # global
npm cache clean --force              # npx — clears the whole npm cache
rm -rf /path/to/roadmap-tool         # a clone
```

Do the skills **first**. Remove the package and the links are left dangling, pointing at
a path that no longer exists.

## Development

```bash
npm run dev          # Vite (5290) + server (5291)
npm run typecheck
npm run snapshot     # dump current state to JSON, for offline work
```

`NOTES.md` records the UI design decisions and why the rejected variants were rejected.
