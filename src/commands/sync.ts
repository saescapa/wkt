import { existsSync } from 'fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import { LocalFilesManager } from '../utils/local-files.js';
import type { Workspace } from '../core/types.js';

interface SyncOptions {
  project?: string;
  workspace?: string;
  files?: string;
  force?: boolean;
  dry?: boolean;
  all?: boolean;
}

export async function syncCommand(options: SyncOptions = {}): Promise<void> {
  const configManager = new ConfigManager();
  const databaseManager = new DatabaseManager();
  const localFilesManager = new LocalFilesManager();

  if (options.dry) {
    console.log(chalk.blue('🔍 Dry run mode - no changes will be made'));
    console.log();
  }

  // Get workspaces to sync
  const workspacesToSync = await getWorkspacesToSync(databaseManager, options);
  
  if (workspacesToSync.length === 0) {
    console.log(chalk.yellow('No workspaces found to sync.'));
    return;
  }

  // Show what will be synced
  console.log(chalk.blue(`📋 Will sync local files for ${workspacesToSync.length} workspace(s):`));
  workspacesToSync.forEach(ws => {
    console.log(`  ${chalk.white(ws.projectName)}/${chalk.cyan(ws.name)} (${ws.branchName})`);
  });
  console.log();

  // Confirm if not forced
  if (!options.force && !options.dry) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Continue with sync?',
      default: true
    }]);

    if (!confirm) {
      console.log(chalk.yellow('Sync cancelled.'));
      return;
    }
  }

  // Sync each workspace
  let synced = 0;
  let errors = 0;

  for (const workspace of workspacesToSync) {
    try {
      console.log(chalk.blue(`🔄 Syncing ${workspace.projectName}/${workspace.name}...`));
      
      if (!options.dry) {
        const project = databaseManager.getProject(workspace.projectName);
        if (!project) {
          console.error(chalk.red(`Error: Project '${workspace.projectName}' not found.`));
          errors++;
          continue;
        }
        const globalConfig = configManager.getConfig();
        const projectConfig = configManager.getProjectConfig(workspace.projectName);
        
        await localFilesManager.setupLocalFiles(
          project, 
          workspace.path, 
          projectConfig, 
          globalConfig,
          { name: workspace.name, branchName: workspace.branchName }
        );
      } else {
        // Show what would be synced
        const config = configManager.getConfig();
        const projectConfig = configManager.getProjectConfig(workspace.projectName);
        const localFilesConfig = {
          shared: projectConfig.local_files?.shared || config.local_files?.shared || [],
          copied: projectConfig.local_files?.copied || config.local_files?.copied || [],
        };

        if (localFilesConfig.shared.length > 0) {
          console.log(`    Would symlink: ${localFilesConfig.shared.join(', ')}`);
        }
        if (localFilesConfig.copied.length > 0) {
          console.log(`    Would copy: ${localFilesConfig.copied.join(', ')}`);
        }
        if (localFilesConfig.shared.length === 0 && localFilesConfig.copied.length === 0) {
          console.log(`    No files configured for local_files management`);
        }
      }
      
      synced++;
    } catch (error) {
      console.error(chalk.red(`  Error syncing ${workspace.projectName}/${workspace.name}: ${error}`));
      errors++;
    }
  }

  console.log();
  if (options.dry) {
    console.log(chalk.blue(`✨ Dry run complete - would sync ${synced} workspace(s)`));
  } else {
    console.log(chalk.green(`✅ Synced ${synced} workspace(s)`));
  }
  
  if (errors > 0) {
    console.log(chalk.red(`❌ ${errors} error(s) occurred`));
  }
}

async function getWorkspacesToSync(databaseManager: DatabaseManager, options: SyncOptions): Promise<Workspace[]> {
  const allWorkspaces = databaseManager.getAllWorkspaces();

  // Filter by project
  let workspaces = options.project 
    ? allWorkspaces.filter(ws => ws.projectName === options.project)
    : allWorkspaces;

  // Filter by specific workspace
  if (options.workspace) {
    const workspaceFilter = options.workspace;
    workspaces = workspaces.filter(ws => 
      ws.name === workspaceFilter || ws.name.includes(workspaceFilter)
    );
  }

  // Filter out non-existent workspace directories
  workspaces = workspaces.filter(ws => existsSync(ws.path));

  return workspaces;
}