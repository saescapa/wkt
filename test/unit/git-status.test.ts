import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { execSync } from 'child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { getCommitsAheadOfRemote, getWorkspaceStatus } from '../../src/utils/git/status.js';

describe('Git Status Utilities', () => {
  let testDir: string;
  let remoteRepo: string;
  let localRepo: string;

  beforeAll(() => {
    testDir = join(tmpdir(), `wkt-git-status-test-${Date.now()}`);
    remoteRepo = join(testDir, 'remote.git');
    localRepo = join(testDir, 'local');

    mkdirSync(testDir, { recursive: true });

    // Create a bare "remote" repository
    mkdirSync(remoteRepo, { recursive: true });
    execSync('git init --bare', { cwd: remoteRepo, stdio: 'pipe' });

    // Create local repo and add remote
    mkdirSync(localRepo, { recursive: true });
    execSync('git init', { cwd: localRepo, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: localRepo, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: localRepo, stdio: 'pipe' });
    execSync(`git remote add origin ${remoteRepo}`, { cwd: localRepo, stdio: 'pipe' });

    // Create initial commit and push to remote
    writeFileSync(join(localRepo, 'README.md'), '# Test\n');
    execSync('git add .', { cwd: localRepo, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: localRepo, stdio: 'pipe' });
    execSync('git branch -M main', { cwd: localRepo, stdio: 'pipe' });
    execSync('git push -u origin main', { cwd: localRepo, stdio: 'pipe' });
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getCommitsAheadOfRemote', () => {
    it('should return 0 commits when in sync with remote', async () => {
      const result = await getCommitsAheadOfRemote(localRepo, 'main');

      expect(result.count).toBe(0);
      expect(result.commits).toHaveLength(0);
    });

    it('should detect commits ahead of remote', async () => {
      // Create a new commit locally
      writeFileSync(join(localRepo, 'file1.txt'), 'content1');
      execSync('git add .', { cwd: localRepo, stdio: 'pipe' });
      execSync('git commit -m "Add file1"', { cwd: localRepo, stdio: 'pipe' });

      const result = await getCommitsAheadOfRemote(localRepo, 'main');

      expect(result.count).toBe(1);
      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].message).toBe('Add file1');
    });

    it('should detect multiple commits ahead of remote', async () => {
      // Create another commit
      writeFileSync(join(localRepo, 'file2.txt'), 'content2');
      execSync('git add .', { cwd: localRepo, stdio: 'pipe' });
      execSync('git commit -m "Add file2"', { cwd: localRepo, stdio: 'pipe' });

      const result = await getCommitsAheadOfRemote(localRepo, 'main');

      expect(result.count).toBe(2);
      expect(result.commits).toHaveLength(2);
      // Commits should be in reverse chronological order
      expect(result.commits[0].message).toBe('Add file2');
      expect(result.commits[1].message).toBe('Add file1');
    });

    it('should handle origin/ prefix in branch name', async () => {
      const result = await getCommitsAheadOfRemote(localRepo, 'origin/main');

      expect(result.count).toBe(2);
    });

    it('should return 0 for non-existent remote branch', async () => {
      const result = await getCommitsAheadOfRemote(localRepo, 'nonexistent');

      expect(result.count).toBe(0);
      expect(result.commits).toHaveLength(0);
    });
  });

  describe('getWorkspaceStatus', () => {
    it('should detect clean workspace', async () => {
      // Ensure clean state
      execSync('git checkout .', { cwd: localRepo, stdio: 'pipe' });
      execSync('git clean -fd', { cwd: localRepo, stdio: 'pipe' });

      const status = await getWorkspaceStatus(localRepo);

      expect(status.clean).toBe(true);
      expect(status.staged).toBe(0);
      expect(status.unstaged).toBe(0);
      expect(status.untracked).toBe(0);
    });

    it('should detect untracked files', async () => {
      writeFileSync(join(localRepo, 'untracked.txt'), 'untracked');

      const status = await getWorkspaceStatus(localRepo);

      expect(status.clean).toBe(false);
      expect(status.untracked).toBe(1);

      // Cleanup
      rmSync(join(localRepo, 'untracked.txt'));
    });

    it('should detect dirty workspace (staged or unstaged)', async () => {
      // Add a new file and stage it
      writeFileSync(join(localRepo, 'new-file.txt'), 'new content');
      execSync('git add new-file.txt', { cwd: localRepo, stdio: 'pipe' });

      const status = await getWorkspaceStatus(localRepo);

      expect(status.clean).toBe(false);
      // Either staged or unstaged should be non-zero
      expect(status.staged + status.unstaged).toBeGreaterThan(0);

      // Cleanup
      execSync('git reset HEAD new-file.txt', { cwd: localRepo, stdio: 'pipe' });
      rmSync(join(localRepo, 'new-file.txt'));
    });
  });
});
