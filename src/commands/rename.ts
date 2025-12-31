import chalk from 'chalk';
import inquirer from 'inquirer';
import { existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import type { RenameCommandOptions } from '../core/types.js';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import {
  executeCommand,
  fetchAll,
  branchExists,
  rebaseBranch,
  moveWorktree,
  getWorkspaceStatus,
  getCommitsDiff,
} from '../utils/git/index.js';
import { BranchInference } from '../utils/branch-inference.js';
import {
  ErrorHandler,
  WorkspaceNotFoundError,
  GitRepositoryError,
} from '../utils/errors.js';

export async function renameCommand(
  newName?: string,
  options: RenameCommandOptions = {}
): Promise<void> {
  try {
    const dbManager = new DatabaseManager();
    const configManager = new ConfigManager();

    // Get current workspace
    const currentWorkspace = dbManager.getCurrentWorkspace();
    if (!currentWorkspace) {
      // Try to detect workspace from current directory
      const cwd = process.cwd();
      const allWorkspaces = dbManager.getAllWorkspaces();
      const detectedWorkspace = allWorkspaces.find(w => cwd.startsWith(w.path));

      if (!detectedWorkspace) {
        throw new WorkspaceNotFoundError('current workspace - run this command from within a workspace directory');
      }

      // Use detected workspace
      console.log(chalk.blue(`Detected workspace: ${detectedWorkspace.name}`));
      dbManager.setCurrentWorkspace(detectedWorkspace.id);
    }

    const workspace = dbManager.getCurrentWorkspace();
    if (!workspace) {
      throw new WorkspaceNotFoundError('current workspace');
    }

    const project = dbManager.getProject(workspace.projectName);
    if (!project) {
      throw new Error(`Project '${workspace.projectName}' not found`);
    }

    const config = configManager.getConfig();
    const projectConfig = configManager.getProjectConfig(workspace.projectName);

    // Interactive mode if newName not provided
    let resolvedName = newName;
    if (!resolvedName) {
      console.log(chalk.blue(`\nRename workspace: ${workspace.name}`));
      console.log(chalk.gray(`Current branch: ${workspace.branchName}\n`));

      const { inputName } = await inquirer.prompt([{
        type: 'input',
        name: 'inputName',
        message: 'New branch name or ticket ID:',
        validate: (input: string) => {
          if (!input.trim()) return 'Name is required';
          return true;
        }
      }]);

      if (!inputName.trim()) {
        console.log(chalk.yellow('Rename cancelled'));
        return;
      }
      resolvedName = inputName.trim();
    }

    // At this point resolvedName is guaranteed to be set
    if (!resolvedName) {
      return; // TypeScript flow analysis
    }

    // Determine if this is a full recycle (--rename-branch) or simple rename
    const isRecycle = options.rebase !== false; // Default to true (recycle mode)

    // Infer new branch name using patterns
    const inferencePatterns = projectConfig.inference?.patterns || config.inference.patterns;
    const inferredBranchName = BranchInference.inferBranchName(resolvedName, inferencePatterns);

    // Generate new workspace name
    const namingStrategy = projectConfig.workspace?.naming_strategy || config.workspace.naming_strategy;
    const newWorkspaceName = options.name
      ? BranchInference.sanitizeWorkspaceName(options.name, namingStrategy)
      : BranchInference.sanitizeWorkspaceName(inferredBranchName, namingStrategy);

    if (isRecycle) {
      // Full recycle mode: create new branch, rebase, reset metadata
      console.log(chalk.blue(`Recycling workspace '${workspace.name}'...`));
      console.log(chalk.gray(`Current branch: ${workspace.branchName}`));
      console.log(chalk.gray(`New branch: ${inferredBranchName}`));
    } else {
      // Simple rename mode
      console.log(chalk.blue(`Renaming workspace '${workspace.name}' to '${newWorkspaceName}'...`));
      console.log(chalk.gray(`Branch will be renamed: ${workspace.branchName} → ${inferredBranchName}`));
    }

    // Safety check: verify working tree status
    const status = await getWorkspaceStatus(workspace.path);
    if (!status.clean && !options.force) {
      console.log(chalk.yellow('\n⚠️  Working tree has uncommitted changes:'));
      if (status.staged > 0) console.log(chalk.yellow(`  - ${status.staged} staged files`));
      if (status.unstaged > 0) console.log(chalk.yellow(`  - ${status.unstaged} unstaged files`));
      if (status.untracked > 0) console.log(chalk.yellow(`  - ${status.untracked} untracked files`));
      if (status.conflicted > 0) console.log(chalk.red(`  - ${status.conflicted} conflicted files`));

      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: `Continue with ${isRecycle ? 'recycle' : 'rename'}? (uncommitted changes will be preserved)`,
          default: false,
        },
      ]);

      if (!proceed) {
        console.log(chalk.yellow(`${isRecycle ? 'Recycle' : 'Rename'} cancelled.`));
        return;
      }
    }

    if (isRecycle) {
      // RECYCLE MODE: Full workflow with rebase and new branch creation
      const baseBranch = options.from || project.defaultBranch;

      console.log(chalk.blue(`\nFetching latest changes from ${baseBranch}...`));
      await fetchAll(project.bareRepoPath);

      const commitsDiff = await getCommitsDiff(workspace.path, baseBranch);
      if (commitsDiff.ahead > 0) {
        console.log(chalk.yellow(`\n⚠️  Current branch has ${commitsDiff.ahead} local commit(s)`));

        const { confirmRebase } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmRebase',
            message: `Rebase these commits onto latest ${baseBranch}?`,
            default: true,
          },
        ]);

        if (!confirmRebase) {
          console.log(chalk.yellow('Skipping rebase. Switching to new branch without rebasing.'));
        } else {
          console.log(chalk.blue(`Rebasing onto ${baseBranch}...`));
          try {
            await rebaseBranch(workspace.path, baseBranch);
            console.log(chalk.green('✓ Rebase successful'));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('conflict')) {
              throw new GitRepositoryError(
                'Rebase failed due to conflicts. Please resolve conflicts manually:\n' +
                `  cd "${workspace.path}"\n` +
                '  git rebase --continue  # after resolving conflicts\n' +
                '  git rebase --abort     # to cancel rebase'
              );
            }
            throw error;
          }
        }
      } else {
        console.log(chalk.blue(`Updating to latest ${baseBranch}...`));
        try {
          await rebaseBranch(workspace.path, baseBranch);
          console.log(chalk.green('✓ Updated to latest base branch'));
        } catch {
          console.log(chalk.yellow(`⚠️  Could not update from ${baseBranch}, continuing anyway...`));
        }
      }

      // Check if new branch already exists
      const branchAlreadyExists = await branchExists(project.bareRepoPath, inferredBranchName);

      if (branchAlreadyExists) {
        console.log(chalk.yellow(`\nBranch '${inferredBranchName}' already exists.`));
        const { action } = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: 'What would you like to do?',
            choices: [
              { name: 'Switch to existing branch (will lose uncommitted changes)', value: 'switch' },
              { name: 'Create new branch with different name', value: 'rename' },
              { name: 'Cancel', value: 'cancel' },
            ],
          },
        ]);

        if (action === 'cancel') {
          console.log(chalk.yellow('Recycle cancelled.'));
          return;
        }

        if (action === 'rename') {
          const { newName: alternativeName } = await inquirer.prompt([
            {
              type: 'input',
              name: 'newName',
              message: 'Enter new branch name:',
              validate: (input: string): boolean | string => input.trim().length > 0 || 'Branch name cannot be empty',
            },
          ]);

          // Recursively call with new name
          return renameCommand(alternativeName, options);
        }

        // Switch to existing branch
        console.log(chalk.blue(`\nSwitching to existing branch '${inferredBranchName}'...`));
        await executeCommand(['git', 'checkout', inferredBranchName], workspace.path);
      } else {
        // Create and switch to new branch
        console.log(chalk.blue(`\nCreating and switching to new branch '${inferredBranchName}'...`));
        await executeCommand(['git', 'checkout', '-b', inferredBranchName], workspace.path);
      }

      // Update workspace metadata with reset timestamps (recycle mode)
      const updatedStatus = await getWorkspaceStatus(workspace.path);
      const updatedCommitsDiff = await getCommitsDiff(workspace.path, baseBranch);

      workspace.branchName = inferredBranchName;
      workspace.baseBranch = baseBranch;
      workspace.status = updatedStatus;
      workspace.commitsAhead = updatedCommitsDiff.ahead;
      workspace.commitsBehind = updatedCommitsDiff.behind;
      workspace.lastUsed = new Date();
      workspace.createdAt = new Date(); // Reset creation date for recycle

      // Update description if provided, otherwise clear it for fresh start
      if (options.description !== undefined) {
        workspace.description = options.description;
      } else {
        // Prompt to update description for recycled workspace
        const { updateDesc } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'updateDesc',
            message: 'Update workspace description?',
            default: false,
          },
        ]);

        if (updateDesc) {
          const { description } = await inquirer.prompt([
            {
              type: 'input',
              name: 'description',
              message: 'Enter new description:',
              default: workspace.description || '',
            },
          ]);
          workspace.description = description;
        } else {
          workspace.description = undefined; // Clear old description
        }
      }

    } else {
      // SIMPLE RENAME MODE: Just rename the branch in place (no new branch creation)
      console.log(chalk.blue(`\nRenaming git branch to '${inferredBranchName}'...`));

      try {
        await executeCommand(['git', 'branch', '-m', inferredBranchName], workspace.path);
        console.log(chalk.green('✓ Git branch renamed'));
      } catch (error) {
        throw new GitRepositoryError(`Failed to rename git branch: ${error}`);
      }

      // Update workspace metadata (keep timestamps)
      const updatedStatus = await getWorkspaceStatus(workspace.path);
      const baseBranch = workspace.baseBranch || project.defaultBranch;
      const updatedCommitsDiff = await getCommitsDiff(workspace.path, baseBranch);

      workspace.branchName = inferredBranchName;
      workspace.status = updatedStatus;
      workspace.commitsAhead = updatedCommitsDiff.ahead;
      workspace.commitsBehind = updatedCommitsDiff.behind;
      workspace.lastUsed = new Date(); // Update last used, but not created

      // Update description if provided
      if (options.description !== undefined) {
        workspace.description = options.description;
      }
    }

    // Update workspace name/directory if it changed
    const oldWorkspaceName = workspace.name;
    if (newWorkspaceName !== oldWorkspaceName) {
      const oldPath = workspace.path;
      const newPath = join(dirname(oldPath), newWorkspaceName);

      // Check if directory already exists
      if (existsSync(newPath) && !options.force) {
        throw new Error(`Directory '${newPath}' already exists. Use --force to overwrite.`);
      }

      // Rename directory using git worktree move to keep git references in sync
      console.log(chalk.blue(`\nRenaming workspace directory...`));
      try {
        await moveWorktree(project.bareRepoPath, oldPath, newPath);
        console.log(chalk.green(`✓ Directory renamed: ${basename(oldPath)} → ${newWorkspaceName}`));
      } catch (error) {
        throw new Error(`Failed to rename directory: ${error}`);
      }

      // Update workspace path and name
      workspace.path = newPath;
      workspace.name = newWorkspaceName;

      // Update workspace ID
      const oldId = workspace.id;
      workspace.id = BranchInference.generateWorkspaceId(workspace.projectName, newWorkspaceName);

      // Remove old workspace and add with new ID
      dbManager.removeWorkspace(oldId);
      dbManager.addWorkspace(workspace);
      dbManager.setCurrentWorkspace(workspace.id);
    } else {
      dbManager.updateWorkspace(workspace);
    }

    console.log(chalk.green(`\n✓ Successfully ${isRecycle ? 'recycled' : 'renamed'} workspace '${workspace.name}'`));
    console.log(chalk.gray(`  Path: ${workspace.path}`));
    console.log(chalk.gray(`  Branch: ${inferredBranchName}`));
    console.log(chalk.gray(`  Base: ${workspace.baseBranch}`));

    if (!status.clean) {
      console.log(chalk.yellow(`\n⚠️  Your uncommitted changes have been preserved`));
    }

    if (isRecycle) {
      console.log(chalk.blue('\nNext steps:'));
      console.log(`  git status                    # Check current state`);
      console.log(`  git push -u origin ${inferredBranchName}  # Push new branch to remote`);
    }

  } catch (error) {
    ErrorHandler.handle(error);
  }
}
