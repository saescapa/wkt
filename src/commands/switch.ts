import chalk from 'chalk';
import inquirer from 'inquirer';
import Fuse from 'fuse.js';
import type { SwitchCommandOptions, Workspace } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';
import { ConfigManager } from '../core/config.js';
import { ErrorHandler, WorkspaceNotFoundError, NoWorkspaceError } from '../utils/errors.js';
import { SafeScriptExecutor } from '../utils/script-executor.js';
import { formatTimeAgo } from '../utils/format.js';

export async function switchCommand(
  workspaceName?: string,
  options: SwitchCommandOptions = {}
): Promise<void> {
  try {
    const dbManager = new DatabaseManager();

    if (workspaceName === '-') {
      const current = dbManager.getCurrentWorkspaceContext();
      if (!current) {
        throw new NoWorkspaceError();
      }
      workspaceName = current.name;
    }

    let workspaces: Workspace[] = [];

    if (options.project) {
      workspaces = dbManager.getWorkspacesByProject(options.project);
      if (workspaces.length === 0) {
        throw new WorkspaceNotFoundError(`project '${options.project}'`);
      }
    } else {
      workspaces = dbManager.getAllWorkspaces();
      if (workspaces.length === 0) {
        throw new NoWorkspaceError();
      }
    }

    let selectedWorkspace: Workspace | undefined;

    if (!workspaceName || options.search) {
      selectedWorkspace = await selectWorkspaceInteractively(workspaces, workspaceName, options.search);
    } else {
      const matches = findWorkspaceMatches(workspaces, workspaceName);

      if (matches.length === 0) {
        const availableWorkspaces = workspaces.map(w => `${w.projectName}/${w.name}`);
        throw new WorkspaceNotFoundError(workspaceName, availableWorkspaces);
      }

      if (matches.length === 1) {
        selectedWorkspace = matches[0];
      } else {
        // Handle multiple matches - if --path-only, try to be smart about selection
        if (options.pathOnly) {
          // For path-only mode (used by shell functions), implement cycling behavior
          const currentWorkspace = dbManager.getCurrentWorkspaceContext();

          if (currentWorkspace && matches.find(w => w.id === currentWorkspace.id)) {
            // Current workspace is one of the matches - cycle to the next one
            const sortedMatches = matches.sort((a, b) => {
              // Sort by project name first, then by name for consistent ordering
              if (a.projectName !== b.projectName) {
                return a.projectName.localeCompare(b.projectName);
              }
              return a.name.localeCompare(b.name);
            });

            const currentIndex = sortedMatches.findIndex(w => w.id === currentWorkspace.id);
            const nextIndex = (currentIndex + 1) % sortedMatches.length;
            selectedWorkspace = sortedMatches[nextIndex];
          } else {
            // Not currently in one of the matches - prefer current project, then most recent
            if (currentWorkspace) {
              const currentProjectMatch = matches.find(w => w.projectName === currentWorkspace.projectName);
              if (currentProjectMatch) {
                selectedWorkspace = currentProjectMatch;
              } else {
                // No current project match, use most recently used
                selectedWorkspace = matches.sort((a, b) =>
                  new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
                )[0];
              }
            } else {
              // No current workspace, use most recently used
              selectedWorkspace = matches.sort((a, b) =>
                new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
              )[0];
            }
          }
        } else {
          // Interactive mode for normal usage
          console.log(chalk.yellow(`Multiple workspaces found matching '${workspaceName}':`));
          selectedWorkspace = await selectFromMultipleMatches(matches);
        }
      }
    }

    if (!selectedWorkspace) {
      console.log(chalk.yellow('No workspace selected.'));
      return;
    }

    const configManager = new ConfigManager();
    const globalConfig = configManager.getConfig();

    // Execute pre_switch hooks for the current workspace (teardown)
    const currentWorkspace = dbManager.getCurrentWorkspaceContext();
    if (currentWorkspace && currentWorkspace.id !== selectedWorkspace.id) {
      const currentProject = dbManager.getProject(currentWorkspace.projectName);
      if (currentProject) {
        const currentProjectConfig = configManager.getProjectConfig(currentWorkspace.projectName);
        const scriptConfig = currentProjectConfig.scripts || globalConfig.scripts;
        if (scriptConfig) {
          const context = SafeScriptExecutor.createContext(currentWorkspace, currentProject);
          await SafeScriptExecutor.executePreSwitchHooks(context, scriptConfig, { force: true });
        }
      }
    }

    selectedWorkspace.lastUsed = new Date();
    dbManager.updateWorkspace(selectedWorkspace);

    // Execute post_switch hooks for the new workspace (setup)
    const newProject = dbManager.getProject(selectedWorkspace.projectName);
    if (newProject) {
      const newProjectConfig = configManager.getProjectConfig(selectedWorkspace.projectName);
      const scriptConfig = newProjectConfig.scripts || globalConfig.scripts;
      if (scriptConfig) {
        const context = SafeScriptExecutor.createContext(selectedWorkspace, newProject);
        await SafeScriptExecutor.executePostSwitchHooks(context, scriptConfig, { force: true });
      }
    }

    if (options.pathOnly) {
      console.log(selectedWorkspace.path);
    } else {
      console.log(chalk.green(`✓ Switched to workspace '${selectedWorkspace.name}'`));
      if (selectedWorkspace.description) {
        console.log(chalk.dim(`  ${selectedWorkspace.description}`));
      }
      console.log(chalk.gray(`  Project: ${selectedWorkspace.projectName}`));
      console.log(chalk.gray(`  Branch: ${selectedWorkspace.branchName}`));
      console.log(chalk.gray(`  Path: ${selectedWorkspace.path}`));

      console.log(chalk.blue('\nTo navigate to the workspace:'));
      console.log(chalk.bold(`  cd "${selectedWorkspace.path}"`));
      console.log(chalk.gray('\nOr use: alias wkts=\'cd $(wkt switch --path-only)\''));
    }

  } catch (error) {
    // In path-only mode, use minimal error output to avoid breaking shell integration
    ErrorHandler.handle(error, { minimal: options.pathOnly });
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

  let choice = `${statusColor(statusIcon)} ${chalk.bold(workspace.projectName)}/${workspace.name} ${chalk.gray(`(${workspace.branchName})`)}`;
  if (workspace.description) {
    choice += ` ${chalk.dim(`- ${workspace.description}`)}`;
  }
  choice += ` ${chalk.gray(`- ${lastUsedTime}`)}`;

  return choice;
}

