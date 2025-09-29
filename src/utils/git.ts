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
  static async executeCommand(command: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command;
      if (!cmd) {
        reject(new Error('Invalid command'));
        return;
      }
      const process = spawn(cmd, args, { 
        cwd: cwd || undefined, 
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false 
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
          reject(new Error(`Command failed: ${command.join(' ')}\n${stderr}`));
        }
      });
    });
  }

  static isGitRepository(path: string): boolean {
    return existsSync(join(path, '.git'));
  }

  static async getBareRepoUrl(repoPath: string): Promise<string> {
    try {
      const result = await this.executeCommand(['git', 'remote', 'get-url', 'origin'], repoPath);
      return result.trim();
    } catch {
      throw new Error('Failed to get repository URL');
    }
  }

  static async getCurrentBranch(workspacePath: string): Promise<string> {
    try {
      const result = await this.executeCommand(['git', 'branch', '--show-current'], workspacePath);
      return result.trim();
    } catch {
      return 'HEAD';
    }
  }

  static async getWorkspaceStatus(workspacePath: string): Promise<WorkspaceStatus> {
    try {
      const result = await this.executeCommand(['git', 'status', '--porcelain'], workspacePath);
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
        ['git', 'rev-list', '--count', `${baseBranch}..${currentBranch}`],
        workspacePath
      );
      
      const behindResult = await this.executeCommand(
        ['git', 'rev-list', '--count', `${currentBranch}..${baseBranch}`],
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
    await this.executeCommand(['git', 'clone', '--bare', repoUrl, targetPath]);
    
    // Check if origin remote already exists (git clone --bare creates it automatically)
    try {
      await this.executeCommand(['git', 'remote', 'get-url', 'origin'], targetPath);
      // Origin exists, update it to ensure it matches
      await this.executeCommand(['git', 'remote', 'set-url', 'origin', repoUrl], targetPath);
    } catch {
      // Origin doesn't exist, add it
      await this.executeCommand(['git', 'remote', 'add', 'origin', repoUrl], targetPath);
    }
  }

  static async createWorktree(bareRepoPath: string, workspacePath: string, branchName: string, baseBranch?: string): Promise<void> {
    const branchExists = await this.branchExists(bareRepoPath, branchName);

    try {
      if (baseBranch && !branchExists) {
        // For bare repos, prefer remote reference to ensure we get the latest commit
        const baseRef = await this.getLatestBranchReference(bareRepoPath, baseBranch);
        await this.executeCommand(['git', 'worktree', 'add', workspacePath, '-b', branchName, baseRef], bareRepoPath);
      } else {
        await this.executeCommand(['git', 'worktree', 'add', workspacePath, branchName], bareRepoPath);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Handle empty repository case - create orphan branch
      if (errorMessage.includes('not a valid object name') ||
          errorMessage.includes('fatal: not a valid object name') ||
          errorMessage.includes('invalid reference: HEAD')) {
        // This is an empty repository, we need to create the initial structure differently

        // Handle empty repository - create a proper initial workspace
        const originUrl = await this.executeCommand(['git', 'remote', 'get-url', 'origin'], bareRepoPath);

        // Create workspace directory
        await this.executeCommand(['mkdir', '-p', workspacePath], undefined);

        // Initialize workspace as git repository
        await this.executeCommand(['git', 'init'], workspacePath);
        await this.executeCommand(['git', 'remote', 'add', 'origin', originUrl], workspacePath);

        // Create and checkout the new branch
        await this.executeCommand(['git', 'checkout', '-b', branchName], workspacePath);

        // Try to fetch from remote to see if there are any commits
        try {
          await this.executeCommand(['git', 'fetch', 'origin'], workspacePath);
          // If fetch succeeds, try to merge or rebase from remote main/master
          try {
            await this.executeCommand(['git', 'merge', `origin/${baseBranch || 'main'}`], workspacePath);
          } catch {
            try {
              await this.executeCommand(['git', 'merge', 'origin/master'], workspacePath);
            } catch {
              // No remote branches to merge, create initial commit
              await this.executeCommand(['git', 'commit', '--allow-empty', '-m', 'Initial commit'], workspacePath);
            }
          }
        } catch {
          // No remote refs available, create initial commit
          await this.executeCommand(['git', 'commit', '--allow-empty', '-m', 'Initial commit'], workspacePath);
        }

        // Note: Not pushing to remote automatically for local development workflow
        // Users can manually push when ready with: git push -u origin <branch-name>
      } else {
        // Re-throw other errors
        throw error;
      }
    }

    // Ensure origin remote is properly configured in the worktree
    try {
      const originUrl = await this.executeCommand(['git', 'remote', 'get-url', 'origin'], bareRepoPath);

      // Check if origin already exists in worktree
      try {
        await this.executeCommand(['git', 'remote', 'get-url', 'origin'], workspacePath);
        // Origin exists, update it to match bare repo
        await this.executeCommand(['git', 'remote', 'set-url', 'origin', originUrl], workspacePath);
      } catch {
        // Origin doesn't exist, add it
        await this.executeCommand(['git', 'remote', 'add', 'origin', originUrl], workspacePath);
      }
    } catch (error) {
      console.warn('Warning: Could not configure origin remote in worktree');
    }

    // Set up local main branch for easier local rebasing (if not already the current branch)
    if (branchName !== 'main') {
      try {
        // Check if main branch exists on remote
        await this.executeCommand(['git', 'show-ref', '--verify', '--quiet', 'refs/remotes/origin/main'], workspacePath);
        // Create local tracking branch for main
        await this.executeCommand(['git', 'branch', '--track', 'main', 'origin/main'], workspacePath);
      } catch {
        // main branch doesn't exist on remote or already exists locally, skip
      }
    }
  }

  static async branchExists(bareRepoPath: string, branchName: string): Promise<boolean> {
    try {
      await this.executeCommand(['git', 'show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], bareRepoPath);
      return true;
    } catch {
      try {
        await this.executeCommand(['git', 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${branchName}`], bareRepoPath);
        return true;
      } catch {
        return false;
      }
    }
  }

  static async getLatestBranchReference(bareRepoPath: string, branchName: string): Promise<string> {
    // First, try to use the remote reference (most up-to-date)
    try {
      await this.executeCommand(['git', 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${branchName}`], bareRepoPath);
      return `origin/${branchName}`;
    } catch {
      // Fall back to local reference if remote doesn't exist
      try {
        await this.executeCommand(['git', 'show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], bareRepoPath);
        return branchName;
      } catch {
        // Try alternative remote reference formats
        try {
          // Sometimes the reference might be under refs/remotes/origin without the origin/ prefix
          const result = await this.executeCommand(['git', 'rev-parse', '--verify', `refs/remotes/origin/${branchName}`], bareRepoPath);
          if (result.trim()) {
            return `origin/${branchName}`;
          }
        } catch {
          // If all else fails, return the branch name as-is
          return branchName;
        }
        return branchName;
      }
    }
  }

  static async removeWorktree(bareRepoPath: string, workspacePath: string): Promise<void> {
    await this.executeCommand(['git', 'worktree', 'remove', workspacePath, '--force'], bareRepoPath);
  }

  static async listWorktrees(bareRepoPath: string): Promise<Array<{ path: string; branch: string; hash: string }>> {
    try {
      const result = await this.executeCommand(['git', 'worktree', 'list', '--porcelain'], bareRepoPath);
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
    try {
      await this.executeCommand(['git', 'fetch', '--all'], bareRepoPath);
    } catch (error) {
      // Handle empty repositories gracefully - they have no refs to fetch
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("couldn't find remote ref HEAD") ||
          errorMessage.includes("fatal: Couldn't find remote ref")) {
        // This is an empty repository, which is acceptable
        return;
      }
      // Re-throw other errors
      throw error;
    }
  }

  static async fetchInWorkspace(workspacePath: string): Promise<void> {
    // Fetch in the workspace - this updates the shared repository refs
    await this.executeCommand(['git', 'fetch', 'origin'], workspacePath);
  }

  static async getDefaultBranch(bareRepoPath: string): Promise<string> {
    try {
      const result = await this.executeCommand(['git', 'symbolic-ref', 'refs/remotes/origin/HEAD'], bareRepoPath);
      return result.replace('refs/remotes/origin/', '').trim();
    } catch {
      try {
        const result = await this.executeCommand(['git', 'branch', '-r'], bareRepoPath);
        const branches = result.split('\n').map(b => b.trim()).filter(b => b.length > 0);

        if (branches.find(b => b.includes('origin/main'))) return 'main';
        if (branches.find(b => b.includes('origin/master'))) return 'master';

        const firstBranch = branches.find(b => b.startsWith('origin/') && !b.includes('HEAD'));
        if (firstBranch) {
          return firstBranch.replace('origin/', '');
        }

        // No remote branches found - this is likely an empty repository
        // Default to 'main' as it's the modern Git standard
        return 'main';
      } catch {
        // If all else fails, default to 'main'
        return 'main';
      }
    }
  }

  static async rebaseBranch(workspacePath: string, baseBranch: string): Promise<void> {
    await this.executeCommand(['git', 'rebase', `origin/${baseBranch}`], workspacePath);
  }

  static async pullWithRebase(workspacePath: string): Promise<void> {
    await this.executeCommand(['git', 'pull', '--rebase'], workspacePath);
  }

  static async pushBranch(workspacePath: string, branchName: string, force: boolean = false): Promise<void> {
    const args = ['git', 'push', 'origin', branchName];
    if (force) {
      args.push('--force-with-lease');
    }
    await this.executeCommand(args, workspacePath);
  }

  static async isWorkingTreeClean(workspacePath: string): Promise<boolean> {
    const status = await this.getWorkspaceStatus(workspacePath);
    return status.clean;
  }

  static async isBranchMerged(bareRepoPath: string, branchName: string, baseBranch: string = 'main'): Promise<boolean> {
    try {
      // Method 1: Check if branch is merged using traditional git branch --merged
      const result = await this.executeCommand(['git', 'branch', '--merged', baseBranch], bareRepoPath);
      const mergedBranches = result.split('\n')
        .map(line => line.trim().replace(/^\*\s*/, ''))
        .filter(line => line.length > 0);
      
      if (mergedBranches.includes(branchName)) {
        return true;
      }

      // Method 2: Check for GitHub-style merges (squash merges, merge commits)
      // Look for merge commits in the base branch that reference the branch name or PR patterns
      const branchParts = branchName.split('/');
      const searchTerms = [
        branchName,
        branchParts[branchParts.length - 1], // Just the last part (e.g., "w34-2" from "misc/w34-2")
        branchName.replace('/', '\\/'),      // Escaped version
      ];
      
      for (const term of searchTerms) {
        const mergeCommits = await this.executeCommand(
          ['git', 'log', '--oneline', '--all', `--grep=${term}`, `origin/${baseBranch}`, '-n', '5'],
          bareRepoPath
        );
        
        if (mergeCommits.trim().length > 0) {
          return true;
        }
      }

      // Method 2b: Check for recent PR merges and match against branch patterns  
      let prNumberSearch = '';
      try {
        const logResult = await this.executeCommand(
          ['git', 'log', '--oneline', `origin/${baseBranch}`, '--since=30 days ago'],
          bareRepoPath
        );
        // Filter lines that contain PR numbers
        prNumberSearch = logResult.split('\n').filter(line => line.includes('(#')).join('\n');
      } catch {
        prNumberSearch = '';
      }
      
      if (prNumberSearch.trim().length > 0 && branchParts.length > 1) {
        // For misc branches like "misc/w34-2", check if there are recent "miscellaneous" commits
        const branchType = branchParts[0]?.toLowerCase(); // e.g., "misc"
        
        if (branchType) {
          // Check if branch type matches common patterns (misc->miscellaneous, feat->feature, etc.)
          const typePatterns = {
            'misc': ['misc', 'miscellaneous'],
            'feat': ['feat', 'feature'],
            'fix': ['fix'],
            'chore': ['chore'],
          };
          
          const patterns = typePatterns[branchType as keyof typeof typePatterns] || [branchType];
          
          for (const pattern of patterns) {
            if (prNumberSearch.toLowerCase().includes(pattern)) {
              // Found a potential match - this is likely a squash merge
              // Check if the branch age suggests it was merged recently
              const branchAge = await this.getBranchAge(bareRepoPath, branchName);
              if (branchAge && (Date.now() - branchAge.getTime()) < 30 * 24 * 60 * 60 * 1000) { // 30 days
                return true;
              }
            }
          }
        }
      }

      // Method 3: Check if branch exists on remote (if not, it might have been deleted after merge)
      try {
        await this.executeCommand(['git', 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${branchName}`], bareRepoPath);
        // Branch still exists on remote, so probably not merged
        return false;
      } catch {
        // Branch doesn't exist on remote anymore - but was it ever pushed?
        // Check git reflog or recent fetch logs to see if this branch was ever tracked
        try {
          // Check if we have any record of this branch being on remote
          const reflogCheck = await this.executeCommand(['git', 'reflog', '--all', `--grep=origin/${branchName}`, '-n', '1'], bareRepoPath);
          if (reflogCheck.trim().length === 0) {
            // No evidence this branch was ever on remote - it's local-only, don't clean
            return false;
          }
        } catch {
          // If reflog fails, err on the side of caution - don't clean local-only branches
          return false;
        }
        
        // Branch was on remote but now deleted - check if it was likely merged
        const recentCommits = await this.executeCommand(
          ['git', 'log', '--oneline', `origin/${baseBranch}`, '--since=30 days ago', '-n', '50'],
          bareRepoPath
        );
        
        // Look for commits that might reference the branch name or PR number
        const branchSearch = branchName.toLowerCase();
        return recentCommits.toLowerCase().includes(branchSearch);
      }
    } catch (error) {
      return false;
    }
  }

  static async getBranchAge(bareRepoPath: string, branchName: string): Promise<Date | null> {
    try {
      // Get the date of the last commit on the branch
      const result = await this.executeCommand(['git', 'log', '-1', '--format=%ct', branchName], bareRepoPath);
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