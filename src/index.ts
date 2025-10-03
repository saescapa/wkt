#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { createCommand } from './commands/create.js';
import { switchCommand } from './commands/switch.js';
import { listCommand } from './commands/list.js';
import { cleanCommand } from './commands/clean.js';
import { configCommand } from './commands/config.js';
import { syncCommand } from './commands/sync.js';
import { execCommand } from './commands/exec.js';
import { runCommand } from './commands/run.js';

program
  .name('wkt')
  .description('A flexible CLI tool for managing multiple project working directories using git worktrees')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize WKT with a repository')
  .argument('[repository-url]', 'Git repository URL (or project name when using --apply-template)')
  .argument('[project-name]', 'Optional project name')
  .option('-l, --list', 'List all managed projects')
  .option('-t, --template <name>', 'Apply a project template during initialization')
  .option('--apply-template', 'Apply template to an existing project')
  .action(initCommand);

program
  .command('create')
  .description('Create a new workspace')
  .argument('<project>', 'Project name')
  .argument('<branch-name>', 'Branch name')
  .option('--from <branch>', 'Base branch (default: main/master)', 'main')
  .option('--name <name>', 'Custom workspace directory name')
  .option('--template <template>', 'Apply workspace template')
  .option('--no-checkout', 'Create but don\'t checkout')
  .option('--force', 'Overwrite existing workspace')
  .action(createCommand);

program
  .command('switch')
  .description('Switch to an existing workspace')
  .argument('[workspace]', 'Workspace name (optional for interactive mode)')
  .option('-s, --search', 'Enable fuzzy search mode')
  .option('-p, --project <name>', 'Limit search to specific project')
  .option('--create', 'Create workspace if it doesn\'t exist')
  .option('--path-only', 'Output only the workspace path (useful for shell integration)')
  .action(switchCommand);

program
  .command('list')
  .alias('ls')
  .description('List all workspaces')
  .option('-p, --project <name>', 'List workspaces for specific project')
  .option('-d, --details', 'Show detailed information')
  .option('--filter <pattern>', 'Filter by pattern')
  .option('--group-by <field>', 'Group results by field', 'project')
  .action(listCommand);

program
  .command('clean')
  .description('Clean up workspaces (defaults to merged branches only)')
  .argument('[workspace]', 'Specific workspace to clean')
  .option('-p, --project <name>', 'Clean specific project')
  .option('--merged', 'Remove merged workspaces (default behavior)')
  .option('--older-than <duration>', 'Remove workspaces older than duration (e.g., 30d, 2w, 6m, 1y)')
  .option('--force', 'Force removal without confirmation')
  .option('--all', 'Clean all workspaces (overrides --merged default)')
  .action(cleanCommand);

program
  .command('config')
  .description('Manage WKT configuration')
  .argument('[subcommand]', 'Subcommand: show, edit, open, path, debug (default: show)')
  .option('--project <name>', 'Work with project-specific config')
  .option('--global', 'Work with global config (default)')
  .action(configCommand);

program
  .command('sync')
  .description('Sync local files to existing workspaces')
  .option('--project <name>', 'Sync specific project only')
  .option('--workspace <name>', 'Sync specific workspace only')
  .option('--all', 'Sync all workspaces without confirmation')
  .option('--force', 'Skip confirmation prompts')
  .option('--dry', 'Show what would be synced (dry run)')
  .action(syncCommand);

program
  .command('exec')
  .description('Execute a command in a specific workspace')
  .argument('<workspace>', 'Workspace identifier (project/workspace or workspace). Use "." for current workspace')
  .argument('<command...>', 'Command to execute')
  .option('--force', 'Skip confirmation prompts')
  .option('--dry', 'Show what would be executed (dry run)')
  .option('--timeout <ms>', 'Command timeout in milliseconds', '120000')
  .action((workspace, command, options) => {
    execCommand(workspace, command, options);
  });

program
  .command('run')
  .description('Run a predefined script in a workspace')
  .argument('[script-name]', 'Name of the script to run (or "list" to show available scripts). If not provided, shows interactive selection')
  .argument('[workspace]', 'Workspace identifier (optional, uses current workspace if not specified). Use "." for current workspace')
  .option('--force', 'Skip confirmation prompts')
  .option('--dry', 'Show what would be executed (dry run)')
  .option('--timeout <ms>', 'Script timeout in milliseconds')
  .action((scriptName, workspace, options) => {
    runCommand(scriptName, workspace, options);
  });

program.on('command:*', () => {
  console.error(chalk.red(`Invalid command: ${program.args.join(' ')}`));
  console.log('See --help for available commands');
  process.exit(1);
});

if (process.argv.length === 2) {
  program.outputHelp();
}

program.parse();