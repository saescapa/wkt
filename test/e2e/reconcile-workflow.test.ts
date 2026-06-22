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

function createTestGitRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  execSync('git init', { cwd: path, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: path, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: path, stdio: 'pipe' });
  writeFileSync(join(path, 'README.md'), '# Test Repository\n');
  execSync('git add .', { cwd: path, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: path, stdio: 'pipe' });
  execSync('git branch -M main', { cwd: path, stdio: 'pipe' });
}

/*
 * Reconcile Workflow E2E Tests
 * ============================
 *
 * `wkt reconcile` detects and fixes drift between git's worktree truth and the
 * wkt database. These tests simulate the drift an LLM/manual git op introduces:
 *
 * - orphan:       `git worktree add` outside wkt -> reconcile --apply adopts it
 * - branch-drift: branch renamed under wkt -> reconcile --apply updates the db
 * - dead:         worktree dir removed by hand -> reconcile --apply prunes the db
 * - dry-run:      default run reports but mutates nothing
 *
 * The fixture is built directly with git + a hand-written database.json rather
 * than `wkt init`, so the test exercises reconcile in isolation and stays
 * independent of project bootstrapping.
 */
describe('Reconcile Workflow', () => {
  let wktBinary: string;
  let testDir: string;
  let wktHome: string;
  let sourceRepo: string;
  const projectName = 'reconcile-project';

  function bareRepoPath(): string {
    return join(wktHome, 'projects', projectName);
  }

  function workspacesPath(): string {
    return join(wktHome, 'workspaces', projectName);
  }

  function seedFixture(): void {
    mkdirSync(join(wktHome, 'projects'), { recursive: true });
    mkdirSync(workspacesPath(), { recursive: true });

    // Bare clone, left bare (true to how a healthy wkt project tracks worktrees).
    execSync(`git clone --bare "${sourceRepo}" "${bareRepoPath()}"`, { stdio: 'pipe' });

    // The canonical main workspace, registered in the database below.
    const mainPath = join(workspacesPath(), 'main');
    execSync(`git -C "${bareRepoPath()}" worktree add "${mainPath}" main`, { stdio: 'pipe' });

    const now = new Date().toISOString();
    const db = {
      projects: {
        [projectName]: {
          name: projectName,
          repositoryUrl: sourceRepo,
          bareRepoPath: bareRepoPath(),
          workspacesPath: workspacesPath(),
          defaultBranch: 'main',
          createdAt: now,
        },
      },
      workspaces: {
        [`${projectName}/main`]: {
          id: `${projectName}/main`,
          projectName,
          name: 'main',
          branchName: 'main',
          path: mainPath,
          baseBranch: 'main',
          createdAt: now,
          lastUsed: now,
          status: { clean: true, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
          commitsAhead: 0,
          commitsBehind: 0,
        },
      },
      metadata: { version: '1.0.0', schemaVersion: 3, lastCleanup: now },
    };
    writeFileSync(join(wktHome, 'database.json'), JSON.stringify(db, null, 2));
  }

  beforeAll(async () => {
    wktBinary = join(process.cwd(), 'dist', 'index.js');
    if (!existsSync(wktBinary)) {
      const buildProcess = spawn('bun', ['run', 'build'], { stdio: 'inherit' });
      await new Promise((resolve, reject) => {
        buildProcess.on('close', (code) => {
          if (code === 0) resolve(undefined);
          else reject(new Error(`Build failed with code ${code}`));
        });
      });
    }

    const baseTmpDir = realpathSync(tmpdir());
    testDir = join(baseTmpDir, `wkt-reconcile-test-${Date.now()}`);
    wktHome = join(testDir, '.wkt');
    sourceRepo = join(testDir, 'source-repo');

    mkdirSync(wktHome, { recursive: true });
    createTestGitRepo(sourceRepo);
    seedFixture();
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  async function wkt(args: string[], options: { cwd?: string } = {}): Promise<CommandResult> {
    return runCommand('node', [wktBinary, ...args], {
      cwd: options.cwd,
      env: { WKT_HOME: wktHome },
    });
  }

  function readDb(): { workspaces: Record<string, { branchName: string; path: string }> } {
    return JSON.parse(readFileSync(join(wktHome, 'database.json'), 'utf-8'));
  }

  describe('Setup', () => {
    it('should report no drift on a freshly-seeded project', async () => {
      const result = await wkt(['reconcile']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('in sync');
    });
  });

  describe('Orphan adoption', () => {
    it('should detect an orphan worktree created with raw git', async () => {
      const orphanPath = join(workspacesPath(), 'orphan-ws');
      execSync(`git -C "${bareRepoPath()}" worktree add -b feat/orphan "${orphanPath}" main`, {
        stdio: 'pipe',
      });

      const dry = await wkt(['reconcile']);
      expect(dry.exitCode).toBe(0);
      expect(dry.stdout).toContain('adopt');
      expect(dry.stdout).toContain('orphan-ws');
      // dry-run must not touch the database
      expect(readDb().workspaces[`${projectName}/orphan-ws`]).toBeUndefined();
    });

    it('should adopt the orphan with --apply', async () => {
      const apply = await wkt(['reconcile', '--apply', '--force']);
      expect(apply.exitCode).toBe(0);
      expect(apply.stdout).toContain('adopt');

      const entry = readDb().workspaces[`${projectName}/orphan-ws`];
      expect(entry).toBeDefined();
      expect(entry.branchName).toBe('feat/orphan');
    });

    it('should now list the adopted workspace', async () => {
      const result = await wkt(['list']);
      expect(result.stdout).toContain('orphan-ws');
    });
  });

  describe('Branch drift', () => {
    it('should detect and fix a branch renamed out from under wkt', async () => {
      const orphanPath = join(workspacesPath(), 'orphan-ws');
      execSync(`git -C "${orphanPath}" branch -m feat/orphan feat/orphan-renamed`, { stdio: 'pipe' });

      const dry = await wkt(['reconcile']);
      expect(dry.stdout).toContain('branch-drift');

      const apply = await wkt(['reconcile', '--apply', '--force']);
      expect(apply.exitCode).toBe(0);
      expect(readDb().workspaces[`${projectName}/orphan-ws`].branchName).toBe('feat/orphan-renamed');
    });
  });

  describe('Dead database entry', () => {
    it('should prune a db entry whose worktree was deleted by hand', async () => {
      const orphanPath = join(workspacesPath(), 'orphan-ws');
      // Remove the working tree directory without going through wkt.
      rmSync(orphanPath, { recursive: true, force: true });
      execSync(`git -C "${bareRepoPath()}" worktree prune`, { stdio: 'pipe' });

      const dry = await wkt(['reconcile']);
      expect(dry.stdout).toContain('dead');

      const apply = await wkt(['reconcile', '--apply', '--force']);
      expect(apply.exitCode).toBe(0);
      expect(readDb().workspaces[`${projectName}/orphan-ws`]).toBeUndefined();
    });

    it('should report in sync once drift is resolved', async () => {
      const result = await wkt(['reconcile']);
      expect(result.stdout).toContain('in sync');
    });
  });

  describe('Scoping and errors', () => {
    it('should error for an unknown project', async () => {
      const result = await wkt(['reconcile', '--project', 'does-not-exist']);
      expect(result.exitCode).toBe(1);
    });
  });
});
