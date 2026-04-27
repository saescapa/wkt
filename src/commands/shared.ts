import { existsSync, mkdirSync } from 'fs';
import chalk from 'chalk';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import { ErrorHandler, ProjectNotFoundError, WKTError } from '../utils/errors.js';

interface SharedCommandOptions {
  project?: string;
}

export async function sharedCommand(options: SharedCommandOptions = {}): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const dbManager = new DatabaseManager();

    let projectName = options.project;

    if (!projectName) {
      const current = dbManager.getCurrentWorkspaceContext();
      if (current) {
        projectName = current.projectName;
      } else {
        const projects = dbManager.getAllProjects();
        if (projects.length === 1 && projects[0]) {
          projectName = projects[0].name;
        } else {
          throw new WKTError(
            'Could not infer project. Pass --project <name> or run from inside a workspace.',
            'PROJECT_INFERENCE_FAILED',
            true,
          );
        }
      }
    }

    const project = dbManager.getProject(projectName);
    if (!project) {
      throw new ProjectNotFoundError(projectName);
    }

    const sharedPath = configManager.getProjectSharedPath(projectName);
    if (!existsSync(sharedPath)) {
      mkdirSync(sharedPath, { recursive: true });
      console.error(chalk.gray(`Created ${sharedPath}`));
    }

    console.log(sharedPath);
  } catch (error) {
    ErrorHandler.handle(error);
  }
}
