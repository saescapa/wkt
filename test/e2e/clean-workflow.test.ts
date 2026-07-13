import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
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
    const childProcess = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
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

/*
 * Destructive-path E2E tests for `wkt clean`.
 * ===========================================
 *
 * Exercises the safety rails: main-branch protection (not force-overridable),
 * the unmerged-work guard (--force overridable), the dirty-working-tree guard
 * (--force overridable), unverifiable merge status (not force-overridable),
 * --project scoping, and cross-project name disambiguation.
 */
describe('Clean workflow (destructive paths)', () => {
  let wktBinary: string;
  let testDir: string;
  let wktHome: string;

  const wsPath = (project: string, name: string): string =>
    join(wktHome, 'workspaces', project, name);
  const barePath = (project: string): string =>
    join(wktHome, 'projects', project);

  async function wkt(args: string[]): Promise<CommandResult> {
    return runCommand('node', [wktBinary, '-y', ...args], { env: { WKT_HOME: wktHome } });
  }

  function commitInWorkspace(path: string, fileName: string): void {
    writeFileSync(join(path, fileName), `content of ${fileName}\n`);
    git(path, `add ${fileName}`);
    git(path, `commit -qm "Add ${fileName}"`);
  }

  beforeAll(async () => {
    wktBinary = join(process.cwd(), 'dist', 'index.js');
    if (!existsSync(wktBinary)) {
      throw new Error('dist/index.js missing — run `bun run build` first');
    }

    const baseTmpDir = realpathSync(tmpdir());
    testDir = join(baseTmpDir, `wkt-clean-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    wktHome = join(testDir, '.wkt');
    mkdirSync(wktHome, { recursive: true });

    for (const project of ['proj-a', 'proj-b']) {
      const sourceRepo = join(testDir, `${project}-source`);
      createSourceRepo(sourceRepo);
      const init = await wkt(['init', sourceRepo, project]);
      expect(init.exitCode).toBe(0);
      // Worktrees inherit identity from the bare repo's config
      git(barePath(project), 'config user.email "test@test.com"');
      git(barePath(project), 'config user.name "Test User"');
    }
  });

  afterAll(() => {
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('refuses to clean the main workspace, even with --force', async () => {
    const result = await wkt(['clean', 'main', '-p', 'proj-a', '--force']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Cannot clean main branch workspace');
    expect(result.stdout).toContain('cannot be overridden');
    expect(existsSync(wsPath('proj-a', 'main'))).toBe(true);
  });

  it('refuses to clean a workspace with unmerged commits without --force', async () => {
    await wkt(['create', 'proj-a', 'unmerged-work']);
    commitInWorkspace(wsPath('proj-a', 'unmerged-work'), 'feature.txt');

    const result = await wkt(['clean', 'unmerged-work']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Unmerged work detected');
    expect(existsSync(wsPath('proj-a', 'unmerged-work'))).toBe(true);
  });

  it('cleans a workspace with unmerged commits when --force is passed', async () => {
    const result = await wkt(['clean', 'unmerged-work', '--force']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Force cleaning');
    expect(existsSync(wsPath('proj-a', 'unmerged-work'))).toBe(false);
  });

  it('refuses to clean a workspace with uncommitted changes without --force', async () => {
    await wkt(['create', 'proj-a', 'dirty-tree']);
    writeFileSync(join(wsPath('proj-a', 'dirty-tree'), 'scratch.txt'), 'not committed\n');

    const result = await wkt(['clean', 'dirty-tree']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('uncommitted changes');
    expect(existsSync(wsPath('proj-a', 'dirty-tree'))).toBe(true);

    const force = await wkt(['clean', 'dirty-tree', '--force']);
    expect(force.exitCode).toBe(0);
    expect(existsSync(wsPath('proj-a', 'dirty-tree'))).toBe(false);
  });

  it('refuses to clean when merge status cannot be verified, even with --force', async () => {
    await wkt(['create', 'proj-a', 'unverifiable']);

    // Point the project's default branch at a ref that doesn't exist so
    // getMergeStatus reports 'unknown' for every branch in the project.
    const dbPath = join(wktHome, 'database.json');
    const db = JSON.parse(readFileSync(dbPath, 'utf-8'));
    db.projects['proj-a'].defaultBranch = 'nonexistent-branch';
    writeFileSync(dbPath, JSON.stringify(db, null, 2));

    const result = await wkt(['clean', 'unverifiable', '--force']);

    expect(result.stdout).toContain('Could not verify merge status');
    expect(result.stdout).toContain('cannot be overridden');
    expect(existsSync(wsPath('proj-a', 'unverifiable'))).toBe(true);

    // Restore the default branch and clean up the fixture workspace
    const dbAfter = JSON.parse(readFileSync(dbPath, 'utf-8'));
    dbAfter.projects['proj-a'].defaultBranch = 'main';
    writeFileSync(dbPath, JSON.stringify(dbAfter, null, 2));
    await wkt(['clean', 'unverifiable', '--force']);
  });

  it('errors on a workspace name that exists in multiple projects', async () => {
    await wkt(['create', 'proj-a', 'shared-name']);
    await wkt(['create', 'proj-b', 'shared-name']);

    const result = await wkt(['clean', 'shared-name']);

    expect(result.stdout).toContain('exists in multiple projects');
    expect(existsSync(wsPath('proj-a', 'shared-name'))).toBe(true);
    expect(existsSync(wsPath('proj-b', 'shared-name'))).toBe(true);
  });

  it('scopes single-workspace clean with --project', async () => {
    const result = await wkt(['clean', 'shared-name', '-p', 'proj-b']);

    expect(result.exitCode).toBe(0);
    expect(existsSync(wsPath('proj-b', 'shared-name'))).toBe(false);
    expect(existsSync(wsPath('proj-a', 'shared-name'))).toBe(true);
  });

  it('scopes bulk clean --force to --project', async () => {
    await wkt(['create', 'proj-b', 'bulk-target']);

    // proj-a still has shared-name (merged, clean); proj-b has bulk-target.
    const result = await wkt(['clean', '--project', 'proj-b', '--force']);

    expect(result.exitCode).toBe(0);
    expect(existsSync(wsPath('proj-b', 'bulk-target'))).toBe(false);
    expect(existsSync(wsPath('proj-a', 'shared-name'))).toBe(true);
    // Main workspaces survive bulk force-clean in both projects
    expect(existsSync(wsPath('proj-a', 'main'))).toBe(true);
    expect(existsSync(wsPath('proj-b', 'main'))).toBe(true);
  });

  it('errors on bulk clean with an unknown --project', async () => {
    const result = await wkt(['clean', '--project', 'no-such-project', '--force']);

    expect(result.stdout).toContain("Project 'no-such-project' not found");
  });
});
