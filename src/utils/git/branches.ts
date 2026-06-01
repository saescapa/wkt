import { executeCommand } from './command.js';
import { logger } from '../logger.js';

export async function getCurrentBranch(workspacePath: string): Promise<string> {
  try {
    const result = await executeCommand(['git', 'branch', '--show-current'], workspacePath);
    const branch = result.trim();
    // Empty string means detached HEAD state
    return branch || 'HEAD';
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

export type MergeStatus = 'merged' | 'unmerged' | 'unknown';

export interface MergeCheckResult {
  status: MergeStatus;
  /** Human-readable explanation, set when status is 'unknown'. */
  reason?: string;
}

/**
 * Resolve the most authoritative ref for the base branch, preferring the
 * remote tracking ref (kept fresh by `wkt clean`'s fetch) over the local head.
 * Returns null when neither exists.
 */
async function resolveBaseRef(bareRepoPath: string, baseBranch: string): Promise<string | null> {
  try {
    await executeCommand(['git', 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${baseBranch}`], bareRepoPath);
    return `origin/${baseBranch}`;
  } catch {
    // No remote tracking ref; fall back to the local head.
  }

  try {
    await executeCommand(['git', 'show-ref', '--verify', '--quiet', `refs/heads/${baseBranch}`], bareRepoPath);
    return baseBranch;
  } catch {
    return null;
  }
}

/**
 * Determine whether a branch's work has landed in the base branch.
 *
 * Uses two git-native checks, no commit-message heuristics:
 *   1. Containment — the branch has no commits beyond base. Covers fast-forward
 *      merges, merge commits, and rebase-onto-base.
 *   2. Squash detection — synthesize a single squashed commit of the branch on
 *      top of the merge-base and check whether an equivalent patch already
 *      exists in base. GitHub computes a squash as the `base...head` diff
 *      (relative to the merge-base), so the patch-ids match.
 *
 * Returns 'unknown' (rather than guessing) when the comparison can't be made —
 * e.g. the base ref or branch is missing, or there's no shared history.
 */
export async function getMergeStatus(
  bareRepoPath: string,
  branchName: string,
  baseBranch: string = 'main'
): Promise<MergeCheckResult> {
  const baseRef = await resolveBaseRef(bareRepoPath, baseBranch);
  if (!baseRef) {
    return {
      status: 'unknown',
      reason: `base branch '${baseBranch}' not found locally or on origin (try fetching)`,
    };
  }

  try {
    await executeCommand(['git', 'rev-parse', '--verify', '--quiet', branchName], bareRepoPath);
  } catch {
    return { status: 'unknown', reason: `branch '${branchName}' not found in repository` };
  }

  // Check 1: containment — zero commits in the branch that aren't already in base.
  try {
    const aheadCount = (await executeCommand(
      ['git', 'rev-list', '--count', `${baseRef}..${branchName}`],
      bareRepoPath
    )).trim();
    if (aheadCount === '0') {
      return { status: 'merged' };
    }
  } catch (error) {
    logger.debug(`Containment check failed: ${error instanceof Error ? error.message : String(error)}`);
    return { status: 'unknown', reason: `could not compare '${branchName}' against '${baseRef}'` };
  }

  // Check 2: squash merge — does base already contain an equivalent squashed patch?
  try {
    const mergeBase = (await executeCommand(['git', 'merge-base', baseRef, branchName], bareRepoPath)).trim();
    if (mergeBase) {
      const tree = (await executeCommand(['git', 'rev-parse', `${branchName}^{tree}`], bareRepoPath)).trim();
      const squashCommit = (await executeCommand(
        ['git', 'commit-tree', tree, '-p', mergeBase, '-m', 'wkt-merge-check'],
        bareRepoPath
      )).trim();
      const cherry = (await executeCommand(['git', 'cherry', baseRef, squashCommit], bareRepoPath)).trim();
      // A '-' prefix means an equivalent patch is already present in base.
      if (cherry.split('\n').some(line => line.startsWith('-'))) {
        return { status: 'merged' };
      }
    }
  } catch (error) {
    logger.debug(`Squash-merge check failed: ${error instanceof Error ? error.message : String(error)}`);
    // Containment already established the branch has unique commits; an
    // inconclusive squash check means we treat it as unmerged below.
  }

  return { status: 'unmerged' };
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
