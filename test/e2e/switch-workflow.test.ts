import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
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
  options: { env?: Record<string, string> } = {}
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const childProcess = spawn(command, args, {
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

describe('Switch Command', () => {
  let testDir: string;
  let wktHome: string;
  let sourceRepo: string;
  let wktBinary: string;

  beforeAll(async () => {
    wktBinary = join(process.cwd(), 'dist', 'index.js');

    // Build if needed
    if (!existsSync(wktBinary)) {
      execSync('bun run build', { stdio: 'pipe' });
    }

    testDir = join(tmpdir(), `wkt-switch-test-${Date.now()}`);
    wktHome = join(testDir, '.wkt');
    sourceRepo = join(testDir, 'source-repo');

    mkdirSync(wktHome, { recursive: true });
    createTestGitRepo(sourceRepo);

    // Initialize project and create workspaces with similar names
    await wkt(['init', sourceRepo, 'myproject']);
    await wkt(['create', 'myproject', 'main', '--name', 'main']);
    await wkt(['create', 'myproject', 'main-wksp-1', '--name', 'main-wksp-1']);
    await wkt(['create', 'myproject', 'main-wksp-2', '--name', 'main-wksp-2']);
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  async function wkt(args: string[]): Promise<CommandResult> {
    return runCommand('node', [wktBinary, ...args], { env: { WKT_HOME: wktHome } });
  }

  describe('Exact Name Matching', () => {
    it('should prioritize exact name match over partial matches', async () => {
      // When searching for "main", should return "main" not "main-wksp-1"
      const result = await wkt(['switch', 'main', '--path-only']);

      expect(result.exitCode).toBe(0);
      // The path should end with /main, not /main-wksp-1 or /main-wksp-2
      expect(result.stdout).toMatch(/\/main$/);
      expect(result.stdout).not.toContain('main-wksp');
    });

    it('should match exact project/name path', async () => {
      const result = await wkt(['switch', 'myproject/main-wksp-1', '--path-only']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('main-wksp-1');
    });

    it('should still match partial names when no exact match exists', async () => {
      // "wksp" should match main-wksp-1 (first shortest match)
      const result = await wkt(['switch', 'wksp', '--path-only']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('main-wksp');
    });
  });

  describe('Match Sorting', () => {
    it('should prefer shorter names after exact matches', async () => {
      // Create additional workspace with longer name
      await wkt(['create', 'myproject', 'main-wksp-1-extended', '--name', 'main-wksp-1-extended']);

      // When searching for "wksp-1", should prefer "main-wksp-1" over "main-wksp-1-extended"
      const result = await wkt(['switch', 'wksp-1', '--path-only']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('main-wksp-1');
      expect(result.stdout).not.toContain('extended');
    });

  });

  describe('Case Insensitivity', () => {
    it('should match case-insensitively', async () => {
      const result = await wkt(['switch', 'MAIN', '--path-only']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\/main$/);
    });
  });
});
