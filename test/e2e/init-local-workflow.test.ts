import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { join } from 'path';
import { spawn, execSync } from 'child_process';
import { rmSync, existsSync, mkdirSync } from 'fs';
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

describe('WKT CLI - Init Local Workflow', () => {
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

  describe('Init --local Validation', () => {
    let testDir: string;
    let wktHome: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `wkt-test-local-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      wktHome = join(testDir, '.wkt');
      mkdirSync(wktHome, { recursive: true });
    });

    afterAll(() => {
      const pattern = join(tmpdir(), 'wkt-test-local-*');
      try {
        execSync(`rm -rf ${pattern}`, { stdio: 'pipe' });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should error when --local is used without a project name', async () => {
      const result = await wkt(['init', '--local'], wktHome);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Project name is required');
    });

    it('should error when --local is used with two positional args', async () => {
      const result = await wkt(['init', '--local', 'my-project', 'extra-arg'], wktHome);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Too many arguments');
    });

    it('should show --local in init help', async () => {
      const result = await runCommand('node', [wktBinary, 'init', '--help']);

      expect(result.stdout).toContain('--local');
    });
  });

  describe('Local Project Workflow', () => {
    let testDir: string;
    let wktHome: string;

    beforeAll(() => {
      testDir = join(tmpdir(), `wkt-local-workflow-${Date.now()}`);
      wktHome = join(testDir, '.wkt');
      mkdirSync(wktHome, { recursive: true });
    });

    afterAll(() => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should initialize a local project', async () => {
      const result = await wkt(['init', '--local', 'my-local-project'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Successfully initialized');
      expect(result.stdout).toContain('my-local-project');
      expect(result.stdout).not.toContain('Repository:');
    });

    it('should list the local project', async () => {
      const result = await wkt(['init', '--list'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('my-local-project');
    });

    it('should have created the main workspace', async () => {
      const result = await wkt(['list'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('main');
    });

    it('should create a workspace in the local project', async () => {
      const result = await wkt(['create', 'my-local-project', 'feature/test'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Successfully created workspace');
    });

    it('should list both workspaces', async () => {
      const result = await wkt(['list'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('main');
      expect(result.stdout).toContain('test');
    });

    it('should switch to workspace with --path-only', async () => {
      const result = await wkt(['switch', 'test', '--path-only'], wktHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('my-local-project');
      expect(result.stdout).toContain('test');
    });

    it('should error on duplicate local project', async () => {
      const result = await wkt(['init', '--local', 'my-local-project'], wktHome);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('already exists');
    });
  });
});
