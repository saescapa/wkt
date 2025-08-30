import chalk from 'chalk';

/**
 * Custom error classes for better error handling and type safety
 */

export class WKTError extends Error {
  public readonly code: string;
  public readonly isUserError: boolean;

  constructor(message: string, code: string = 'GENERIC_ERROR', isUserError: boolean = true) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.isUserError = isUserError;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ProjectNotFoundError extends WKTError {
  constructor(projectName: string) {
    super(`Project '${projectName}' not found`, 'PROJECT_NOT_FOUND');
  }
}

export class WorkspaceNotFoundError extends WKTError {
  constructor(workspaceName: string) {
    super(`Workspace '${workspaceName}' not found`, 'WORKSPACE_NOT_FOUND');
  }
}

export class WorkspaceExistsError extends WKTError {
  constructor(workspaceName: string, projectName: string) {
    super(`Workspace '${workspaceName}' already exists in project '${projectName}'`, 'WORKSPACE_EXISTS');
  }
}

export class DirectoryExistsError extends WKTError {
  constructor(path: string) {
    super(`Directory '${path}' already exists`, 'DIRECTORY_EXISTS');
  }
}

export class GitRepositoryError extends WKTError {
  constructor(message: string) {
    super(`Git repository error: ${message}`, 'GIT_ERROR', false);
  }
}

export class CommandNotAllowedError extends WKTError {
  constructor(command: string) {
    super(`Command "${command}" not allowed`, 'COMMAND_NOT_ALLOWED');
  }
}

export class ScriptNotFoundError extends WKTError {
  constructor(scriptName: string) {
    super(`Script "${scriptName}" not found`, 'SCRIPT_NOT_FOUND');
  }
}

export class ConfigurationError extends WKTError {
  constructor(message: string) {
    super(`Configuration error: ${message}`, 'CONFIG_ERROR');
  }
}

export class ValidationError extends WKTError {
  constructor(field: string, message: string) {
    super(`Validation error for ${field}: ${message}`, 'VALIDATION_ERROR');
  }
}

/**
 * Centralized error handler that provides consistent error reporting
 */
export class ErrorHandler {
  /**
   * Handle and display error with appropriate formatting and exit behavior
   */
  static handle(error: unknown, context?: string): never {
    if (error instanceof WKTError) {
      this.displayError(error, context);
      process.exit(1);
    } else if (error instanceof Error) {
      this.displayUnexpectedError(error, context);
      process.exit(1);
    } else {
      this.displayUnknownError(error, context);
      process.exit(1);
    }
  }

  /**
   * Handle error without exiting (for non-fatal errors)
   */
  static warn(error: unknown, context?: string): void {
    if (error instanceof WKTError) {
      this.displayWarning(error, context);
    } else if (error instanceof Error) {
      console.warn(chalk.yellow(`Warning${context ? ` in ${context}` : ''}: ${error.message}`));
    } else {
      console.warn(chalk.yellow(`Warning${context ? ` in ${context}` : ''}: ${String(error)}`));
    }
  }

  /**
   * Create a WKT error from a generic error
   */
  static createError(error: unknown, defaultMessage: string, code: string = 'GENERIC_ERROR'): WKTError {
    if (error instanceof WKTError) {
      return error;
    } else if (error instanceof Error) {
      return new WKTError(error.message, code, false);
    } else {
      return new WKTError(defaultMessage, code, false);
    }
  }

  private static displayError(error: WKTError, context?: string): void {
    const prefix = context ? `Error in ${context}` : 'Error';
    console.error(chalk.red(`${prefix}: ${error.message}`));

    // Provide helpful hints for common errors
    if (error instanceof ProjectNotFoundError) {
      console.log('Use `wkt init --list` to see available projects.');
      console.log('Or initialize it with: wkt init <repository-url> <project-name>');
    } else if (error instanceof WorkspaceNotFoundError) {
      console.log('Use `wkt list` to see available workspaces.');
      console.log('Or create one with: wkt create <project> <branch-name>');
    } else if (error instanceof WorkspaceExistsError) {
      console.log('Use --force to overwrite the existing workspace.');
    } else if (error instanceof DirectoryExistsError) {
      console.log('Use --force to overwrite the existing directory.');
    } else if (error instanceof CommandNotAllowedError) {
      console.log('Add to allowed_commands in .wkt.yaml to enable this command.');
    } else if (error instanceof ConfigurationError) {
      console.log('Check your .wkt.yaml configuration or global config.');
    }

    // Show stack trace for development errors
    if (!error.isUserError && process.env.NODE_ENV === 'development') {
      console.error(chalk.gray(error.stack));
    }
  }

  private static displayUnexpectedError(error: Error, context?: string): void {
    const prefix = context ? `Unexpected error in ${context}` : 'Unexpected error';
    console.error(chalk.red(`${prefix}: ${error.message}`));
    
    if (process.env.NODE_ENV === 'development') {
      console.error(chalk.gray(error.stack));
    }
  }

  private static displayUnknownError(error: unknown, context?: string): void {
    const prefix = context ? `Unknown error in ${context}` : 'Unknown error';
    console.error(chalk.red(`${prefix}: ${String(error)}`));
  }

  private static displayWarning(error: WKTError, context?: string): void {
    const prefix = context ? `Warning in ${context}` : 'Warning';
    console.warn(chalk.yellow(`${prefix}: ${error.message}`));
  }
}

/**
 * Utility function for validating required parameters
 */
export function validateRequired<T>(value: T | undefined | null, fieldName: string): T {
  if (value === undefined || value === null) {
    throw new ValidationError(fieldName, 'is required');
  }
  return value;
}

/**
 * Utility function for validating string length
 */
export function validateStringLength(value: string, fieldName: string, min?: number, max?: number): void {
  if (min !== undefined && value.length < min) {
    throw new ValidationError(fieldName, `must be at least ${min} characters`);
  }
  if (max !== undefined && value.length > max) {
    throw new ValidationError(fieldName, `must be no more than ${max} characters`);
  }
}

/**
 * Utility function for validating file/directory paths
 */
export function validatePath(path: string, fieldName: string): void {
  if (path.includes('..')) {
    throw new ValidationError(fieldName, 'cannot contain parent directory references (..)');
  }
  if (!path.startsWith('/') && !path.match(/^[a-zA-Z]:\\/)) {
    throw new ValidationError(fieldName, 'must be an absolute path');
  }
}