import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, lstatSync, readlinkSync, symlinkSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { setupSharedSymlinks } from '../../src/utils/shared-symlinks.js';

describe('setupSharedSymlinks', () => {
  let tmp: string;
  let sharedPath: string;
  let workspacePath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wkt-shared-test-'));
    sharedPath = join(tmp, 'shared');
    workspacePath = join(tmp, 'workspace');
    mkdirSync(sharedPath, { recursive: true });
    mkdirSync(workspacePath, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('symlinks each top-level entry into the workspace', () => {
    mkdirSync(join(sharedPath, 'docs.local'));
    writeFileSync(join(sharedPath, 'docs.local', 'note.md'), 'hello');
    writeFileSync(join(sharedPath, '.env'), 'X=1');

    setupSharedSymlinks(sharedPath, workspacePath);

    const docsStat = lstatSync(join(workspacePath, 'docs.local'));
    expect(docsStat.isSymbolicLink()).toBe(true);
    expect(resolve(workspacePath, readlinkSync(join(workspacePath, 'docs.local')))).toBe(resolve(sharedPath, 'docs.local'));

    const envStat = lstatSync(join(workspacePath, '.env'));
    expect(envStat.isSymbolicLink()).toBe(true);
  });

  it('skips .git, .gitignore, and .DS_Store', () => {
    mkdirSync(join(sharedPath, '.git'));
    writeFileSync(join(sharedPath, '.gitignore'), 'node_modules');
    writeFileSync(join(sharedPath, '.DS_Store'), '');

    setupSharedSymlinks(sharedPath, workspacePath);

    expect(lstatSync(join(workspacePath, '.git'), { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(join(workspacePath, '.gitignore'), { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(join(workspacePath, '.DS_Store'), { throwIfNoEntry: false })).toBeUndefined();
  });

  it('does not overwrite existing files in the workspace', () => {
    writeFileSync(join(sharedPath, 'README.md'), 'shared');
    writeFileSync(join(workspacePath, 'README.md'), 'tracked');

    setupSharedSymlinks(sharedPath, workspacePath);

    const stat = lstatSync(join(workspacePath, 'README.md'));
    expect(stat.isSymbolicLink()).toBe(false);
  });

  it('is idempotent when the symlink already points to the right place', () => {
    writeFileSync(join(sharedPath, 'config'), 'data');
    symlinkSync(resolve(sharedPath, 'config'), join(workspacePath, 'config'));

    setupSharedSymlinks(sharedPath, workspacePath);

    const stat = lstatSync(join(workspacePath, 'config'));
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('does nothing if the shared directory does not exist', () => {
    const missing = join(tmp, 'missing');
    expect(() => setupSharedSymlinks(missing, workspacePath)).not.toThrow();
  });

  it('does nothing if the shared directory is empty', () => {
    setupSharedSymlinks(sharedPath, workspacePath);
    // No throw; workspace remains empty.
  });
});
