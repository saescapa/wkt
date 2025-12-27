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

      // No remote branches found - this is likely an empty repository
      logger.debug('No remote branches found, defaulting to main');
      return 'main';
    } catch (innerError) {
      logger.debug(`Failed to list remote branches: ${innerError instanceof Error ? innerError.message : String(innerError)}`);
      return 'main';
    }
  }
}
