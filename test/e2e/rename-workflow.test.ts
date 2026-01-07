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
 * Rename Workflow E2E Tests
 * =========================
 *
 * Setup for all tests:
 * - wkt init <repo> <project>
 * - wkt create <project> feature/old-name  -> workspace dir: old-name
 *
 * Workflow 1: Simple branch rename (--no-rebase)
 * - wkt rename feature/new-name --no-rebase --force  (from workspace cwd)
 * - Verify: workspace still exists, branch renamed, dir renamed to new-name
 *
 * Workflow 2: Rename with custom workspace name
 * - wkt rename feature/another --name custom-dir --no-rebase --force
 * - Verify: workspace directory renamed to custom-dir
 *
 * Workflow 3: Rename with description update
 * - wkt rename feature/desc-updated --description "New description" --no-rebase --force
 * - wkt info --description-only -> shows "New description"
 *
 * Workflow 4: Error cases
 * - Rename from non-workspace directory -> error
 * - Rename to existing directory name -> error
 *
 * Workflow 5: Rename only description (keep same branch)
 * - wkt rename feature/keep-branch --description "Updated" --no-rebase --force
 * - Branch name unchanged but description updated
 *
 * Note: The rename command requires running from within a workspace directory.
 * Tests use cwd option to simulate being in the workspace.
 * Workspace naming: feature/foo -> workspace dir "foo" (prefix stripped)
 */
describe('Rename Workflow', () => {
  let wktBinary: string;
  let testDir: string;
  let wktHome: string;
  let sourceRepo: string;
  const projectName = 'rename-project';

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
    testDir = join(baseTmpDir, `wkt-rename-test-${Date.now()}`);
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

  describe('Setup', () => {
    it('should initialize project', async () => {
      const result = await wkt(['init', sourceRepo, projectName]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Successfully initialized');
      expect(result.stdout).toContain(projectName);
    });

    it('should create workspace for rename tests', async () => {
      const result = await wkt(['create', projectName, 'feature/old-name']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('feature/old-name');
    });
  });

  describe('Workflow 1: Simple branch rename (--no-rebase)', () => {
    it('should rename branch in place with --no-rebase', async () => {
      // Workspace created from feature/old-name has directory name 'old-name'
      const workspacePath = getWorkspacePath('old-name');
      const result = await wkt(
        ['rename', 'feature/new-name', '--no-rebase', '--force'],
        { cwd: workspacePath }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Renaming workspace');
      expect(result.stdout).toContain('feature/new-name');
      expect(result.stdout).toContain('Git branch renamed');
    });

    it('should show renamed workspace in list', async () => {
      const result = await wkt(['list']);

      expect(result.exitCode).toBe(0);
      // The workspace should now show the new branch name
      expect(result.stdout).toContain('new-name');
    });

    it('should verify workspace directory still exists with new name', async () => {
      // After renaming branch to feature/new-name, workspace dir is renamed to 'new-name'
      const newWorkspacePath = getWorkspacePath('new-name');
      expect(existsSync(newWorkspacePath)).toBe(true);
    });
  });

  describe('Workflow 2: Rename with custom workspace name', () => {
    let workspacePath: string;

    it('should create a new workspace for custom name test', async () => {
      const result = await wkt(['create', projectName, 'feature/to-rename']);

      expect(result.exitCode).toBe(0);
      // feature/to-rename -> workspace dir 'to-rename'
      workspacePath = getWorkspacePath('to-rename');
      expect(existsSync(workspacePath)).toBe(true);
    });

    it('should rename with custom workspace directory name', async () => {
      const result = await wkt(
        ['rename', 'feature/renamed', '--name', 'custom-workspace-dir', '--no-rebase', '--force'],
        { cwd: workspacePath }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('custom-workspace-dir');
      expect(result.stdout).toContain('Directory renamed');
    });

    it('should verify custom directory name exists', async () => {
      const customPath = getWorkspacePath('custom-workspace-dir');
      expect(existsSync(customPath)).toBe(true);
    });

    it('should show workspace with custom name in list', async () => {
      const result = await wkt(['list']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('custom-workspace-dir');
    });
  });

  describe('Workflow 3: Rename with description update', () => {
    let workspacePath: string;

    it('should create a workspace for description test', async () => {
      const result = await wkt(['create', projectName, 'feature/desc-test']);

      expect(result.exitCode).toBe(0);
      // feature/desc-test -> workspace dir 'desc-test'
      workspacePath = getWorkspacePath('desc-test');
      expect(existsSync(workspacePath)).toBe(true);
    });

    it('should update description during rename', async () => {
      const result = await wkt(
        ['rename', 'feature/desc-updated', '--description', 'New description for testing', '--no-rebase', '--force'],
        { cwd: workspacePath }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Successfully renamed');
    });

    it('should show updated description with info --description-only', async () => {
      // feature/desc-updated -> workspace dir 'desc-updated'
      const newWorkspacePath = getWorkspacePath('desc-updated');
      const result = await wkt(['info', '--description-only'], { cwd: newWorkspacePath });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('New description for testing');
    });
  });

  describe('Workflow 4: Error cases', () => {
    it('should error when renaming from non-workspace directory', async () => {
      const result = await wkt(['rename', 'feature/test', '--no-rebase'], { cwd: testDir });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('current workspace');
    });

    it('should error when directory already exists and not using --force', async () => {
      // First create two workspaces
      await wkt(['create', projectName, 'feature/workspace-a']);
      await wkt(['create', projectName, 'feature/workspace-b']);

      // feature/workspace-a -> workspace dir 'workspace-a'
      const workspaceAPath = getWorkspacePath('workspace-a');

      // Try to rename workspace-a to have the same directory name as workspace-b
      const result = await wkt(
        ['rename', 'feature/other', '--name', 'workspace-b', '--no-rebase'],
        { cwd: workspaceAPath }
      );

      // Should fail because workspace-b directory already exists
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('already exists');
    });
  });

  describe('Workflow 5: Rename only description (keep same branch)', () => {
    let workspacePath: string;

    it('should create workspace for description-only update', async () => {
      const result = await wkt(['create', projectName, 'feature/keep-branch']);

      expect(result.exitCode).toBe(0);
      // feature/keep-branch -> workspace dir 'keep-branch'
      workspacePath = getWorkspacePath('keep-branch');
    });

    it('should update only description without changing branch', async () => {
      // Pass the same branch name to effectively just update metadata
      const result = await wkt(
        ['rename', 'feature/keep-branch', '--description', 'Updated description only', '--no-rebase', '--force'],
        { cwd: workspacePath }
      );

      expect(result.exitCode).toBe(0);
    });

    it('should verify branch name unchanged but description updated', async () => {
      const infoResult = await wkt(['info', '--json'], { cwd: workspacePath });

      expect(infoResult.exitCode).toBe(0);
      const info = JSON.parse(infoResult.stdout);
      expect(info.branchName).toBe('feature/keep-branch');
      expect(info.description).toBe('Updated description only');
    });
  });
});
