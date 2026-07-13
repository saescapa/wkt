import { existsSync } from 'fs';
import { ValidationError } from './errors.js';

/**
 * Input validation at the CLI trust boundary. Everything here runs before a
 * value reaches git or the filesystem.
 */

const MAX_PROJECT_NAME_LENGTH = 100;
const MAX_BRANCH_NAME_LENGTH = 200;

const PROJECT_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const BRANCH_NAME_PATTERN = /^[a-zA-Z0-9_./+-]+$/;

/**
 * Project names become directory names under the wkt roots, so they must not
 * contain path separators or traversal sequences.
 */
export function validateProjectName(name: string): void {
  if (!name || name.length > MAX_PROJECT_NAME_LENGTH) {
    throw new ValidationError('project name', `must be 1-${MAX_PROJECT_NAME_LENGTH} characters`);
  }
  if (name === '.' || name === '..' || name.startsWith('-')) {
    throw new ValidationError('project name', `'${name}' is not a valid project name`);
  }
  if (!PROJECT_NAME_PATTERN.test(name)) {
    throw new ValidationError(
      'project name',
      'can only contain letters, numbers, dots, hyphens, and underscores'
    );
  }
}

/**
 * Branch names reach git as positional arguments; reject anything that could
 * be parsed as an option (leading "-") or that git would refuse anyway.
 */
export function validateBranchName(name: string): void {
  if (!name || name.length > MAX_BRANCH_NAME_LENGTH) {
    throw new ValidationError('branch name', `must be 1-${MAX_BRANCH_NAME_LENGTH} characters`);
  }
  if (name.startsWith('-')) {
    throw new ValidationError('branch name', 'cannot start with "-"');
  }
  if (!BRANCH_NAME_PATTERN.test(name)) {
    throw new ValidationError('branch name', 'contains invalid characters');
  }
}

/**
 * Repository URLs reach `git clone`. Restrict to transports that only talk to
 * a repository: http(s)/ssh/git/file URLs, scp-style git@host:path, or an
 * existing local path. This blocks git's exotic transports (ext::, transport
 * helpers) and option injection (URLs starting with "-"), both of which can
 * execute arbitrary commands.
 */
export function validateRepositoryUrl(url: string): void {
  if (!url) {
    throw new ValidationError('repository URL', 'is required');
  }
  if (url.startsWith('-')) {
    throw new ValidationError('repository URL', 'cannot start with "-"');
  }
  const allowed =
    /^(https?|ssh|git|file):\/\//.test(url) ||
    /^[\w.-]+@[\w.-]+:/.test(url) ||
    existsSync(url);
  if (!allowed) {
    throw new ValidationError(
      'repository URL',
      'must be an http(s)/ssh/git/file URL, scp-style git@host:path, or an existing local path'
    );
  }
}
