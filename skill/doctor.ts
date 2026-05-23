#!/usr/bin/env bun
/**
 * pai-hooks doctor — audit every git repo under a scan root to determine
 * whether the guardrails personal-hooks layer will fire there.
 *
 * Three categories per repo:
 *   chain-enrolled — no local core.hooksPath override; wt + guardrails fire normally
 *   bypass         — local core.hooksPath set (Husky/lefthook/.githooks/etc.);
 *                    guardrails will NOT fire unless explicitly shimmed
 *   opt-out        — repo path is in ~/.git-hooks-personal/.opt-out OR has .no-personal-hooks
 */

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

type RepoCategory = 'chain-enrolled' | 'bypass' | 'opt-out';

interface RepoReport {
  path: string;
  category: RepoCategory;
  hooksPath: string | null;
  hookSystem: string | null;
  reason: string;
}

const HOME = homedir();
const DEFAULT_ROOT = join(HOME, 'Documents', 'GitHub');
const PERSONAL_DIR = join(HOME, '.git-hooks-personal');
const OPT_OUT_FILE = join(PERSONAL_DIR, '.opt-out');

function parseArgs(argv: string[]): { root: string; json: boolean; help: boolean } {
  let root = DEFAULT_ROOT;
  let json = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') {
      const v = argv[i + 1];
      if (!v) {
        console.error('pai-hooks doctor: --root requires a path');
        process.exit(2);
      }
      root = resolve(v);
      i++;
    } else if (a === '--json') {
      json = true;
    } else if (a === '--help' || a === '-h') {
      help = true;
    } else {
      console.error(`pai-hooks doctor: unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return { root, json, help };
}

function readOptOut(): Set<string> {
  if (!existsSync(OPT_OUT_FILE)) return new Set();
  return new Set(
    readFileSync(OPT_OUT_FILE, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))
      .map((l) => {
        try {
          return realpathSync(resolve(l));
        } catch {
          return resolve(l);
        }
      }),
  );
}

function findGitRepos(root: string, depth = 0, maxDepth = 5): string[] {
  if (depth > maxDepth) return [];
  if (!existsSync(root)) return [];
  let stat;
  try {
    // lstat: don't follow symlinks. Prevents escaping the requested root.
    stat = lstatSync(root);
  } catch {
    return [];
  }
  if (stat.isSymbolicLink()) return [];
  if (!stat.isDirectory()) return [];

  // A path containing `.git` (file OR directory) is a repo entry; stop descending.
  // Worktrees have `.git` as a file pointing to the canonical, so existsSync alone is fine.
  if (existsSync(join(root, '.git'))) {
    return [root];
  }

  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  for (const e of entries) {
    if (e.startsWith('.')) continue;
    if (e === 'node_modules' || e === 'venv' || e === '.venv') continue;
    out.push(...findGitRepos(join(root, e), depth + 1, maxDepth));
  }
  return out;
}

function getRepoHooksPath(repo: string): string | null {
  // Use git itself to resolve hooksPath. Handles worktrees (.git is a file),
  // submodules (.git points to parent's modules/), bare repos, sparse-checkouts.
  try {
    const out = execFileSync('git', ['-C', repo, 'config', '--local', '--get', 'core.hooksPath'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    return out.trim() || null;
  } catch {
    // Exit code 1 means key not set; any other failure (not a repo, etc.) also falls through.
    return null;
  }
}

function detectHookSystem(repo: string, hooksPath: string | null): string | null {
  if (hooksPath) {
    if (hooksPath.includes('.husky')) return 'husky';
    if (hooksPath.includes('.githooks')) return 'custom (.githooks/)';
    if (hooksPath.includes('lefthook')) return 'lefthook';
    return `custom (${hooksPath})`;
  }
  if (existsSync(join(repo, '.husky'))) return 'husky (.husky present)';
  if (existsSync(join(repo, '.pre-commit-config.yaml'))) return 'pre-commit framework';
  if (existsSync(join(repo, 'lefthook.yml')) || existsSync(join(repo, 'lefthook.yaml'))) {
    return 'lefthook (config present)';
  }
  return null;
}

function categorize(repo: string, optOut: Set<string>): RepoReport {
  // Canonicalize: resolve symlinks (e.g. macOS /var → /private/var) so reported
  // paths match what `git rev-parse --show-toplevel` returns. This keeps doctor
  // output usable as direct input to other git commands and makes .opt-out
  // matching predictable on macOS.
  let absRepo: string;
  try {
    absRepo = realpathSync(resolve(repo));
  } catch {
    absRepo = resolve(repo);
  }

  // Opt-out checks: only user-owned .opt-out file. We deliberately do NOT
  // honor any in-repo marker — a hostile repo must not be able to disable
  // user-level security checks by committing a file.
  if (optOut.has(absRepo)) {
    return {
      path: absRepo,
      category: 'opt-out',
      hooksPath: null,
      hookSystem: null,
      reason: 'listed in ~/.git-hooks-personal/.opt-out',
    };
  }

  // Resolve hooksPath via git itself — handles worktrees (.git is a file
  // pointing to canonical), submodules, bare repos, and sparse-checkouts.
  const hooksPath = getRepoHooksPath(absRepo);

  const hookSystem = detectHookSystem(absRepo, hooksPath);

  if (hooksPath) {
    return {
      path: absRepo,
      category: 'bypass',
      hooksPath,
      hookSystem,
      reason: `local core.hooksPath=${hooksPath} overrides global (wt + guardrails skipped)`,
    };
  }

  return {
    path: absRepo,
    category: 'chain-enrolled',
    hooksPath: null,
    hookSystem,
    reason: 'no local hooksPath override; wt → guardrails → per-repo chain fires',
  };
}

function shimSnippet(_report: RepoReport): string {
  // Fail-CLOSED: personal hook failures abort the commit/push, matching
  // guardrails' blocking contract.
  return [
    '# Insert near the top of the repo\'s hook entrypoint:',
    'if [ -x "$HOME/.git-hooks-personal/$(basename "$0")" ]; then',
    '  "$HOME/.git-hooks-personal/$(basename "$0")" "$@" || exit $?',
    'fi',
  ].join('\n');
}

function colorize(s: string, code: number): string {
  if (!process.stdout.isTTY) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

function categoryBadge(c: RepoCategory): string {
  switch (c) {
    case 'chain-enrolled':
      return colorize('✓ enrolled', 32);
    case 'bypass':
      return colorize('✗ bypass  ', 33);
    case 'opt-out':
      return colorize('— opt-out ', 90);
  }
}

function renderHuman(reports: RepoReport[], root: string): void {
  const enrolled = reports.filter((r) => r.category === 'chain-enrolled');
  const bypass = reports.filter((r) => r.category === 'bypass');
  const optOut = reports.filter((r) => r.category === 'opt-out');

  console.log(`pai-hooks doctor — scan root: ${root}`);
  console.log(
    `  ${reports.length} repos | ${colorize(String(enrolled.length), 32)} enrolled | ${colorize(String(bypass.length), 33)} bypass | ${colorize(String(optOut.length), 90)} opt-out`,
  );
  console.log();

  if (bypass.length > 0) {
    console.log(colorize('bypass — guardrails will NOT fire in these repos:', 33));
    for (const r of bypass) {
      const rel = relative(root, r.path) || r.path;
      console.log(`  ${categoryBadge(r.category)}  ${rel}`);
      console.log(`     hookSystem: ${r.hookSystem ?? 'unknown'}`);
      console.log(`     hooksPath:  ${r.hooksPath}`);
      console.log(`     fix:        add this to ${r.hooksPath ? join(r.hooksPath, '<hook>') : 'the repo\'s hook entrypoint'}:`);
      for (const line of shimSnippet(r).split('\n')) {
        console.log(`                 ${line}`);
      }
      console.log();
    }
  }

  if (enrolled.length > 0) {
    console.log(colorize('enrolled — guardrails fires via wt chain:', 32));
    for (const r of enrolled) {
      const rel = relative(root, r.path) || r.path;
      console.log(`  ${categoryBadge(r.category)}  ${rel}${r.hookSystem ? `   (also: ${r.hookSystem})` : ''}`);
    }
    console.log();
  }

  if (optOut.length > 0) {
    console.log(colorize('opt-out — explicitly skipped:', 90));
    for (const r of optOut) {
      const rel = relative(root, r.path) || r.path;
      console.log(`  ${categoryBadge(r.category)}  ${rel}   (${r.reason})`);
    }
  }
}

function help(): void {
  console.log(`pai-hooks doctor — audit guardrails coverage across local git repos

usage: pai-hooks doctor [--root <PATH>] [--json] [--help]

options:
  --root <PATH>   Override scan root (default: ~/Documents/GitHub)
  --json          Emit JSON instead of human-readable output
  --help, -h      Show this message
`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help) {
    help();
    return;
  }

  const root = args.root;
  if (!existsSync(root)) {
    console.error(`scan root does not exist: ${root}`);
    process.exit(2);
  }

  const optOut = readOptOut();
  const repos = findGitRepos(root);
  const reports = repos.map((r) => categorize(r, optOut)).sort((a, b) => a.path.localeCompare(b.path));

  if (args.json) {
    console.log(JSON.stringify({ root, reports }, null, 2));
    return;
  }

  renderHuman(reports, root);
}

main();
