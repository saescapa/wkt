import chalk from 'chalk';
import type { CommandOptions } from '../core/types.js';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import { SafeScriptExecutor } from '../utils/script-executor.js';

export async function runCommand(
  scriptName: string,
  workspaceIdentifier?: string,
  options: CommandOptions = {}
): Promise<void> {
  const dbManager = new DatabaseManager();
  const configManager = new ConfigManager();

  // Determine workspace
  let workspace;
  if (workspaceIdentifier) {
    // Handle current workspace shortcut
    if (workspaceIdentifier === '.') {
      const currentWorkspace = dbManager.getCurrentWorkspace();
      if (!currentWorkspace) {
        console.error(chalk.red('No current workspace set. Use `wkt switch` to select one.'));
        process.exit(1);
      }
      workspaceIdentifier = currentWorkspace.id;
    }

    const { projectName, workspaceName } = parseWorkspaceIdentifier(workspaceIdentifier);
    workspace = findWorkspace(projectName, workspaceName, dbManager);
    
    if (!workspace) {
      console.error(chalk.red(`Workspace not found: ${workspaceIdentifier}`));
      process.exit(1);
    }
  } else {
    // Use current workspace
    const currentWorkspace = dbManager.getCurrentWorkspace();
    if (!currentWorkspace) {
      console.error(chalk.red('No current workspace set. Use `wkt switch` to select one or specify workspace.'));
      process.exit(1);
    }
    
    workspace = currentWorkspace;
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
    console.error(chalk.red('No script configuration found.'));
    console.log(chalk.gray('Add scripts section to .wkt.yaml in your project root or global config'));
    process.exit(1);
  }

  // List available scripts if no script name provided or if script not found
  if (scriptName === '--list' || scriptName === 'list') {
    listAvailableScripts(workspace, scriptConfig);
    return;
  }

  // Create execution context
  const context = SafeScriptExecutor.createContext(workspace, project);

  console.log(chalk.blue(`Running script "${scriptName}" in workspace: ${workspace.projectName}/${workspace.name}`));
  console.log(chalk.gray(`Path: ${workspace.path}`));

  // Execute the script
  const success = await SafeScriptExecutor.executeScript(scriptName, context, scriptConfig, options);
  
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
) {
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

function listAvailableScripts(workspace: import('../core/types.js').Workspace, scriptConfig: import('../core/types.js').ScriptConfig): void {
  console.log(chalk.blue(`Available scripts for ${workspace.projectName}/${workspace.name}:\n`));

  // Global scripts
  if (scriptConfig.scripts) {
    console.log(chalk.green('Global scripts:'));
    for (const [name, script] of Object.entries(scriptConfig.scripts)) {
      const s = script as any;
      console.log(`  ${chalk.bold(name)}`);
      if (s.description) {
        console.log(chalk.gray(`    ${s.description}`));
      } else {
        console.log(chalk.gray(`    ${s.command?.join(' ') || 'No command defined'}`));
      }
    }
    console.log();
  }

  // Workspace-specific scripts
  const workspaceScripts: Record<string, any> = {};
  if (scriptConfig.workspace_scripts) {
    for (const [pattern, config] of Object.entries(scriptConfig.workspace_scripts)) {
      const configObj = config as any;
      if (matchesPattern(workspace.name, pattern) || matchesPattern(workspace.branchName, pattern)) {
        if (configObj.scripts) {
          Object.assign(workspaceScripts, configObj.scripts);
        }
      }
    }
  }

  if (Object.keys(workspaceScripts).length > 0) {
    console.log(chalk.green('Workspace-specific scripts:'));
    for (const [name, script] of Object.entries(workspaceScripts)) {
      const s = script as import('../core/types.js').ScriptDefinition;
      console.log(`  ${chalk.bold(name)}`);
      if (s.description) {
        console.log(chalk.gray(`    ${s.description}`));
      } else {
        console.log(chalk.gray(`    ${s.command?.join(' ') || 'No command defined'}`));
      }
    }
    console.log();
  }

  // Shortcuts
  if (scriptConfig.shortcuts) {
    console.log(chalk.green('Shortcuts:'));
    for (const [shortcut, target] of Object.entries(scriptConfig.shortcuts)) {
      console.log(`  ${chalk.bold(shortcut)} → ${chalk.cyan(target)}`);
    }
    console.log();
  }

  console.log(chalk.gray('Usage:'));
  console.log(chalk.gray('  wkt run <script-name>                    # Run in current workspace'));
  console.log(chalk.gray('  wkt run <script-name> <workspace>       # Run in specific workspace'));
  console.log(chalk.gray('  wkt run <script-name> --dry              # Show what would be executed'));
  console.log(chalk.gray('  wkt run <script-name> --force            # Skip confirmation prompts'));
}

function matchesPattern(text: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(text);
}