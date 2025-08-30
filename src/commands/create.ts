import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import chalk from 'chalk';
import type { CommandOptions, Workspace } from '../core/types.js';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import { GitUtils } from '../utils/git.js';
import { BranchInference } from '../utils/branch-inference.js';
import { LocalFilesManager } from '../utils/local-files.js';
import { SafeScriptExecutor } from '../utils/script-executor.js';

export async function createCommand(
  projectName: string,
  branchName: string,
  options: CommandOptions = {}
): Promise<void> {
  const configManager = new ConfigManager();
  const dbManager = new DatabaseManager();
  const localFilesManager = new LocalFilesManager();

  const project = dbManager.getProject(projectName);
  if (!project) {
    console.error(chalk.red(`Error: Project '${projectName}' not found.`));
    console.log('Use `wkt init --list` to see available projects.');
    console.log(`Or initialize it with: wkt init <repository-url> ${projectName}`);
    process.exit(1);
  }

  const config = configManager.getConfig();
  const projectConfig = configManager.getProjectConfig(projectName);

  const inferencePatterns = projectConfig.inference?.patterns || config.inference.patterns;
  const inferredBranchName = BranchInference.inferBranchName(branchName, inferencePatterns);

  const namingStrategy = projectConfig.workspace?.naming_strategy || config.workspace.naming_strategy;
  const workspaceName = options.name || BranchInference.sanitizeWorkspaceName(inferredBranchName, namingStrategy);

  const workspaceId = BranchInference.generateWorkspaceId(projectName, workspaceName);

  if (dbManager.getWorkspace(workspaceId) && !options.force) {
    console.error(chalk.red(`Error: Workspace '${workspaceName}' already exists in project '${projectName}'.`));
    console.log('Use --force to overwrite the existing workspace.');
    process.exit(1);
  }

  const workspacePath = join(project.workspacesPath, workspaceName);

  if (existsSync(workspacePath) && !options.force) {
    console.error(chalk.red(`Error: Directory '${workspacePath}' already exists.`));
    console.log('Use --force to overwrite the existing directory.');
    process.exit(1);
  }

  console.log(chalk.blue(`Creating workspace '${workspaceName}' for project '${projectName}'...`));
  console.log(chalk.gray(`Branch: ${inferredBranchName}`));
  console.log(chalk.gray(`Base: ${options.from || project.defaultBranch}`));

  try {
    if (!existsSync(project.workspacesPath)) {
      mkdirSync(project.workspacesPath, { recursive: true });
    }

    const baseBranch = options.from || project.defaultBranch;

    await GitUtils.fetchAll(project.bareRepoPath);

    if (options.force && existsSync(workspacePath)) {
      try {
        await GitUtils.removeWorktree(project.bareRepoPath, workspacePath);
      } catch {
        // Ignore errors if worktree doesn't exist in git
      }
    }

    await GitUtils.createWorktree(
      project.bareRepoPath,
      workspacePath,
      inferredBranchName,
      baseBranch
    );

    const status = await GitUtils.getWorkspaceStatus(workspacePath);
    const commitsDiff = await GitUtils.getCommitsDiff(workspacePath, baseBranch);

    const workspace: Workspace = {
      id: workspaceId,
      projectName,
      name: workspaceName,
      branchName: inferredBranchName,
      path: workspacePath,
      baseBranch,
      createdAt: new Date(),
      lastUsed: new Date(),
      status,
      commitsAhead: commitsDiff.ahead,
      commitsBehind: commitsDiff.behind,
    };

    dbManager.addWorkspace(workspace);
    dbManager.setCurrentWorkspace(workspaceId);

    // Setup local files (symlinks and copies)
    await localFilesManager.setupLocalFiles(project, workspacePath, projectConfig, config, {
      name: workspaceName,
      branchName: inferredBranchName
    });

    console.log(chalk.green(`✓ Successfully created workspace '${workspaceName}'`));
    console.log(chalk.gray(`  Path: ${workspacePath}`));
    console.log(chalk.gray(`  Branch: ${inferredBranchName}`));
    console.log(chalk.gray(`  Base: ${baseBranch}`));

    // Execute post-creation hooks
    const scriptConfig = projectConfig.scripts || config.scripts;
    if (scriptConfig) {
      const context = SafeScriptExecutor.createContext(workspace, project);
      await SafeScriptExecutor.executePostCreationHooks(context, scriptConfig, options);
    }

    if (options.checkout !== false) {
      console.log(chalk.blue(`\nTo switch to this workspace:`));
      console.log(chalk.bold(`  cd "${workspacePath}"`));
    }

    console.log(chalk.blue('\nNext steps:'));
    console.log(`  wkt switch ${workspaceName}                     # Switch to this workspace`);
    console.log(`  wkt list                                       # List all workspaces`);

  } catch (error) {
    console.error(chalk.red(`Error creating workspace: ${error instanceof Error ? error.message : error}`));
    
    if (existsSync(workspacePath)) {
      try {
        await GitUtils.removeWorktree(project.bareRepoPath, workspacePath);
      } catch {
        // Ignore cleanup errors
      }
    }
    
    process.exit(1);
  }
}