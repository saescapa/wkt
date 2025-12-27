import { executeCommand } from './command.js';
import { logger } from '../logger.js';

export async function getCurrentBranch(workspacePath: string): Promise<string> {
  try {
    const result = await executeCommand(['git', 'branch', '--show-current'], workspacePath);
    return result.trim();
  } catch (error) {
    logger.debug(`Failed to get current branch: ${error instanceof Error ? error.message : String(error)}`);
    return 'HEAD';
  }
}

export async function branchExists(bareRepoPath: string, branchName: string): Promise<boolean> {
  try {
    await executeCommand(['git', 'show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], bareRepoPath);
    return true;
  } catch {
    try {
      await executeCommand(['git', 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${branchName}`], bareRepoPath);
      return true;
    } catch {
      logger.debug(`Branch '${branchName}' not found locally or on remote`);
      return false;
    }
  }
}

export async function getLatestBranchReference(bareRepoPath: string, branchName: string): Promise<string> {
  // First, try to use the remote reference (most up-to-date)
  try {
    await executeCommand(['git', 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${branchName}`], bareRepoPath);
    return `origin/${branchName}`;
  } catch {
    logger.debug(`Remote reference for '${branchName}' not found, trying local`);

    try {
      await executeCommand(['git', 'show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], bareRepoPath);
      return branchName;
    } catch {
      // Try alternative remote reference formats
      try {
        const result = await executeCommand(['git', 'rev-parse', '--verify', `refs/remotes/origin/${branchName}`], bareRepoPath);
        if (result.trim()) {
          return `origin/${branchName}`;
        }
      } catch {
        logger.debug(`Could not find any reference for branch '${branchName}', using as-is`);
      }
      return branchName;
    }
  }
}

export async function rebaseBranch(workspacePath: string, baseBranch: string): Promise<void> {
  // Get the bare repo path from the worktree to find the correct branch reference
  const gitDir = await executeCommand(['git', 'rev-parse', '--git-common-dir'], workspacePath);
  const bareRepoPath = gitDir.trim();

  // Use getLatestBranchReference to intelligently find the correct reference
  const branchRef = await getLatestBranchReference(bareRepoPath, baseBranch);

  await executeCommand(['git', 'rebase', branchRef], workspacePath);
}

export async function isBranchMerged(bareRepoPath: string, branchName: string, baseBranch: string = 'main'): Promise<boolean> {
  try {
    // Method 1: Check if branch is merged using traditional git branch --merged
    const result = await executeCommand(['git', 'branch', '--merged', baseBranch], bareRepoPath);
    const mergedBranches = result.split('\n')
      .map(line => line.trim().replace(/^\*\s*/, ''))
      .filter(line => line.length > 0);

    if (mergedBranches.includes(branchName)) {
      return true;
    }

    // Method 2: Check for GitHub-style merges (squash merges, merge commits)
    const branchParts = branchName.split('/');
    const searchTerms = [
      branchName,
      branchParts[branchParts.length - 1],
      branchName.replace('/', '\\/'),
    ];

    for (const term of searchTerms) {
      try {
        const mergeCommits = await executeCommand(
          ['git', 'log', '--oneline', '--all', `--grep=${term}`, `origin/${baseBranch}`, '-n', '5'],
          bareRepoPath
        );

        if (mergeCommits.trim().length > 0) {
          return true;
        }
      } catch (error) {
        logger.debug(`Failed to search for merge commits with term '${term}': ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Method 2b: Check for recent PR merges and match against branch patterns
    let prNumberSearch = '';
    try {
      const logResult = await executeCommand(
        ['git', 'log', '--oneline', `origin/${baseBranch}`, '--since=30 days ago'],
        bareRepoPath
      );
      prNumberSearch = logResult.split('\n').filter(line => line.includes('(#')).join('\n');
    } catch (error) {
      logger.debug(`Failed to get PR search results: ${error instanceof Error ? error.message : String(error)}`);
      prNumberSearch = '';
    }

    if (prNumberSearch.trim().length > 0 && branchParts.length > 1) {
      const branchType = branchParts[0]?.toLowerCase();

      if (branchType) {
        const typePatterns: Record<string, string[]> = {
          'misc': ['misc', 'miscellaneous'],
          'feat': ['feat', 'feature'],
          'fix': ['fix'],
          'chore': ['chore'],
        };

        const patterns = typePatterns[branchType] ?? [branchType];

        for (const pattern of patterns) {
          if (prNumberSearch.toLowerCase().includes(pattern)) {
            const branchAge = await getBranchAge(bareRepoPath, branchName);
            if (branchAge && (Date.now() - branchAge.getTime()) < 30 * 24 * 60 * 60 * 1000) {
              return true;
            }
          }
        }
      }
    }

    // Method 3: Check if branch exists on remote
    try {
      await executeCommand(['git', 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${branchName}`], bareRepoPath);
      // Branch still exists on remote, so probably not merged
      return false;
    } catch {
      // Branch doesn't exist on remote anymore - check reflog
      try {
        const reflogCheck = await executeCommand(['git', 'reflog', '--all', `--grep=origin/${branchName}`, '-n', '1'], bareRepoPath);
        if (reflogCheck.trim().length === 0) {
          // No evidence this branch was ever on remote - it's local-only
          return false;
        }
      } catch (error) {
        logger.debug(`Failed to check reflog: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }

      // Branch was on remote but now deleted - check if it was likely merged
      try {
        const recentCommits = await executeCommand(
          ['git', 'log', '--oneline', `origin/${baseBranch}`, '--since=30 days ago', '-n', '50'],
          bareRepoPath
        );

        const branchSearch = branchName.toLowerCase();
        return recentCommits.toLowerCase().includes(branchSearch);
      } catch (error) {
        logger.debug(`Failed to check recent commits: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    }
  } catch (error) {
    logger.debug(`isBranchMerged failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function getBranchAge(bareRepoPath: string, branchName: string): Promise<Date | null> {
  try {
    const result = await executeCommand(['git', 'log', '-1', '--format=%ct', branchName], bareRepoPath);
    const timestamp = parseInt(result.trim(), 10);

    if (isNaN(timestamp)) {
      return null;
    }

    return new Date(timestamp * 1000);
  } catch (error) {
    logger.debug(`Failed to get branch age: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
