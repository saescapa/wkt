import chalk from 'chalk';
import { existsSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import inquirer from 'inquirer';
import type { CommandOptions, Workspace, Project } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';
import { ConfigManager } from '../core/config.js';
import { GitUtils, parseDuration } from '../utils/git.js';
import { SafeScriptExecutor } from '../utils/script-executor.js';

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

  // Check for orphaned directories
  const orphanedDirs = await findOrphanedDirectories(db);

  if (allWorkspaces.length === 0 && orphanedDirs.length === 0) {
    console.log(chalk.yellow('No workspaces to clean'));
    return;
  }

  // Handle orphaned directories first if any exist
  if (orphanedDirs.length > 0) {
    await handleOrphanedDirectories(orphanedDirs, options);
  }

  if (allWorkspaces.length === 0) {
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

  // Show what can be cleaned and let user select
  console.log(chalk.cyan(`Found ${workspacesToClean.length} workspace(s) that can be cleaned:`));
  
  // Interactive selection with checkboxes (always show, regardless of force flag)
  const choices = workspacesToClean.map(workspace => {
    const project = db.getProject(workspace.projectName);
    const isMain = project && isMainBranchWorkspace(workspace, project);
    const marker = isMain ? '⚠️ ' : '';
    const projectInfo = workspace.projectName !== workspace.name ? ` [${workspace.projectName}]` : '';
    
    return {
      name: `${marker}${workspace.name} (${workspace.branchName})${projectInfo}`,
      value: workspace,
      checked: true // Default to checked
    };
  });

  const { selectedForCleanup } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedForCleanup',
      message: options.force 
        ? 'Select workspaces to force clean (use space to toggle, enter to confirm):' 
        : 'Select workspaces to clean (use space to toggle, enter to confirm):',
      choices: choices,
      pageSize: Math.min(10, choices.length),
    }
  ]);

  const selectedWorkspaces = selectedForCleanup as Workspace[];

  if (selectedWorkspaces.length === 0) {
    console.log(chalk.yellow('No workspaces selected for cleanup'));
    return;
  }

  console.log(chalk.cyan(`\nSelected ${selectedWorkspaces.length} workspace(s) for cleanup:`));
  for (const workspace of selectedWorkspaces) {
    const project = db.getProject(workspace.projectName);
    const isMain = project && isMainBranchWorkspace(workspace, project);
    const marker = isMain ? chalk.red('⚠️ ') : chalk.green('• ');
    console.log(`${marker}${workspace.name} (${workspace.branchName})`);
  }

  // Clean workspaces
  let cleanedCount = 0;
  
  for (const workspace of selectedWorkspaces) {
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
    } catch {
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
    } catch {
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
  const configManager = new ConfigManager();
  const globalConfig = configManager.getConfig();
  const projectConfig = configManager.getProjectConfig(workspace.projectName);
  const scriptConfig = projectConfig.scripts || globalConfig.scripts;

  // Execute pre_clean hooks (e.g., stop containers, cleanup resources)
  if (scriptConfig) {
    const context = SafeScriptExecutor.createContext(workspace, project);
    await SafeScriptExecutor.executePreCleanHooks(context, scriptConfig, { force: true });
  }

  let directoryRemoved = false;

  // Try to remove via git worktree first
  if (existsSync(workspace.path)) {
    try {
      await GitUtils.removeWorktree(project.bareRepoPath, workspace.path);
      console.log(chalk.green(`Removed workspace via git worktree: ${workspace.path}`));
      directoryRemoved = true;
    } catch (error) {
      console.log(chalk.yellow(`Git worktree remove failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
      // Fallback to manual directory removal
      try {
        rmSync(workspace.path, { recursive: true, force: true });
        console.log(chalk.yellow(`Force removed workspace directory: ${workspace.path}`));
        directoryRemoved = true;
      } catch (rmError) {
        console.log(chalk.red(`Failed to remove directory ${workspace.path}: ${rmError instanceof Error ? rmError.message : 'Unknown error'}`));
      }
    }
  } else {
    console.log(chalk.gray(`Directory ${workspace.path} does not exist`));
    directoryRemoved = true; // Consider it "removed" if it doesn't exist
  }

  // Always remove from database, even if directory removal failed
  db.removeWorkspace(workspace.id);

  // Execute post_clean hooks (e.g., cleanup external resources)
  if (scriptConfig) {
    const context = SafeScriptExecutor.createContext(workspace, project);
    await SafeScriptExecutor.executePostCleanHooks(context, scriptConfig, { force: true });
  }

  if (directoryRemoved) {
    console.log(chalk.green(`✓ Cleaned workspace '${workspace.name}'`));
  } else {
    console.log(chalk.yellow(`⚠️  Workspace '${workspace.name}' removed from database but directory may still exist`));
  }
}

async function findOrphanedDirectories(db: DatabaseManager): Promise<Array<{ projectName: string; dirName: string; fullPath: string }>> {
  const orphanedDirs: Array<{ projectName: string; dirName: string; fullPath: string }> = [];
  const allProjects = db.getAllProjects();
  const allWorkspaces = db.getAllWorkspaces();

  for (const project of allProjects) {
    if (!existsSync(project.workspacesPath)) {
      continue;
    }

    try {
      const directories = readdirSync(project.workspacesPath);

      for (const dirName of directories) {
        const fullPath = join(project.workspacesPath, dirName);

        // Check if it's actually a directory
        if (!statSync(fullPath).isDirectory()) {
          continue;
        }

        // Check if this directory corresponds to a known workspace
        const hasWorkspace = allWorkspaces.some(w =>
          w.projectName === project.name &&
          (w.name === dirName || w.path === fullPath)
        );

        if (!hasWorkspace) {
          orphanedDirs.push({
            projectName: project.name,
            dirName,
            fullPath
          });
        }
      }
    } catch {
      console.log(chalk.yellow(`Warning: Could not read directories in ${project.workspacesPath}`));
    }
  }

  return orphanedDirs;
}

async function handleOrphanedDirectories(
  orphanedDirs: Array<{ projectName: string; dirName: string; fullPath: string }>,
  _options: CommandOptions
): Promise<void> {
  console.log(chalk.cyan(`\nFound ${orphanedDirs.length} orphaned workspace directories:`));

  const choices = orphanedDirs.map(dir => ({
    name: `${dir.dirName} [${dir.projectName}] (${dir.fullPath})`,
    value: dir,
    checked: true
  }));

  const { selectedOrphans } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedOrphans',
      message: 'Select orphaned directories to remove (use space to toggle, enter to confirm):',
      choices: choices,
      pageSize: Math.min(10, choices.length),
    }
  ]);

  if (selectedOrphans.length === 0) {
    console.log(chalk.yellow('No orphaned directories selected for removal'));
    return;
  }

  console.log(chalk.cyan(`\nRemoving ${selectedOrphans.length} orphaned directories:`));

  let removedCount = 0;
  for (const dir of selectedOrphans) {
    try {
      rmSync(dir.fullPath, { recursive: true, force: true });
      console.log(chalk.green(`✓ Removed orphaned directory: ${dir.fullPath}`));
      removedCount++;
    } catch (error) {
      console.log(chalk.red(`Failed to remove ${dir.fullPath}: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  }

  console.log(chalk.green(`\n✓ Removed ${removedCount} orphaned directory(ies)`));
}