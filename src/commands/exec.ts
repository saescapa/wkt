import chalk from 'chalk';
import inquirer from 'inquirer';
import type { CommandOptions, Workspace } from '../core/types.js';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import { SafeScriptExecutor } from '../utils/script-executor.js';

export async function execCommand(
  workspaceIdentifier: string,
  command: string[],
  options: CommandOptions = {}
): Promise<void> {
  const dbManager = new DatabaseManager();
  const configManager = new ConfigManager();

  // Handle current workspace shortcut
  if (workspaceIdentifier === '.') {
    const currentWorkspace = dbManager.getCurrentWorkspace();
    if (!currentWorkspace) {
      console.error(chalk.red('No current workspace set. Use `wkt switch` to select one.'));
      process.exit(1);
    }
    workspaceIdentifier = currentWorkspace.id;
  }

  // Parse workspace identifier (project/workspace or just workspace)
  const { projectName, workspaceName } = parseWorkspaceIdentifier(workspaceIdentifier);
  
  // Find workspace
  const workspace = findWorkspace(projectName, workspaceName, dbManager);
  if (!workspace) {
    console.error(chalk.red(`Workspace not found: ${workspaceIdentifier}`));
    if (!projectName) {
      console.log(chalk.gray('Try using format: project/workspace'));
    }
    process.exit(1);
  }

  // Get project
  const project = dbManager.getProject(workspace.projectName);
  if (!project) {
    console.error(chalk.red(`Project not found: ${workspace.projectName}`));
    process.exit(1);
  }

  // Get script configuration
  const globalConfig = configManager.getConfig();
  const projectConfig = configManager.getProjectConfig(workspace.projectName);
  const scriptConfig = projectConfig.scripts || globalConfig.scripts || {
    scripts: {},
    allowed_commands: [],
    hooks: {},
    shortcuts: {},
    workspace_scripts: {},
  };

  if (!scriptConfig) {
    console.error(chalk.red('No script configuration found. Add scripts section to .wkt.yaml'));
    process.exit(1);
  }

  // Check if command is allowed
  const commandName = command[0];
  if (!commandName || !isCommandAllowed(commandName, scriptConfig.allowed_commands)) {
    console.error(chalk.red(`Command "${commandName}" not allowed`));
    console.log(chalk.gray('Add to allowed_commands in .wkt.yaml:'));
    console.log(chalk.gray(`  scripts:`));
    console.log(chalk.gray(`    allowed_commands:`));
    console.log(chalk.gray(`      - "${commandName}"`));
    process.exit(1);
  }

  // Create execution context
  const context = SafeScriptExecutor.createContext(workspace, project);

  // Create ad-hoc script definition
  const adHocScript = {
    name: `exec: ${command.join(' ')}`,
    command: command,
    description: `Direct execution: ${command.join(' ')}`,
    timeout: options.timeout || 120000
  };

  console.log(chalk.blue(`Executing in workspace: ${workspace.projectName}/${workspace.name}`));
  console.log(chalk.gray(`Path: ${workspace.path}`));

  if (options.dry) {
    console.log(chalk.blue('🔍 Dry run - would execute:'));
    console.log(chalk.gray(`  Command: ${command.join(' ')}`));
    console.log(chalk.gray(`  Working directory: ${workspace.path}`));
    return;
  }

  // Confirm execution unless --force
  if (!options.force) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Execute "${command.join(' ')}" in ${workspace.projectName}/${workspace.name}?`,
      default: true
    }]);
    
    if (!confirm) {
      console.log(chalk.yellow('Execution cancelled'));
      return;
    }
  }

  // Execute the command
  const success = await SafeScriptExecutor.runScript(adHocScript, context, options);
  
  if (!success) {
    process.exit(1);
  }
}

function parseWorkspaceIdentifier(identifier: string): {
  projectName?: string;
  workspaceName: string;
} {
  if (identifier.includes('/')) {
    const parts = identifier.split('/', 2);
    const projectName = parts[0];
    const workspaceName = parts[1];
    if (!projectName || !workspaceName) {
      throw new Error('Invalid workspace identifier format');
    }
    return { projectName, workspaceName };
  }
  return { workspaceName: identifier };
}

function findWorkspace(
  projectName: string | undefined,
  workspaceName: string,
  dbManager: DatabaseManager
): Workspace | null {
  const allWorkspaces = dbManager.getAllWorkspaces();

  // If project specified, look for exact match
  if (projectName) {
    return allWorkspaces.find(w => 
      w.projectName === projectName && w.name === workspaceName
    ) || null;
  }

  // Search across all projects
  return allWorkspaces.find(w => w.name === workspaceName) || null;
}

function isCommandAllowed(command: string, allowedCommands?: string[]): boolean {
  const DEFAULT_ALLOWED_COMMANDS = [
    'pnpm', 'npm', 'yarn', 'bun',
    'node', 'tsx', 'ts-node',
    'git', 'docker', 'docker-compose',
    'planetscale', 'pscale',
    'make', 'cmake',
    './scripts/', '../scripts/', 'scripts/'
  ];
  
  const allowed = allowedCommands || DEFAULT_ALLOWED_COMMANDS;
  
  return allowed.some(allowedCmd => {
    // Exact match
    if (command === allowedCmd) return true;
    
    // Path prefix match (for ./scripts/, etc.)
    if (allowedCmd.endsWith('/') && command.startsWith(allowedCmd)) return true;
    
    return false;
  });
}