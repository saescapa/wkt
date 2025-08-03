import chalk from 'chalk';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import type { CommandOptions } from '../core/types.js';
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
  
  for (const workspace of allWorkspaces) {
    const project = db.getProject(workspace.projectName);
    if (!project) {
      console.log(chalk.yellow(`Skipping workspace '${workspace.name}' - project not found`));
      continue;
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
}