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
import { 
  ErrorHandler, 
  ProjectNotFoundError, 
  WorkspaceExistsError, 
  DirectoryExistsError
} from '../utils/errors.js';

export async function createCommand(
  projectName: string,
  branchName: string,
  options: CommandOptions = {}
): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const dbManager = new DatabaseManager();
    const localFilesManager = new LocalFilesManager();

    const project = dbManager.getProject(projectName);
    if (!project) {
      throw new ProjectNotFoundError(projectName);
    }

    const config = configManager.getConfig();
    const projectConfig = configManager.getProjectConfig(projectName);

    const inferencePatterns = projectConfig.inference?.patterns || config.inference.patterns;
    const inferredBranchName = BranchInference.inferBranchName(branchName, inferencePatterns);

    const namingStrategy = projectConfig.workspace?.naming_strategy || config.workspace.naming_strategy;
    const workspaceName = options.name || BranchInference.sanitizeWorkspaceName(inferredBranchName, namingStrategy);

    const workspaceId = BranchInference.generateWorkspaceId(projectName, workspaceName);

    if (dbManager.getWorkspace(workspaceId) && !options.force) {
      throw new WorkspaceExistsError(workspaceName, projectName);
    }

    const workspacePath = join(project.workspacesPath, workspaceName);

    if (existsSync(workspacePath) && !options.force) {
      throw new DirectoryExistsError(workspacePath);
    }

    console.log(chalk.blue(`Creating workspace '${workspaceName}' for project '${projectName}'...`));
    console.log(chalk.gray(`Branch: ${inferredBranchName}`));
    console.log(chalk.gray(`Base: ${options.from || project.defaultBranch}`));

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
    // Cleanup on error - need to re-initialize managers for cleanup
    try {
      const cleanupDbManager = new DatabaseManager();
      const cleanupConfigManager = new ConfigManager();
      // Variables might not be defined if error occurred early
      const project = cleanupDbManager.getProject(projectName);
      if (project) {
        const config = cleanupConfigManager.getConfig();
        const projectConfig = cleanupConfigManager.getProjectConfig(projectName);
        const inferencePatterns = projectConfig.inference?.patterns || config.inference.patterns;
        const inferredBranchName = BranchInference.inferBranchName(branchName, inferencePatterns);
        const namingStrategy = projectConfig.workspace?.naming_strategy || config.workspace.naming_strategy;
        const workspaceName = options.name || BranchInference.sanitizeWorkspaceName(inferredBranchName, namingStrategy);
        const workspacePath = join(project.workspacesPath, workspaceName);
        
        if (existsSync(workspacePath)) {
          await GitUtils.removeWorktree(project.bareRepoPath, workspacePath);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
    
    ErrorHandler.handle(error, 'workspace creation');
  }
}