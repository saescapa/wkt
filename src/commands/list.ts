import chalk from 'chalk';
import type { ListCommandOptions, Workspace } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';
import { ConfigManager } from '../core/config.js';
import { formatTimeAgo } from '../utils/format.js';

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

  // Filter by dirty (uncommitted changes)
  if (options.dirty) {
    workspaces = workspaces.filter(w => !w.status.clean);

    if (workspaces.length === 0) {
      console.log(chalk.green('No workspaces with uncommitted changes.'));
      return;
    }
  }

  // Filter by stale (older than specified duration)
  if (options.stale) {
    const { parseDuration } = await import('../utils/git/index.js');
    try {
      const maxAge = parseDuration(options.stale);
      const now = Date.now();

      workspaces = workspaces.filter(w => {
        const age = now - w.lastUsed.getTime();
        return age > maxAge;
      });

      if (workspaces.length === 0) {
        console.log(chalk.green(`No workspaces older than ${options.stale}.`));
        return;
      }
    } catch {
      console.log(chalk.red(`Invalid duration format: ${options.stale}`));
      console.log(chalk.gray('Use format like "30d", "2w", "6m", "1y"'));
      return;
    }
  }

  // Filter by pool (claimed or pooled workspaces)
  if (options.pool) {
    workspaces = workspaces.filter(w => w.mode === 'claimed' || w.mode === 'pooled');

    if (workspaces.length === 0) {
      console.log(chalk.yellow('No pooled or claimed workspaces.'));
      return;
    }
  }

  const currentWorkspace = dbManager.getCurrentWorkspaceContext();

  // Separate active vs inactive workspaces
  let activeWorkspaces = workspaces;
  let inactiveWorkspaces: Workspace[] = [];

  if (!options.all && config.display.hide_inactive_main_branches) {
    const allProjects = dbManager.getAllProjects();
    const projectDefaultBranches = new Map(
      allProjects.map(p => [p.name, p.defaultBranch])
    );

    const now = new Date();
    const inactiveDaysThreshold = config.display.main_branch_inactive_days;
    const inactiveThresholdMs = inactiveDaysThreshold * 24 * 60 * 60 * 1000;

    activeWorkspaces = [];
    inactiveWorkspaces = [];

    for (const workspace of workspaces) {
      const defaultBranch = projectDefaultBranches.get(workspace.projectName);
      const isMainBranch = defaultBranch && workspace.branchName === defaultBranch;

      // Non-main branches are always active
      if (!isMainBranch) {
        activeWorkspaces.push(workspace);
        continue;
      }

      // Current workspace is always active
      if (currentWorkspace?.id === workspace.id) {
        activeWorkspaces.push(workspace);
        continue;
      }

      // Main branch with uncommitted changes is active
      if (!workspace.status.clean) {
        activeWorkspaces.push(workspace);
        continue;
      }

      // Check if recently used
      const timeSinceLastUse = now.getTime() - workspace.lastUsed.getTime();
      if (timeSinceLastUse < inactiveThresholdMs) {
        activeWorkspaces.push(workspace);
      } else {
        inactiveWorkspaces.push(workspace);
      }
    }
  }

  if (options.groupBy === 'project' || !options.groupBy) {
    displayGroupedByProject(activeWorkspaces, currentWorkspace, options.details);
  } else {
    displayFlat(activeWorkspaces, currentWorkspace, options.details);
  }

  // Show inactive workspaces in separate section (compact format)
  if (inactiveWorkspaces.length > 0) {
    console.log(chalk.dim('─'.repeat(40)));
    const inactiveList = inactiveWorkspaces.map(w => {
      const timeAgo = formatTimeAgo(w.lastUsed).replace(' ago', '');
      return `${w.projectName}/${w.name} (${timeAgo})`;
    }).join(', ');
    console.log(chalk.dim(`Inactive: ${inactiveList}`));
  }

  // Show pool summary when using --pool flag
  if (options.pool) {
    const pooledCount = workspaces.filter(w => w.mode === 'pooled').length;
    console.log(chalk.dim('─'.repeat(40)));
    console.log(chalk.gray(`(${pooledCount} available in pool)`));
  }

  // Show legend
  console.log();
  console.log(chalk.dim('─'.repeat(40)));
  console.log(chalk.dim(`${chalk.green('●')} active  ${chalk.blue('○')} workspace  ${chalk.cyan('◇')} pooled  ${chalk.yellow('◐')} dirty  ${chalk.red('✗')} conflict`));
}

function displayGroupedByProject(workspaces: Workspace[], currentWorkspace?: Workspace, showDetails?: boolean): void {
  const projectGroups = groupWorkspacesByProject(workspaces);

  Object.entries(projectGroups).forEach(([projectName, projectWorkspaces]) => {
    console.log(chalk.bold(`${projectName}/`));

    const branchGroups = groupByTrackingBranch(projectWorkspaces);

    Object.entries(branchGroups).forEach(([branchName, branchWorkspaces]) => {
      console.log(chalk.dim(`  ${branchName}:`));

      branchWorkspaces.forEach((workspace, index) => {
        const isLast = index === branchWorkspaces.length - 1;
        const connector = isLast ? '└─' : '├─';
        const isCurrent = currentWorkspace?.id === workspace.id;

        console.log(formatWorkspace(workspace, `    ${connector} `, isCurrent, showDetails));
      });
    });

    console.log();
  });
}

// Extract pool number from workspace name (e.g., "main-wksp-3" -> 3, "wksp-1" -> 1)
function getPoolNumber(name: string): number | null {
  const match = name.match(/wksp-(\d+)$/);
  return match && match[1] ? parseInt(match[1], 10) : null;
}

function groupByTrackingBranch(workspaces: Workspace[]): Record<string, Workspace[]> {
  const groups: Record<string, Workspace[]> = {};

  for (const ws of workspaces) {
    const trackingBranch = ws.trackingBranch ?? ws.baseBranch;
    if (!groups[trackingBranch]) {
      groups[trackingBranch] = [];
    }
    groups[trackingBranch]!.push(ws);
  }

  for (const group of Object.values(groups)) {
    group.sort((a, b) => {
      const aPoolNum = getPoolNumber(a.name);
      const bPoolNum = getPoolNumber(b.name);
      const aIsPool = aPoolNum !== null;
      const bIsPool = bPoolNum !== null;

      // Pool workspaces come first
      if (aIsPool && !bIsPool) return -1;
      if (!aIsPool && bIsPool) return 1;

      // Both are pool workspaces - sort by number, then by availability
      if (aIsPool && bIsPool) {
        // Available (pooled) before in-use (claimed)
        if (a.mode === 'pooled' && b.mode !== 'pooled') return -1;
        if (a.mode !== 'pooled' && b.mode === 'pooled') return 1;
        // Then by number
        return aPoolNum! - bPoolNum!;
      }

      // Neither are pool workspaces - sort by lastUsed
      return b.lastUsed.getTime() - a.lastUsed.getTime();
    });
  }

  return groups;
}

function displayFlat(workspaces: Workspace[], currentWorkspace?: Workspace, showDetails?: boolean): void {
  workspaces
    .sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime())
    .forEach((workspace, index) => {
      const isLast = index === workspaces.length - 1;
      const connector = isLast ? '└─' : '├─';
      const isCurrent = currentWorkspace?.id === workspace.id;

      console.log(formatWorkspace(workspace, `${connector} `, isCurrent, showDetails, true));
    });
}

function formatWorkspace(workspace: Workspace, prefix: string, isCurrent: boolean, showDetails?: boolean, includeProject?: boolean): string {
  const modeIcon = getModeIcon(workspace, isCurrent);
  const dirtyIndicator = getDirtyIndicator(workspace);
  const statusText = getStatusText(workspace);
  const timeAgo = formatTimeAgo(workspace.lastUsed);

  let name = workspace.name;
  if (includeProject) {
    name = `${workspace.projectName}/${workspace.name}`;
  }

  const icon = dirtyIndicator || modeIcon;
  let line = `${prefix}${icon} ${chalk.bold(name)}`;

  if (showDetails) {
    if (workspace.description) {
      line += ` ${chalk.dim(`- ${workspace.description}`)}`;
    }
    line += `\n${prefix}    Branch: ${chalk.cyan(workspace.branchName)}`;
    line += `\n${prefix}    Base: ${chalk.gray(workspace.baseBranch)}`;
    if (workspace.trackingBranch) {
      line += `\n${prefix}    Tracking: ${chalk.gray(workspace.trackingBranch)}`;
    }
    line += `\n${prefix}    Mode: ${chalk.gray(workspace.mode)}`;
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
    const modeLabel = getModeLabel(workspace, isCurrent);
    if (modeLabel) {
      line += ` ${chalk.gray(modeLabel)}`;
    }
    if (workspace.description) {
      line += ` ${chalk.dim(`- ${workspace.description}`)}`;
    }
    if (!workspace.status.clean) {
      line += ` ${statusText}`;
    }
    line += ` ${chalk.gray(`- ${timeAgo}`)}`;
  }

  return line;
}

function getModeIcon(workspace: Workspace, isCurrent: boolean): string {
  if (isCurrent) {
    return chalk.green('●');
  }
  switch (workspace.mode) {
    case 'pooled':
      return chalk.cyan('◇');
    case 'claimed':
    case 'branched':
    default:
      return chalk.blue('○');
  }
}

function getModeLabel(workspace: Workspace, isCurrent: boolean): string {
  if (isCurrent) {
    return 'active';
  }
  // Only show label for pooled workspaces
  if (workspace.mode === 'pooled') {
    return 'pooled';
  }
  // Claimed and branched show no label
  return '';
}

function getDirtyIndicator(workspace: Workspace): string | null {
  if (workspace.status.conflicted > 0) {
    return chalk.red('✗');
  } else if (!workspace.status.clean) {
    return chalk.yellow('◐');
  }
  return null;
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


