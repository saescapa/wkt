import chalk from 'chalk';
import inquirer from 'inquirer';
import type { CommandOptions, Workspace } from '../core/types.js';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import { GitUtils } from '../utils/git.js';
import { BranchInference } from '../utils/branch-inference.js';
import {
  ErrorHandler,
  WorkspaceNotFoundError,
  GitRepositoryError
} from '../utils/errors.js';

export async function recycleCommand(
  newBranchName: string,
  options: CommandOptions = {}
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

    // Infer new branch name using patterns
    const inferencePatterns = projectConfig.inference?.patterns || config.inference.patterns;
    const inferredBranchName = BranchInference.inferBranchName(newBranchName, inferencePatterns);

    console.log(chalk.blue(`Recycling workspace '${workspace.name}'...`));
    console.log(chalk.gray(`Current branch: ${workspace.branchName}`));
    console.log(chalk.gray(`New branch: ${inferredBranchName}`));

    // Safety check: verify working tree status
    const status = await GitUtils.getWorkspaceStatus(workspace.path);
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
          message: 'Continue with recycle? (uncommitted changes will be preserved)',
          default: false,
        },
      ]);

      if (!proceed) {
        console.log(chalk.yellow('Recycle cancelled.'));
        return;
      }
    }

    // Check if there are local commits that would be rebased
    const baseBranch = options.from || project.defaultBranch;
    const shouldRebase = options.rebase !== false;

    if (shouldRebase) {
      console.log(chalk.blue(`\nFetching latest changes from ${baseBranch}...`));
      await GitUtils.fetchAll(project.bareRepoPath);

      const commitsDiff = await GitUtils.getCommitsDiff(workspace.path, baseBranch);
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
            await GitUtils.rebaseBranch(workspace.path, baseBranch);
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
          await GitUtils.rebaseBranch(workspace.path, baseBranch);
          console.log(chalk.green('✓ Updated to latest base branch'));
        } catch (error) {
          console.log(chalk.yellow(`⚠️  Could not update from ${baseBranch}, continuing anyway...`));
        }
      }
    }

    // Check if new branch already exists
    const branchExists = await GitUtils.branchExists(project.bareRepoPath, inferredBranchName);

    if (branchExists) {
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
        const { newName } = await inquirer.prompt([
          {
            type: 'input',
            name: 'newName',
            message: 'Enter new branch name:',
            validate: (input: string) => input.trim().length > 0 || 'Branch name cannot be empty',
          },
        ]);

        // Recursively call with new name
        return recycleCommand(newName, options);
      }

      // Switch to existing branch
      console.log(chalk.blue(`\nSwitching to existing branch '${inferredBranchName}'...`));
      await GitUtils.executeCommand(['git', 'checkout', inferredBranchName], workspace.path);
    } else {
      // Create and switch to new branch
      console.log(chalk.blue(`\nCreating and switching to new branch '${inferredBranchName}'...`));
      await GitUtils.executeCommand(['git', 'checkout', '-b', inferredBranchName], workspace.path);
    }

    // Update workspace metadata
    const updatedStatus = await GitUtils.getWorkspaceStatus(workspace.path);
    const updatedCommitsDiff = await GitUtils.getCommitsDiff(workspace.path, baseBranch);

    workspace.branchName = inferredBranchName;
    workspace.baseBranch = baseBranch;
    workspace.status = updatedStatus;
    workspace.commitsAhead = updatedCommitsDiff.ahead;
    workspace.commitsBehind = updatedCommitsDiff.behind;
    workspace.lastUsed = new Date();

    // Update description if provided
    if (options.description !== undefined) {
      workspace.description = options.description;
    }

    // Update workspace name if needed
    if (options.name) {
      const namingStrategy = projectConfig.workspace?.naming_strategy || config.workspace.naming_strategy;
      const newWorkspaceName = BranchInference.sanitizeWorkspaceName(options.name, namingStrategy);

      // Update workspace ID
      const oldId = workspace.id;
      workspace.name = newWorkspaceName;
      workspace.id = BranchInference.generateWorkspaceId(workspace.projectName, newWorkspaceName);

      // Remove old workspace and add with new ID
      dbManager.removeWorkspace(oldId);
      dbManager.addWorkspace(workspace);
      dbManager.setCurrentWorkspace(workspace.id);
    } else {
      dbManager.updateWorkspace(workspace);
    }

    console.log(chalk.green(`\n✓ Successfully recycled workspace '${workspace.name}'`));
    console.log(chalk.gray(`  Path: ${workspace.path}`));
    console.log(chalk.gray(`  Branch: ${inferredBranchName}`));
    console.log(chalk.gray(`  Base: ${baseBranch}`));

    if (!status.clean) {
      console.log(chalk.yellow(`\n⚠️  Your uncommitted changes have been preserved`));
    }

    console.log(chalk.blue('\nNext steps:'));
    console.log(`  git status                    # Check current state`);
    console.log(`  git push -u origin ${inferredBranchName}  # Push new branch to remote`);

  } catch (error) {
    ErrorHandler.handle(error, 'workspace recycle');
  }
}
