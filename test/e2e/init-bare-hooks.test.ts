import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { spawn, execSync } from 'child_process';
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync, realpathSync } from 'fs';
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
    childProcess.stdout?.on('data', (d) => { stdout += d.toString(); });
    childProcess.stderr?.on('data', (d) => { stderr += d.toString(); });
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
 * Init / Bare-repo / Hooks E2E Tests
 * ==================================
 *
 * Regression guard for the core.bare handling. The project repo must stay BARE
 * so its own directory doesn't occupy `main` (which broke `wkt init`'s main
 * workspace creation). At the same time, post-checkout hooks must still run in
 * worktrees of the bare repo — the behavior the (since-removed) disableBareFlag
 * workaround was trying to protect.
 */
describe('Init / bare repo / hooks', () => {
  let wktBinary: string;
  let testDir: string;
  let wktHome: string;
  let sourceRepo: string;
  const projectName = 'bare-hooks-project';

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
    testDir = join(baseTmpDir, `wkt-bare-hooks-test-${Date.now()}`);
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

  async function wkt(args: string[], options: { cwd?: string } = {}): Promise<CommandResult> {
    return runCommand('node', [wktBinary, ...args], {
      cwd: options.cwd,
      env: { WKT_HOME: wktHome },
    });
  }

  function bareRepoPath(): string {
    return join(wktHome, 'projects', projectName);
  }

  it('should initialize and create the main workspace without a bare-root collision', async () => {
    const result = await wkt(['init', sourceRepo, projectName]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Successfully initialized');
    expect(existsSync(join(wktHome, 'workspaces', projectName, 'main'))).toBe(true);
  });

  it('should keep the project repo bare', () => {
    // The whole regression hinges on this staying true.
    const isBare = execSync(`git -C "${bareRepoPath()}" rev-parse --is-bare-repository`, {
      stdio: 'pipe',
    }).toString().trim();
    expect(isBare).toBe('true');
  });

  it('should run a post-checkout hook inside a newly created worktree', async () => {
    // Install a post-checkout hook on the bare repo that records the result of
    // `git rev-parse --show-toplevel` — the call that failed under the old bug.
    const hookPath = join(bareRepoPath(), 'hooks', 'post-checkout');
    writeFileSync(
      hookPath,
      ['#!/bin/sh', 'top=$(git rev-parse --show-toplevel 2>&1)', 'printf "%s" "$top" > "$top/.hook-marker"'].join('\n') + '\n'
    );
    chmodSync(hookPath, 0o755);

    const result = await wkt(['create', projectName, 'feat/hooked']);
    expect(result.exitCode).toBe(0);

    // feat/hooked sanitizes to the directory name 'feat-hooked'.
    const workspacePath = join(wktHome, 'workspaces', projectName, 'feat-hooked');
    const markerPath = join(workspacePath, '.hook-marker');
    expect(existsSync(markerPath)).toBe(true);
    // The hook's rev-parse succeeded and resolved to the worktree, not an error.
    expect(readFileSync(markerPath, 'utf-8')).toContain(workspacePath);
  });
});
