import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { 
  Project, 
  Workspace, 
  ScriptConfig, 
  ScriptDefinition, 
  ScriptHook,
  CommandOptions 
} from '../core/types.js';

interface ExecutionContext {
  workspace: Workspace;
  project: Project;
  variables: Record<string, string>;
}

export class SafeScriptExecutor {
  private static DEFAULT_ALLOWED_COMMANDS = [
    'pnpm', 'npm', 'yarn', 'bun',
    'node', 'tsx', 'ts-node',
    'git', 'docker', 'docker-compose',
    'planetscale', 'pscale',  // PlanetScale CLI
    'make', 'cmake',
    './scripts/', '../scripts/', 'scripts/'  // Local script directories
  ];

  private static DEFAULT_TIMEOUT = 120000; // 2 minutes

  /**
   * Execute a predefined script safely
   */
  static async executeScript(
    scriptName: string,
    context: ExecutionContext,
    scriptConfig: ScriptConfig,
    options: CommandOptions = {}
  ): Promise<boolean> {
    const script = this.findScript(scriptName, context.workspace, scriptConfig);
    if (!script) {
      console.error(chalk.red(`Script "${scriptName}" not found`));
      return false;
    }

    // Check if command is allowed
    const commandName = script.command[0];
    if (!commandName || !this.isCommandAllowed(commandName, scriptConfig.allowed_commands)) {
      console.error(chalk.red(`Command "${script.command[0]}" not allowed`));
      console.log(chalk.gray('Add to allowed_commands in .wkt.yaml to enable'));
      return false;
    }

    // Check conditions
    if (!this.checkConditions(script.conditions, context)) {
      console.log(chalk.gray(`Skipping "${scriptName}": conditions not met`));
      return true;
    }

    // Confirm execution unless --force
    if (!options.force && !options.confirm) {
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Execute script "${scriptName}"? (${script.description || script.command.join(' ')})`,
        default: true
      }]);
      
      if (!confirm) {
        console.log(chalk.yellow('Script execution cancelled'));
        return false;
      }
    }

    // Dry run mode
    if (options.dry) {
      this.printDryRun(script, context);
      return true;
    }

    return this.runScript(script, context, options);
  }

  /**
   * Execute post-creation hooks
   */
  static async executePostCreationHooks(
    context: ExecutionContext,
    scriptConfig: ScriptConfig,
    options: CommandOptions = {}
  ): Promise<void> {
    const hooks = this.getApplicableHooks('post_create', context, scriptConfig);

    if (hooks.length === 0) {
      return;
    }

    console.log(chalk.blue('\n🔧 Running post-creation scripts...'));

    for (const hook of hooks) {
      const success = await this.executeHook(hook, context, scriptConfig, options);
      if (!success) {
        const script = this.findScript(hook.script, context.workspace, scriptConfig);
        if (!script?.optional) {
          console.error(chalk.red(`Required script "${hook.script}" failed. Workspace created but setup incomplete.`));
          break;
        }
      }
    }
  }

  /**
   * Execute pre-switch hooks (runs on the workspace being switched FROM)
   */
  static async executePreSwitchHooks(
    context: ExecutionContext,
    scriptConfig: ScriptConfig,
    options: CommandOptions = {}
  ): Promise<void> {
    const hooks = this.getApplicableHooks('pre_switch', context, scriptConfig);

    if (hooks.length === 0) {
      return;
    }

    console.log(chalk.blue('\n🔄 Running pre-switch scripts...'));

    for (const hook of hooks) {
      const success = await this.executeHook(hook, context, scriptConfig, options);
      if (!success) {
        const script = this.findScript(hook.script, context.workspace, scriptConfig);
        if (!script?.optional) {
          console.error(chalk.red(`Required script "${hook.script}" failed.`));
          break;
        }
      }
    }
  }

  /**
   * Execute post-switch hooks (runs on the workspace being switched TO)
   */
  static async executePostSwitchHooks(
    context: ExecutionContext,
    scriptConfig: ScriptConfig,
    options: CommandOptions = {}
  ): Promise<void> {
    const hooks = this.getApplicableHooks('post_switch', context, scriptConfig);

    if (hooks.length === 0) {
      return;
    }

    console.log(chalk.blue('\n🔄 Running post-switch scripts...'));

    for (const hook of hooks) {
      const success = await this.executeHook(hook, context, scriptConfig, options);
      if (!success) {
        const script = this.findScript(hook.script, context.workspace, scriptConfig);
        if (!script?.optional) {
          console.error(chalk.red(`Required script "${hook.script}" failed. Workspace switched but setup incomplete.`));
          break;
        }
      }
    }
  }

  /**
   * Execute pre-clean hooks (runs before workspace is removed)
   */
  static async executePreCleanHooks(
    context: ExecutionContext,
    scriptConfig: ScriptConfig,
    options: CommandOptions = {}
  ): Promise<void> {
    const hooks = this.getApplicableHooks('pre_clean', context, scriptConfig);

    if (hooks.length === 0) {
      return;
    }

    console.log(chalk.blue('\n🧹 Running pre-clean scripts...'));

    for (const hook of hooks) {
      const success = await this.executeHook(hook, context, scriptConfig, options);
      if (!success) {
        const script = this.findScript(hook.script, context.workspace, scriptConfig);
        if (!script?.optional) {
          console.error(chalk.red(`Required script "${hook.script}" failed.`));
          break;
        }
      }
    }
  }

  /**
   * Execute post-clean hooks (runs after workspace is removed)
   */
  static async executePostCleanHooks(
    context: ExecutionContext,
    scriptConfig: ScriptConfig,
    options: CommandOptions = {}
  ): Promise<void> {
    const hooks = this.getApplicableHooks('post_clean', context, scriptConfig);

    if (hooks.length === 0) {
      return;
    }

    console.log(chalk.blue('\n🧹 Running post-clean scripts...'));

    for (const hook of hooks) {
      const success = await this.executeHook(hook, context, scriptConfig, options);
      if (!success) {
        const script = this.findScript(hook.script, context.workspace, scriptConfig);
        if (!script?.optional) {
          console.error(chalk.red(`Required script "${hook.script}" failed.`));
          break;
        }
      }
    }
  }

  /**
   * Execute a script hook
   */
  private static async executeHook(
    hook: ScriptHook,
    context: ExecutionContext,
    scriptConfig: ScriptConfig,
    options: CommandOptions = {}
  ): Promise<boolean> {
    const script = this.findScript(hook.script, context.workspace, scriptConfig);
    if (!script) {
      console.error(chalk.red(`Hook script "${hook.script}" not found`));
      return false;
    }

    // Merge hook variables with context
    const hookContext = {
      ...context,
      variables: { ...context.variables, ...hook.variables }
    };

    // Check hook-specific conditions
    if (!this.checkConditions(hook.conditions, hookContext)) {
      console.log(chalk.gray(`Skipping hook "${hook.script}": conditions not met`));
      return true;
    }

    // Add hook arguments to command
    const commandWithArgs = [...script.command];
    if (hook.args) {
      commandWithArgs.push(...this.substituteVariables(hook.args, hookContext.variables));
    }

    const scriptWithArgs = {
      ...script,
      command: commandWithArgs
    };

    return this.runScript(scriptWithArgs, hookContext, options);
  }

  /**
   * Find a script definition by name
   */
  private static findScript(
    scriptName: string,
    workspace: Workspace,
    scriptConfig: ScriptConfig
  ): ScriptDefinition | null {
    // Check workspace-specific scripts first
    const workspaceScripts = this.getWorkspaceSpecificScripts(workspace, scriptConfig);
    if (workspaceScripts[scriptName]) {
      return workspaceScripts[scriptName];
    }

    // Check global scripts
    if (scriptConfig.scripts?.[scriptName]) {
      return scriptConfig.scripts[scriptName];
    }

    // Check shortcuts
    if (scriptConfig.shortcuts?.[scriptName]) {
      const targetScript = scriptConfig.shortcuts[scriptName];
      return this.findScript(targetScript, workspace, scriptConfig);
    }

    return null;
  }

  /**
   * Get applicable hooks for a workspace
   */
  private static getApplicableHooks(
    hookType: 'post_create' | 'pre_switch' | 'post_switch' | 'pre_clean' | 'post_clean',
    context: ExecutionContext,
    scriptConfig: ScriptConfig
  ): ScriptHook[] {
    const hooks: ScriptHook[] = [];

    // Global hooks
    if (scriptConfig.hooks?.[hookType]) {
      hooks.push(...scriptConfig.hooks[hookType]);
    }

    // Workspace-specific hooks
    const workspaceScriptConfig = scriptConfig.workspace_scripts || {};
    for (const [pattern, config] of Object.entries(workspaceScriptConfig)) {
      if (this.matchesPattern(context.workspace.name, pattern) ||
          this.matchesPattern(context.workspace.branchName, pattern)) {
        const workspaceHooks = config[hookType];
        if (workspaceHooks) {
          hooks.push(...workspaceHooks);
        }
      }
    }

    return hooks;
  }

  /**
   * Get workspace-specific scripts
   */
  private static getWorkspaceSpecificScripts(
    workspace: Workspace,
    scriptConfig: ScriptConfig
  ): Record<string, ScriptDefinition> {
    const scripts: Record<string, ScriptDefinition> = {};

    const workspaceScriptConfig = scriptConfig.workspace_scripts || {};
    for (const [pattern, config] of Object.entries(workspaceScriptConfig)) {
      if (this.matchesPattern(workspace.name, pattern) || 
          this.matchesPattern(workspace.branchName, pattern)) {
        if (config.scripts) {
          Object.assign(scripts, config.scripts);
        }
      }
    }

    return scripts;
  }

  /**
   * Check if a command is allowed
   */
  private static isCommandAllowed(command: string, allowedCommands?: string[]): boolean {
    const allowed = allowedCommands || this.DEFAULT_ALLOWED_COMMANDS;
    
    return allowed.some(allowedCmd => {
      // Exact match
      if (command === allowedCmd) return true;
      
      // Path prefix match (for ./scripts/, etc.)
      if (allowedCmd.endsWith('/') && command.startsWith(allowedCmd)) return true;
      
      return false;
    });
  }

  /**
   * Check script conditions
   */
  private static checkConditions(
    conditions: ScriptDefinition['conditions'] | ScriptHook['conditions'] | undefined,
    context: ExecutionContext
  ): boolean {
    if (!conditions) return true;

    // File existence checks
    if (conditions.file_exists) {
      for (const file of conditions.file_exists) {
        const filePath = resolve(context.workspace.path, file);
        if (!existsSync(filePath)) {
          return false;
        }
      }
    }

    if (conditions.file_missing) {
      for (const file of conditions.file_missing) {
        const filePath = resolve(context.workspace.path, file);
        if (existsSync(filePath)) {
          return false;
        }
      }
    }

    // Pattern matching
    if (conditions.branch_pattern) {
      const regex = new RegExp(conditions.branch_pattern);
      if (!regex.test(context.workspace.branchName)) {
        return false;
      }
    }

    if (conditions.workspace_pattern) {
      const regex = new RegExp(conditions.workspace_pattern);
      if (!regex.test(context.workspace.name)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Run a script with safety checks
   */
  static async runScript(
    script: ScriptDefinition,
    context: ExecutionContext,
    options: CommandOptions = {}
  ): Promise<boolean> {
    const workingDir = script.working_dir 
      ? resolve(context.workspace.path, script.working_dir)
      : context.workspace.path;

    // Verify working directory exists and is within workspace
    if (!this.isPathSafe(workingDir, context.workspace.path)) {
      console.error(chalk.red(`Unsafe working directory: ${workingDir}`));
      return false;
    }

    const command = this.substituteVariables(script.command, context.variables);
    const timeout = script.timeout || options.timeout || this.DEFAULT_TIMEOUT;

    console.log(chalk.blue(`Running: ${script.name || command.join(' ')}`));
    console.log(chalk.gray(`  Working directory: ${workingDir}`));

    return new Promise((resolve) => {
      const env = {
        ...process.env,
        ...script.env,
        WKT_WORKSPACE_PATH: context.workspace.path,
        WKT_WORKSPACE_NAME: context.workspace.name,
        WKT_BRANCH_NAME: context.workspace.branchName,
        WKT_PROJECT_NAME: context.project.name
      };

      const firstCommand = command[0];
      if (!firstCommand) {
        resolve(false);
        return;
      }

      const child: ChildProcess = spawn(firstCommand, command.slice(1), {
        cwd: workingDir,
        env,
        stdio: script.background ? 'ignore' : 'inherit',
        detached: script.background
      });

      if (script.background) {
        child.unref();
        console.log(chalk.gray(`Started in background (PID: ${child.pid})`));
        resolve(true);
        return;
      }

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        console.error(chalk.red(`Script timed out after ${timeout}ms`));
        resolve(false);
      }, timeout);

      child.on('exit', (code: number | null) => {
        clearTimeout(timer);
        const success = code === 0;
        
        if (success) {
          console.log(chalk.green(`✓ ${script.name || 'Script completed'}`));
        } else {
          console.error(chalk.red(`✗ ${script.name || 'Script failed'} (exit code: ${code})`));
        }
        
        resolve(success);
      });

      child.on('error', (error: Error) => {
        clearTimeout(timer);
        console.error(chalk.red(`Script execution error: ${error.message}`));
        resolve(false);
      });
    });
  }

  /**
   * Print what would be executed in dry-run mode
   */
  private static printDryRun(script: ScriptDefinition, context: ExecutionContext): void {
    console.log(chalk.blue('🔍 Dry run - would execute:'));
    console.log(chalk.gray(`  Script: ${script.name}`));
    console.log(chalk.gray(`  Command: ${script.command.join(' ')}`));
    console.log(chalk.gray(`  Working directory: ${context.workspace.path}`));
    
    if (script.env) {
      console.log(chalk.gray(`  Environment variables:`));
      for (const [key, value] of Object.entries(script.env)) {
        console.log(chalk.gray(`    ${key}=${value}`));
      }
    }
  }

  /**
   * Substitute variables in command or arguments
   */
  private static substituteVariables(
    input: string[],
    variables: Record<string, string>
  ): string[] {
    return input.map(arg => {
      let result = arg;
      for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }
      return result;
    });
  }

  /**
   * Check if pattern matches string (with wildcard support)
   */
  private static matchesPattern(text: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(text);
  }

  /**
   * Verify path is safe (within workspace boundaries)
   */
  private static isPathSafe(targetPath: string, workspacePath: string): boolean {
    const resolvedTarget = resolve(targetPath);
    const resolvedWorkspace = resolve(workspacePath);
    
    return resolvedTarget.startsWith(resolvedWorkspace);
  }

  /**
   * Create execution context for a workspace
   */
  static createContext(workspace: Workspace, project: Project): ExecutionContext {
    return {
      workspace,
      project,
      variables: {
        workspace_name: workspace.name,
        workspace_path: workspace.path,
        branch_name: workspace.branchName,
        project_name: workspace.projectName,
        base_branch: workspace.baseBranch,
        created_at: workspace.createdAt.toISOString(),
      }
    };
  }
}