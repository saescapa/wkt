import chalk from 'chalk';
import { existsSync, rmSync } from 'fs';
import inquirer from 'inquirer';
import type { CommandOptions, Workspace, Project } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';
import { GitUtils, parseDuration } from '../utils/git.js';

export async function cleanCommand(
  workspace?: string,
  options: CommandOptions = {}
): Promise<void> {
  const db = new DatabaseManager();
  
  // Default to merged behavior unless --all or --older-than is specified
  if (options.merged === undefined && !options.all && !options.olderThan) {
    options.merged = true;
  }
  
  // If --all is specified, don't use merged filter
  if (options.all) {
    options.merged = false;
  }
  
  if (workspace) {
    await cleanSingleWorkspace(workspace, db, options);
  } else {
    await cleanAllWorkspaces(db, options);
  }
}

async function cleanSingleWorkspace(
  workspaceName: string,
  db: DatabaseManager,
  options: CommandOptions
): Promise<void> {
  const allWorkspaces = db.getAllWorkspaces();
  const workspace = allWorkspaces.find(w => w.name === workspaceName);
  
  if (!workspace) {
    console.log(chalk.red(`Workspace '${workspaceName}' not found`));
    return;
  }

  const project = db.getProject(workspace.projectName);
  if (!project) {
    console.log(chalk.red(`Project '${workspace.projectName}' not found`));
    return;
  }

  // Check if workspace should be cleaned based on criteria
  const shouldClean = await shouldCleanWorkspace(workspace, project, options);
  if (!shouldClean.clean) {
    console.log(chalk.yellow(`⚠️  ${shouldClean.reason}`));
    if (!options.force && shouldClean.canForce) {
      console.log(chalk.gray(`   Use --force to override this protection`));
      return;
    }
    if (shouldClean.canForce) {
      console.log(chalk.yellow(`🔥 Force cleaning workspace...`));
    } else {
      return;
    }
  }

  await removeWorkspace(workspace, project, db);
}

async function cleanAllWorkspaces(
  db: DatabaseManager,
  options: CommandOptions
): Promise<void> {
  const allWorkspaces = db.getAllWorkspaces();
  
  if (allWorkspaces.length === 0) {
    console.log(chalk.yellow('No workspaces to clean'));
    return;
  }

  // Filter workspaces based on criteria
  const workspacesToClean: Workspace[] = [];
  const skippedWorkspaces: Array<{ workspace: Workspace; reason: string }> = [];
  
  for (const workspace of allWorkspaces) {
    const project = db.getProject(workspace.projectName);
    if (!project) {
      skippedWorkspaces.push({ workspace, reason: 'project not found' });
      continue;
    }

    const shouldClean = await shouldCleanWorkspace(workspace, project, options);
    if (shouldClean.clean || (options.force && shouldClean.canForce)) {
      workspacesToClean.push(workspace);
    } else {
      skippedWorkspaces.push({ workspace, reason: shouldClean.reason });
    }
  }

  if (workspacesToClean.length === 0) {
    console.log(chalk.yellow('No workspaces match the cleanup criteria'));
    if (skippedWorkspaces.length > 0) {
      console.log(chalk.gray(`\nSkipped workspaces:`));
      for (const { workspace, reason } of skippedWorkspaces.slice(0, 5)) {
        console.log(chalk.gray(`  ${workspace.name}: ${reason}`));
      }
      if (skippedWorkspaces.length > 5) {
        console.log(chalk.gray(`  ... and ${skippedWorkspaces.length - 5} more`));
      }
    }
    return;
  }

  // Show what will be cleaned
  console.log(chalk.cyan(`Found ${workspacesToClean.length} workspace(s) to clean:`));
  for (const workspace of workspacesToClean) {
    const project = db.getProject(workspace.projectName);
    const isMain = project && isMainBranchWorkspace(workspace, project);
    const marker = isMain ? chalk.red('⚠️ ') : chalk.green('• ');
    console.log(`${marker}${workspace.name} (${workspace.branchName})`);
  }

  // Confirm cleanup unless force is used
  if (!options.force) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Clean ${workspacesToClean.length} workspace(s)?`,
        default: false
      }
    ]);

    if (!confirm) {
      console.log(chalk.yellow('Cleanup cancelled'));
      return;
    }
  }

  // Clean workspaces
  let cleanedCount = 0;
  
  for (const workspace of workspacesToClean) {
    const project = db.getProject(workspace.projectName);
    if (!project) continue;

    try {
      await removeWorkspace(workspace, project, db);
      cleanedCount++;
    } catch (error) {
      console.log(chalk.red(`Failed to clean ${workspace.name}: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  }
  
  console.log(chalk.green(`\n✓ Cleaned ${cleanedCount} workspace(s)`));
  
  if (skippedWorkspaces.length > 0) {
    console.log(chalk.yellow(`Skipped ${skippedWorkspaces.length} workspace(s)`));
  }
}

function isMainBranchWorkspace(workspace: Workspace, project: Project): boolean {
  // Check if this workspace is the main/master/default branch
  const mainBranchNames = [project.defaultBranch, 'main', 'master'];
  
  return mainBranchNames.some(branchName => 
    workspace.branchName === branchName || 
    workspace.name === branchName
  );
}

async function shouldCleanWorkspace(
  workspace: Workspace, 
  project: Project, 
  options: CommandOptions
): Promise<{ clean: boolean; reason: string; canForce: boolean }> {
  // Protect main branch workspaces (they contain shared files)
  if (isMainBranchWorkspace(workspace, project)) {
    return {
      clean: false,
      reason: `Cannot clean main branch workspace '${workspace.name}' (contains shared files)`,
      canForce: true
    };
  }

  // Check if we should only clean merged branches
  if (options.merged) {
    try {
      const isMerged = await GitUtils.isBranchMerged(
        project.bareRepoPath, 
        workspace.branchName, 
        project.defaultBranch
      );
      
      if (!isMerged) {
        return {
          clean: false,
          reason: `Branch '${workspace.branchName}' is not merged into ${project.defaultBranch}`,
          canForce: true
        };
      }
    } catch (error) {
      return {
        clean: false,
        reason: `Could not check merge status for '${workspace.branchName}'`,
        canForce: true
      };
    }
  }

  // Check age-based cleanup
  if (options.olderThan) {
    try {
      const maxAge = parseDuration(options.olderThan);
      const branchAge = await GitUtils.getBranchAge(project.bareRepoPath, workspace.branchName);
      
      if (!branchAge) {
        return {
          clean: false,
          reason: `Could not determine age of branch '${workspace.branchName}'`,
          canForce: true
        };
      }
      
      const ageMs = Date.now() - branchAge.getTime();
      if (ageMs < maxAge) {
        const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        return {
          clean: false,
          reason: `Branch '${workspace.branchName}' is only ${days} days old`,
          canForce: true
        };
      }
    } catch (error) {
      return {
        clean: false,
        reason: `Invalid duration format: ${options.olderThan}`,
        canForce: false
      };
    }
  }

  return { clean: true, reason: '', canForce: false };
}

async function removeWorkspace(workspace: Workspace, project: Project, db: DatabaseManager): Promise<void> {
  try {
    if (existsSync(workspace.path)) {
      await GitUtils.removeWorktree(project.bareRepoPath, workspace.path);
      console.log(chalk.green(`Removed workspace directory: ${workspace.path}`));
    }
    
    db.removeWorkspace(workspace.id);
    console.log(chalk.green(`✓ Cleaned workspace '${workspace.name}'`));
  } catch (error) {
    if (existsSync(workspace.path)) {
      rmSync(workspace.path, { recursive: true, force: true });
      console.log(chalk.yellow(`Force removed workspace directory: ${workspace.path}`));
    }
    
    db.removeWorkspace(workspace.id);
    console.log(chalk.green(`✓ Cleaned workspace '${workspace.name}' (forced)`));
  }
}