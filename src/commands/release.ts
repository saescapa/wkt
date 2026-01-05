import chalk from 'chalk';
import inquirer from 'inquirer';
import type { ReleaseCommandOptions } from '../core/types.js';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import {
  resetDetachedWorktree,
  getWorkspaceStatus,
  removeWorktree,
} from '../utils/git/index.js';
import { SafeScriptExecutor } from '../utils/script-executor.js';
import { ErrorHandler, WKTError } from '../utils/errors.js';

export async function releaseCommand(
  options: ReleaseCommandOptions = {}
): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const dbManager = new DatabaseManager();

    // Detect workspace from current directory
    const workspace = dbManager.getCurrentWorkspaceContext();

    if (!workspace) {
      console.log(chalk.yellow('Not in a workspace directory.'));
      console.log(chalk.gray('Navigate to a workspace first, or use `wkt list` to see workspaces.'));
      return;
    }

    const project = dbManager.getProject(workspace.projectName);
    if (!project) {
      throw new WKTError(
        `Project '${workspace.projectName}' not found`,
        'PROJECT_NOT_FOUND',
        true
      );
    }

    const config = configManager.getConfig();
    const projectConfig = configManager.getProjectConfig(workspace.projectName);

    // Check for uncommitted changes
    const status = await getWorkspaceStatus(workspace.path);
    if (!status.clean && !options.force) {
      throw new WKTError(
        'Workspace has uncommitted changes',
        'DIRTY_WORKSPACE',
        true,
        [
          { text: 'Use \'wkt save\' to handle your changes first', command: 'wkt save' },
          { text: 'Use \'wkt release --force\' to discard changes', command: 'wkt release --force' }
        ]
      );
    }

    // If branched workspace, confirm detaching from branch
    if (workspace.mode === 'branched') {
      console.log(chalk.yellow(`Warning: This will detach from branch '${workspace.branchName}'`));
      console.log(chalk.gray('The branch will remain in git but workspace becomes pooled.'));

      if (!options.force) {
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: 'Continue?',
          default: false
        }]);

        if (!confirm) {
          console.log(chalk.yellow('Release cancelled'));
          return;
        }
      }
    }

    console.log(chalk.blue(`Releasing '${workspace.name}' back to pool...`));

    // Reset to default branch (detached HEAD)
    const trackingBranch = workspace.trackingBranch || project.defaultBranch;
    const commitSHA = await resetDetachedWorktree(
      project.bareRepoPath,
      workspace.path,
      trackingBranch
    );

    console.log(chalk.green(`✓ Reset to ${trackingBranch} (${commitSHA.substring(0, 7)})`));

    // Update workspace record
    workspace.mode = 'pooled';
    workspace.branchName = 'HEAD';
    workspace.trackingBranch = trackingBranch;
    workspace.baseCommit = commitSHA;
    workspace.claimedAt = undefined;
    workspace.lastUsed = new Date();
    workspace.status = await getWorkspaceStatus(workspace.path);

    // Execute post-release hooks before updating DB
    const scriptConfig = projectConfig.scripts || config.scripts;
    if (scriptConfig) {
      const context = SafeScriptExecutor.createContext(workspace, project);
      await SafeScriptExecutor.executePostReleaseHooks(context, scriptConfig, options);
    }

    dbManager.updateWorkspace(workspace);

    // Check pool size and clean up if needed
    const poolConfig = projectConfig.workspace?.pool;
    const maxPoolSize = poolConfig?.max_size ?? 5;
    const pooledWorkspaces = dbManager.getPooledWorkspaces(workspace.projectName);

    if (pooledWorkspaces.length > maxPoolSize) {
      // Remove oldest workspaces beyond max size
      const toRemove = pooledWorkspaces.slice(maxPoolSize);
      for (const ws of toRemove) {
        try {
          await removeWorktree(project.bareRepoPath, ws.path);
          dbManager.removeWorkspace(ws.id);
          console.log(chalk.gray(`  Removed old pool workspace: ${ws.name}`));
        } catch (error) {
          console.log(chalk.yellow(`  Could not remove ${ws.name}: ${error instanceof Error ? error.message : 'Unknown error'}`));
        }
      }
    }

    console.log(chalk.green(`✓ Released to pool`));

    console.log(chalk.blue('\nNext steps:'));
    console.log(`  wkt claim ${workspace.projectName}              # Claim a workspace again`);
    console.log(`  wkt list --pool                         # View pool status`);

  } catch (error) {
    ErrorHandler.handle(error);
  }
}
