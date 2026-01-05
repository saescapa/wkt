import { executeCommand } from './command.js';
import { branchExists, getLatestBranchReference, getCurrentBranch } from './branches.js';
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

    // Handle empty repository case - create orphan branch
    if (errorMessage.includes('not a valid object name') ||
        errorMessage.includes('fatal: not a valid object name') ||
        errorMessage.includes('invalid reference: HEAD')) {
      logger.debug('Detected empty repository, creating initial workspace structure');

      const originUrl = await executeCommand(['git', 'remote', 'get-url', 'origin'], bareRepoPath);

      // Create workspace directory
      await executeCommand(['mkdir', '-p', workspacePath], undefined);

      // Initialize workspace as git repository
      await executeCommand(['git', 'init'], workspacePath);
      await executeCommand(['git', 'remote', 'add', 'origin', originUrl], workspacePath);

      // Create and checkout the new branch
      await executeCommand(['git', 'checkout', '-b', branchName], workspacePath);

      // Try to fetch from remote to see if there are any commits
      try {
        await executeCommand(['git', 'fetch', 'origin'], workspacePath);
        try {
          await executeCommand(['git', 'merge', `origin/${baseBranch || 'main'}`], workspacePath);
        } catch {
          try {
            await executeCommand(['git', 'merge', 'origin/master'], workspacePath);
          } catch {
            logger.debug('No remote branches to merge, creating initial commit');
            await executeCommand(['git', 'commit', '--allow-empty', '-m', 'Initial commit'], workspacePath);
          }
        }
      } catch {
        logger.debug('No remote refs available, creating initial commit');
        await executeCommand(['git', 'commit', '--allow-empty', '-m', 'Initial commit'], workspacePath);
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

/**
 * Create a detached worktree at a specific commit (for pool workspaces)
 * Returns the commit SHA
 */
export async function createDetachedWorktree(
  bareRepoPath: string,
  workspacePath: string,
  trackingBranch: string
): Promise<string> {
  // Get the latest reference for the tracking branch
  const branchRef = await getLatestBranchReference(bareRepoPath, trackingBranch);

  // Create worktree in detached HEAD state at the commit
  // --detach flag creates worktree at commit without creating a branch
  await executeCommand(['git', 'worktree', 'add', '--detach', workspacePath, branchRef], bareRepoPath);

  // Get the commit SHA we ended up at
  const commitSHA = await executeCommand(['git', 'rev-parse', 'HEAD'], workspacePath);

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

  return commitSHA;
}

/**
 * Reset a detached worktree to the latest commit of a tracking branch
 * Returns the new commit SHA
 */
export async function resetDetachedWorktree(
  bareRepoPath: string,
  workspacePath: string,
  trackingBranch: string
): Promise<string> {
  // Fetch to ensure we have the latest
  try {
    await executeCommand(['git', 'fetch', 'origin'], workspacePath);
  } catch (error) {
    logger.debug(`Fetch failed, continuing with local refs: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Get the latest reference for the tracking branch
  const branchRef = await getLatestBranchReference(bareRepoPath, trackingBranch);

  // Hard reset to the latest commit
  await executeCommand(['git', 'reset', '--hard', branchRef], workspacePath);

  // Clean any untracked files
  await executeCommand(['git', 'clean', '-fd'], workspacePath);

  // Get the commit SHA we ended up at
  const commitSHA = await executeCommand(['git', 'rev-parse', 'HEAD'], workspacePath);

  return commitSHA;
}

/**
 * Create a branch from the current detached HEAD state
 */
export async function createBranchFromDetached(
  workspacePath: string,
  branchName: string
): Promise<void> {
  // Verify we're in detached HEAD state
  const currentBranch = await getCurrentBranch(workspacePath);
  if (currentBranch !== 'HEAD') {
    throw new Error(`Workspace is not in detached HEAD state (currently on branch '${currentBranch}')`);
  }

  // Create and checkout the new branch from current HEAD
  await executeCommand(['git', 'checkout', '-b', branchName], workspacePath);
}
