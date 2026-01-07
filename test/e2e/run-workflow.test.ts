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
 * Run Command E2E Tests
 * =====================
 *
 * Workflow 1: List scripts
 * - wkt run list          -> lists available scripts (may be empty without config)
 *
 * Workflow 2: Run with no scripts configured
 * - wkt run               -> shows message about no scripts or interactive prompt
 *
 * Workflow 3: Dry run mode
 * - wkt run <script> --dry  -> shows what would execute without running
 *
 * Workflow 4: Error cases
 * - wkt run nonexistent   -> error for non-existent script
 * - wkt run outside workspace context -> appropriate error
 *
 * Note: The run command executes user-defined scripts from config.
 * Without scripts configured, it will show "no scripts" messages.
 * Focus on testing command structure and error handling.
 */
describe('Run Workflow', () => {
  let wktBinary: string;
  let testDir: string;
  let wktHome: string;
  let sourceRepo: string;
  const projectName = 'run-project';

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
    testDir = join(baseTmpDir, `wkt-run-test-${Date.now()}`);
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

  function createWorkspaceConfig(workspacePath: string): void {
    const configContent = `scripts:
  allowed_commands:
    - echo
    - pwd
  scripts:
    test-echo:
      description: "Echo test message"
      command: ["echo", "hello from test"]
    test-pwd:
      description: "Print working directory"
      command: ["pwd"]
`;
    writeFileSync(join(workspacePath, '.wkt.yaml'), configContent);
  }

  describe('Workflow 1: List scripts (no config)', () => {
    it('should initialize project and claim workspace', async () => {
      const initResult = await wkt(['init', sourceRepo, projectName]);
      expect(initResult.exitCode).toBe(0);
      expect(initResult.stdout).toContain('Successfully initialized');

      const claimResult = await wkt(['claim', projectName]);
      expect(claimResult.exitCode).toBe(0);
      expect(claimResult.stdout).toContain('wksp-1');
    });

    it('should list available scripts (empty without config)', async () => {
      const workspacePath = getWorkspacePath('wksp-1');
      const result = await wkt(['run', 'list'], { cwd: workspacePath });

      // Without config, there's no script configuration
      // The command should handle this gracefully
      expect(result.exitCode).toBe(0);
      // Should show available scripts section or message about no scripts
      expect(
        result.stdout.includes('Available scripts') ||
        result.stdout.includes('No script configuration') ||
        result.stderr.includes('No script configuration')
      ).toBe(true);
    });
  });

  describe('Workflow 2: Run with no scripts configured', () => {
    it('should show no scripts message when running without script name', async () => {
      const workspacePath = getWorkspacePath('wksp-1');
      const result = await wkt(['run'], { cwd: workspacePath });

      // Without scripts configured, command should indicate no scripts available
      // or show config error
      expect(
        result.stdout.includes('No scripts available') ||
        result.stdout.includes('No script configuration') ||
        result.stderr.includes('No script configuration')
      ).toBe(true);
    });
  });

  describe('Workflow 3: Configured scripts', () => {
    it('should add config and list configured scripts', async () => {
      // Create config in workspace
      const workspacePath = getWorkspacePath('wksp-1');
      createWorkspaceConfig(workspacePath);

      const result = await wkt(['run', 'list'], { cwd: workspacePath });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Available scripts');
      expect(result.stdout).toContain('test-echo');
      expect(result.stdout).toContain('test-pwd');
    });

    it('should show dry run output without executing', async () => {
      const workspacePath = getWorkspacePath('wksp-1');
      // Note: --dry still requires --force to skip confirmation prompt
      const result = await wkt(['run', 'test-echo', '--dry', '--force'], { cwd: workspacePath });

      expect(result.exitCode).toBe(0);
      // Dry run should show what would be executed
      expect(
        result.stdout.includes('Would execute') ||
        result.stdout.includes('Dry run') ||
        result.stdout.includes('echo')
      ).toBe(true);
    });

    it('should execute script with --force flag', async () => {
      const workspacePath = getWorkspacePath('wksp-1');
      const result = await wkt(['run', 'test-echo', '--force'], { cwd: workspacePath });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Running script');
      expect(result.stdout).toContain('test-echo');
    });
  });

  describe('Workflow 4: Error cases', () => {
    it('should error for non-existent script', async () => {
      const workspacePath = getWorkspacePath('wksp-1');
      const result = await wkt(['run', 'nonexistent-script', '--force'], { cwd: workspacePath });

      // Script not found should result in error
      expect(result.exitCode).toBe(1);
      expect(
        result.stdout.includes('not found') ||
        result.stderr.includes('not found')
      ).toBe(true);
    });

    it('should error when run outside workspace context', async () => {
      const result = await wkt(['run', 'test-echo'], { cwd: testDir });

      // Should indicate no workspace context
      expect(
        result.stdout.includes('Not in a workspace') ||
        result.stdout.includes('No workspace') ||
        result.stderr.includes('Not in a workspace') ||
        result.stderr.includes('No workspace')
      ).toBe(true);
    });

    it('should error for invalid workspace identifier', async () => {
      const workspacePath = getWorkspacePath('wksp-1');
      const result = await wkt(['run', 'test-echo', 'nonexistent/workspace'], { cwd: workspacePath });

      // Should indicate workspace not found
      expect(result.exitCode).toBe(1);
      expect(
        result.stdout.includes('not found') ||
        result.stderr.includes('not found') ||
        result.stderr.includes('Workspace')
      ).toBe(true);
    });
  });

  describe('Workflow 5: Workspace targeting', () => {
    it('should create second workspace and run script targeting it', async () => {
      // Create another workspace
      const claimResult = await wkt(['claim', projectName]);
      expect(claimResult.exitCode).toBe(0);
      expect(claimResult.stdout).toContain('wksp-2');

      // Add config to wksp-2
      const wksp2Path = getWorkspacePath('wksp-2');
      createWorkspaceConfig(wksp2Path);

      // Run from wksp-1 targeting wksp-2
      const workspacePath = getWorkspacePath('wksp-1');
      const result = await wkt(['run', 'test-echo', `${projectName}/wksp-2`, '--force'], { cwd: workspacePath });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('wksp-2');
    });

    it('should run script in current workspace using dot shortcut', async () => {
      const workspacePath = getWorkspacePath('wksp-1');
      const result = await wkt(['run', 'test-echo', '.', '--force'], { cwd: workspacePath });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('wksp-1');
    });
  });
});
