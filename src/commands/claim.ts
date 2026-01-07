import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { ClaimCommandOptions, Workspace } from '../core/types.js';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import {
  fetchAll,
  createDetachedWorktree,
  resetDetachedWorktree,
  getWorkspaceStatus,
} from '../utils/git/index.js';
import { BranchInference } from '../utils/branch-inference.js';
import { LocalFilesManager } from '../utils/local-files.js';
import { SafeScriptExecutor } from '../utils/script-executor.js';
import {
  ErrorHandler,
  ProjectNotFoundError,
} from '../utils/errors.js';

export async function claimCommand(
  projectName?: string,
  options: ClaimCommandOptions = {}
): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const dbManager = new DatabaseManager();
    const localFilesManager = new LocalFilesManager();

    // Interactive mode if project not provided
    if (!projectName) {
      const result = await selectProject(dbManager);
      if (!result) {
        console.log(chalk.yellow('Claim cancelled'));
        return;
      }
      projectName = result;
    }

    const project = dbManager.getProject(projectName);
    if (!project) {
      throw new ProjectNotFoundError(projectName);
    }

    const config = configManager.getConfig();
    const projectConfig = configManager.getProjectConfig(projectName);
    const trackingBranch = options.from || project.defaultBranch;

    // Try to get a pooled workspace first
    const pooledWorkspaces = dbManager.getPooledWorkspaces(projectName);
    let workspace: Workspace;

    if (pooledWorkspaces.length > 0 && pooledWorkspaces[0]) {
      // Claim from pool - use oldest available
      workspace = pooledWorkspaces[0];

      console.log(chalk.blue(`Claiming workspace from pool...`));

      // Fetch latest and reset to tracking branch
      await fetchAll(project.bareRepoPath);
      const commitSHA = await resetDetachedWorktree(
        project.bareRepoPath,
        workspace.path,
        trackingBranch
      );

      // Update workspace record
      workspace.mode = 'claimed';
      workspace.trackingBranch = trackingBranch;
      workspace.baseCommit = commitSHA;
      workspace.claimedAt = new Date();
      workspace.lastUsed = new Date();
      workspace.status = await getWorkspaceStatus(workspace.path);

      dbManager.updateWorkspace(workspace);

      console.log(chalk.green(`✓ Claimed '${workspace.name}' (tracking ${trackingBranch})`));
      console.log(chalk.gray(`  Updated to latest ${trackingBranch} (${commitSHA.substring(0, 7)})`));

    } else {
      // Pool empty - check if there are claimed workspaces that could be released
      const claimedWorkspaces = dbManager.getClaimedWorkspaces(projectName);
      const poolNamePattern = /^(?:.+-)?wksp-\d+$/;
      const claimedPoolWorkspaces = claimedWorkspaces.filter(w => poolNamePattern.test(w.name));

      if (claimedPoolWorkspaces.length > 0) {
        console.log(chalk.blue(`No available workspaces (${claimedPoolWorkspaces.length} in use), creating new...`));
      } else {
        console.log(chalk.blue(`Pool empty, creating new workspace...`));
      }

      const workspaceName = dbManager.getNextPoolWorkspaceName(projectName, trackingBranch);
      const workspaceId = BranchInference.generateWorkspaceId(projectName, workspaceName);
      const workspacePath = join(project.workspacesPath, workspaceName);

      if (!existsSync(project.workspacesPath)) {
        mkdirSync(project.workspacesPath, { recursive: true });
      }

      await fetchAll(project.bareRepoPath);

      const commitSHA = await createDetachedWorktree(
        project.bareRepoPath,
        workspacePath,
        trackingBranch
      );

      const status = await getWorkspaceStatus(workspacePath);

      workspace = {
        id: workspaceId,
        projectName,
        name: workspaceName,
        branchName: 'HEAD', // Detached HEAD
        path: workspacePath,
        baseBranch: trackingBranch,
        createdAt: new Date(),
        lastUsed: new Date(),
        status,
        mode: 'claimed',
        trackingBranch,
        baseCommit: commitSHA,
        claimedAt: new Date(),
      };

      dbManager.addWorkspace(workspace);

      console.log(chalk.green(`✓ Created '${workspaceName}' (tracking ${trackingBranch})`));
    }

    // Setup local files (symlinks and copies)
    await localFilesManager.setupLocalFiles(project, workspace.path, projectConfig, config, {
      name: workspace.name,
      branchName: workspace.branchName
    });

    // Execute post-claim hooks
    const scriptConfig = projectConfig.scripts || config.scripts;
    if (scriptConfig) {
      const context = SafeScriptExecutor.createContext(workspace, project);
      await SafeScriptExecutor.executePostClaimHooks(context, scriptConfig, options);
    }

    console.log(chalk.green(`✓ Workspace ready at ${workspace.path}`));

    console.log(chalk.blue('\nNext steps:'));
    console.log(`  cd "${workspace.path}"                  # Enter workspace`);
    console.log(`  wkt save --branch <name>               # Save changes to a branch`);
    console.log(`  wkt release                            # Return to pool when done`);

  } catch (error) {
    ErrorHandler.handle(error);
  }
}

async function selectProject(dbManager: DatabaseManager): Promise<string | null> {
  const projects = dbManager.getAllProjects();

  if (projects.length === 0) {
    console.log(chalk.yellow('No projects initialized.'));
    console.log(chalk.gray('Run `wkt init <repository-url>` to add a project first.'));
    return null;
  }

  if (projects.length === 1 && projects[0]) {
    return projects[0].name;
  }

  console.log(chalk.blue('\nClaim workspace from pool\n'));

  const projectChoices = projects.map(p => {
    const pooled = dbManager.getPooledWorkspaces(p.name).length;
    const poolInfo = pooled > 0 ? chalk.green(` (${pooled} available)`) : chalk.gray(' (empty pool)');
    return {
      name: `${p.name}${poolInfo}`,
      value: p.name,
      short: p.name
    };
  });

  const { project } = await inquirer.prompt([{
    type: 'list',
    name: 'project',
    message: 'Select project:',
    choices: [
      ...projectChoices,
      new inquirer.Separator(),
      { name: chalk.gray('Cancel'), value: null }
    ],
    pageSize: 10
  }]);

  return project;
}
