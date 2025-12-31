import { join, basename } from 'path';
import { existsSync, mkdirSync } from 'fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { InitCommandOptions, Project, Workspace } from '../core/types.js';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import {
  isGitRepository,
  getBareRepoUrl,
  cloneBareRepository,
  getDefaultBranch,
  fetchAll,
  createWorktree,
  getWorkspaceStatus,
} from '../utils/git/index.js';
import { BranchInference } from '../utils/branch-inference.js';
import { LocalFilesManager } from '../utils/local-files.js';
import { SafeScriptExecutor } from '../utils/script-executor.js';
import {
  ErrorHandler,
  WKTError,
  ValidationError,
  DirectoryExistsError,
  GitRepositoryError,
} from '../utils/errors.js';

export async function initCommand(
  repositoryUrl?: string,
  projectName?: string,
  options: InitCommandOptions = {}
): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const dbManager = new DatabaseManager();

    if (options.list) {
      const projects = dbManager.getAllProjects();
      if (projects.length === 0) {
        console.log(chalk.yellow('No projects initialized yet.'));
        console.log(chalk.dim('Use `wkt init <repository-url> [project-name]` to get started.'));
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
          throw new GitRepositoryError('Current directory is not a valid git repository or has no remote origin');
        }
      } else {
        // Interactive mode - prompt for repository URL
        console.log(chalk.blue('\nInitialize new project\n'));

        const { inputUrl } = await inquirer.prompt([{
          type: 'input',
          name: 'inputUrl',
          message: 'Repository URL (git clone URL):',
          validate: (input: string) => {
            if (!input.trim()) return 'Repository URL is required';
            if (!input.includes('git') && !input.includes('://') && !input.includes('@')) {
              return 'Please enter a valid git repository URL';
            }
            return true;
          }
        }]);

        if (!inputUrl.trim()) {
          console.log(chalk.yellow('Initialization cancelled'));
          return;
        }
        repoUrl = inputUrl.trim();
      }
    }

    // At this point repoUrl must be set
    if (!repoUrl) {
      throw new ValidationError('repository URL', 'Repository URL is required');
    }

    if (!inferredProjectName) {
      const urlParts = repoUrl.split('/');
      const lastPart = urlParts[urlParts.length - 1];
      if (!lastPart) {
        throw new ValidationError('project name', 'Could not infer project name from repository URL');
      }
      inferredProjectName = lastPart.replace(/\.git$/, '');
    }

    if (dbManager.getProject(inferredProjectName)) {
      throw new WKTError(
        `Project '${inferredProjectName}' already exists`,
        'PROJECT_EXISTS',
        true,
        [{ text: 'See existing projects', command: 'wkt init --list' }]
      );
    }

    console.log(chalk.blue(`Initializing project '${inferredProjectName}'...`));

    configManager.ensureConfigDir();

    const projectsRoot = configManager.getProjectsRoot();
    const bareRepoPath = join(projectsRoot, inferredProjectName);

    if (existsSync(bareRepoPath)) {
      throw new DirectoryExistsError(bareRepoPath);
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

    // Create the main workspace automatically
    console.log(chalk.gray(`Creating main workspace...`));

    const localFilesManager = new LocalFilesManager();
    const projectConfig = configManager.getProjectConfig(inferredProjectName);

    if (!existsSync(workspacesPath)) {
      mkdirSync(workspacesPath, { recursive: true });
    }

    const mainWorkspacePath = join(workspacesPath, 'main');
    await createWorktree(bareRepoPath, mainWorkspacePath, defaultBranch, defaultBranch);

    const status = await getWorkspaceStatus(mainWorkspacePath);
    const workspaceID = BranchInference.generateWorkspaceId(inferredProjectName, 'main');

    const workspace: Workspace = {
      id: workspaceID,
      projectName: inferredProjectName,
      name: 'main',
      branchName: defaultBranch,
      path: mainWorkspacePath,
      baseBranch: defaultBranch,
      createdAt: new Date(),
      lastUsed: new Date(),
      status,
      commitsAhead: 0,
      commitsBehind: 0,
    };

    dbManager.addWorkspace(workspace);
    dbManager.setCurrentWorkspace(workspaceID);

    // Setup local files (symlinks and copies)
    await localFilesManager.setupLocalFiles(project, mainWorkspacePath, projectConfig, globalConfig, {
      name: 'main',
      branchName: defaultBranch
    });

    // Execute post-creation hooks
    const scriptConfig = projectConfig.scripts || globalConfig.scripts;
    if (scriptConfig) {
      const context = SafeScriptExecutor.createContext(workspace, project);
      await SafeScriptExecutor.executePostCreationHooks(context, scriptConfig, {});
    }

    console.log(chalk.green(`✓ Successfully initialized project '${inferredProjectName}'`));
    console.log(chalk.gray(`  Repository: ${repoUrl}`));
    console.log(chalk.gray(`  Default branch: ${defaultBranch}`));
    if (selectedTemplate) {
      console.log(chalk.gray(`  Template: ${selectedTemplate}`));
    }
    console.log(chalk.gray(`  Workspace: ${mainWorkspacePath}`));

    console.log(chalk.blue('\nTo start working:'));
    console.log(chalk.bold(`  cd "${mainWorkspacePath}"`));
    console.log(chalk.gray(`\nOr use: wkt switch ${inferredProjectName}/main`));

  } catch (error) {
    ErrorHandler.handle(error);
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
      console.log(chalk.yellow('No projects found.'));
      console.log(chalk.dim('Initialize a project first: wkt init <repository-url>'));
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
    throw new WKTError(
      `Project '${selectedProject}' not found`,
      'PROJECT_NOT_FOUND',
      true,
      [{ text: 'See existing projects', command: 'wkt init --list' }]
    );
  }

  // Get template name
  const availableTemplates = globalConfig.project_templates ? Object.keys(globalConfig.project_templates) : [];
  if (availableTemplates.length === 0) {
    console.log(chalk.yellow('No project templates defined in config.'));
    console.log(chalk.dim('Add templates to ~/.wkt/config.yaml under project_templates'));
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
    throw new WKTError(
      `Template '${selectedTemplate}' not found`,
      'TEMPLATE_NOT_FOUND',
      true,
      [{ text: 'Check your config.yaml for available templates' }]
    );
  }

  // Apply template
  project.template = selectedTemplate;
  project.config = globalConfig.project_templates[selectedTemplate];
  dbManager.updateProject(project);

  console.log(chalk.green(`✓ Applied template '${selectedTemplate}' to project '${selectedProject}'`));
  console.log(chalk.gray('\nTemplate configuration will be used for new workspaces.'));
  console.log(chalk.gray('Existing workspaces are not affected.'));
}