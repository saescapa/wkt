import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import type { WorkspaceStatus } from '../core/types.js';

export function parseDuration(duration: string): number {
  const regex = /^(\d+)([dwmy])$/;
  const match = duration.match(regex);
  
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like '30d', '2w', '6m', '1y'`);
  }
  
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  
  const msInDay = 24 * 60 * 60 * 1000;
  
  switch (unit) {
    case 'd': return value * msInDay;
    case 'w': return value * 7 * msInDay;
    case 'm': return value * 30 * msInDay;
    case 'y': return value * 365 * msInDay;
    default: throw new Error(`Unknown duration unit: ${unit}`);
  }
}

export class GitUtils {
  static async executeCommand(command: string, cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ');
      if (!cmd) {
        reject(new Error('Invalid command'));
        return;
      }
      const process = spawn(cmd, args, { 
        cwd: cwd || undefined, 
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true 
      });

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      process.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      process.on('close', (code: number | null) => {
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
    
    // Add origin remote to bare repository so worktrees can inherit it
    await this.executeCommand(`git remote add origin "${repoUrl}"`, targetPath);
  }

  static async createWorktree(bareRepoPath: string, workspacePath: string, branchName: string, baseBranch?: string): Promise<void> {
    const branchExists = await this.branchExists(bareRepoPath, branchName);
    
    if (baseBranch && !branchExists) {
      await this.executeCommand(`git worktree add "${workspacePath}" -b "${branchName}" "${baseBranch}"`, bareRepoPath);
    } else {
      await this.executeCommand(`git worktree add "${workspacePath}" "${branchName}"`, bareRepoPath);
    }

    // Ensure origin remote is properly configured in the worktree
    try {
      const originUrl = await this.executeCommand('git remote get-url origin', bareRepoPath);
      
      // Check if origin already exists in worktree
      try {
        await this.executeCommand('git remote get-url origin', workspacePath);
        // Origin exists, update it to match bare repo
        await this.executeCommand(`git remote set-url origin "${originUrl}"`, workspacePath);
      } catch {
        // Origin doesn't exist, add it
        await this.executeCommand(`git remote add origin "${originUrl}"`, workspacePath);
      }
    } catch (error) {
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

  static async fetchInWorkspace(workspacePath: string): Promise<void> {
    // Fetch in the workspace - this updates the shared repository refs
    await this.executeCommand('git fetch origin', workspacePath);
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

  static async rebaseBranch(workspacePath: string, baseBranch: string): Promise<void> {
    await this.executeCommand(`git rebase origin/${baseBranch}`, workspacePath);
  }

  static async pullWithRebase(workspacePath: string): Promise<void> {
    await this.executeCommand('git pull --rebase', workspacePath);
  }

  static async pushBranch(workspacePath: string, branchName: string, force: boolean = false): Promise<void> {
    const forceFlag = force ? '--force-with-lease' : '';
    await this.executeCommand(`git push origin ${branchName} ${forceFlag}`.trim(), workspacePath);
  }

  static async isWorkingTreeClean(workspacePath: string): Promise<boolean> {
    const status = await this.getWorkspaceStatus(workspacePath);
    return status.clean;
  }

  static async isBranchMerged(bareRepoPath: string, branchName: string, baseBranch: string = 'main'): Promise<boolean> {
    try {
      // Check if branch is merged into base branch
      const result = await this.executeCommand(`git branch --merged ${baseBranch}`, bareRepoPath);
      const mergedBranches = result.split('\n')
        .map(line => line.trim().replace(/^\*\s*/, ''))
        .filter(line => line.length > 0);
      
      return mergedBranches.includes(branchName);
    } catch (error) {
      return false;
    }
  }

  static async getBranchAge(bareRepoPath: string, branchName: string): Promise<Date | null> {
    try {
      // Get the date of the last commit on the branch
      const result = await this.executeCommand(`git log -1 --format=%ct ${branchName}`, bareRepoPath);
      const timestamp = parseInt(result.trim(), 10);
      
      if (isNaN(timestamp)) {
        return null;
      }
      
      return new Date(timestamp * 1000);
    } catch (error) {
      return null;
    }
  }
}