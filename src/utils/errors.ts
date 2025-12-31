import chalk from 'chalk';

/**
 * Custom error classes for better error handling and type safety
 */

export interface ErrorHint {
  text: string;
  command?: string;
}

export class WKTError extends Error {
  public readonly code: string;
  public readonly isUserError: boolean;
  public readonly hints: ErrorHint[];

  constructor(
    message: string,
    code: string = 'GENERIC_ERROR',
    isUserError: boolean = true,
    hints: ErrorHint[] = []
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.isUserError = isUserError;
    this.hints = hints;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ProjectNotFoundError extends WKTError {
  constructor(projectName: string) {
    super(`Project '${projectName}' not found`, 'PROJECT_NOT_FOUND', true, [
      { text: 'See available projects', command: 'wkt init --list' },
      { text: 'Initialize a project', command: 'wkt init <repository-url> <project-name>' },
    ]);
  }
}

export class WorkspaceNotFoundError extends WKTError {
  constructor(workspaceName: string, availableWorkspaces?: string[]) {
    const hints: ErrorHint[] = [
      { text: 'List workspaces', command: 'wkt list' },
      { text: 'Create workspace', command: 'wkt create <project> <branch-name>' },
    ];

    super(`Workspace '${workspaceName}' not found`, 'WORKSPACE_NOT_FOUND', true, hints);

    // Store available workspaces for display if provided
    if (availableWorkspaces && availableWorkspaces.length > 0) {
      (this as { availableWorkspaces?: string[] }).availableWorkspaces = availableWorkspaces;
    }
  }
}

export class WorkspaceExistsError extends WKTError {
  constructor(workspaceName: string, projectName: string) {
    super(
      `Workspace '${workspaceName}' already exists in project '${projectName}'`,
      'WORKSPACE_EXISTS',
      true,
      [{ text: 'Overwrite existing', command: '--force' }]
    );
  }
}

export class DirectoryExistsError extends WKTError {
  constructor(path: string) {
    super(`Directory already exists: ${path}`, 'DIRECTORY_EXISTS', true, [
      { text: 'Overwrite existing', command: '--force' },
    ]);
  }
}

export class GitRepositoryError extends WKTError {
  constructor(message: string) {
    super(message, 'GIT_ERROR', false);
  }
}

export class CommandNotAllowedError extends WKTError {
  constructor(command: string) {
    super(`Command not allowed: ${command}`, 'COMMAND_NOT_ALLOWED', true, [
      { text: 'Add to allowed_commands in .wkt.yaml' },
    ]);
  }
}

export class ScriptNotFoundError extends WKTError {
  constructor(scriptName: string) {
    super(`Script '${scriptName}' not found`, 'SCRIPT_NOT_FOUND', true, [
      { text: 'List available scripts', command: 'wkt run --list' },
    ]);
  }
}

export class ConfigurationError extends WKTError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', true, [
      { text: 'Check your .wkt.yaml configuration' },
    ]);
  }
}

export class ValidationError extends WKTError {
  constructor(field: string, message: string) {
    super(`Invalid ${field}: ${message}`, 'VALIDATION_ERROR');
  }
}

export class NoWorkspaceError extends WKTError {
  constructor() {
    super('No workspace detected', 'NO_WORKSPACE', true, [
      { text: 'Switch to a workspace', command: 'wkt switch' },
      { text: 'Create a workspace', command: 'wkt create <project> <branch>' },
    ]);
  }
}

export interface ErrorHandlerOptions {
  /** Minimal output mode - just the error message to stderr, no hints */
  minimal?: boolean;
  /** Exit after displaying error (default: true) */
  exit?: boolean;
}

/**
 * Centralized error handler that provides consistent error reporting
 */
export class ErrorHandler {
  /**
   * Handle and display error with appropriate formatting and exit behavior
   */
  static handle(error: unknown, options: ErrorHandlerOptions = {}): never {
    const { minimal = false, exit = true } = options;

    if (error instanceof WKTError) {
      this.displayError(error, minimal);
    } else if (error instanceof Error) {
      this.displayUnexpectedError(error, minimal);
    } else {
      this.displayUnknownError(error, minimal);
    }

    if (exit) {
      process.exit(1);
    }

    // TypeScript needs this for the `never` return type
    throw error;
  }

  /**
   * Handle error without exiting (for non-fatal errors)
   */
  static warn(error: unknown): void {
    if (error instanceof WKTError) {
      console.warn(chalk.yellow(`⚠ ${error.message}`));
    } else if (error instanceof Error) {
      console.warn(chalk.yellow(`⚠ ${error.message}`));
    } else {
      console.warn(chalk.yellow(`⚠ ${String(error)}`));
    }
  }

  /**
   * Create a WKT error from a generic error
   */
  static createError(
    error: unknown,
    defaultMessage: string,
    code: string = 'GENERIC_ERROR'
  ): WKTError {
    if (error instanceof WKTError) {
      return error;
    } else if (error instanceof Error) {
      return new WKTError(error.message, code, false);
    } else {
      return new WKTError(defaultMessage, code, false);
    }
  }

  private static displayError(error: WKTError, minimal: boolean): void {
    // Always output to stderr
    console.error(chalk.red(`✗ ${error.message}`));

    if (minimal) {
      return;
    }

    // Show available workspaces for WorkspaceNotFoundError
    const availableWorkspaces = (error as { availableWorkspaces?: string[] }).availableWorkspaces;
    if (availableWorkspaces && availableWorkspaces.length > 0) {
      console.error('');
      console.error(chalk.dim('Available workspaces:'));
      // Show up to 10 workspaces
      const toShow = availableWorkspaces.slice(0, 10);
      for (const ws of toShow) {
        console.error(chalk.dim(`  ${ws}`));
      }
      if (availableWorkspaces.length > 10) {
        console.error(chalk.dim(`  ... and ${availableWorkspaces.length - 10} more`));
      }
    }

    // Show hints from the error
    if (error.hints.length > 0) {
      console.error('');
      for (const hint of error.hints) {
        if (hint.command) {
          console.error(chalk.dim(`${hint.text}: `) + chalk.cyan(hint.command));
        } else {
          console.error(chalk.dim(hint.text));
        }
      }
    }

    // Show stack trace for development errors
    if (!error.isUserError && process.env.WKT_DEBUG === '1') {
      console.error('');
      console.error(chalk.gray(error.stack));
    }
  }

  private static displayUnexpectedError(error: Error, minimal: boolean): void {
    console.error(chalk.red(`✗ ${error.message}`));

    if (!minimal && process.env.WKT_DEBUG === '1') {
      console.error('');
      console.error(chalk.gray(error.stack));
    }
  }

  private static displayUnknownError(error: unknown, minimal: boolean): void {
    console.error(chalk.red(`✗ ${String(error)}`));

    if (!minimal && process.env.WKT_DEBUG === '1') {
      console.error('');
      console.error(chalk.gray(new Error().stack));
    }
  }
}