/**
 * guardrails fixture-based test suite.
 *
 * Run: bun test ~/.git-hooks-personal/tests/guardrails.test.ts
 *
 * Each test spawns a real temp git repo, exercises a hook through the actual
 * shim chain, and asserts on git state + exit codes. No mocks. The repos are
 * disposable; cleanup runs after each test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOKS_HOME = `${process.env.HOME}/.git-hooks-personal`;
// Build the test key at runtime so GitHub's secret scanner doesn't flag this
// source file. Gitleaks still detects the leak inside the test git repo because
// the key is written verbatim to disk there.
const STRIPE_KEY_LIKE = `const k = '${['sk', 'live', '4eC39HqLyjWDarjtT1zdp7dc'].join('_')}';`;

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], opts: SpawnSyncOptions = {}): SpawnResult {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return {
    status: r.status,
    stdout: r.stdout?.toString() ?? '',
    stderr: r.stderr?.toString() ?? '',
  };
}

function git(repo: string, ...args: Array<string | SpawnSyncOptions>): SpawnResult {
  // Last arg may be an options object; if so peel it off.
  let opts: SpawnSyncOptions = {};
  if (args.length > 0 && typeof args[args.length - 1] === 'object') {
    opts = args.pop() as SpawnSyncOptions;
  }
  return run('git', ['-C', repo, ...(args as string[])], opts);
}

function newRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'guardrails-test-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'guardrails-test');
  return dir;
}

function cleanup(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function commitCount(repo: string): number {
  const r = git(repo, 'rev-list', '--count', 'HEAD');
  if (r.status !== 0) return 0;
  return Number.parseInt(r.stdout.trim(), 10);
}

describe('R5 — gitleaks baseline cannot be weakened by hostile repo .gitleaks.toml', () => {
  let repo: string;
  beforeEach(() => { repo = newRepo(); });
  afterEach(() => cleanup(repo));

  test('hostile repo .gitleaks.toml allowing everything still blocks via baseline', () => {
    writeFileSync(join(repo, '.gitleaks.toml'), `
title = "hostile"
[extend]
useDefault = true
[[allowlists]]
description = "block nothing"
regexes = ['''.*''']
`);
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', 'leak.ts', '.gitleaks.toml');
    const r = git(repo, 'commit', '-m', 'feat: add');
    expect(r.status).not.toBe(0);
    expect(commitCount(repo)).toBe(0);
  });

  test('SKIP_GITLEAKS=1 bypasses gitleaks but other checks still run', () => {
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', 'leak.ts');
    const r = git(repo, 'commit', '-m', 'feat: ok', { env: { ...process.env, SKIP_GITLEAKS: '1' } });
    expect(r.status).toBe(0);
  });
});

describe('R6 — branch-guard list-vs-regex API', () => {
  const guard = `${HOOKS_HOME}/checks/branch-guard.sh`;
  const ZERO = '0'.repeat(40);
  const ONE = '1'.repeat(40);

  function runGuard(stdin: string, env: Record<string, string> = {}): SpawnResult {
    return run(guard, [], {
      input: stdin,
      env: { ...process.env, ...env },
    });
  }

  test('default regex blocks main', () => {
    const r = runGuard(`refs/heads/main ${ONE} refs/heads/main ${ZERO}\n`);
    expect(r.status).toBe(1);
  });
  test('default regex does NOT match "domain" (substring concern)', () => {
    const r = runGuard(`refs/heads/domain ${ONE} refs/heads/domain ${ZERO}\n`);
    expect(r.status).toBe(0);
  });
  test('default regex does NOT match "feature-main"', () => {
    const r = runGuard(`refs/heads/feature-main ${ONE} refs/heads/feature-main ${ZERO}\n`);
    expect(r.status).toBe(0);
  });
  test('LIST mode: comma-separated exact match', () => {
    const r = runGuard(`refs/heads/develop ${ONE} refs/heads/develop ${ZERO}\n`, {
      PROTECTED_BRANCHES_LIST: 'main,develop',
    });
    expect(r.status).toBe(1);
  });
  test('LIST mode: "main" does NOT match "domain"', () => {
    const r = runGuard(`refs/heads/domain ${ONE} refs/heads/domain ${ZERO}\n`, {
      PROTECTED_BRANCHES_LIST: 'main',
    });
    expect(r.status).toBe(0);
  });
  test('tag pushes are ignored', () => {
    const r = runGuard(`refs/tags/v1 ${ONE} refs/tags/v1 ${ZERO}\n`);
    expect(r.status).toBe(0);
  });
  test('branch deletions are ignored', () => {
    const r = runGuard(`refs/heads/main ${ZERO} refs/heads/main ${ONE}\n`);
    expect(r.status).toBe(0);
  });
  test('ALLOW_PROTECTED_PUSH=1 bypasses', () => {
    const r = runGuard(`refs/heads/main ${ONE} refs/heads/main ${ZERO}\n`, {
      ALLOW_PROTECTED_PUSH: '1',
    });
    expect(r.status).toBe(0);
  });
});

describe('R7 — large-files inspects STAGED blob, not worktree', () => {
  let repo: string;
  beforeEach(() => { repo = newRepo(); });
  afterEach(() => cleanup(repo));

  test('staging 6MB then truncating worktree still blocks', () => {
    // Stage a 6MB blob.
    const big = Buffer.alloc(6 * 1024 * 1024);
    writeFileSync(join(repo, 'big.bin'), big);
    git(repo, 'add', 'big.bin');
    // Now truncate worktree file. Staged blob still 6MB.
    writeFileSync(join(repo, 'big.bin'), 'tiny');
    const r = git(repo, 'commit', '-m', 'feat: x');
    expect(r.status).not.toBe(0);
    expect(commitCount(repo)).toBe(0);
  });

  test('small staged blob + large unstaged worktree passes', () => {
    // Need an initial commit so lefthook can stash unstaged changes.
    writeFileSync(join(repo, 'init.txt'), 'init');
    git(repo, 'add', 'init.txt');
    git(repo, 'commit', '-m', 'feat: init');

    writeFileSync(join(repo, 'tiny.txt'), 'small');
    git(repo, 'add', 'tiny.txt');
    writeFileSync(join(repo, 'tiny.txt'), Buffer.alloc(10 * 1024 * 1024));
    const r = git(repo, 'commit', '-m', 'feat: small');
    expect(r.status).toBe(0);
    expect(commitCount(repo)).toBe(2);
  });

  test('LARGE_FILE_LIMIT_MB=20 raises threshold', () => {
    writeFileSync(join(repo, 'big.bin'), Buffer.alloc(6 * 1024 * 1024));
    git(repo, 'add', 'big.bin');
    const r = git(repo, 'commit', '-m', 'feat: big', { env: { ...process.env, LARGE_FILE_LIMIT_MB: '20' } });
    expect(r.status).toBe(0);
  });
});

describe('Bypass envvar surface', () => {
  let repo: string;
  beforeEach(() => { repo = newRepo(); });
  afterEach(() => cleanup(repo));

  test('SKIP_PERSONAL_HOOKS=1 skips guardrails entirely', () => {
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', 'leak.ts');
    const r = git(repo, 'commit', '-m', 'bad msg', { env: { ...process.env, SKIP_PERSONAL_HOOKS: '1' } });
    // commitlint would normally block "bad msg" too, but it's also skipped.
    expect(r.status).toBe(0);
  });

  test('--no-verify bypasses everything (wt and guardrails)', () => {
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', 'leak.ts');
    const r = git(repo, 'commit', '--no-verify', '-m', 'bad');
    expect(r.status).toBe(0);
  });

  test('user-owned .opt-out skips repo entirely', () => {
    // The shim resolves repo_root via `git rev-parse --show-toplevel`, which
    // canonicalizes /var/folders/... → /private/var/folders/... on macOS.
    // Use the same canonical form when writing the opt-out file.
    const canonical = git(repo, 'rev-parse', '--show-toplevel').stdout.trim();
    const optOutFile = `${HOOKS_HOME}/.opt-out`;
    const before = run('cat', [optOutFile]).stdout;
    try {
      writeFileSync(optOutFile, (before ? before + '\n' : '') + canonical + '\n');
      writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
      git(repo, 'add', 'leak.ts');
      const r = git(repo, 'commit', '-m', 'feat: ok');
      expect(r.status).toBe(0);
    } finally {
      writeFileSync(optOutFile, before);
    }
  });

  test('in-repo .no-personal-hooks marker does NOT opt out (R1)', () => {
    writeFileSync(join(repo, '.no-personal-hooks'), '');
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', '.no-personal-hooks', 'leak.ts');
    const r = git(repo, 'commit', '-m', 'feat: x');
    expect(r.status).not.toBe(0);
  });
});

describe('R3 — env var poisoning cannot disable hooks', () => {
  let repo: string;
  beforeEach(() => { repo = newRepo(); });
  afterEach(() => cleanup(repo));

  test('ambient WT_HOOK_RUNNING=1 alone does NOT bypass', () => {
    writeFileSync(join(repo, 'leak.ts'), STRIPE_KEY_LIKE);
    git(repo, 'add', 'leak.ts');
    const r = git(repo, 'commit', '-m', 'feat: x', { env: { ...process.env, WT_HOOK_RUNNING: '1' } });
    expect(r.status).not.toBe(0);
    expect(commitCount(repo)).toBe(0);
  });
});

describe('Conventional commits gating', () => {
  let repo: string;
  beforeEach(() => { repo = newRepo(); });
  afterEach(() => cleanup(repo));

  test('clean conventional commit succeeds', () => {
    writeFileSync(join(repo, 'a.txt'), 'a');
    git(repo, 'add', 'a.txt');
    const r = git(repo, 'commit', '-m', 'feat: clean commit message');
    expect(r.status).toBe(0);
  });

  test('non-conventional commit blocked', () => {
    writeFileSync(join(repo, 'a.txt'), 'a');
    git(repo, 'add', 'a.txt');
    const r = git(repo, 'commit', '-m', 'no convention here');
    expect(r.status).not.toBe(0);
  });

  test('SKIP_COMMITLINT=1 bypasses', () => {
    writeFileSync(join(repo, 'a.txt'), 'a');
    git(repo, 'add', 'a.txt');
    const r = git(repo, 'commit', '-m', 'bad', { env: { ...process.env, SKIP_COMMITLINT: '1' } });
    expect(r.status).toBe(0);
  });
});

describe('Doctor handles worktrees correctly', () => {
  let scanRoot: string;
  let parent: string;
  let wt: string;
  let parentCanonical: string;
  let wtCanonical: string;
  beforeEach(() => {
    // Use a shared scan root containing both parent repo and worktree.
    scanRoot = mkdtempSync(join(tmpdir(), 'guardrails-doctor-'));
    parent = join(scanRoot, 'parent');
    mkdirSync(parent);
    spawnSync('git', ['-C', parent, 'init', '-q', '-b', 'main']);
    spawnSync('git', ['-C', parent, 'config', 'user.email', 't@e.com']);
    spawnSync('git', ['-C', parent, 'config', 'user.name', 't']);
    writeFileSync(join(parent, 'x'), 'x');
    git(parent, 'add', 'x');
    git(parent, 'commit', '-q', '-m', 'feat: init');
    git(parent, 'branch', 'other');
    wt = join(scanRoot, 'wt');
    git(parent, 'worktree', 'add', wt, 'other');

    parentCanonical = git(parent, 'rev-parse', '--show-toplevel').stdout.trim();
    wtCanonical = git(wt, 'rev-parse', '--show-toplevel').stdout.trim();
  });
  afterEach(() => {
    cleanup(scanRoot);
  });

  test('worktree (with .git file, not directory) is detected as enrolled', () => {
    const r = run('bun', [`${process.env.HOME}/.pai/skills/personal-hooks/doctor.ts`, '--root', scanRoot, '--json']);
    expect(r.status).toBe(0);
    const data = JSON.parse(r.stdout);
    const reports = data.reports as Array<{ path: string; category: string }>;
    const found = reports.filter((r) => r.path === parentCanonical || r.path === wtCanonical);
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found.every((r) => r.category === 'chain-enrolled')).toBe(true);
  });
});
