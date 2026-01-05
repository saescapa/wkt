import chalk from 'chalk';
import inquirer from 'inquirer';
import type { SaveCommandOptions } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';
import {
  getWorkspaceStatus,
  createBranchFromDetached,
} from '../utils/git/index.js';
import { executeCommand } from '../utils/git/command.js';
import { ErrorHandler, WKTError } from '../utils/errors.js';
import { BranchInference } from '../utils/branch-inference.js';

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

    // If already branched, no-op
    if (workspace.mode === 'branched') {
      console.log(chalk.blue(`Workspace is already on branch '${workspace.branchName}'.`));
      console.log(chalk.gray('Use git commands to commit your changes:'));
      console.log(chalk.gray('  git add . && git commit -m "Your message"'));
      return;
    }

    // Check for changes
    const status = await getWorkspaceStatus(workspace.path);
    const hasChanges = !status.clean;

    if (!hasChanges && !options.branch) {
      console.log(chalk.green('Workspace is clean. No changes to save.'));
      return;
    }

    // Handle options
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

    // Interactive mode
    console.log(chalk.blue(`\nYou have changes in '${workspace.name}':`));
    const totalChanges = status.staged + status.unstaged + status.untracked;
    console.log(chalk.gray(`  ${totalChanges} file(s) modified\n`));

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
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
    } else if (action === 'stash') {
      await stashChanges(workspace);
    } else if (action === 'discard') {
      await discardChanges(workspace);
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
