import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import type { WorkspaceStatus } from '../core/types.js';

export class GitUtils {
  static async executeCommand(command: string, cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ');
      const process = spawn(cmd, args, { 
        cwd, 
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true 
      });

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Command failed: ${command}\n${stderr}`));
        }
      });
    });
  }

  static isGitRepository(path: string): boolean {
    return existsSync(join(path, '.git'));
  }

  static async getBareRepoUrl(repoPath: string): Promise<string> {
    try {
      const result = await this.executeCommand('git remote get-url origin', repoPath);
      return result.trim();
    } catch {
      throw new Error('Failed to get repository URL');
    }
  }

  static async getCurrentBranch(workspacePath: string): Promise<string> {
    try {
      const result = await this.executeCommand('git branch --show-current', workspacePath);
      return result.trim();
    } catch {
      return 'HEAD';
    }
  }

  static async getWorkspaceStatus(workspacePath: string): Promise<WorkspaceStatus> {
    try {
      const result = await this.executeCommand('git status --porcelain', workspacePath);
      const lines = result.split('\n').filter(line => line.trim());

      let staged = 0;
      let unstaged = 0;
      let untracked = 0;
      let conflicted = 0;

      for (const line of lines) {
        const indexStatus = line[0];
        const workTreeStatus = line[1];

        if (indexStatus === 'U' || workTreeStatus === 'U' || 
            (indexStatus === 'A' && workTreeStatus === 'A') ||
            (indexStatus === 'D' && workTreeStatus === 'D')) {
          conflicted++;
        } else if (indexStatus === '?') {
          untracked++;
        } else {
          if (indexStatus !== ' ' && indexStatus !== '?') staged++;
          if (workTreeStatus !== ' ' && workTreeStatus !== '?') unstaged++;
        }
      }

      return {
        clean: lines.length === 0,
        staged,
        unstaged,
        untracked,
        conflicted,
      };
    } catch {
      return {
        clean: true,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
      };
    }
  }

  static async getCommitsDiff(workspacePath: string, baseBranch: string): Promise<{ ahead: number; behind: number }> {
    try {
      const currentBranch = await this.getCurrentBranch(workspacePath);
      
      const aheadResult = await this.executeCommand(
        `git rev-list --count ${baseBranch}..${currentBranch}`,
        workspacePath
      );
      
      const behindResult = await this.executeCommand(
        `git rev-list --count ${currentBranch}..${baseBranch}`,
        workspacePath
      );

      return {
        ahead: parseInt(aheadResult.trim()) || 0,
        behind: parseInt(behindResult.trim()) || 0,
      };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  }

  static async cloneBareRepository(repoUrl: string, targetPath: string): Promise<void> {
    await this.executeCommand(`git clone --bare "${repoUrl}" "${targetPath}"`);
  }

  static async createWorktree(bareRepoPath: string, workspacePath: string, branchName: string, baseBranch?: string): Promise<void> {
    const branchExists = await this.branchExists(bareRepoPath, branchName);
    
    if (baseBranch && !branchExists) {
      await this.executeCommand(`git worktree add "${workspacePath}" -b "${branchName}" "${baseBranch}"`, bareRepoPath);
    } else {
      await this.executeCommand(`git worktree add "${workspacePath}" "${branchName}"`, bareRepoPath);
    }

    // Add origin remote to the worktree so git rebase origin/main works
    try {
      const originUrl = await this.executeCommand('git remote get-url origin', bareRepoPath);
      await this.executeCommand(`git remote add origin "${originUrl}"`, workspacePath);
    } catch (error) {
      // If getting/setting origin fails, continue - worktree will still function
      console.warn('Warning: Could not configure origin remote in worktree');
    }
  }

  static async branchExists(bareRepoPath: string, branchName: string): Promise<boolean> {
    try {
      await this.executeCommand(`git show-ref --verify --quiet refs/heads/${branchName}`, bareRepoPath);
      return true;
    } catch {
      try {
        await this.executeCommand(`git show-ref --verify --quiet refs/remotes/origin/${branchName}`, bareRepoPath);
        return true;
      } catch {
        return false;
      }
    }
  }

  static async removeWorktree(bareRepoPath: string, workspacePath: string): Promise<void> {
    await this.executeCommand(`git worktree remove "${workspacePath}" --force`, bareRepoPath);
  }

  static async listWorktrees(bareRepoPath: string): Promise<Array<{ path: string; branch: string; hash: string }>> {
    try {
      const result = await this.executeCommand('git worktree list --porcelain', bareRepoPath);
      const lines = result.split('\n');
      const worktrees: Array<{ path: string; branch: string; hash: string }> = [];
      
      let current: Partial<{ path: string; branch: string; hash: string }> = {};
      
      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          current.path = line.substring(9);
        } else if (line.startsWith('branch ')) {
          current.branch = line.substring(7);
        } else if (line.startsWith('HEAD ')) {
          current.hash = line.substring(5);
        } else if (line === '') {
          if (current.path && current.branch && current.hash) {
            worktrees.push(current as { path: string; branch: string; hash: string });
          }
          current = {};
        }
      }
      
      if (current.path && current.branch && current.hash) {
        worktrees.push(current as { path: string; branch: string; hash: string });
      }
      
      return worktrees;
    } catch {
      return [];
    }
  }

  static async fetchAll(bareRepoPath: string): Promise<void> {
    await this.executeCommand('git fetch --all', bareRepoPath);
  }

  static async getDefaultBranch(bareRepoPath: string): Promise<string> {
    try {
      const result = await this.executeCommand('git symbolic-ref refs/remotes/origin/HEAD', bareRepoPath);
      return result.replace('refs/remotes/origin/', '').trim();
    } catch {
      try {
        const result = await this.executeCommand('git branch -r', bareRepoPath);
        const branches = result.split('\n').map(b => b.trim());
        
        if (branches.find(b => b.includes('origin/main'))) return 'main';
        if (branches.find(b => b.includes('origin/master'))) return 'master';
        
        const firstBranch = branches.find(b => b.startsWith('origin/') && !b.includes('HEAD'));
        return firstBranch ? firstBranch.replace('origin/', '') : 'main';
      } catch {
        return 'main';
      }
    }
  }
}