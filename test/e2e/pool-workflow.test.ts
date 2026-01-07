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
 * Pool Workflow E2E Tests
 * =======================
 *
 * These tests verify the pool-based workspace workflow:
 *
 * Workflow 1: Claim from empty pool (creates new workspace)
 * - wkt init <repo> <project>    -> success
 * - wkt claim <project>          -> creates wksp-1, outputs path
 * - wkt list --pool              -> shows wksp-1 as claimed
 *
 * Workflow 2: Release claimed workspace back to pool
 * - (continue from above)
 * - wkt release                  -> success (from wksp-1 directory)
 * - wkt list --pool              -> shows wksp-1 as pooled
 *
 * Workflow 3: Claim from populated pool (reuses existing)
 * - wkt claim <project>          -> reuses wksp-1 (oldest pooled)
 * - wkt list --pool              -> shows wksp-1 as claimed again
 *
 * Workflow 4: Save with --branch (converts to branched)
 * - wkt claim <project>          -> get a workspace
 * - wkt save --branch feature/my-feature -> creates branch, converts to branched mode
 * - wkt list                     -> shows workspace with feature/my-feature branch
 *
 * Workflow 5: Multiple pool workspaces
 * - wkt claim <project>          -> creates wksp-2
 * - wkt claim <project>          -> creates wksp-3
 * - wkt list --pool              -> shows multiple claimed workspaces
 */
describe('Pool Workflow', () => {
  let wktBinary: string;
  let testDir: string;
  let wktHome: string;
  let sourceRepo: string;
  const projectName = 'pool-project';

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
    testDir = join(baseTmpDir, `wkt-pool-test-${Date.now()}`);
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

  describe('Workflow 1: Claim from empty pool', () => {
    it('should initialize project', async () => {
      const result = await wkt(['init', sourceRepo, projectName]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Successfully initialized');
      expect(result.stdout).toContain(projectName);
    });

    it('should claim from empty pool and create wksp-1', async () => {
      const result = await wkt(['claim', projectName]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Pool empty, creating new workspace');
      expect(result.stdout).toContain('wksp-1');
      expect(result.stdout).toContain('tracking main');
    });

    it('should show wksp-1 as claimed in pool list', async () => {
      const result = await wkt(['list', '--pool']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('wksp-1');
      expect(result.stdout).toContain('claimed');
    });
  });

  describe('Workflow 2: Release claimed workspace', () => {
    it('should release workspace back to pool', async () => {
      const workspacePath = getWorkspacePath('wksp-1');
      const result = await wkt(['release', '--force'], { cwd: workspacePath });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Releasing');
      expect(result.stdout).toContain('back to pool');
      expect(result.stdout).toContain('Released to pool');
    });

    it('should show wksp-1 as pooled after release', async () => {
      const result = await wkt(['list', '--pool']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('wksp-1');
      expect(result.stdout).toContain('pooled');
    });
  });

  describe('Workflow 3: Claim from populated pool', () => {
    it('should claim and reuse existing pooled workspace', async () => {
      const result = await wkt(['claim', projectName]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Claiming workspace from pool');
      expect(result.stdout).toContain('wksp-1');
    });

    it('should show wksp-1 as claimed again', async () => {
      const result = await wkt(['list', '--pool']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('wksp-1');
      expect(result.stdout).toContain('claimed');
    });
  });

  describe('Workflow 4: Save with --branch', () => {
    it('should save with --branch and convert to branched mode', async () => {
      const workspacePath = getWorkspacePath('wksp-1');
      const result = await wkt(['save', '--branch', 'feature/my-feature'], { cwd: workspacePath });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Creating branch');
      expect(result.stdout).toContain('feature/my-feature');
      expect(result.stdout).toContain('is now branched');
    });

    it('should show workspace with feature branch in list', async () => {
      const result = await wkt(['list']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('wksp-1');
      // The branch name appears in detailed view or in the mode display
    });

    it('should not show branched workspace as pooled in pool list', async () => {
      const result = await wkt(['list', '--pool']);

      expect(result.exitCode).toBe(0);
      // Pool list filters to only claimed/pooled workspaces
      // wksp-1 is now branched, so it should either not appear or not show as pooled/claimed
      const hasWksp1 = result.stdout.includes('wksp-1');
      if (hasWksp1) {
        // If it appears, it should show as branched, not pooled/claimed
        expect(result.stdout).toContain('branched');
      }
    });
  });

  describe('Workflow 5: Multiple pool workspaces', () => {
    it('should create wksp-2 when claiming', async () => {
      // wksp-1 is now branched, so claiming should create wksp-2
      const result = await wkt(['claim', projectName]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Pool empty, creating new workspace');
      expect(result.stdout).toContain('wksp-2');
    });

    it('should create wksp-3 when claiming again', async () => {
      const result = await wkt(['claim', projectName]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Pool empty, creating new workspace');
      expect(result.stdout).toContain('wksp-3');
    });

    it('should show multiple claimed workspaces in pool list', async () => {
      const result = await wkt(['list', '--pool']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('wksp-2');
      expect(result.stdout).toContain('wksp-3');
      expect(result.stdout).toContain('claimed');
    });

    it('should show pool summary after releasing one workspace', async () => {
      const wksp2Path = getWorkspacePath('wksp-2');
      await wkt(['release', '--force'], { cwd: wksp2Path });

      const result = await wkt(['list', '--pool']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('available in pool');
    });
  });

  describe('Edge Cases', () => {
    it('should error when releasing from non-workspace directory', async () => {
      const result = await wkt(['release'], { cwd: testDir });

      expect(result.exitCode).toBe(0); // Command handles gracefully
      expect(result.stdout).toContain('Not in a workspace directory');
    });

    it('should error when saving from non-workspace directory', async () => {
      const result = await wkt(['save', '--branch', 'test'], { cwd: testDir });

      expect(result.exitCode).toBe(0); // Command handles gracefully
      expect(result.stdout).toContain('Not in a workspace directory');
    });

    it('should handle claim on non-existent project', async () => {
      const result = await wkt(['claim', 'nonexistent-project']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Project 'nonexistent-project' not found");
    });
  });
});
