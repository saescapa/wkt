import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { ConfigManager } from '../core/config.js';

interface ConfigOptions {
  open?: boolean;
  edit?: boolean;
  show?: boolean;
  path?: boolean;
  global?: boolean;
  project?: string;
}

export async function configCommand(subcommand: string = 'show', options: ConfigOptions = {}): Promise<void> {
  const configManager = new ConfigManager();

  switch (subcommand) {
    case 'show':
      await showConfig(configManager, options);
      break;
    case 'edit':
    case 'open':
      await openConfig(configManager, options);
      break;
    case 'path':
      await showConfigPath(configManager, options);
      break;
    case 'debug':
      await debugConfig(configManager, options);
      break;
    default:
      console.error(chalk.red(`Unknown config subcommand: ${subcommand}`));
      showConfigHelp();
      process.exit(1);
  }
}

async function showConfig(configManager: ConfigManager, options: ConfigOptions): Promise<void> {
  if (options.project) {
    const projectConfig = configManager.getProjectConfig(options.project);
    console.log(chalk.blue(`Project config for "${options.project}":`));
    console.log(JSON.stringify(projectConfig, null, 2));
  } else {
    const globalConfig = configManager.getConfig();
    console.log(chalk.blue('Global WKT Configuration:'));
    console.log(JSON.stringify(globalConfig, null, 2));
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function openConfig(configManager: ConfigManager, _options: ConfigOptions): Promise<void> {
  const configPath = join(homedir(), '.wkt', 'config.yaml');
  
  if (!existsSync(configPath)) {
    console.log(chalk.yellow('Config file does not exist. Creating with defaults...'));
    configManager.getConfig(); // This will create the config file
  }

  const editor = process.env.EDITOR || process.env.VISUAL || 'code';
  
  console.log(chalk.blue(`Opening config file with ${editor}...`));
  console.log(chalk.gray(`Path: ${configPath}`));

  const child = spawn(editor, [configPath], {
    stdio: 'inherit',
    detached: true
  });

  child.on('error', (error) => {
    console.error(chalk.red(`Failed to open editor: ${error.message}`));
    console.log(chalk.yellow(`Try setting your EDITOR environment variable or use:`));
    console.log(chalk.white(`  wkt config path`));
  });

  child.unref();
}

async function showConfigPath(configManager: ConfigManager, options: ConfigOptions): Promise<void> {
  const configPath = join(homedir(), '.wkt', 'config.yaml');
  
  if (options.project) {
    const projectConfigPath = join(process.cwd(), '.wkt.yaml');
    console.log(projectConfigPath);
  } else {
    console.log(configPath);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function debugConfig(configManager: ConfigManager, _options: ConfigOptions): Promise<void> {
  const configPath = join(homedir(), '.wkt', 'config.yaml');
  const projectConfigPath = join(process.cwd(), '.wkt.yaml');
  
  console.log(chalk.blue('🔧 WKT Configuration Debug Info'));
  console.log();
  
  // Global config info
  console.log(chalk.yellow('Global Configuration:'));
  console.log(`  Path: ${configPath}`);
  console.log(`  Exists: ${existsSync(configPath) ? '✅' : '❌'}`);
  if (existsSync(configPath)) {
    try {
      const config = configManager.getConfig();
      console.log(`  Projects: ${Object.keys(config.projects).length}`);
      console.log(`  Workspace Root: ${config.wkt.workspace_root}`);
      console.log(`  Projects Root: ${config.wkt.projects_root}`);
      console.log(`  Valid: ✅`);
    } catch (error) {
      console.log(`  Valid: ❌ (${error})`);
    }
  }
  console.log();
  
  // Project config info
  console.log(chalk.yellow('Project Configuration (.wkt.yaml):'));
  console.log(`  Path: ${projectConfigPath}`);
  console.log(`  Exists: ${existsSync(projectConfigPath) ? '✅' : '❌'}`);
  console.log();
  
  // Directory structure
  console.log(chalk.yellow('Directory Structure:'));
  const config = configManager.getConfig();
  const wktDir = join(homedir(), '.wkt');
  const workspaceDir = config.wkt.workspace_root;
  const projectsDir = config.wkt.projects_root;
  
  console.log(`  ~/.wkt/: ${existsSync(wktDir) ? '✅' : '❌'}`);
  console.log(`  Workspaces: ${existsSync(workspaceDir) ? '✅' : '❌'} (${workspaceDir})`);
  console.log(`  Projects: ${existsSync(projectsDir) ? '✅' : '❌'} (${projectsDir})`);
  console.log();
  
  // Database info
  const databasePath = join(wktDir, 'database.json');
  console.log(chalk.yellow('Database:'));
  console.log(`  Path: ${databasePath}`);
  console.log(`  Exists: ${existsSync(databasePath) ? '✅' : '❌'}`);
  console.log();
  
  // Environment info
  console.log(chalk.yellow('Environment:'));
  console.log(`  EDITOR: ${process.env.EDITOR || '(not set)'}`);
  console.log(`  VISUAL: ${process.env.VISUAL || '(not set)'}`);
  console.log(`  HOME: ${homedir()}`);
  console.log(`  CWD: ${process.cwd()}`);
}

function showConfigHelp(): void {
  console.log(chalk.blue('WKT Config Commands:'));
  console.log();
  console.log('  wkt config [show]         Show current configuration');
  console.log('  wkt config edit|open      Open config file in editor');
  console.log('  wkt config path           Show config file path');
  console.log('  wkt config debug          Show detailed debug information');
  console.log();
  console.log('Options:');
  console.log('  --project <name>          Work with project-specific config');
  console.log('  --global                  Work with global config (default)');
  console.log();
  console.log('Examples:');
  console.log('  wkt config                # Show current config');
  console.log('  wkt config edit           # Open in $EDITOR');
  console.log('  wkt config debug          # Debug config issues');
  console.log('  wkt config path           # Get config file path');
  console.log('  wkt config --project myapp # Show project config');
}