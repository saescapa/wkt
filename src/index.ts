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
import { runCommand } from './commands/run.js';
import { renameCommand } from './commands/rename.js';
import { infoCommand } from './commands/info.js';
import { Logger, logger } from './utils/logger.js';
import { ErrorHandler } from './utils/errors.js';

// Global error handlers
process.on('unhandledRejection', (reason: unknown) => {
  logger.debug('Unhandled promise rejection:', reason);
  if (reason instanceof Error) {
    ErrorHandler.handle(reason, 'unhandled rejection');
  } else {
    console.error(chalk.red('Unhandled rejection:'), reason);
    process.exit(1);
  }
});

process.on('uncaughtException', (error: Error) => {
  logger.debug('Uncaught exception:', error);
  ErrorHandler.handle(error, 'uncaught exception');
});

program
  .name('wkt')
  .description('A flexible CLI tool for managing multiple project working directories using git worktrees')
  .version('0.1.0')
  .option('--debug', 'Enable debug logging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.debug) {
      Logger.initialize({ level: 'debug' });
    }
  });

// Setup Commands
program.commandsGroup('Setup:');

program
  .command('init')
  .description('Initialize WKT with a repository')
  .argument('[repository-url]', 'Git repository URL (optional if current directory is a git repo, or project name when using --apply-template)')
  .argument('[project-name]', 'Custom project name (optional, inferred from repository URL or directory name if not provided)')
  .option('-l, --list', 'List all managed projects')
  .option('-t, --template <name>', 'Apply a project template during initialization')
  .option('--apply-template', 'Apply template to an existing project (first argument becomes project name)')
  .action(initCommand);

program
  .command('config')
  .description('Manage WKT configuration')
  .argument('[subcommand]', 'Subcommand: show, edit, open, path, debug (default: show)')
  .option('--project <name>', 'Work with project-specific config')
  .option('--global', 'Work with global config (default)')
  .action(configCommand);

// Workspace Management Commands
program.commandsGroup('Workspace Management:');

program
  .command('create')
  .description('Create a new workspace')
  .argument('<project>', 'Project name')
  .argument('<branch-name>', 'Branch name')
  .option('--from <branch>', 'Base branch (default: main/master)', 'main')
  .option('--name <name>', 'Custom workspace directory name')
  .option('--description <text>', 'Workspace description (e.g., "Splits feature")')
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
  .option('--dirty', 'Show only workspaces with uncommitted changes')
  .option('--stale <duration>', 'Show only workspaces older than duration (e.g., 30d, 2w)')
  .option('--group-by <field>', 'Group results by field', 'project')
  .option('-a, --all', 'Show all workspaces including inactive main branches')
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
  .command('rename')
  .description('Rename current workspace (optionally with new branch)')
  .argument('<new-name>', 'New workspace/branch name')
  .option('--from <branch>', 'Base branch to rebase from when creating new branch (default: main)')
  .option('--no-rebase', 'Simple rename: rename branch in-place without creating new branch or rebasing')
  .option('--name <name>', 'Custom workspace directory name (default: inferred from branch name)')
  .option('--description <text>', 'Update workspace description')
  .option('--force', 'Force rename even if working tree is dirty')
  .action(renameCommand);

// Workspace Info Commands
program.commandsGroup('Workspace Info:');

program
  .command('info')
  .description('Show detailed information about current workspace')
  .option('--description-only', 'Output only the description (for shell integration)')
  .option('--branch-only', 'Output only the branch name')
  .option('--name-only', 'Output only the workspace name')
  .option('--json', 'Output as JSON')
  .option('-d, --set-description [text]', 'Set or update workspace description (prompts if no text provided)')
  .action(infoCommand);

// Execution Commands
program.commandsGroup('Execution:');

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

program
  .command('sync')
  .description('Sync local files to existing workspaces')
  .option('--project <name>', 'Sync specific project only')
  .option('--workspace <name>', 'Sync specific workspace only')
  .option('--all', 'Sync all workspaces without confirmation')
  .option('--force', 'Skip confirmation prompts')
  .option('--dry', 'Show what would be synced (dry run)')
  .action(syncCommand);

program.on('command:*', () => {
  console.error(chalk.red(`Invalid command: ${program.args.join(' ')}`));
  console.log('See --help for available commands');
  process.exit(1);
});

if (process.argv.length === 2) {
  program.outputHelp();
}

program.parse();