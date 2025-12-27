import chalk from 'chalk';
import inquirer from 'inquirer';
import type { RunCommandOptions, Workspace, ScriptConfig, ScriptDefinition } from '../core/types.js';
import { ConfigManager } from '../core/config.js';
import { DatabaseManager } from '../core/database.js';
import { SafeScriptExecutor } from '../utils/script-executor.js';

export async function runCommand(
  scriptName?: string,
  workspaceIdentifier?: string,
  options: RunCommandOptions = {}
): Promise<void> {
  const dbManager = new DatabaseManager();
  const configManager = new ConfigManager();

  // Determine workspace
  let workspace;
  if (workspaceIdentifier) {
    // Handle current workspace shortcut
    if (workspaceIdentifier === '.') {
      const currentWorkspace = dbManager.getCurrentWorkspaceContext();
      if (!currentWorkspace) {
        console.error(chalk.red('No workspace detected. Ensure you are in a workspace directory or use `wkt switch` to select one.'));
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
    // Use current workspace (detect from path first, then fall back to stored)
    const currentWorkspace = dbManager.getCurrentWorkspaceContext();
    if (!currentWorkspace) {
      console.error(chalk.red('No workspace detected. Ensure you are in a workspace directory or use `wkt switch` to select one.'));
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

  // Get script configuration (merged from workspace, project, and global)
  const globalConfig = configManager.getConfig();
  const projectConfig = configManager.getProjectConfig(workspace.projectName);
  const workspaceConfig = configManager.getWorkspaceConfig(workspace.path);

  const scriptConfig = mergeScriptConfigs(
    globalConfig.scripts,
    projectConfig.scripts,
    workspaceConfig.scripts
  );

  if (!scriptConfig) {
    console.error(chalk.red('No script configuration found.'));
    console.log(chalk.gray('Add scripts section to .wkt.yaml in your project root or global config'));
    process.exit(1);
  }

  // Handle no script name provided - show interactive selection
  if (!scriptName) {
    const selectedScript = await selectScriptInteractively(workspace, scriptConfig);
    if (!selectedScript) {
      console.log(chalk.yellow('Script selection cancelled'));
      return;
    }
    scriptName = selectedScript;
  }

  // List available scripts if explicitly requested
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

function listAvailableScripts(workspace: Workspace, scriptConfig: ScriptConfig): void {
  console.log(chalk.blue(`Available scripts for ${workspace.projectName}/${workspace.name}:\n`));

  // All available scripts (merged from global, project, and workspace)
  if (scriptConfig.scripts) {
    console.log(chalk.green('Available scripts:'));
    for (const [name, script] of Object.entries(scriptConfig.scripts)) {
      console.log(`  ${chalk.bold(name)}`);
      if (script.description) {
        console.log(chalk.gray(`    ${script.description}`));
      } else {
        console.log(chalk.gray(`    ${script.command?.join(' ') || 'No command defined'}`));
      }
    }
    console.log();
  }

  // Workspace-specific scripts
  const workspaceScripts: Record<string, ScriptDefinition> = {};
  if (scriptConfig.workspace_scripts) {
    for (const [pattern, config] of Object.entries(scriptConfig.workspace_scripts)) {
      if (matchesPattern(workspace.name, pattern) || matchesPattern(workspace.branchName, pattern)) {
        if (config.scripts) {
          Object.assign(workspaceScripts, config.scripts);
        }
      }
    }
  }

  if (Object.keys(workspaceScripts).length > 0) {
    console.log(chalk.green('Workspace-specific scripts:'));
    for (const [name, script] of Object.entries(workspaceScripts)) {
      const s = script;
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

async function selectScriptInteractively(workspace: Workspace, scriptConfig: ScriptConfig): Promise<string | null> {
  const availableScripts: Array<{name: string, description: string, source: string}> = [];

  // Collect all scripts (already merged by source priority)
  if (scriptConfig.scripts) {
    for (const [name, script] of Object.entries(scriptConfig.scripts)) {
      availableScripts.push({
        name,
        description: script.description || script.command?.join(' ') || 'No description',
        source: 'available'
      });
    }
  }

  // Collect workspace-specific scripts
  if (scriptConfig.workspace_scripts) {
    for (const [pattern, config] of Object.entries(scriptConfig.workspace_scripts)) {
      if (matchesPattern(workspace.name, pattern) || matchesPattern(workspace.branchName, pattern)) {
        if (config.scripts) {
          for (const [name, script] of Object.entries(config.scripts)) {
            // Don't duplicate if already exists in global
            if (!availableScripts.find(s => s.name === name)) {
              availableScripts.push({
                name,
                description: script.description || script.command?.join(' ') || 'No description',
                source: 'workspace-specific'
              });
            }
          }
        }
      }
    }
  }

  // Handle shortcuts
  const shortcuts: Array<{name: string, description: string, source: string}> = [];
  if (scriptConfig.shortcuts) {
    for (const [shortcut, target] of Object.entries(scriptConfig.shortcuts)) {
      shortcuts.push({
        name: shortcut,
        description: `Shortcut for "${target}"`,
        source: 'shortcut'
      });
    }
  }

  if (availableScripts.length === 0 && shortcuts.length === 0) {
    console.log(chalk.yellow('No scripts available in this workspace'));
    console.log(chalk.gray('Add scripts to .wkt.yaml in your project root or global config'));
    return null;
  }

  // Combine scripts and shortcuts for selection
  const allOptions = [
    ...availableScripts.map(script => ({
      name: `${chalk.bold(script.name)} ${chalk.gray(`(${script.source})`)}`,
      value: script.name,
      short: script.name
    })),
    ...shortcuts.map(shortcut => ({
      name: `${chalk.bold(shortcut.name)} ${chalk.cyan('→')} ${chalk.gray(shortcut.description)}`,
      value: shortcut.name,
      short: shortcut.name
    }))
  ];

  console.log(chalk.blue(`Available scripts for ${workspace.projectName}/${workspace.name}:`));

  const { selectedScript } = await inquirer.prompt([{
    type: 'list',
    name: 'selectedScript',
    message: 'Select a script to run:',
    choices: [
      ...allOptions,
      new inquirer.Separator(),
      {
        name: chalk.gray('Cancel'),
        value: null
      }
    ],
    pageSize: 15
  }]);

  return selectedScript;
}

function mergeScriptConfigs(
  globalScripts?: Partial<ScriptConfig>,
  projectScripts?: Partial<ScriptConfig>,
  workspaceScripts?: Partial<ScriptConfig>
): ScriptConfig {
  const defaultConfig: ScriptConfig = {
    scripts: {},
    allowed_commands: [],
    hooks: {},
    shortcuts: {},
    workspace_scripts: {},
  };

  // Start with global config
  const merged = { ...defaultConfig };
  if (globalScripts) {
    merged.scripts = { ...merged.scripts, ...globalScripts.scripts };
    merged.allowed_commands = [...(merged.allowed_commands || []), ...(globalScripts.allowed_commands || [])];
    merged.hooks = { ...merged.hooks, ...globalScripts.hooks };
    merged.shortcuts = { ...merged.shortcuts, ...globalScripts.shortcuts };
    merged.workspace_scripts = { ...merged.workspace_scripts, ...globalScripts.workspace_scripts };
  }

  // Merge project config
  if (projectScripts) {
    merged.scripts = { ...merged.scripts, ...projectScripts.scripts };
    merged.allowed_commands = [...(merged.allowed_commands || []), ...(projectScripts.allowed_commands || [])];
    merged.hooks = { ...merged.hooks, ...projectScripts.hooks };
    merged.shortcuts = { ...merged.shortcuts, ...projectScripts.shortcuts };
    merged.workspace_scripts = { ...merged.workspace_scripts, ...projectScripts.workspace_scripts };
  }

  // Merge workspace config (highest priority)
  if (workspaceScripts) {
    merged.scripts = { ...merged.scripts, ...workspaceScripts.scripts };
    merged.allowed_commands = [...(merged.allowed_commands || []), ...(workspaceScripts.allowed_commands || [])];
    merged.hooks = { ...merged.hooks, ...workspaceScripts.hooks };
    merged.shortcuts = { ...merged.shortcuts, ...workspaceScripts.shortcuts };
    merged.workspace_scripts = { ...merged.workspace_scripts, ...workspaceScripts.workspace_scripts };
  }

  // Remove duplicates from allowed_commands
  merged.allowed_commands = [...new Set(merged.allowed_commands)];

  return merged;
}