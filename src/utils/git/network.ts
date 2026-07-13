import { executeCommand } from './command.js';
import { withRetry } from '../retry.js';
import { logger } from '../logger.js';

export async function fetchAll(bareRepoPath: string): Promise<void> {
  try {
    await withRetry(
      () => executeCommand(['git', 'fetch', '--all'], bareRepoPath),
      'Fetch all remotes'
    );
  } catch (error) {
    // Handle empty repositories gracefully - they have no refs to fetch
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("couldn't find remote ref HEAD") ||
        errorMessage.includes("fatal: Couldn't find remote ref")) {
      logger.debug('Empty repository detected, skipping fetch');
      return;
    }
    throw error;
  }
}
