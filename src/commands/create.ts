import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { CreateCommandOptions, Workspace, Project } from '../core/types.js';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import {
  fetchAll,
  createWorktree,
  removeWorktree,
  getWorkspaceStatus,
  getCommitsDiff,
} from '../utils/git/index.js';
import { BranchInference } from '../utils/branch-inference.js';
import { LocalFilesManager } from '../utils/local-files.js';
import { SafeScriptExecutor } from '../utils/script-executor.js';
import {
  ErrorHandler,
  ProjectNotFoundError,
  WorkspaceExistsError,
  DirectoryExistsError,
} from '../utils/errors.js';

export async function createCommand(
  projectName?: string,
  branchName?: string,
  options: CreateCommandOptions = {}
): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const dbManager = new DatabaseManager();
    const localFilesManager = new LocalFilesManager();

    // Interactive mode if project or branch not provided
    if (!projectName || !branchName) {
      const result = await selectProjectAndBranch(dbManager, projectName);
      if (!result) {
        console.log(chalk.yellow('Workspace creation cancelled'));
        return;
      }
      projectName = result.projectName;
      branchName = result.branchName;
    }

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

    await fetchAll(project.bareRepoPath);

    if (options.force && existsSync(workspacePath)) {
      try {
        await removeWorktree(project.bareRepoPath, workspacePath);
      } catch {
        // Ignore errors if worktree doesn't exist in git
      }
    }

    await createWorktree(
      project.bareRepoPath,
      workspacePath,
      inferredBranchName,
      baseBranch
    );

    const status = await getWorkspaceStatus(workspacePath);
    const commitsDiff = await getCommitsDiff(workspacePath, baseBranch);

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
      description: options.description,
      mode: 'branched',
    };

    dbManager.addWorkspace(workspace);

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
    if (projectName && branchName) {
      try {
        const cleanupDbManager = new DatabaseManager();
        const cleanupConfigManager = new ConfigManager();
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
            await removeWorktree(project.bareRepoPath, workspacePath);
          }
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    ErrorHandler.handle(error);
  }
}

interface InteractiveResult {
  projectName: string;
  branchName: string;
}

async function selectProjectAndBranch(
  dbManager: DatabaseManager,
  preselectedProject?: string
): Promise<InteractiveResult | null> {
  const projects = dbManager.getAllProjects();

  if (projects.length === 0) {
    console.log(chalk.yellow('No projects initialized.'));
    console.log(chalk.gray('Run `wkt init <repository-url>` to add a project first.'));
    return null;
  }

  console.log(chalk.blue('\nCreate new workspace\n'));

  let selectedProject: Project;

  // Project selection - skip if only one project or preselected
  if (preselectedProject) {
    const project = dbManager.getProject(preselectedProject);
    if (!project) {
      console.log(chalk.red(`Project '${preselectedProject}' not found.`));
      return null;
    }
    selectedProject = project;
  } else if (projects.length === 1 && projects[0]) {
    selectedProject = projects[0];
    console.log(chalk.gray(`Project: ${selectedProject.name}`));
  } else {
    const projectChoices = projects.map(p => ({
      name: `${p.name}  ${chalk.gray(p.repositoryUrl)}`,
      value: p,
      short: p.name
    }));

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

    if (!project) return null;
    selectedProject = project;
  }

  // Branch name input
  const { branchName } = await inquirer.prompt([{
    type: 'input',
    name: 'branchName',
    message: 'Branch name or ticket ID:',
    validate: (input: string) => {
      if (!input.trim()) return 'Branch name is required';
      return true;
    }
  }]);

  if (!branchName.trim()) return null;

  return {
    projectName: selectedProject.name,
    branchName: branchName.trim()
  };
}