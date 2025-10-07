import chalk from 'chalk';
import inquirer from 'inquirer';
import { DatabaseManager } from '../core/database.js';
import { ErrorHandler, WorkspaceNotFoundError } from '../utils/errors.js';

export async function describeCommand(
  workspaceName?: string,
  newDescription?: string
): Promise<void> {
  try {
    const dbManager = new DatabaseManager();

    // If no workspace specified, try to detect from current directory
    let workspace = workspaceName
      ? dbManager.searchWorkspaces(workspaceName)[0]
      : dbManager.getCurrentWorkspaceContext();

    if (!workspace) {
      // Try interactive selection
      const allWorkspaces = dbManager.getAllWorkspaces();
      if (allWorkspaces.length === 0) {
        console.log(chalk.yellow('No workspaces found.'));
        return;
      }

      const choices = allWorkspaces.map(w => ({
        name: `${w.projectName}/${w.name} (${w.branchName})${w.description ? ` - ${w.description}` : ''}`,
        value: w,
      }));

      const { selectedWorkspace } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedWorkspace',
          message: 'Select a workspace:',
          choices,
          pageSize: 10,
        },
      ]);

      workspace = selectedWorkspace;
    }

    if (!workspace) {
      throw new WorkspaceNotFoundError(workspaceName || 'current workspace');
    }

    // If description provided, update it
    if (newDescription !== undefined) {
      workspace.description = newDescription;
      dbManager.updateWorkspace(workspace);

      if (newDescription) {
        console.log(chalk.green(`✓ Updated description for workspace '${workspace.name}'`));
        console.log(chalk.dim(`  ${newDescription}`));
      } else {
        console.log(chalk.green(`✓ Removed description from workspace '${workspace.name}'`));
      }
      return;
    }

    // If no description provided, prompt for one
    const { description } = await inquirer.prompt([
      {
        type: 'input',
        name: 'description',
        message: `Enter description for workspace '${workspace.name}':`,
        default: workspace.description || '',
      },
    ]);

    workspace.description = description;
    dbManager.updateWorkspace(workspace);

    if (description) {
      console.log(chalk.green(`✓ Updated description for workspace '${workspace.name}'`));
      console.log(chalk.dim(`  ${description}`));
    } else {
      console.log(chalk.green(`✓ Removed description from workspace '${workspace.name}'`));
    }

  } catch (error) {
    ErrorHandler.handle(error, 'workspace describe');
  }
}
