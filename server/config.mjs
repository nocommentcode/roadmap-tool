// Where configuration comes from, most specific first:
//   CLI flags  →  environment  →  ./roadmap.config.json  →  detected from the repo
//
// Almost everything is detectable, so the common case is `roadmap-tool` with no
// arguments inside a repo that has exactly one roadmap.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sh, ok } from './util.mjs';

export const USAGE = `
roadmap-tool — see where a multi-stage roadmap actually is

  roadmap-tool [options]

Options
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
                           Default: the first one found.
      --no-open            Don't open a browser on start.
  -h, --help               This.

Environment
  ROADMAP_REPO, ROADMAP_SLUG, PORT  equivalent to --repo, --roadmap, --port

Examples
  roadmap-tool                                  # this repo, its only roadmap
  roadmap-tool -r espresso                      # pick a roadmap by slug
  roadmap-tool -C ~/src/app -r bundling -p 5300
`;

const FLAGS = {
  '-C': 'repo', '--repo': 'repo',
  '-r': 'roadmap', '--roadmap': 'roadmap', '--slug': 'roadmap',
  '-p': 'port', '--port': 'port',
  '--trunk': 'trunk',
  '--handle': 'handle',
  '--worktrees': 'worktrees',
  '--terminal': 'terminal',
};

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { help: true };
    if (a === '--no-open') { out.open = false; continue; }
    const key = FLAGS[a.split('=')[0]];
    if (!key) {
      if (a.startsWith('-')) return { error: `unknown option: ${a}` };
      continue;
    }
    const value = a.includes('=') ? a.split('=').slice(1).join('=') : argv[++i];
    if (value === undefined) return { error: `${a} needs a value` };
    out[key] = value;
  }
  return out;
}

/** main vs master vs whatever this repo actually uses. */
async function detectTrunk(repo) {
  const head = (await sh('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repo)).trim();
  if (head) return head.replace(/^origin\//, '');
  for (const b of ['main', 'master']) {
    if (await ok('git', ['rev-parse', '--verify', `origin/${b}`], repo)) return b;
  }
  return 'master';
}

/** The prefix your branches already use — `alex/foo`, `sam/bar` — else $USER. */
async function detectHandle(repo) {
  const branches = (await sh('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], repo))
    .split('\n')
    .map((b) => b.split('/')[0])
    .filter((p) => p && !p.includes(' '));
  const counts = new Map();
  for (const p of branches) counts.set(p, (counts.get(p) ?? 0) + 1);
  const best = [...counts.entries()].filter(([k]) => k !== 'main' && k !== 'master')
    .sort((a, b) => b[1] - a[1])[0];
  return best?.[0] ?? os.userInfo().username;
}

/** Roadmaps are directories under docs/roadmaps/ containing a ROADMAP.md. */
export function listRoadmaps(repo) {
  const dir = path.join(repo, 'docs/roadmaps');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, 'ROADMAP.md')))
    .sort();
}

export async function resolveConfig(argv, cwd = process.cwd()) {
  const args = parseArgs(argv);
  if (args.help || args.error) return args;

  const repo = path.resolve(args.repo ?? process.env.ROADMAP_REPO ?? cwd);
  if (!fs.existsSync(path.join(repo, '.git'))) {
    return { error: `not a git repository: ${repo}\nPass --repo <path>.` };
  }

  // Optional config, looked up IN the repo being read. A tool-local file is honoured
  // only when it names this same repo — otherwise pointing the CLI at a second repo
  // silently inherits the first one's settings.
  const read = (f) => {
    try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } catch { return null; }
  };
  const local = read(path.join(repo, 'roadmap.config.json'));
  const adjacent = read(path.join(import.meta.dirname, '..', 'roadmap.config.json'));
  const file = local ?? (adjacent && path.resolve(adjacent.repo ?? '') === repo ? adjacent : {}) ?? {};

  const roadmaps = listRoadmaps(repo);
  let slug = args.roadmap ?? process.env.ROADMAP_SLUG ?? file.slug;
  if (!slug) {
    if (roadmaps.length === 1) slug = roadmaps[0];
    else if (roadmaps.length === 0) return { error: `no roadmaps found under ${repo}/docs/roadmaps/` };
    else return { error: `several roadmaps here — pick one with --roadmap:\n${roadmaps.map((r) => `  ${r}`).join('\n')}` };
  }
  if (!roadmaps.includes(slug)) {
    return { error: `no roadmap "${slug}" in ${repo}/docs/roadmaps/\n${roadmaps.map((r) => `  ${r}`).join('\n')}` };
  }

  return {
    repo,
    slug,
    roadmaps,
    port: Number(args.port ?? process.env.PORT ?? file.port ?? 5290),
    trunk: args.trunk ?? file.trunk ?? (await detectTrunk(repo)),
    handle: args.handle ?? file.handle ?? (await detectHandle(repo)),
    worktreesDir: path.resolve(args.worktrees ?? file.worktreesDir ?? `${repo}-worktrees`),
    terminal: args.terminal ?? file.terminal ?? null,
    open: args.open ?? file.open ?? true,
    home: os.homedir(),
    dependsOn: file.dependsOn ?? {},
    poll: file.poll ?? {},
  };
}
