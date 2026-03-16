import { existsSync } from 'fs';
import { join } from 'path';
import { executeCommand } from './command.js';
import { withRetry } from '../retry.js';
import { logger } from '../logger.js';

export function isGitRepository(path: string): boolean {
  return existsSync(join(path, '.git'));
}

export async function getBareRepoUrl(repoPath: string): Promise<string> {
  try {
    const result = await executeCommand(['git', 'remote', 'get-url', 'origin'], repoPath);
    return result.trim();
  } catch (error) {
    logger.debug(`Failed to get bare repo URL: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('Failed to get repository URL');
  }
}

export async function cloneBareRepository(repoUrl: string, targetPath: string): Promise<void> {
  await withRetry(
    () => executeCommand(['git', 'clone', '--bare', repoUrl, targetPath]),
    `Clone repository ${repoUrl}`
  );

  // Check if origin remote already exists (git clone --bare creates it automatically)
  try {
    await executeCommand(['git', 'remote', 'get-url', 'origin'], targetPath);
    // Origin exists, update it to ensure it matches
    await executeCommand(['git', 'remote', 'set-url', 'origin', repoUrl], targetPath);
  } catch {
    // Origin doesn't exist, add it
    logger.debug('Origin remote not found, adding it');
    await executeCommand(['git', 'remote', 'add', 'origin', repoUrl], targetPath);
  }

  // git clone --bare stores remote branches as local refs (refs/heads/*) instead
  // of remote-tracking refs (refs/remotes/origin/*). Set up the standard fetch
  // refspec and re-fetch so worktrees and getDefaultBranch work correctly.
  await executeCommand(
    ['git', 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
    targetPath
  );
  try {
    await withRetry(
      () => executeCommand(['git', 'fetch', 'origin'], targetPath),
      `Fetch after bare clone`
    );
  } catch {
    logger.debug('Fetch after bare clone failed (remote may be empty)');
  }
}

export async function initBareRepository(targetPath: string): Promise<void> {
  await executeCommand(['git', 'init', '--bare', targetPath]);
}

export async function getDefaultBranch(bareRepoPath: string): Promise<string> {
  try {
    const result = await executeCommand(['git', 'symbolic-ref', 'refs/remotes/origin/HEAD'], bareRepoPath);
    return result.replace('refs/remotes/origin/', '').trim();
  } catch (error) {
    logger.debug(`Failed to get default branch via symbolic-ref: ${error instanceof Error ? error.message : String(error)}`);

    try {
      const result = await executeCommand(['git', 'branch', '-r'], bareRepoPath);
      const branches = result.split('\n').map(b => b.trim()).filter(b => b.length > 0);

      if (branches.find(b => b.includes('origin/main'))) return 'main';
      if (branches.find(b => b.includes('origin/master'))) return 'master';

      const firstBranch = branches.find(b => b.startsWith('origin/') && !b.includes('HEAD'));
      if (firstBranch) {
        return firstBranch.replace('origin/', '');
      }
    } catch (innerError) {
      logger.debug(`Failed to list remote branches: ${innerError instanceof Error ? innerError.message : String(innerError)}`);
    }

    // Fallback: check local branches (bare clones without fetch refspec
    // store remote branches as local refs in refs/heads/*)
    try {
      const localResult = await executeCommand(['git', 'branch'], bareRepoPath);
      const localBranches = localResult.split('\n').map(b => b.replace('*', '').trim()).filter(b => b.length > 0);

      if (localBranches.includes('main')) return 'main';
      if (localBranches.includes('master')) return 'master';

      if (localBranches.length > 0 && localBranches[0]) {
        return localBranches[0];
      }
    } catch (localError) {
      logger.debug(`Failed to list local branches: ${localError instanceof Error ? localError.message : String(localError)}`);
    }

    logger.debug('No branches found, defaulting to main');
    return 'main';
  }
}
