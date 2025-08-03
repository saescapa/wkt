import chalk from 'chalk';
import inquirer from 'inquirer';
import Fuse from 'fuse.js';
import type { CommandOptions, Workspace } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';

export async function switchCommand(
  workspaceName?: string,
  options: CommandOptions = {}
): Promise<void> {
  const dbManager = new DatabaseManager();

  if (workspaceName === '-') {
    const current = dbManager.getCurrentWorkspace();
    if (!current) {
      console.error(chalk.red('Error: No previous workspace found.'));
      process.exit(1);
    }
    workspaceName = current.name;
  }

  let workspaces: Workspace[] = [];

  if (options.project) {
    workspaces = dbManager.getWorkspacesByProject(options.project);
    if (workspaces.length === 0) {
      console.error(chalk.red(`Error: No workspaces found for project '${options.project}'.`));
      process.exit(1);
    }
  } else {
    workspaces = dbManager.getAllWorkspaces();
    if (workspaces.length === 0) {
      console.error(chalk.red('Error: No workspaces found.'));
      console.log('Create a workspace with: wkt create <project> <branch-name>');
      process.exit(1);
    }
  }

  let selectedWorkspace: Workspace | undefined;

  if (!workspaceName || options.search) {
    selectedWorkspace = await selectWorkspaceInteractively(workspaces, workspaceName, options.search);
  } else {
    const matches = findWorkspaceMatches(workspaces, workspaceName);

    if (matches.length === 0) {
      console.error(chalk.red(`Error: No workspace found matching '${workspaceName}'.`));
      
      if (options.create) {
        console.log(chalk.blue('Use --create flag to create a new workspace.'));
        // TODO: Implement create logic here
        return;
      }
      
      console.log('Available workspaces:');
      workspaces.forEach(w => {
        console.log(`  ${w.projectName}/${w.name}`);
      });
      process.exit(1);
    }

    if (matches.length === 1) {
      selectedWorkspace = matches[0];
    } else {
      console.log(chalk.yellow(`Multiple workspaces found matching '${workspaceName}':`));
      selectedWorkspace = await selectFromMultipleMatches(matches);
    }
  }

  if (!selectedWorkspace) {
    console.log(chalk.yellow('No workspace selected.'));
    return;
  }

  try {
    selectedWorkspace.lastUsed = new Date();
    dbManager.updateWorkspace(selectedWorkspace);
    dbManager.setCurrentWorkspace(selectedWorkspace.id);

    if (options.pathOnly) {
      console.log(selectedWorkspace.path);
    } else {
      console.log(chalk.green(`✓ Switched to workspace '${selectedWorkspace.name}'`));
      console.log(chalk.gray(`  Project: ${selectedWorkspace.projectName}`));
      console.log(chalk.gray(`  Branch: ${selectedWorkspace.branchName}`));
      console.log(chalk.gray(`  Path: ${selectedWorkspace.path}`));

      console.log(chalk.blue('\nTo navigate to the workspace:'));
      console.log(chalk.bold(`  cd "${selectedWorkspace.path}"`));
      console.log(chalk.gray('\nOr use: alias wkts=\'cd $(wkt switch --path-only)\''));
    }

  } catch (error) {
    console.error(chalk.red(`Error switching to workspace: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}

function findWorkspaceMatches(workspaces: Workspace[], query: string): Workspace[] {
  const exactMatches = workspaces.filter(w => 
    w.name === query || 
    w.id === query ||
    `${w.projectName}/${w.name}` === query
  );

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  return workspaces.filter(w => 
    w.name.toLowerCase().includes(query.toLowerCase()) ||
    w.branchName.toLowerCase().includes(query.toLowerCase()) ||
    `${w.projectName}/${w.name}`.toLowerCase().includes(query.toLowerCase())
  );
}

async function selectWorkspaceInteractively(
  workspaces: Workspace[], 
  query?: string,
  enableSearch?: boolean
): Promise<Workspace | undefined> {
  let filteredWorkspaces = workspaces;

  if (query && enableSearch) {
    const fuse = new Fuse(workspaces, {
      keys: ['name', 'branchName', 'projectName'],
      threshold: 0.3,
    });
    
    const results = fuse.search(query);
    filteredWorkspaces = results.map(r => r.item);
  }

  if (filteredWorkspaces.length === 0) {
    console.log(chalk.yellow('No workspaces match your search.'));
    return undefined;
  }

  const choices = filteredWorkspaces.map(workspace => ({
    name: formatWorkspaceChoice(workspace),
    value: workspace,
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

  return selectedWorkspace;
}

async function selectFromMultipleMatches(matches: Workspace[]): Promise<Workspace | undefined> {
  const choices = matches.map((workspace, index) => ({
    name: `${index + 1}. ${workspace.projectName}/${workspace.name} (${workspace.branchName})`,
    value: workspace,
  }));

  const { selectedWorkspace } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedWorkspace',
      message: 'Multiple matches found. Select workspace:',
      choices,
    },
  ]);

  return selectedWorkspace;
}

function formatWorkspaceChoice(workspace: Workspace): string {
  const statusColor = workspace.status.clean ? chalk.green : chalk.yellow;
  const statusIcon = workspace.status.clean ? '●' : '◐';
  
  const lastUsedTime = formatTimeAgo(workspace.lastUsed);
  
  return `${statusColor(statusIcon)} ${chalk.bold(workspace.projectName)}/${workspace.name} ${chalk.gray(`(${workspace.branchName})`)} ${chalk.gray(`- ${lastUsedTime}`)}`;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return `${diffDays}d ago`;
  }
}