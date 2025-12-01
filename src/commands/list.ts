import chalk from 'chalk';
import { existsSync } from 'fs';
import type { ListCommandOptions, Workspace } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';
import { ConfigManager } from '../core/config.js';
import { GitUtils } from '../utils/git.js';

export async function listCommand(options: ListCommandOptions = {}): Promise<void> {
  const dbManager = new DatabaseManager();
  const configManager = new ConfigManager();
  const config = configManager.getConfig();

  let workspaces: Workspace[] = [];

  if (options.project) {
    workspaces = dbManager.getWorkspacesByProject(options.project);
    if (workspaces.length === 0) {
      console.log(chalk.yellow(`No workspaces found for project '${options.project}'.`));
      return;
    }
  } else {
    workspaces = dbManager.getAllWorkspaces();
    if (workspaces.length === 0) {
      console.log(chalk.yellow('No workspaces found.'));
      console.log('Create a workspace with: wkt create <project> <branch-name>');
      return;
    }
  }

  // Update workspace status in real-time
  await updateWorkspaceStatuses(workspaces, dbManager);

  if (options.filter) {
    const filterPattern = options.filter.toLowerCase();
    workspaces = workspaces.filter(w =>
      w.name.toLowerCase().includes(filterPattern) ||
      w.branchName.toLowerCase().includes(filterPattern) ||
      w.projectName.toLowerCase().includes(filterPattern)
    );

    if (workspaces.length === 0) {
      console.log(chalk.yellow(`No workspaces found matching filter '${options.filter}'.`));
      return;
    }
  }

  // Apply smart filtering for inactive main branches (unless --all flag is used)
  if (!options.all && config.display.hide_inactive_main_branches) {
    const currentWorkspace = dbManager.getCurrentWorkspace();
    const allProjects = dbManager.getAllProjects();
    const projectDefaultBranches = new Map(
      allProjects.map(p => [p.name, p.defaultBranch])
    );

    const now = new Date();
    const inactiveDaysThreshold = config.display.main_branch_inactive_days;
    const inactiveThresholdMs = inactiveDaysThreshold * 24 * 60 * 60 * 1000;

    workspaces = workspaces.filter(workspace => {
      const defaultBranch = projectDefaultBranches.get(workspace.projectName);
      const isMainBranch = defaultBranch && workspace.branchName === defaultBranch;

      if (!isMainBranch) {
        return true; // Always show non-main branches
      }

      // Show main branch if it's the current workspace
      if (currentWorkspace?.id === workspace.id) {
        return true;
      }

      // Show main branch if it has uncommitted changes
      if (!workspace.status.clean) {
        return true;
      }

      // Show main branch if it was used recently
      const timeSinceLastUse = now.getTime() - workspace.lastUsed.getTime();
      if (timeSinceLastUse < inactiveThresholdMs) {
        return true;
      }

      // Hide inactive main branch
      return false;
    });

    if (workspaces.length === 0) {
      console.log(chalk.yellow('No active workspaces found.'));
      console.log(chalk.gray('Use --all to show inactive main branches.'));
      return;
    }
  }

  const currentWorkspace = dbManager.getCurrentWorkspace();

  if (options.groupBy === 'project' || !options.groupBy) {
    displayGroupedByProject(workspaces, currentWorkspace, options.details);
  } else {
    displayFlat(workspaces, currentWorkspace, options.details);
  }
}

function displayGroupedByProject(workspaces: Workspace[], currentWorkspace?: Workspace, showDetails?: boolean): void {
  const projectGroups = groupWorkspacesByProject(workspaces);

  Object.entries(projectGroups).forEach(([projectName, projectWorkspaces]) => {
    console.log(chalk.bold(`${projectName}:`));
    
    projectWorkspaces.forEach(workspace => {
      const isCurrent = currentWorkspace?.id === workspace.id;
      const prefix = isCurrent ? chalk.green('  * ') : '    ';
      
      console.log(formatWorkspace(workspace, prefix, showDetails));
    });
    
    console.log();
  });
}

function displayFlat(workspaces: Workspace[], currentWorkspace?: Workspace, showDetails?: boolean): void {
  workspaces
    .sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime())
    .forEach(workspace => {
      const isCurrent = currentWorkspace?.id === workspace.id;
      const prefix = isCurrent ? chalk.green('* ') : '  ';
      
      console.log(formatWorkspace(workspace, prefix, showDetails, true));
    });
}

function formatWorkspace(workspace: Workspace, prefix: string, showDetails?: boolean, includeProject?: boolean): string {
  const statusIcon = getStatusIcon(workspace);
  const statusText = getStatusText(workspace);
  const timeAgo = formatTimeAgo(workspace.lastUsed);

  let name = workspace.name;
  if (includeProject) {
    name = `${workspace.projectName}/${workspace.name}`;
  }

  let line = `${prefix}${statusIcon} ${chalk.bold(name)}`;

  if (showDetails) {
    if (workspace.description) {
      line += ` ${chalk.dim(`- ${workspace.description}`)}`;
    }
    line += `\n${prefix}    Branch: ${chalk.cyan(workspace.branchName)}`;
    line += `\n${prefix}    Base: ${chalk.gray(workspace.baseBranch)}`;
    line += `\n${prefix}    Path: ${chalk.gray(workspace.path)}`;
    line += `\n${prefix}    Status: ${statusText}`;
    line += `\n${prefix}    Created: ${chalk.gray(workspace.createdAt.toLocaleDateString())}`;
    line += `\n${prefix}    Last used: ${chalk.gray(timeAgo)}`;

    if (workspace.commitsAhead || workspace.commitsBehind) {
      const ahead = workspace.commitsAhead || 0;
      const behind = workspace.commitsBehind || 0;
      line += `\n${prefix}    Commits: `;
      if (ahead > 0) line += chalk.green(`+${ahead} `);
      if (behind > 0) line += chalk.red(`-${behind}`);
    }
  } else {
    line += ` ${chalk.gray(`(${workspace.branchName})`)}`;
    if (workspace.description) {
      line += ` ${chalk.dim(`- ${workspace.description}`)}`;
    }
    line += ` ${statusText}`;
    line += ` ${chalk.gray(`- ${timeAgo}`)}`;
  }

  return line;
}

function groupWorkspacesByProject(workspaces: Workspace[]): Record<string, Workspace[]> {
  const groups: Record<string, Workspace[]> = {};
  
  workspaces.forEach(workspace => {
    if (!groups[workspace.projectName]) {
      groups[workspace.projectName] = [];
    }
    const projectGroup = groups[workspace.projectName];
    if (projectGroup) {
      projectGroup.push(workspace);
    }
  });

  Object.keys(groups).forEach(projectName => {
    const projectGroup = groups[projectName];
    if (projectGroup) {
      projectGroup.sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime());
    }
  });

  return groups;
}

function getStatusIcon(workspace: Workspace): string {
  if (workspace.status.conflicted > 0) {
    return chalk.red('✗');
  } else if (!workspace.status.clean) {
    return chalk.yellow('◐');
  } else {
    return chalk.green('●');
  }
}

function getStatusText(workspace: Workspace): string {
  if (workspace.status.clean) {
    return chalk.green('clean');
  }

  const parts: string[] = [];
  
  if (workspace.status.conflicted > 0) {
    parts.push(chalk.red(`${workspace.status.conflicted} conflicted`));
  }
  
  if (workspace.status.staged > 0) {
    parts.push(chalk.green(`${workspace.status.staged} staged`));
  }
  
  if (workspace.status.unstaged > 0) {
    parts.push(chalk.yellow(`${workspace.status.unstaged} unstaged`));
  }
  
  if (workspace.status.untracked > 0) {
    parts.push(chalk.gray(`${workspace.status.untracked} untracked`));
  }

  if (parts.length === 0) {
    return chalk.yellow('dirty');
  }

  return parts.join(', ');
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return 'yesterday';
  } else {
    return `${diffDays}d ago`;
  }
}

async function updateWorkspaceStatuses(workspaces: Workspace[], dbManager: DatabaseManager): Promise<void> {
  // Update status for each workspace in parallel
  const updates = workspaces.map(async (workspace) => {
    // Skip if workspace path doesn't exist
    if (!existsSync(workspace.path)) {
      return;
    }

    try {
      // Get current git status
      const status = await GitUtils.getWorkspaceStatus(workspace.path);

      // Update workspace status if it changed
      if (status.clean !== workspace.status.clean ||
          status.staged !== workspace.status.staged ||
          status.unstaged !== workspace.status.unstaged ||
          status.untracked !== workspace.status.untracked ||
          status.conflicted !== workspace.status.conflicted) {
        workspace.status = status;
        dbManager.updateWorkspace(workspace);
      }
    } catch (error) {
      // Silently skip workspaces with git errors (might be corrupted or deleted)
      console.warn(`Warning: Could not update status for workspace ${workspace.name}`);
    }
  });

  await Promise.all(updates);
}