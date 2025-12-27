import { join, basename } from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { InitCommandOptions, Project } from '../core/types.js';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import {
  isGitRepository,
  getBareRepoUrl,
  cloneBareRepository,
  getDefaultBranch,
  fetchAll,
} from '../utils/git/index.js';

export async function initCommand(
  repositoryUrl?: string,
  projectName?: string,
  options: InitCommandOptions = {}
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
      if (project.template) {
        console.log(`    ${chalk.gray(`Template: ${project.template}`)}`);
      }
      console.log(`    ${chalk.gray(`Created: ${project.createdAt.toLocaleDateString()}`)}`);
    });
    return;
  }

  // Handle applying template to existing project
  if (options.applyTemplate) {
    await applyTemplateToExistingProject(repositoryUrl, options.template);
    return;
  }

  let repoUrl = repositoryUrl;
  let inferredProjectName = projectName;

  if (!repoUrl) {
    if (isGitRepository(process.cwd())) {
      try {
        repoUrl = await getBareRepoUrl(process.cwd());
        if (!inferredProjectName) {
          inferredProjectName = basename(process.cwd());
        }
        console.log(chalk.blue(`Found git repository: ${repoUrl}`));
      } catch {
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
    if (!lastPart) {
      console.error(chalk.red('Error: Could not infer project name from repository URL.'));
      process.exit(1);
    }
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
    await cloneBareRepository(repoUrl, bareRepoPath);

    await fetchAll(bareRepoPath);

    const defaultBranch = await getDefaultBranch(bareRepoPath);

    const workspacesPath = join(configManager.getWorkspaceRoot(), inferredProjectName);

    // Handle template selection
    let selectedTemplate: string | undefined = options.template;
    const globalConfig = configManager.getConfig();
    const availableTemplates = globalConfig.project_templates ? Object.keys(globalConfig.project_templates) : [];

    if (!selectedTemplate && availableTemplates.length > 0) {
      const answer = await inquirer.prompt<{ template: string; useTemplate: boolean }>([
        {
          type: 'confirm',
          name: 'useTemplate',
          message: 'Would you like to apply a project template?',
          default: false,
        },
        {
          type: 'list',
          name: 'template',
          message: 'Select a template:',
          choices: [...availableTemplates, new inquirer.Separator(), { name: 'None', value: undefined }],
          when: (answers): boolean => !!answers.useTemplate,
        },
      ]);
      selectedTemplate = answer.template;
    }

    const project: Project = {
      name: inferredProjectName,
      repositoryUrl: repoUrl,
      bareRepoPath,
      workspacesPath,
      defaultBranch,
      createdAt: new Date(),
      template: selectedTemplate,
    };

    // Apply template configuration if selected
    if (selectedTemplate && globalConfig.project_templates?.[selectedTemplate]) {
      project.config = globalConfig.project_templates[selectedTemplate];
    }

    dbManager.addProject(project);

    console.log(chalk.green(`✓ Successfully initialized project '${inferredProjectName}'`));
    console.log(chalk.gray(`  Repository: ${repoUrl}`));
    console.log(chalk.gray(`  Default branch: ${defaultBranch}`));
    if (selectedTemplate) {
      console.log(chalk.gray(`  Template: ${selectedTemplate}`));
    }
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

async function applyTemplateToExistingProject(projectName?: string, templateName?: string): Promise<void> {
  const configManager = new ConfigManager();
  const dbManager = new DatabaseManager();
  const globalConfig = configManager.getConfig();

  // Get project name
  let selectedProject = projectName;
  if (!selectedProject) {
    const projects = dbManager.getAllProjects();
    if (projects.length === 0) {
      console.log(chalk.yellow('No projects found. Initialize a project first with `wkt init`'));
      return;
    }

    const answer = await inquirer.prompt<{ project: string }>([
      {
        type: 'list',
        name: 'project',
        message: 'Select a project to apply template to:',
        choices: projects.map(p => ({ name: `${p.name}${p.template ? ` (current: ${p.template})` : ''}`, value: p.name })),
      },
    ]);
    selectedProject = answer.project;
  }

  const project = dbManager.getProject(selectedProject);
  if (!project) {
    console.error(chalk.red(`Error: Project '${selectedProject}' not found.`));
    process.exit(1);
  }

  // Get template name
  const availableTemplates = globalConfig.project_templates ? Object.keys(globalConfig.project_templates) : [];
  if (availableTemplates.length === 0) {
    console.log(chalk.yellow('No project templates defined in config.'));
    console.log(chalk.gray('Add templates to ~/.wkt/config.yaml under project_templates'));
    return;
  }

  let selectedTemplate = templateName;
  if (!selectedTemplate) {
    const answer = await inquirer.prompt<{ template: string }>([
      {
        type: 'list',
        name: 'template',
        message: 'Select a template to apply:',
        choices: availableTemplates,
      },
    ]);
    selectedTemplate = answer.template;
  }

  if (!globalConfig.project_templates?.[selectedTemplate]) {
    console.error(chalk.red(`Error: Template '${selectedTemplate}' not found.`));
    process.exit(1);
  }

  // Apply template
  project.template = selectedTemplate;
  project.config = globalConfig.project_templates[selectedTemplate];
  dbManager.updateProject(project);

  console.log(chalk.green(`✓ Applied template '${selectedTemplate}' to project '${selectedProject}'`));
  console.log(chalk.gray('\nTemplate configuration will be used for new workspaces.'));
  console.log(chalk.gray('Existing workspaces are not affected.'));
}