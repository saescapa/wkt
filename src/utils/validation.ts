import { ValidationError } from './errors.js';
import { 
  PATTERNS, 
  MIN_PROJECT_NAME_LENGTH, 
  MAX_PROJECT_NAME_LENGTH,
  MIN_WORKSPACE_NAME_LENGTH,
  MAX_WORKSPACE_NAME_LENGTH,
  MIN_BRANCH_NAME_LENGTH,
  MAX_BRANCH_NAME_LENGTH,
  DURATION_UNITS
} from './constants.js';

/**
 * Validation utilities for user input
 */

/**
 * Validate that a value is not null or undefined
 */
export function validateRequired<T>(value: T | undefined | null, fieldName: string): T {
  if (value === undefined || value === null) {
    throw new ValidationError(fieldName, 'is required');
  }
  return value;
}

/**
 * Validate string length within specified bounds
 */
export function validateStringLength(
  value: string, 
  fieldName: string, 
  min?: number, 
  max?: number
): void {
  if (min !== undefined && value.length < min) {
    throw new ValidationError(fieldName, `must be at least ${min} characters`);
  }
  if (max !== undefined && value.length > max) {
    throw new ValidationError(fieldName, `must be no more than ${max} characters`);
  }
}

/**
 * Validate project name format and length
 */
export function validateProjectName(name: string): void {
  validateRequired(name, 'project name');
  validateStringLength(name, 'project name', MIN_PROJECT_NAME_LENGTH, MAX_PROJECT_NAME_LENGTH);
  
  if (!PATTERNS.PROJECT_NAME.test(name)) {
    throw new ValidationError(
      'project name', 
      'can only contain letters, numbers, hyphens, and underscores'
    );
  }
}

/**
 * Validate workspace name format and length
 */
export function validateWorkspaceName(name: string): void {
  validateRequired(name, 'workspace name');
  validateStringLength(name, 'workspace name', MIN_WORKSPACE_NAME_LENGTH, MAX_WORKSPACE_NAME_LENGTH);
  
  if (!PATTERNS.WORKSPACE_NAME.test(name)) {
    throw new ValidationError(
      'workspace name', 
      'can only contain letters, numbers, hyphens, underscores, dots, and slashes'
    );
  }
}

/**
 * Validate branch name format and length
 */
export function validateBranchName(name: string): void {
  validateRequired(name, 'branch name');
  validateStringLength(name, 'branch name', MIN_BRANCH_NAME_LENGTH, MAX_BRANCH_NAME_LENGTH);
  
  if (!PATTERNS.BRANCH_NAME.test(name)) {
    throw new ValidationError(
      'branch name', 
      'contains invalid characters'
    );
  }
}

/**
 * Validate repository URL format
 */
export function validateRepositoryUrl(url: string): void {
  validateRequired(url, 'repository URL');
  
  if (!PATTERNS.URL.test(url)) {
    throw new ValidationError(
      'repository URL', 
      'must be a valid HTTP/HTTPS or SSH Git URL'
    );
  }
}

/**
 * Validate duration format (e.g., "30d", "2w", "6m", "1y")
 */
export function validateDuration(duration: string): void {
  validateRequired(duration, 'duration');
  
  const match = duration.match(PATTERNS.DURATION);
  if (!match) {
    throw new ValidationError(
      'duration',
      'must be in format like "30d", "2w", "6m", "1y"'
    );
  }
  
  const [, valueStr, unit] = match;
  if (!valueStr || !unit) {
    throw new ValidationError('duration', 'invalid format');
  }
  
  const value = parseInt(valueStr, 10);
  
  if (isNaN(value) || value <= 0) {
    throw new ValidationError('duration', 'must be a positive number');
  }
  
  if (!(unit in DURATION_UNITS)) {
    throw new ValidationError('duration', 'unit must be d (days), w (weeks), m (months), or y (years)');
  }
}

/**
 * Validate file path for security (prevent directory traversal)
 */
export function validatePath(path: string, fieldName: string = 'path'): void {
  validateRequired(path, fieldName);
  
  // Check for directory traversal attempts
  if (path.includes('..')) {
    throw new ValidationError(fieldName, 'cannot contain parent directory references (..)');
  }
  
  // Check for absolute path (required for safety)
  if (!path.startsWith('/') && !path.match(/^[a-zA-Z]:\\/)) {
    throw new ValidationError(fieldName, 'must be an absolute path');
  }
}

/**
 * Validate timeout value in milliseconds
 */
export function validateTimeout(timeout: number): void {
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new ValidationError('timeout', 'must be a positive integer');
  }
  
  if (timeout > 600000) { // 10 minutes max
    throw new ValidationError('timeout', 'must be no more than 600000ms (10 minutes)');
  }
}

/**
 * Validate command name for script execution
 */
export function validateCommandName(command: string): void {
  validateRequired(command, 'command');
  
  if (command.trim() === '') {
    throw new ValidationError('command', 'cannot be empty');
  }
  
  // Basic safety checks - no shell metacharacters that could be dangerous
  const dangerousChars = ['&', '|', ';', '>', '<', '`', '$', '(', ')', '{', '}'];
  for (const char of dangerousChars) {
    if (command.includes(char)) {
      throw new ValidationError(
        'command', 
        `cannot contain shell metacharacter "${char}"`
      );
    }
  }
}

/**
 * Validate array of command arguments
 */
export function validateCommandArgs(args: string[]): void {
  if (!Array.isArray(args)) {
    throw new ValidationError('command arguments', 'must be an array');
  }
  
  for (let i = 0; i < args.length; i++) {
    if (typeof args[i] !== 'string') {
      throw new ValidationError(`command argument ${i}`, 'must be a string');
    }
  }
}

/**
 * Validate environment variables object
 */
export function validateEnvironmentVars(env: Record<string, string>): void {
  if (typeof env !== 'object' || env === null) {
    throw new ValidationError('environment variables', 'must be an object');
  }
  
  for (const [key, value] of Object.entries(env)) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new ValidationError('environment variables', 'keys and values must be strings');
    }
    
    // Basic validation for environment variable names
    if (!key.match(/^[A-Z_][A-Z0-9_]*$/)) {
      throw new ValidationError(
        `environment variable "${key}"`, 
        'must start with letter or underscore and contain only uppercase letters, numbers, and underscores'
      );
    }
  }
}

/**
 * Validate template variables object
 */
export function validateTemplateVars(vars: Record<string, string>): void {
  if (typeof vars !== 'object' || vars === null) {
    throw new ValidationError('template variables', 'must be an object');
  }
  
  for (const [key, value] of Object.entries(vars)) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new ValidationError('template variables', 'keys and values must be strings');
    }
    
    // Template variable names should be simple identifiers
    if (!key.match(/^[a-z_][a-z0-9_]*$/)) {
      throw new ValidationError(
        `template variable "${key}"`, 
        'must start with lowercase letter or underscore and contain only lowercase letters, numbers, and underscores'
      );
    }
  }
}

/**
 * Validate workspace pattern for matching
 */
export function validateWorkspacePattern(pattern: string): void {
  validateRequired(pattern, 'workspace pattern');
  
  try {
    // Test if the pattern can be compiled as a regex
    new RegExp(pattern.replace(/\*/g, '.*'));
  } catch (error) {
    throw new ValidationError('workspace pattern', 'is not a valid pattern');
  }
}

/**
 * Validate number within range
 */
export function validateNumberRange(
  value: number, 
  fieldName: string, 
  min?: number, 
  max?: number
): void {
  if (!Number.isFinite(value)) {
    throw new ValidationError(fieldName, 'must be a valid number');
  }
  
  if (min !== undefined && value < min) {
    throw new ValidationError(fieldName, `must be at least ${min}`);
  }
  
  if (max !== undefined && value > max) {
    throw new ValidationError(fieldName, `must be no more than ${max}`);
  }
}