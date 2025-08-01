import chalk from 'chalk';
import type { CommandOptions, Workspace } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';

export async function listCommand(options: CommandOptions = {}): Promise<void> {
  const dbManager = new DatabaseManager();

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
    groups[workspace.projectName].push(workspace);
  });

  Object.keys(groups).forEach(projectName => {
    groups[projectName].sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime());
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