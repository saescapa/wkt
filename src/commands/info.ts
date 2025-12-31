import chalk from 'chalk';
import inquirer from 'inquirer';
import { DatabaseManager } from '../core/database.js';
import { ErrorHandler } from '../utils/errors.js';
import { formatTimeAgo } from '../utils/format.js';

interface InfoCommandOptions {
  descriptionOnly?: boolean;
  branchOnly?: boolean;
  nameOnly?: boolean;
  json?: boolean;
  setDescription?: string | boolean;
}

export async function infoCommand(options: InfoCommandOptions = {}): Promise<void> {
  try {
    const dbManager = new DatabaseManager();

    // Detect workspace from current directory
    const workspace = dbManager.getCurrentWorkspaceContext();

    if (!workspace) {
      if (options.descriptionOnly || options.branchOnly || options.nameOnly) {
        // Silent exit for shell integration when not in a workspace
        process.exit(1);
      }
      console.log(chalk.yellow('Not in a workspace directory.'));
      console.log(chalk.gray('Run this command from within a workspace, or use `wkt list` to see all workspaces.'));
      return;
    }

    // Handle setting description
    if (options.setDescription !== undefined) {
      let newDescription: string;

      if (typeof options.setDescription === 'string') {
        newDescription = options.setDescription;
      } else {
        // Interactive prompt
        const { description } = await inquirer.prompt([
          {
            type: 'input',
            name: 'description',
            message: `Enter description for workspace '${workspace.name}':`,
            default: workspace.description || '',
          },
        ]);
        newDescription = description;
      }

      workspace.description = newDescription || undefined;
      dbManager.updateWorkspace(workspace);

      if (newDescription) {
        console.log(chalk.green(`✓ Updated description for workspace '${workspace.name}'`));
        console.log(chalk.dim(`  ${newDescription}`));
      } else {
        console.log(chalk.green(`✓ Removed description from workspace '${workspace.name}'`));
      }
      return;
    }

    // Handle specific output modes for shell integration
    if (options.descriptionOnly) {
      if (workspace.description) {
        console.log(workspace.description);
      }
      return;
    }

    if (options.branchOnly) {
      console.log(workspace.branchName);
      return;
    }

    if (options.nameOnly) {
      console.log(workspace.name);
      return;
    }

    if (options.json) {
      console.log(JSON.stringify({
        name: workspace.name,
        projectName: workspace.projectName,
        branchName: workspace.branchName,
        description: workspace.description,
        path: workspace.path,
        baseBranch: workspace.baseBranch,
        createdAt: workspace.createdAt,
        lastUsed: workspace.lastUsed,
        status: workspace.status,
        commitsAhead: workspace.commitsAhead,
        commitsBehind: workspace.commitsBehind,
      }, null, 2));
      return;
    }

    // Default: show comprehensive info
    console.log(chalk.bold.blue(`\n${workspace.name}`));
    if (workspace.description) {
      console.log(chalk.dim(`${workspace.description}`));
    }
    console.log();

    console.log(`${chalk.gray('Project:')}      ${workspace.projectName}`);
    console.log(`${chalk.gray('Branch:')}       ${chalk.cyan(workspace.branchName)}`);
    console.log(`${chalk.gray('Base:')}         ${workspace.baseBranch}`);
    console.log(`${chalk.gray('Path:')}         ${workspace.path}`);

    // Status
    const statusIcon = workspace.status.clean ? chalk.green('✓') : chalk.yellow('⚠');
    const statusText = workspace.status.clean ? chalk.green('clean') : chalk.yellow('uncommitted changes');
    console.log(`${chalk.gray('Status:')}       ${statusIcon} ${statusText}`);

    // Commits ahead/behind
    if (workspace.commitsAhead || workspace.commitsBehind) {
      const ahead = workspace.commitsAhead || 0;
      const behind = workspace.commitsBehind || 0;
      let commitInfo = '';
      if (ahead > 0) commitInfo += chalk.green(`↑ ${ahead} ahead`);
      if (ahead > 0 && behind > 0) commitInfo += ', ';
      if (behind > 0) commitInfo += chalk.red(`↓ ${behind} behind`);
      console.log(`${chalk.gray('Commits:')}      ${commitInfo}`);
    }

    // Timestamps
    const now = new Date();
    const daysSinceCreation = Math.floor((now.getTime() - workspace.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    console.log(`${chalk.gray('Created:')}      ${workspace.createdAt.toLocaleDateString()} (${daysSinceCreation}d ago)`);
    console.log(`${chalk.gray('Last used:')}    ${formatTimeAgo(workspace.lastUsed, 'long')}`);

    console.log();

  } catch (error) {
    // Use minimal mode for shell integration options
    const isShellMode = options.descriptionOnly || options.branchOnly || options.nameOnly;
    ErrorHandler.handle(error, { minimal: isShellMode });
  }
}
