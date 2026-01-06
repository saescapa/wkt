import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { join } from 'path';
import { spawn, execSync } from 'child_process';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
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

describe('WKT CLI', () => {
  let wktBinary: string;

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
  });

  async function wkt(args: string[], wktHome: string): Promise<CommandResult> {
    return runCommand('node', [wktBinary, ...args], { env: { WKT_HOME: wktHome } });
  }

  describe('Basic Commands', () => {
    let testDir: string;
    let wktHome: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `wkt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      wktHome = join(testDir, '.wkt');
      mkdirSync(wktHome, { recursive: true });
    });

    afterAll(() => {
      // Clean up any remaining test directories
      const pattern = join(tmpdir(), 'wkt-test-*');
      try {
        execSync(`rm -rf ${pattern}`, { stdio: 'pipe' });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should show help when no arguments provided', async () => {
      const result = await wkt([], wktHome);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Usage: wkt');
      expect(result.stdout).toContain('Commands:');
    });

    it('should handle --version flag', async () => {
      const result = await wkt(['--version'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('0.1.0');
    });

    it('should show no projects when listing initially', async () => {
      const result = await wkt(['init', '--list'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No projects initialized yet');
    });

    it('should show empty workspace list initially', async () => {
      const result = await wkt(['list'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No workspaces found');
    });

    it('should error on non-existent project', async () => {
      const result = await wkt(['create', 'fake-project', 'feature/test'], wktHome);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Project 'fake-project' not found");
    });

    it('should error on non-existent workspace switch', async () => {
      const result = await wkt(['switch', 'fake-workspace'], wktHome);

      expect(result.exitCode).toBe(1);
      // When no workspaces exist, we get "No workspace detected" instead of "not found"
      expect(result.stderr).toMatch(/not found|No workspace detected/);
    });
  });

  describe('Command Help', () => {
    async function getHelp(command: string): Promise<string> {
      const result = await runCommand('node', [wktBinary, command, '--help']);
      return result.stdout;
    }

    it('init command help', async () => {
      const help = await getHelp('init');

      expect(help).toContain('Initialize WKT with a repository');
      expect(help).toContain('[repository-url]');
      expect(help).toContain('--list');
    });

    it('create command help', async () => {
      const help = await getHelp('create');

      expect(help).toContain('Create a new workspace');
      expect(help).toContain('[project]');
      expect(help).toContain('[branch-name]');
      expect(help).toContain('--from');
      expect(help).toContain('--name');
    });

    it('switch command help', async () => {
      const help = await getHelp('switch');

      expect(help).toContain('Switch to an existing workspace');
      expect(help).toContain('--project');
    });

    it('list command help', async () => {
      const help = await getHelp('list');

      expect(help).toContain('List all workspaces');
      expect(help).toContain('--project');
      expect(help).toContain('--details');
    });

    it('clean command help', async () => {
      const help = await getHelp('clean');

      expect(help).toContain('Clean up');
      expect(help).toContain('--older-than');
    });

    it('save command help', async () => {
      const help = await getHelp('save');

      expect(help).toContain('Save changes from claimed workspace');
      expect(help).toContain('--branch');
      expect(help).toContain('--stash');
      expect(help).toContain('--discard');
      expect(help).toContain('--push');
    });
  });

  describe('Full Workflow', () => {
    let testDir: string;
    let wktHome: string;
    let sourceRepo: string;

    beforeAll(() => {
      testDir = join(tmpdir(), `wkt-workflow-${Date.now()}`);
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

    it('should initialize project from local repo', async () => {
      const result = await wkt(['init', sourceRepo, 'test-project'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Successfully initialized');
      expect(result.stdout).toContain('test-project');
    });

    it('should list the initialized project', async () => {
      const result = await wkt(['init', '--list'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('test-project');
    });

    it('should create a workspace', async () => {
      const result = await wkt(['create', 'test-project', 'feature/auth'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Successfully created workspace');
      expect(result.stdout).toContain('auth');
    });

    it('should list the created workspace', async () => {
      const result = await wkt(['list'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('auth');
    });

    it('should show workspace info', async () => {
      // First switch to the workspace to make it current
      await wkt(['switch', 'auth', '--path-only'], wktHome);

      const result = await wkt(['info'], wktHome);

      // Info might show current workspace or prompt
      expect(result.exitCode).toBe(0);
    });

    it('should create a second workspace', async () => {
      const result = await wkt(['create', 'test-project', 'feature/payments'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Successfully created workspace');
    });

    it('should list both workspaces', async () => {
      const result = await wkt(['list'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('auth');
      expect(result.stdout).toContain('payments');
    });

    it('should switch workspace with --path-only', async () => {
      const result = await wkt(['switch', 'auth', '--path-only'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('test-project');
      expect(result.stdout).toContain('auth');
    });

    it('should error on duplicate workspace', async () => {
      const result = await wkt(['create', 'test-project', 'feature/auth'], wktHome);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('already exists');
    });

    it('should error on duplicate project init', async () => {
      const result = await wkt(['init', sourceRepo, 'test-project'], wktHome);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('already exists');
    });

    it('should filter workspaces by project', async () => {
      const result = await wkt(['list', '--project', 'test-project'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('auth');
      expect(result.stdout).toContain('payments');
    });

    it('should clean up merged workspace', async () => {
      // Create a workspace that we'll "merge" by deleting
      await wkt(['create', 'test-project', 'feature/temp-branch'], wktHome);

      // Clean with the workspace name
      const result = await wkt(['clean', 'temp-branch', '--force'], wktHome);

      expect(result.exitCode).toBe(0);
    });
  });
});
