/**
 * Application constants and configuration values
 */

// Application metadata
export const APP_NAME = 'wkt';
export const APP_VERSION = '0.1.0';
export const APP_DESCRIPTION = 'A flexible CLI tool for managing multiple project working directories using git worktrees';

// File and directory names
export const CONFIG_DIR_NAME = '.wkt';
export const CONFIG_FILE_NAME = 'config.yaml';
export const DATABASE_FILE_NAME = 'database.json';
export const LOCAL_CONFIG_FILE_NAME = '.wkt.yaml';
export const PROJECTS_DIR_NAME = 'projects';
export const WORKSPACES_DIR_NAME = 'workspaces';

// Git-related constants
export const DEFAULT_BRANCH_NAMES = ['main', 'master'] as const;
export const GIT_REMOTE_NAME = 'origin';

// Timeout values (in milliseconds)
export const DEFAULT_SCRIPT_TIMEOUT = 120000; // 2 minutes
export const MAX_SCRIPT_TIMEOUT = 600000;    // 10 minutes

// Duration parsing constants
export const DURATION_UNITS = {
  d: 24 * 60 * 60 * 1000,      // days
  w: 7 * 24 * 60 * 60 * 1000,  // weeks
  m: 30 * 24 * 60 * 60 * 1000, // months (approximate)
  y: 365 * 24 * 60 * 60 * 1000 // years (approximate)
} as const;

// Branch inference patterns
export const DEFAULT_INFERENCE_PATTERNS = [
  { pattern: '^(\\d+)$', template: 'feature/eng-{}' },
  { pattern: '^eng-(\\d+)$', template: 'feature/{}' },
  { pattern: '^(feature/.+)$', template: '{}' },
] as const;

// Default allowed commands for script execution
export const DEFAULT_ALLOWED_COMMANDS = [
  'pnpm', 'npm', 'yarn', 'bun',
  'node', 'tsx', 'ts-node',
  'git', 'docker', 'docker-compose',
  'planetscale', 'pscale',
  'make', 'cmake',
  './scripts/', '../scripts/', 'scripts/'
] as const;

// Branch age constants (for merge detection)
export const BRANCH_AGE_LIMIT_DAYS = 30;
export const BRANCH_AGE_LIMIT_MS = BRANCH_AGE_LIMIT_DAYS * DURATION_UNITS.d;

// Search and pagination limits
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_SEARCH_RESULTS = 50;
export const MAX_LOG_ENTRIES = 50;

// Naming strategy constants
export const NAMING_STRATEGIES = ['sanitized', 'kebab-case', 'snake_case'] as const;

// Default workspace configuration
export const DEFAULT_WORKSPACE_CONFIG = {
  naming_strategy: 'sanitized' as const,
  auto_cleanup: true,
  max_age_days: 30,
};

// Default git configuration
export const DEFAULT_GIT_CONFIG = {
  default_base: 'main',
  auto_fetch: true,
  auto_rebase: false,
  push_on_create: false,
};

// Command aliases
export const DEFAULT_COMMAND_ALIASES = {
  ls: 'list',
  sw: 'switch',
  rm: 'clean',
} as const;

// Environment variables
export const ENV_VARS = {
  HOME: 'HOME',
  NODE_ENV: 'NODE_ENV',
  WKT_DEBUG: 'WKT_DEBUG',
  WKT_WORKSPACE_PATH: 'WKT_WORKSPACE_PATH',
  WKT_WORKSPACE_NAME: 'WKT_WORKSPACE_NAME',
  WKT_BRANCH_NAME: 'WKT_BRANCH_NAME',
  WKT_PROJECT_NAME: 'WKT_PROJECT_NAME',
} as const;

// Exit codes
export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  MISUSE: 2,
  CANNOT_EXECUTE: 126,
  COMMAND_NOT_FOUND: 127,
  INVALID_ARGUMENT: 128,
} as const;

// File size limits
export const MAX_CONFIG_FILE_SIZE = 1024 * 1024; // 1MB
export const MAX_DATABASE_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Validation constants
export const MIN_PROJECT_NAME_LENGTH = 1;
export const MAX_PROJECT_NAME_LENGTH = 100;
export const MIN_WORKSPACE_NAME_LENGTH = 1;
export const MAX_WORKSPACE_NAME_LENGTH = 100;
export const MIN_BRANCH_NAME_LENGTH = 1;
export const MAX_BRANCH_NAME_LENGTH = 200;

// Regular expressions
export const PATTERNS = {
  DURATION: /^(\d+)([dwmy])$/,
  PROJECT_NAME: /^[a-zA-Z0-9_-]+$/,
  WORKSPACE_NAME: /^[a-zA-Z0-9_.-]+$/,
  BRANCH_NAME: /^[a-zA-Z0-9_./+-]+$/,
  URL: /^(https?:\/\/|git@)/,
} as const;

// Error messages
export const ERROR_MESSAGES = {
  PROJECT_NOT_FOUND: (name: string) => `Project '${name}' not found`,
  WORKSPACE_NOT_FOUND: (name: string) => `Workspace '${name}' not found`,
  WORKSPACE_EXISTS: (workspace: string, project: string) => 
    `Workspace '${workspace}' already exists in project '${project}'`,
  DIRECTORY_EXISTS: (path: string) => `Directory '${path}' already exists`,
  INVALID_DURATION: (duration: string) => 
    `Invalid duration format: ${duration}. Use format like '30d', '2w', '6m', '1y'`,
  COMMAND_NOT_ALLOWED: (command: string) => `Command "${command}" not allowed`,
  SCRIPT_NOT_FOUND: (script: string) => `Script "${script}" not found`,
  NO_CURRENT_WORKSPACE: 'No current workspace set. Use `wkt switch` to select one.',
} as const;

// Success messages
export const SUCCESS_MESSAGES = {
  WORKSPACE_CREATED: (name: string) => `✓ Successfully created workspace '${name}'`,
  WORKSPACE_SWITCHED: (name: string) => `✓ Switched to workspace '${name}'`,
  SCRIPT_COMPLETED: (name: string) => `✓ ${name}`,
  FILES_SYNCED: 'Files synced successfully',
} as const;

// Help messages
export const HELP_MESSAGES = {
  USE_LIST: 'Use `wkt list` to see available workspaces.',
  USE_INIT_LIST: 'Use `wkt init --list` to see available projects.',
  USE_FORCE: 'Use --force to overwrite the existing workspace.',
  CREATE_WORKSPACE: 'Or create one with: wkt create <project> <branch-name>',
  ADD_TO_ALLOWED: 'Add to allowed_commands in .wkt.yaml to enable this command.',
} as const;