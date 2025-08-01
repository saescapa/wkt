import { join, basename } from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';
import type { CommandOptions, Project } from '../core/types.js';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import { GitUtils } from '../utils/git.js';

export async function initCommand(
  repositoryUrl?: string,
  projectName?: string,
  options: CommandOptions = {}
): Promise<void> {
  const configManager = new ConfigManager();
  const dbManager = new DatabaseManager();

  if (options.list) {
    const projects = dbManager.getAllProjects();
    if (projects.length === 0) {
      console.log(chalk.yellow('No projects initialized yet.'));
      console.log('Use `wkt init <repository-url> [project-name]` to get started.');
      return;
    }

    console.log(chalk.bold('\nManaged Projects:'));
    projects.forEach(project => {
      console.log(`  ${chalk.green('●')} ${chalk.bold(project.name)}`);
      console.log(`    ${chalk.gray(project.repositoryUrl)}`);
      console.log(`    ${chalk.gray(`Created: ${project.createdAt.toLocaleDateString()}`)}`);
    });
    return;
  }

  let repoUrl = repositoryUrl;
  let inferredProjectName = projectName;

  if (!repoUrl) {
    if (GitUtils.isGitRepository(process.cwd())) {
      try {
        repoUrl = await GitUtils.getBareRepoUrl(process.cwd());
        if (!inferredProjectName) {
          inferredProjectName = basename(process.cwd());
        }
        console.log(chalk.blue(`Found git repository: ${repoUrl}`));
      } catch (error) {
        console.error(chalk.red('Error: Current directory is not a valid git repository or has no remote origin.'));
        console.log('Usage: wkt init <repository-url> [project-name]');
        process.exit(1);
      }
    } else {
      console.error(chalk.red('Error: No repository URL provided and current directory is not a git repository.'));
      console.log('Usage: wkt init <repository-url> [project-name]');
      process.exit(1);
    }
  }

  if (!inferredProjectName) {
    const urlParts = repoUrl.split('/');
    const lastPart = urlParts[urlParts.length - 1];
    inferredProjectName = lastPart.replace(/\.git$/, '');
  }

  if (dbManager.getProject(inferredProjectName)) {
    console.error(chalk.red(`Error: Project '${inferredProjectName}' already exists.`));
    console.log('Use `wkt init --list` to see all projects.');
    process.exit(1);
  }

  console.log(chalk.blue(`Initializing project '${inferredProjectName}'...`));

  try {
    configManager.ensureConfigDir();

    const projectsRoot = configManager.getProjectsRoot();
    const bareRepoPath = join(projectsRoot, inferredProjectName);

    if (existsSync(bareRepoPath)) {
      console.error(chalk.red(`Error: Directory '${bareRepoPath}' already exists.`));
      process.exit(1);
    }

    console.log(chalk.gray(`Cloning bare repository to ${bareRepoPath}...`));
    await GitUtils.cloneBareRepository(repoUrl, bareRepoPath);

    await GitUtils.fetchAll(bareRepoPath);

    const defaultBranch = await GitUtils.getDefaultBranch(bareRepoPath);

    const workspacesPath = join(configManager.getWorkspaceRoot(), inferredProjectName);

    const project: Project = {
      name: inferredProjectName,
      repositoryUrl: repoUrl,
      bareRepoPath,
      workspacesPath,
      defaultBranch,
      createdAt: new Date(),
    };

    dbManager.addProject(project);

    console.log(chalk.green(`✓ Successfully initialized project '${inferredProjectName}'`));
    console.log(chalk.gray(`  Repository: ${repoUrl}`));
    console.log(chalk.gray(`  Default branch: ${defaultBranch}`));
    console.log(chalk.gray(`  Bare repo: ${bareRepoPath}`));
    console.log(chalk.gray(`  Workspaces: ${workspacesPath}`));
    
    console.log(chalk.blue('\nNext steps:'));
    console.log(`  wkt create ${inferredProjectName} <branch-name>    # Create a new workspace`);
    console.log(`  wkt list                                         # List all workspaces`);

  } catch (error) {
    console.error(chalk.red(`Error initializing project: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}