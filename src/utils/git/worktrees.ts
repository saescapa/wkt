import { executeCommand } from './command.js';
import { branchExists, getLatestBranchReference } from './branches.js';
import { logger } from '../logger.js';

export async function createWorktree(
  bareRepoPath: string,
  workspacePath: string,
  branchName: string,
  baseBranch?: string
): Promise<void> {
  const branchExistsResult = await branchExists(bareRepoPath, branchName);

  try {
    if (baseBranch && !branchExistsResult) {
      // For bare repos, prefer remote reference to ensure we get the latest commit
      const baseRef = await getLatestBranchReference(bareRepoPath, baseBranch);
      await executeCommand(['git', 'worktree', 'add', workspacePath, '-b', branchName, baseRef], bareRepoPath);
    } else {
      await executeCommand(['git', 'worktree', 'add', workspacePath, branchName], bareRepoPath);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle empty repository — seed the bare repo with an initial commit,
    // then retry `git worktree add` so the workspace is a real worktree
    // (not an independent clone).
    if (errorMessage.includes('not a valid object name') ||
        errorMessage.includes('fatal: not a valid object name') ||
        errorMessage.includes('invalid reference:')) {
      logger.debug('Detected empty repository, seeding bare repo with initial commit');

      const targetBranch = baseBranch || branchName;

      // Create an empty tree and commit using plumbing commands
      const emptyTree = (await executeCommand(['git', 'hash-object', '-t', 'tree', '/dev/null'], bareRepoPath)).trim();
      const commitHash = (await executeCommand(
        ['git', 'commit-tree', emptyTree, '-m', 'Initial commit'],
        bareRepoPath
      )).trim();

      // Point the target branch at this commit
      await executeCommand(['git', 'update-ref', `refs/heads/${targetBranch}`, commitHash], bareRepoPath);

      // Retry the worktree add — this time the ref exists
      if (baseBranch && branchName !== baseBranch) {
        await executeCommand(['git', 'worktree', 'add', workspacePath, '-b', branchName, targetBranch], bareRepoPath);
      } else {
        await executeCommand(['git', 'worktree', 'add', workspacePath, branchName], bareRepoPath);
      }
    } else {
      throw error;
    }
  }

  // Ensure origin remote is properly configured in the worktree
  try {
    const originUrl = await executeCommand(['git', 'remote', 'get-url', 'origin'], bareRepoPath);

    try {
      await executeCommand(['git', 'remote', 'get-url', 'origin'], workspacePath);
      await executeCommand(['git', 'remote', 'set-url', 'origin', originUrl], workspacePath);
    } catch {
      logger.debug('Adding origin remote to worktree');
      await executeCommand(['git', 'remote', 'add', 'origin', originUrl], workspacePath);
    }
  } catch (error) {
    logger.warn(`Could not configure origin remote in worktree: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Set up local main branch for easier local rebasing
  if (branchName !== 'main') {
    try {
      await executeCommand(['git', 'show-ref', '--verify', '--quiet', 'refs/remotes/origin/main'], workspacePath);
      await executeCommand(['git', 'branch', '--track', 'main', 'origin/main'], workspacePath);
    } catch {
      logger.debug('main branch not available for local tracking');
    }
  }
}

export async function removeWorktree(bareRepoPath: string, workspacePath: string): Promise<void> {
  await executeCommand(['git', 'worktree', 'remove', workspacePath, '--force'], bareRepoPath);
}

export async function moveWorktree(bareRepoPath: string, oldPath: string, newPath: string): Promise<void> {
  await executeCommand(['git', 'worktree', 'move', oldPath, newPath], bareRepoPath);
}

export async function listWorktrees(bareRepoPath: string): Promise<Array<{ path: string; branch: string; hash: string }>> {
  try {
    const result = await executeCommand(['git', 'worktree', 'list', '--porcelain'], bareRepoPath);
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
  } catch (error) {
    logger.debug(`Failed to list worktrees: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
