import { describe, it, expect, beforeAll, afterEach } from 'bun:test';
import { join } from 'path';
import { spawn, execSync } from 'child_process';
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'fs';
import { tmpdir } from 'os';

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {}
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...options.env };
    const childProcess = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    childProcess.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, exitCode: 1 });
    });

    let stdout = '';
    let stderr = '';
    childProcess.stdout?.on('data', (data) => { stdout += data.toString(); });
    childProcess.stderr?.on('data', (data) => { stderr += data.toString(); });
    childProcess.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code || 0 });
    });
  });
}

function git(cwd: string, command: string): string {
  return execSync(`git ${command}`, { cwd, stdio: 'pipe' }).toString();
}

function createSourceRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  git(path, 'init -q');
  git(path, 'config user.email "test@test.com"');
  git(path, 'config user.name "Test User"');
  writeFileSync(join(path, 'README.md'), '# Test Repository\n');
  git(path, 'add .');
  git(path, 'commit -qm "Initial commit"');
  git(path, 'branch -M main');
}

interface WorkspaceSeed {
  name: string;
  branchName: string;
  baseBranch: string;
  commitsAhead?: number;
  commitsBehind?: number;
}

/*
 * Stacking & base-branch lifecycle E2E tests.
 * ===========================================
 *
 * Covers the three behaviours that make `baseBranch` a living field:
 *   - `wkt list` tags stacked workspaces (base != default) and collapses
 *     `origin/main` into `main`.
 *   - merging a branch into the default branch re-points workspaces stacked on
 *     it back to the default branch.
 *   - `wkt merge --rebase` replays a feature onto its base branch.
 *
 * Fixtures are built directly with git + a hand-written database.json so each
 * test controls the exact drift it exercises (mirrors reconcile-workflow.test).
 */
describe('Stacking & base-branch workflow', () => {
  let wktBinary: string;
  const projectName = 'stack-project';
  const activeDirs: string[] = [];

  interface Fixture {
    wktHome: string;
    bareRepo: string;
    wsRoot: string;
  }

  function makeFixture(label: string): Fixture {
    const baseTmpDir = realpathSync(tmpdir());
    const testDir = join(baseTmpDir, `wkt-stacking-${label}-${Date.now()}`);
    activeDirs.push(testDir);

    const wktHome = join(testDir, '.wkt');
    const sourceRepo = join(testDir, 'source-repo');
    const bareRepo = join(wktHome, 'projects', projectName);
    const wsRoot = join(wktHome, 'workspaces', projectName);

    createSourceRepo(sourceRepo);
    mkdirSync(join(wktHome, 'projects'), { recursive: true });
    mkdirSync(wsRoot, { recursive: true });

    git(testDir, `clone --bare -q "${sourceRepo}" "${bareRepo}"`);
    // Worktrees inherit identity from the bare repo's config.
    git(bareRepo, 'config user.email "test@test.com"');
    git(bareRepo, 'config user.name "Test User"');

    // The canonical main workspace.
    git(bareRepo, `worktree add -q "${join(wsRoot, 'main')}" main`);

    return { wktHome, bareRepo, wsRoot };
  }

  function writeDb(fx: Fixture, seeds: WorkspaceSeed[]): void {
    const now = new Date().toISOString();
    const workspaces: Record<string, unknown> = {};
    for (const seed of [{ name: 'main', branchName: 'main', baseBranch: 'main' }, ...seeds]) {
      const s = seed as WorkspaceSeed;
      workspaces[`${projectName}/${s.name}`] = {
        id: `${projectName}/${s.name}`,
        projectName,
        name: s.name,
        branchName: s.branchName,
        path: join(fx.wsRoot, s.name),
        baseBranch: s.baseBranch,
        createdAt: now,
        lastUsed: now,
        status: { clean: true, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
        commitsAhead: s.commitsAhead ?? 0,
        commitsBehind: s.commitsBehind ?? 0,
      };
    }

    const db = {
      projects: {
        [projectName]: {
          name: projectName,
          repositoryUrl: join(fx.wktHome, '..', 'source-repo'),
          bareRepoPath: fx.bareRepo,
          workspacesPath: fx.wsRoot,
          defaultBranch: 'main',
          createdAt: now,
        },
      },
      workspaces,
      metadata: { version: '1.0.0', schemaVersion: 3, lastCleanup: now },
    };
    writeFileSync(join(fx.wktHome, 'database.json'), JSON.stringify(db, null, 2));
  }

  function readDb(fx: Fixture): { workspaces: Record<string, { baseBranch: string; commitsAhead: number; commitsBehind: number }> } {
    return JSON.parse(readFileSync(join(fx.wktHome, 'database.json'), 'utf-8'));
  }

  /** Add a worktree-backed branch and an optional commit on it. */
  function addWorktree(fx: Fixture, name: string, branch: string, fromRef: string, commitMessage?: string): void {
    const wtPath = join(fx.wsRoot, name);
    git(fx.bareRepo, `worktree add -q "${wtPath}" -b ${branch} ${fromRef}`);
    if (commitMessage) {
      writeFileSync(join(wtPath, `${name}.txt`), `${commitMessage}\n`);
      git(wtPath, 'add .');
      git(wtPath, `commit -qm "${commitMessage}"`);
    }
  }

  function wkt(fx: Fixture, args: string[]): Promise<CommandResult> {
    return runCommand('node', [wktBinary, ...args], { env: { WKT_HOME: fx.wktHome } });
  }

  beforeAll(async () => {
    wktBinary = join(process.cwd(), 'dist', 'index.js');
    if (!existsSync(wktBinary)) {
      await new Promise((resolve, reject) => {
        const build = spawn('bun', ['run', 'build'], { stdio: 'inherit' });
        build.on('close', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`Build failed: ${code}`))));
      });
    }
  });

  afterEach(() => {
    while (activeDirs.length) {
      const dir = activeDirs.pop();
      if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tags stacked workspaces and collapses origin/main into main', async () => {
    const fx = makeFixture('list');
    git(fx.bareRepo, 'branch feat/base main');
    addWorktree(fx, 'child', 'feat/child', 'feat/base');
    addWorktree(fx, 'preview', 'feat/preview', 'main');
    writeDb(fx, [
      { name: 'child', branchName: 'feat/child', baseBranch: 'feat/base', commitsAhead: 2, commitsBehind: 5 },
      // Recorded against the remote ref — must normalize to `main`.
      { name: 'preview', branchName: 'feat/preview', baseBranch: 'origin/main' },
    ]);

    const result = await wkt(fx, ['list']);

    expect(result.exitCode).toBe(0);
    // Only the child row is tagged (legend line aside) — preview normalizes to main.
    const stackedRows = result.stdout
      .split('\n')
      .filter(l => /[├└]─/.test(l) && l.includes('↳stacked'));
    expect(stackedRows.length).toBe(1);
    expect(stackedRows[0]).toContain('child');
    expect(stackedRows[0]).toContain('+2');
    expect(stackedRows[0]).toContain('-5');
    // origin/main collapses into the main group — no separate header.
    expect(result.stdout).not.toContain('origin/main');
    expect(result.stdout).toContain('feat/base:');
  });

  it('re-points workspaces stacked on a branch when it merges into main', async () => {
    const fx = makeFixture('repoint');
    addWorktree(fx, 'base', 'feat/base', 'main', 'base work');
    addWorktree(fx, 'child', 'feat/child', 'feat/base', 'child work');
    writeDb(fx, [
      { name: 'base', branchName: 'feat/base', baseBranch: 'main', commitsAhead: 1 },
      { name: 'child', branchName: 'feat/child', baseBranch: 'feat/base', commitsAhead: 1 },
    ]);

    const result = await wkt(fx, ['merge', 'base']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Merged feat/base into main');
    expect(result.stdout).toContain('Re-pointed 1 stacked workspace');
    expect(result.stdout).toContain('feat/base → main');

    const db = readDb(fx);
    expect(db.workspaces[`${projectName}/child`].baseBranch).toBe('main');
  });

  it('rebases a feature onto its base branch with --rebase', async () => {
    const fx = makeFixture('rebase');
    addWorktree(fx, 'x', 'feat/x', 'main', 'feature work');
    // Advance main after the feature branched, so the feature is behind.
    const mainPath = join(fx.wsRoot, 'main');
    writeFileSync(join(mainPath, 'main-update.txt'), 'main moved on\n');
    git(mainPath, 'add .');
    git(mainPath, 'commit -qm "advance main"');

    writeDb(fx, [{ name: 'x', branchName: 'feat/x', baseBranch: 'main', commitsAhead: 1, commitsBehind: 1 }]);

    const result = await wkt(fx, ['merge', 'x', '--rebase']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Rebased feat/x onto main');

    // The feature now contains main's advance commit.
    const log = git(join(fx.wsRoot, 'x'), 'log --oneline');
    expect(log).toContain('advance main');
    expect(log).toContain('feature work');

    const db = readDb(fx);
    expect(db.workspaces[`${projectName}/x`].commitsBehind).toBe(0);
    expect(db.workspaces[`${projectName}/x`].commitsAhead).toBe(1);

    // Running again is a no-op now that the feature is current.
    const again = await wkt(fx, ['merge', 'x', '--rebase']);
    expect(again.stdout).toContain('already up to date');
  });
});
