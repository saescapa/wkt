import type { WorkspaceStatus } from '../../core/types.js';
import { executeCommand } from './command.js';
import { getCurrentBranch } from './branches.js';
import { logger } from '../logger.js';

export async function getWorkspaceStatus(workspacePath: string): Promise<WorkspaceStatus> {
  try {
    const result = await executeCommand(['git', 'status', '--porcelain'], workspacePath);
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
  } catch (error) {
    logger.debug(`Failed to get workspace status: ${error instanceof Error ? error.message : String(error)}`);
    return {
      clean: true,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
    };
  }
}

export async function isWorkingTreeClean(workspacePath: string): Promise<boolean> {
  const status = await getWorkspaceStatus(workspacePath);
  return status.clean;
}

export async function getCommitsDiff(workspacePath: string, baseBranch: string): Promise<{ ahead: number; behind: number }> {
  try {
    const currentBranch = await getCurrentBranch(workspacePath);

    const aheadResult = await executeCommand(
      ['git', 'rev-list', '--count', `${baseBranch}..${currentBranch}`],
      workspacePath
    );

    const behindResult = await executeCommand(
      ['git', 'rev-list', '--count', `${currentBranch}..${baseBranch}`],
      workspacePath
    );

    return {
      ahead: parseInt(aheadResult.trim()) || 0,
      behind: parseInt(behindResult.trim()) || 0,
    };
  } catch (error) {
    logger.debug(`Failed to get commits diff: ${error instanceof Error ? error.message : String(error)}`);
    return { ahead: 0, behind: 0 };
  }
}

export async function getCommitCountAhead(workspacePath: string, baseBranch: string): Promise<number> {
  try {
    const currentBranch = await getCurrentBranch(workspacePath);
    const result = await executeCommand(
      ['git', 'rev-list', '--count', `${baseBranch}..${currentBranch}`],
      workspacePath
    );
    return parseInt(result.trim(), 10) || 0;
  } catch (error) {
    logger.debug(`Failed to get commit count ahead: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

export async function getLastCommitInfo(repoPath: string, branchName?: string): Promise<{ message: string; date: Date; hash: string } | null> {
  try {
    const ref = branchName || 'HEAD';
    const result = await executeCommand(
      ['git', 'log', '-1', '--format=%H%n%ct%n%s', ref],
      repoPath
    );
    const lines = result.trim().split('\n');
    if (lines.length < 3) return null;

    const hash = lines[0]?.substring(0, 7) || '';
    const timestamp = parseInt(lines[1] || '0', 10);
    const message = lines[2] || '';

    return {
      hash,
      date: new Date(timestamp * 1000),
      message: message.length > 60 ? message.substring(0, 57) + '...' : message,
    };
  } catch (error) {
    logger.debug(`Failed to get last commit info: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
