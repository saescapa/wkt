import chalk from 'chalk';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import type { CommandOptions, Workspace, Project } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';
import { GitUtils } from '../utils/git.js';

export async function cleanCommand(
  workspace?: string,
  options: CommandOptions = {}
): Promise<void> {
  const db = new DatabaseManager();
  
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

  // Protect main branch workspaces (they contain shared files)
  if (isMainBranchWorkspace(workspace, project)) {
    console.log(chalk.yellow(`⚠️  Cannot clean main branch workspace '${workspaceName}' (contains shared files)`));
    console.log(chalk.gray(`   Main workspaces are used as source for symlinked shared files`));
    if (!options.force) {
      console.log(chalk.gray(`   Use --force to override this protection`));
      return;
    }
    console.log(chalk.yellow(`🔥 Force cleaning main workspace...`));
  }

  try {
    if (existsSync(workspace.path)) {
      await GitUtils.removeWorktree(project.bareRepoPath, workspace.path);
      console.log(chalk.green(`Removed workspace directory: ${workspace.path}`));
    }
    
    db.removeWorkspace(workspace.id);
    console.log(chalk.green(`✓ Cleaned workspace '${workspaceName}'`));
  } catch (error) {
    if (existsSync(workspace.path)) {
      rmSync(workspace.path, { recursive: true, force: true });
      console.log(chalk.yellow(`Force removed workspace directory: ${workspace.path}`));
    }
    
    db.removeWorkspace(workspace.id);
    console.log(chalk.green(`✓ Cleaned workspace '${workspaceName}' (forced)`));
  }
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

  let cleanedCount = 0;
  let skippedMain = 0;
  
  for (const workspace of allWorkspaces) {
    const project = db.getProject(workspace.projectName);
    if (!project) {
      console.log(chalk.yellow(`Skipping workspace '${workspace.name}' - project not found`));
      continue;
    }

    // Protect main branch workspaces
    if (isMainBranchWorkspace(workspace, project)) {
      if (!options.force) {
        console.log(chalk.yellow(`⚠️  Skipping main workspace '${workspace.name}' (contains shared files)`));
        skippedMain++;
        continue;
      }
      console.log(chalk.yellow(`🔥 Force cleaning main workspace '${workspace.name}'...`));
    }

    try {
      if (existsSync(workspace.path)) {
        await GitUtils.removeWorktree(project.bareRepoPath, workspace.path);
        console.log(chalk.green(`Removed workspace directory: ${workspace.path}`));
      }
      
      db.removeWorkspace(workspace.id);
      console.log(chalk.green(`✓ Cleaned workspace '${workspace.name}'`));
      cleanedCount++;
    } catch (error) {
      if (existsSync(workspace.path)) {
        rmSync(workspace.path, { recursive: true, force: true });
        console.log(chalk.yellow(`Force removed workspace directory: ${workspace.path}`));
      }
      
      db.removeWorkspace(workspace.id);
      console.log(chalk.green(`✓ Cleaned workspace '${workspace.name}' (forced)`));
      cleanedCount++;
    }
  }
  
  console.log(chalk.green(`\nCleaned ${cleanedCount} workspace(s)`));
  if (skippedMain > 0) {
    console.log(chalk.yellow(`Skipped ${skippedMain} main workspace(s) (use --force to clean)`));
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