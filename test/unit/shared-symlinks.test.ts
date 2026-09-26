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
    const docsTarget = join(tmp, 'docs-local-target');
    mkdirSync(docsTarget);
    writeFileSync(join(docsTarget, 'note.md'), 'hello');
    symlinkSync(docsTarget, join(sharedPath, 'docs.local'));
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

  it('skips backup and swap artifacts so junk in shared/ does not leak in', () => {
    mkdirSync(join(sharedPath, '.backup-claude-local-20260608'));
    writeFileSync(join(sharedPath, 'notes.md~'), 'editor backup');
    writeFileSync(join(sharedPath, '.notes.md.swp'), 'vim swap');
    writeFileSync(join(sharedPath, 'docs.local'), 'kept');

    setupSharedSymlinks(sharedPath, workspacePath);

    expect(lstatSync(join(workspacePath, '.backup-claude-local-20260608'), { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(join(workspacePath, 'notes.md~'), { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(join(workspacePath, '.notes.md.swp'), { throwIfNoEntry: false })).toBeUndefined();
    // Real entries are still symlinked.
    expect(lstatSync(join(workspacePath, 'docs.local')).isSymbolicLink()).toBe(true);
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

  it('links a file nested inside a pre-existing real directory', () => {
    mkdirSync(join(sharedPath, '.claude'));
    writeFileSync(join(sharedPath, '.claude', 'settings.local.json'), '{}');
    mkdirSync(join(workspacePath, '.claude'));

    setupSharedSymlinks(sharedPath, workspacePath);

    const dirStat = lstatSync(join(workspacePath, '.claude'));
    expect(dirStat.isDirectory()).toBe(true);
    expect(dirStat.isSymbolicLink()).toBe(false);

    const fileStat = lstatSync(join(workspacePath, '.claude', 'settings.local.json'));
    expect(fileStat.isSymbolicLink()).toBe(true);
    expect(resolve(workspacePath, '.claude', readlinkSync(join(workspacePath, '.claude', 'settings.local.json')))).toBe(
      resolve(sharedPath, '.claude', 'settings.local.json')
    );
  });

  it('creates a nested directory when absent as a real directory, not a symlink', () => {
    mkdirSync(join(sharedPath, '.claude'));
    writeFileSync(join(sharedPath, '.claude', 'settings.local.json'), '{}');

    setupSharedSymlinks(sharedPath, workspacePath);

    const dirStat = lstatSync(join(workspacePath, '.claude'));
    expect(dirStat.isDirectory()).toBe(true);
    expect(dirStat.isSymbolicLink()).toBe(false);
    expect(lstatSync(join(workspacePath, '.claude', 'settings.local.json')).isSymbolicLink()).toBe(true);
  });

  it('skips an existing nested file without overwriting it', () => {
    mkdirSync(join(sharedPath, '.claude'));
    writeFileSync(join(sharedPath, '.claude', 'settings.local.json'), 'shared');
    mkdirSync(join(workspacePath, '.claude'));
    writeFileSync(join(workspacePath, '.claude', 'settings.local.json'), 'tracked');

    setupSharedSymlinks(sharedPath, workspacePath);

    const stat = lstatSync(join(workspacePath, '.claude', 'settings.local.json'));
    expect(stat.isSymbolicLink()).toBe(false);
  });

  it('still links a symlinked directory in shared whole, without recursing into it', () => {
    const target = join(tmp, 'docs-local-target');
    mkdirSync(target);
    writeFileSync(join(target, 'note.md'), 'hello');
    symlinkSync(target, join(sharedPath, 'docs.local'));

    setupSharedSymlinks(sharedPath, workspacePath);

    const stat = lstatSync(join(workspacePath, 'docs.local'));
    expect(stat.isSymbolicLink()).toBe(true);
    expect(resolve(workspacePath, readlinkSync(join(workspacePath, 'docs.local')))).toBe(resolve(sharedPath, 'docs.local'));
  });

  it('skips ignored entries at depth', () => {
    mkdirSync(join(sharedPath, '.claude'));
    mkdirSync(join(sharedPath, '.claude', '.git'));
    writeFileSync(join(sharedPath, '.claude', 'notes.md~'), 'editor backup');

    setupSharedSymlinks(sharedPath, workspacePath);

    expect(lstatSync(join(workspacePath, '.claude', '.git'), { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(join(workspacePath, '.claude', 'notes.md~'), { throwIfNoEntry: false })).toBeUndefined();
  });
});
