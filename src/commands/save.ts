import chalk from 'chalk';
import inquirer from 'inquirer';
import type { SaveCommandOptions } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';
import {
  getWorkspaceStatus,
  createBranchFromDetached,
  getCommitsAheadOfRemote,
  pushHEADToRemote,
  fetchInWorkspace,
} from '../utils/git/index.js';
import { executeCommand } from '../utils/git/command.js';
import { ErrorHandler, WKTError } from '../utils/errors.js';
import { BranchInference } from '../utils/branch-inference.js';
import { logger } from '../utils/logger.js';

export async function saveCommand(
  options: SaveCommandOptions = {}
): Promise<void> {
  try {
    const dbManager = new DatabaseManager();

    // Detect workspace from current directory
    const workspace = dbManager.getCurrentWorkspaceContext();

    if (!workspace) {
      console.log(chalk.yellow('Not in a workspace directory.'));
      console.log(chalk.gray('Navigate to a workspace first, or use `wkt list` to see workspaces.'));
      return;
    }

    // If already branched, no-op for save (user should use git directly)
    if (workspace.mode === 'branched') {
      console.log(chalk.blue(`Workspace is already on branch '${workspace.branchName}'.`));
      console.log(chalk.gray('Use git commands to commit and push your changes:'));
      console.log(chalk.gray('  git add . && git commit -m "Your message"'));
      console.log(chalk.gray(`  git push origin ${workspace.branchName}`));
      return;
    }

    // Check for uncommitted changes
    const status = await getWorkspaceStatus(workspace.path);
    const hasUncommittedChanges = !status.clean;

    // Check for commits ahead of remote (for pool/claimed workspaces)
    const trackingBranch = workspace.trackingBranch || workspace.baseBranch;

    // Fetch to ensure we have the latest remote state
    logger.debug(`Fetching from origin to check for commits ahead of ${trackingBranch}`);
    try {
      await fetchInWorkspace(workspace.path);
    } catch (error) {
      logger.debug(`Fetch failed (may be offline): ${error instanceof Error ? error.message : String(error)}`);
    }

    const commitsAhead = await getCommitsAheadOfRemote(workspace.path, trackingBranch);
    const hasCommitsAhead = commitsAhead.count > 0;

    // Nothing to save
    if (!hasUncommittedChanges && !hasCommitsAhead && !options.branch) {
      console.log(chalk.green('Workspace is clean. No changes to save.'));
      return;
    }

    // Handle explicit options first
    if (options.branch) {
      await createBranch(workspace, options.branch, dbManager);
      return;
    }

    if (options.stash) {
      await stashChanges(workspace);
      return;
    }

    if (options.discard) {
      await discardChanges(workspace);
      return;
    }

    if (options.push) {
      if (hasUncommittedChanges) {
        console.log(chalk.yellow('Cannot push: you have uncommitted changes.'));
        console.log(chalk.gray('Commit your changes first, or use --stash/--discard to handle them.'));
        return;
      }
      if (!hasCommitsAhead) {
        console.log(chalk.green('Nothing to push. Workspace is in sync with remote.'));
        return;
      }
      await pushToRemote(workspace, trackingBranch, commitsAhead);
      return;
    }

    // Interactive mode: handle uncommitted changes first
    if (hasUncommittedChanges) {
      console.log(chalk.blue(`\nYou have uncommitted changes in '${workspace.name}':`));
      const totalChanges = status.staged + status.unstaged + status.untracked;
      console.log(chalk.gray(`  ${totalChanges} file(s) modified\n`));

      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'What would you like to do with uncommitted changes?',
        choices: [
          { name: 'Create a branch from these changes', value: 'branch' },
          { name: 'Stash changes', value: 'stash' },
          { name: 'Discard changes', value: 'discard' },
          new inquirer.Separator(),
          { name: chalk.gray('Cancel'), value: 'cancel' }
        ]
      }]);

      if (action === 'cancel') {
        console.log(chalk.yellow('Save cancelled'));
        return;
      }

      if (action === 'branch') {
        const { branchName } = await inquirer.prompt([{
          type: 'input',
          name: 'branchName',
          message: 'Branch name:',
          validate: (input: string) => {
            if (!input.trim()) return 'Branch name is required';
            return true;
          }
        }]);

        await createBranch(workspace, branchName.trim(), dbManager);
        return; // Creating a branch changes the mode, so we're done
      } else if (action === 'stash') {
        await stashChanges(workspace);
      } else if (action === 'discard') {
        await discardChanges(workspace);
      }

      // After handling uncommitted changes, re-check for commits ahead
      // (in case they stashed/discarded and still have commits to push)
      if (!hasCommitsAhead) {
        return;
      }
    }

    // Handle commits ahead of remote
    if (hasCommitsAhead) {
      console.log(chalk.blue(`\nYou have ${commitsAhead.count} commit(s) ahead of origin/${trackingBranch}:`));
      for (const commit of commitsAhead.commits.slice(0, 5)) {
        console.log(chalk.gray(`  ${commit.hash} ${commit.message}`));
      }
      if (commitsAhead.count > 5) {
        console.log(chalk.gray(`  ... and ${commitsAhead.count - 5} more`));
      }
      console.log();

      const { shouldPush } = await inquirer.prompt([{
        type: 'confirm',
        name: 'shouldPush',
        message: `Push these commits to origin/${trackingBranch}?`,
        default: true
      }]);

      if (shouldPush) {
        await pushToRemote(workspace, trackingBranch, commitsAhead);
      } else {
        console.log(chalk.yellow('Push cancelled'));
      }
    }

  } catch (error) {
    ErrorHandler.handle(error);
  }
}

async function createBranch(
  workspace: ReturnType<DatabaseManager['getCurrentWorkspaceContext']>,
  branchName: string,
  dbManager: DatabaseManager
): Promise<void> {
  if (!workspace) return;

  // Infer full branch name if needed
  const inferredBranchName = BranchInference.inferBranchName(branchName, []);

  console.log(chalk.blue(`Creating branch '${inferredBranchName}'...`));

  try {
    await createBranchFromDetached(workspace.path, inferredBranchName);
  } catch (error) {
    throw new WKTError(
      `Failed to create branch: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'GIT_ERROR',
      true
    );
  }

  // Update workspace record
  workspace.mode = 'branched';
  workspace.branchName = inferredBranchName;
  workspace.claimedAt = undefined;
  workspace.lastUsed = new Date();

  dbManager.updateWorkspace(workspace);

  console.log(chalk.green(`✓ Created branch '${inferredBranchName}'`));
  console.log(chalk.green(`✓ Workspace '${workspace.name}' is now branched`));

  console.log(chalk.blue('\nNext steps:'));
  console.log(`  git add . && git commit -m "message"   # Commit your changes`);
  console.log(`  git push -u origin ${inferredBranchName}     # Push to remote`);
}

async function stashChanges(
  workspace: ReturnType<DatabaseManager['getCurrentWorkspaceContext']>
): Promise<void> {
  if (!workspace) return;

  console.log(chalk.blue('Stashing changes...'));

  try {
    await executeCommand(['git', 'stash', 'push', '-m', `wkt-save-${Date.now()}`], workspace.path);
  } catch (error) {
    throw new WKTError(
      `Failed to stash changes: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'GIT_ERROR',
      true
    );
  }

  console.log(chalk.green(`✓ Changes stashed`));
  console.log(chalk.gray('To restore: git stash pop'));
}

async function discardChanges(
  workspace: ReturnType<DatabaseManager['getCurrentWorkspaceContext']>
): Promise<void> {
  if (!workspace) return;

  console.log(chalk.blue('Discarding changes...'));

  try {
    // Reset tracked files
    await executeCommand(['git', 'checkout', '--', '.'], workspace.path);
    // Clean untracked files
    await executeCommand(['git', 'clean', '-fd'], workspace.path);
  } catch (error) {
    throw new WKTError(
      `Failed to discard changes: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'GIT_ERROR',
      true
    );
  }

  console.log(chalk.green(`✓ Changes discarded`));
}

async function pushToRemote(
  workspace: ReturnType<DatabaseManager['getCurrentWorkspaceContext']>,
  trackingBranch: string,
  commitsAhead: { count: number; commits: Array<{ hash: string; message: string }> }
): Promise<void> {
  if (!workspace) return;

  console.log(chalk.blue(`Pushing ${commitsAhead.count} commit(s) to origin/${trackingBranch}...`));

  try {
    await pushHEADToRemote(workspace.path, trackingBranch);
  } catch (error) {
    throw new WKTError(
      `Failed to push to remote: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'GIT_ERROR',
      true
    );
  }

  console.log(chalk.green(`✓ Pushed ${commitsAhead.count} commit(s) to origin/${trackingBranch}`));
}
