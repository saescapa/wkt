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

describe('Merge conflict handling', () => {
  let wktBinary: string;
  let testDir: string;
  let wktHome: string;
  const projectName = 'conflict-project';

  async function wkt(args: string[]): Promise<CommandResult> {
    return runCommand('node', [wktBinary, '-y', ...args], { env: { WKT_HOME: wktHome } });
  }

  beforeAll(async () => {
    wktBinary = join(process.cwd(), 'dist', 'index.js');
    if (!existsSync(wktBinary)) {
      throw new Error('dist/index.js missing — run `bun run build` first');
    }

    const baseTmpDir = realpathSync(tmpdir());
    testDir = join(baseTmpDir, `wkt-merge-conflict-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    wktHome = join(testDir, '.wkt');
    mkdirSync(wktHome, { recursive: true });

    const sourceRepo = join(testDir, 'source-repo');
    createSourceRepo(sourceRepo);
    const init = await wkt(['init', sourceRepo, projectName]);
    expect(init.exitCode).toBe(0);

    const bareRepo = join(wktHome, 'projects', projectName);
    git(bareRepo, 'config user.email "test@test.com"');
    git(bareRepo, 'config user.name "Test User"');
  });

  afterAll(() => {
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('reports conflicts and leaves the target resolvable instead of crashing', async () => {
    const mainWs = join(wktHome, 'workspaces', projectName, 'main');
    const featureWs = join(wktHome, 'workspaces', projectName, 'conflicting');

    await wkt(['create', projectName, 'conflicting']);

    // Both sides edit the same line of README.md
    writeFileSync(join(featureWs, 'README.md'), '# Feature version\n');
    git(featureWs, 'add README.md');
    git(featureWs, 'commit -qm "Feature edit"');

    writeFileSync(join(mainWs, 'README.md'), '# Main version\n');
    git(mainWs, 'add README.md');
    git(mainWs, 'commit -qm "Main edit"');

    const result = await wkt(['merge', 'conflicting']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Merge conflicts detected');
    expect(result.stdout).toContain('git merge --abort');

    // Target workspace is mid-merge with a conflicted file
    const status = git(mainWs, 'status --porcelain');
    expect(status).toContain('UU README.md');

    // The source workspace was NOT cleaned up despite the failed merge
    expect(existsSync(featureWs)).toBe(true);

    // And the merge is cleanly abortable, restoring the target
    git(mainWs, 'merge --abort');
    expect(git(mainWs, 'status --porcelain').trim()).toBe('');
  });
});
