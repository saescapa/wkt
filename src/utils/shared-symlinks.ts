import { existsSync, readdirSync, lstatSync, readlinkSync, symlinkSync, mkdirSync } from 'fs';
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

// A shared entry that is a real directory (not a symlink, e.g. `docs.local`) is mirrored
// rather than linked whole: the target directory is created if absent and the same linking
// logic is applied to its children, so pre-existing real files at any depth are preserved.
function linkTree(
  sharedDir: string,
  workspaceDir: string,
  workspaceRoot: string,
  quiet: boolean,
  created: string[],
  skipped: string[]
): void {
  let entries: string[];
  try {
    entries = readdirSync(sharedDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (isIgnoredEntry(entry)) continue;

    const source = join(sharedDir, entry);
    const target = join(workspaceDir, entry);
    const reportPath = relative(workspaceRoot, target);
    const sourceStat = lstatSync(source, { throwIfNoEntry: false });
    if (!sourceStat) continue;

    if (sourceStat.isDirectory()) {
      const targetStat = lstatSync(target, { throwIfNoEntry: false });
      if (targetStat) {
        if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
          skipped.push(reportPath);
          continue;
        }
      } else {
        try {
          mkdirSync(target);
        } catch (error) {
          if (!quiet) console.log(chalk.yellow(`⚠ Could not create ${reportPath}: ${error instanceof Error ? error.message : String(error)}`));
          continue;
        }
      }
      linkTree(source, target, workspaceRoot, quiet, created, skipped);
      continue;
    }

    const sourceResolved = resolve(source);
    const targetStat = lstatSync(target, { throwIfNoEntry: false });
    if (targetStat) {
      if (targetStat.isSymbolicLink()) {
        try {
          const linkTarget = readlinkSync(target);
          if (resolve(workspaceDir, linkTarget) === sourceResolved) {
            continue;
          }
        } catch {
          // fall through to skip
        }
      }
      skipped.push(reportPath);
      continue;
    }

    try {
      symlinkSync(relative(workspaceDir, source), target);
      created.push(reportPath);
    } catch (error) {
      if (!quiet) console.log(chalk.yellow(`⚠ Could not symlink ${reportPath}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}

export function setupSharedSymlinks(sharedPath: string, workspacePath: string, quiet = false): void {
  if (!existsSync(sharedPath)) return;

  const created: string[] = [];
  const skipped: string[] = [];

  linkTree(sharedPath, workspacePath, workspacePath, quiet, created, skipped);

  if (!quiet && created.length > 0) {
    console.log(chalk.gray(`Symlinked from shared: ${created.join(', ')}`));
  }
  if (!quiet && skipped.length > 0) {
    console.log(chalk.yellow(`Skipped (target exists): ${skipped.join(', ')}`));
  }
}
