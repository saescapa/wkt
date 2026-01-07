import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { spawn, execSync } from 'child_process';
import { rmSync, existsSync, mkdirSync, writeFileSync, realpathSync } from 'fs';
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
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
      });
    });

    let stdout = '';
    let stderr = '';

    childProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code || 0,
      });
    });
  });
}

function createTestGitRepo(path: string): void {
  mkdirSync(path, { recursive: true });

  execSync('git init', { cwd: path, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: path, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: path, stdio: 'pipe' });

  writeFileSync(join(path, 'README.md'), '# Test Repository\n');
  writeFileSync(
    join(path, 'package.json'),
    JSON.stringify({ name: 'test-project', version: '1.0.0' }, null, 2)
  );

  execSync('git add .', { cwd: path, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: path, stdio: 'pipe' });
  execSync('git branch -M main', { cwd: path, stdio: 'pipe' });
}

/*
 * Sync Command E2E Tests
 * ======================
 *
 * These tests verify the sync command workflow for managing local files:
 *
 * Workflow 1: Dry run sync
 * - wkt init <repo> <project>
 * - wkt create <project> feature/test
 * - wkt sync --dry                   -> shows what would be synced (may be empty without config)
 *
 * Workflow 2: Sync specific workspace
 * - wkt sync --workspace <name> --force  -> syncs specific workspace
 *
 * Workflow 3: Sync specific project
 * - wkt sync --project <name> --force    -> syncs all workspaces in project
 *
 * Workflow 4: Sync all
 * - wkt sync --all --force               -> syncs all workspaces
 *
 * Workflow 5: No workspaces case
 * - wkt sync on fresh install            -> appropriate message
 *
 * Note: Sync copies/symlinks files based on config. Without local_files
 * configured, it may just succeed with "nothing to sync". Test the command
 * structure even if the actual file operations are minimal.
 */
describe('Sync Workflow', () => {
  let wktBinary: string;
  let testDir: string;
  let wktHome: string;
  let sourceRepo: string;
  const projectName = 'sync-project';

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

    // Use realpathSync to get canonical path (resolves /var -> /private/var on macOS)
    const baseTmpDir = realpathSync(tmpdir());
    testDir = join(baseTmpDir, `wkt-sync-test-${Date.now()}`);
    wktHome = join(testDir, '.wkt');
    sourceRepo = join(testDir, 'source-repo');

    mkdirSync(wktHome, { recursive: true });
    createTestGitRepo(sourceRepo);
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  async function wkt(
    args: string[],
    options: { cwd?: string } = {}
  ): Promise<CommandResult> {
    return runCommand('node', [wktBinary, ...args], {
      cwd: options.cwd,
      env: { WKT_HOME: wktHome },
    });
  }

  function getWorkspacePath(workspaceName: string): string {
    return join(wktHome, 'workspaces', projectName, workspaceName);
  }

  describe('Workflow 1: Dry run sync', () => {
    it('should initialize project', async () => {
      const result = await wkt(['init', sourceRepo, projectName]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Successfully initialized');
      expect(result.stdout).toContain(projectName);
    });

    it('should create a workspace for testing', async () => {
      const result = await wkt(['create', projectName, 'feature/test']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('feature/test');
    });

    it('should run sync --dry and show dry run output', async () => {
      const result = await wkt(['sync', '--dry']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Dry run mode');
      expect(result.stdout).toContain('Will sync local files for');
      expect(result.stdout).toContain('Dry run complete');
    });

    it('should show no files configured message in dry run', async () => {
      const result = await wkt(['sync', '--dry']);

      expect(result.exitCode).toBe(0);
      // Without local_files config, should indicate nothing to sync
      expect(result.stdout).toContain('No files configured for local_files management');
    });
  });

  describe('Workflow 2: Sync specific workspace', () => {
    it('should sync specific workspace with --workspace flag', async () => {
      // Workspace name is sanitized: feature/test -> test
      const result = await wkt(['sync', '--workspace', 'test', '--force']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Will sync local files for');
      expect(result.stdout).toContain('test');
      expect(result.stdout).toContain('Synced');
    });

    it('should handle non-existent workspace gracefully', async () => {
      const result = await wkt(['sync', '--workspace', 'nonexistent-workspace', '--force']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No workspaces found to sync');
    });
  });

  describe('Workflow 3: Sync specific project', () => {
    it('should create additional workspace for project sync test', async () => {
      const result = await wkt(['create', projectName, 'feature/another']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('feature/another');
    });

    it('should sync all workspaces in project with --project flag', async () => {
      const result = await wkt(['sync', '--project', projectName, '--force']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Will sync local files for');
      // Should sync multiple workspaces
      expect(result.stdout).toContain('Synced');
    });

    it('should handle non-existent project gracefully', async () => {
      const result = await wkt(['sync', '--project', 'nonexistent-project', '--force']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No workspaces found to sync');
    });
  });

  describe('Workflow 4: Sync all', () => {
    it('should sync all workspaces with --all flag', async () => {
      const result = await wkt(['sync', '--all', '--force']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Will sync local files for');
      expect(result.stdout).toContain('Synced');
    });

    it('should show workspace count in sync summary', async () => {
      const result = await wkt(['sync', '--all', '--force']);

      expect(result.exitCode).toBe(0);
      // Should mention number of workspaces synced
      expect(result.stdout).toMatch(/Synced \d+ workspace/);
    });
  });

  describe('Workflow 5: No workspaces case', () => {
    let emptyWktHome: string;

    beforeAll(() => {
      emptyWktHome = join(testDir, '.wkt-empty');
      mkdirSync(emptyWktHome, { recursive: true });
    });

    it('should handle sync when no workspaces exist', async () => {
      const result = await runCommand('node', [wktBinary, 'sync', '--force'], {
        env: { WKT_HOME: emptyWktHome },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No workspaces found to sync');
    });

    it('should handle sync --dry when no workspaces exist', async () => {
      const result = await runCommand('node', [wktBinary, 'sync', '--dry'], {
        env: { WKT_HOME: emptyWktHome },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Dry run mode');
      expect(result.stdout).toContain('No workspaces found to sync');
    });
  });

  describe('Edge Cases', () => {
    it('should handle combined --workspace and --project flags', async () => {
      // Workspace name is sanitized: feature/test -> test
      const result = await wkt([
        'sync',
        '--project', projectName,
        '--workspace', 'test',
        '--force'
      ]);

      expect(result.exitCode).toBe(0);
      // Should filter to just the specific workspace in the project
      expect(result.stdout).toContain('test');
    });

    it('should handle sync with --dry and --force flags together', async () => {
      const result = await wkt(['sync', '--dry', '--force']);

      expect(result.exitCode).toBe(0);
      // Dry run should take precedence - no actual changes
      expect(result.stdout).toContain('Dry run mode');
      expect(result.stdout).toContain('Dry run complete');
    });

    it('should run sync without any flags (defaults to current directory context)', async () => {
      const workspacePath = getWorkspacePath('feature-test');
      const result = await wkt(['sync', '--force']);

      expect(result.exitCode).toBe(0);
      // Should either sync all or handle appropriately
    });
  });
});
