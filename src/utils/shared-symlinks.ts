import { existsSync, readdirSync, lstatSync, readlinkSync, symlinkSync } from 'fs';
import { join, relative, resolve } from 'path';
import chalk from 'chalk';

const IGNORED_ENTRIES = new Set(['.git', '.gitignore', '.DS_Store']);

// Backup/swap artifacts that occasionally land in a project's shared/ directory.
// Everything in shared/ is mirrored into each workspace, so junk like a stray
// editor swapfile or a dated backup would otherwise leak in as a symlink.
const IGNORED_PATTERNS = [/^\.backup/, /~$/, /\.swp$/];

function isIgnoredEntry(entry: string): boolean {
  return IGNORED_ENTRIES.has(entry) || IGNORED_PATTERNS.some((pattern) => pattern.test(entry));
}

export function setupSharedSymlinks(sharedPath: string, workspacePath: string): void {
  if (!existsSync(sharedPath)) return;

  let entries: string[];
  try {
    entries = readdirSync(sharedPath);
  } catch {
    return;
  }

  const created: string[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (isIgnoredEntry(entry)) continue;

    const source = join(sharedPath, entry);
    const target = join(workspacePath, entry);
    const sourceResolved = resolve(source);

    const targetStat = lstatSync(target, { throwIfNoEntry: false });
    if (targetStat) {
      if (targetStat.isSymbolicLink()) {
        try {
          const linkTarget = readlinkSync(target);
          if (resolve(workspacePath, linkTarget) === sourceResolved) {
            continue;
          }
        } catch {
          // fall through to skip
        }
      }
      skipped.push(entry);
      continue;
    }

    try {
      symlinkSync(relative(workspacePath, source), target);
      created.push(entry);
    } catch (error) {
      console.log(chalk.yellow(`⚠ Could not symlink ${entry}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  if (created.length > 0) {
    console.log(chalk.gray(`Symlinked from shared: ${created.join(', ')}`));
  }
  if (skipped.length > 0) {
    console.log(chalk.yellow(`Skipped (target exists): ${skipped.join(', ')}`));
  }
}
