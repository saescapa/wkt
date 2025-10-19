import type { CommandOptions } from '../core/types.js';
import { renameCommand } from './rename.js';

/**
 * Recycle command - Alias for rename with --rename-branch behavior
 * This command recycles the current workspace to a new branch, preserving all files
 * and resetting workspace metadata for a fresh start.
 */
export async function recycleCommand(
  newBranchName: string,
  options: CommandOptions = {}
): Promise<void> {
  // Recycle is an alias for rename with rebase enabled (default behavior)
  // The rename command handles rebase by default unless --no-rebase is specified
  await renameCommand(newBranchName, options);
}
