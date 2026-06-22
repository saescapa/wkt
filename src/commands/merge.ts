import chalk from 'chalk';
import inquirer from 'inquirer';
import { isNonInteractive, requireInput } from '../utils/interactive.js';
import { existsSync } from 'fs';
import type { MergeCommandOptions, Workspace, Project } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';
import {
  executeCommand,
  getWorkspaceStatus,
  getCommitsDiff,
  getCommitCountAhead,
  removeWorktree,
  rebaseBranch,
  fetchAll,
  normalizeBaseBranch,
} from '../utils/git/index.js';
import {
  ErrorHandler,
  WorkspaceNotFoundError,
  GitRepositoryError,
} from '../utils/errors.js';

export async function mergeCommand(
  workspace?: string,
  options: MergeCommandOptions = {}
): Promise<void> {
  try {
    const dbManager = new DatabaseManager();

    if (options.rebase) {
      await rebaseFeatureCommand(dbManager, workspace, options);
      return;
    }

    // Step 1: Determine the source workspace
    const sourceWorkspace = await resolveSourceWorkspace(dbManager, workspace, options);
    if (!sourceWorkspace) {
      console.log(chalk.yellow('Merge cancelled'));
      return;
    }

    const project = dbManager.getProject(sourceWorkspace.projectName);
    if (!project) {
      throw new Error(`Project '${sourceWorkspace.projectName}' not found`);
    }

    const targetBranch = options.into || project.defaultBranch;

    // Prevent merging main into itself (but allow main → feature)
    const mainBranches = [project.defaultBranch, 'main', 'master'];
    const sourceIsMain = mainBranches.some(b => sourceWorkspace.branchName === b);
    const targetIsMain = mainBranches.some(b => targetBranch === b);

    if (sourceIsMain && targetIsMain) {
      console.log(chalk.red(`✗ Cannot merge '${sourceWorkspace.branchName}' into '${targetBranch}' — both are main branches`));
      return;
    }

    if (sourceIsMain && !options.into) {
      console.log(chalk.red(`✗ Cannot merge '${sourceWorkspace.branchName}' — use --into <branch> to specify target`));
      return;
    }

    // Step 2: Find target workspace (must have targetBranch checked out)
    const projectWorkspaces = dbManager.getWorkspacesByProject(sourceWorkspace.projectName);
    const targetWorkspace = projectWorkspaces.find(w =>
      w.branchName === targetBranch || w.name === targetBranch
    );

    if (!targetWorkspace) {
      console.log(chalk.red(`✗ No workspace found for branch '${targetBranch}'`));
      console.log(chalk.gray(`Create one with: wkt create ${sourceWorkspace.projectName} ${targetBranch}`));
      return;
    }

    if (!existsSync(targetWorkspace.path)) {
      console.log(chalk.red(`✗ Target workspace directory missing: ${targetWorkspace.path}`));
      return;
    }

    // Step 3: Pre-merge checks
    if (!existsSync(sourceWorkspace.path)) {
      console.log(chalk.red(`✗ Source workspace directory missing: ${sourceWorkspace.path}`));
      return;
    }

    const commitsAhead = await getCommitCountAhead(sourceWorkspace.path, targetBranch);
    if (commitsAhead === 0 && !options.force) {
      console.log(chalk.yellow(`'${sourceWorkspace.branchName}' has no commits ahead of '${targetBranch}'`));
      return;
    }

    // Check source for uncommitted changes
    const sourceStatus = await getWorkspaceStatus(sourceWorkspace.path);
    if (!sourceStatus.clean) {
      console.log(chalk.yellow(`\n⚠️  '${sourceWorkspace.name}' has uncommitted changes:`));
      if (sourceStatus.staged > 0) console.log(chalk.yellow(`   ${sourceStatus.staged} staged`));
      if (sourceStatus.unstaged > 0) console.log(chalk.yellow(`   ${sourceStatus.unstaged} unstaged`));
      if (sourceStatus.untracked > 0) console.log(chalk.yellow(`   ${sourceStatus.untracked} untracked`));

      if (!options.force) {
        if (isNonInteractive()) {
          console.log(chalk.yellow('Merge cancelled: uncommitted changes present. Pass --force to proceed anyway.'));
          return;
        }
        const { proceed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'proceed',
          message: 'Continue? Only committed changes will be merged.',
          default: false,
        }]);
        if (!proceed) {
          console.log(chalk.yellow('Merge cancelled'));
          return;
        }
      }
    }

    // Check target is clean
    const targetStatus = await getWorkspaceStatus(targetWorkspace.path);
    if (!targetStatus.clean) {
      console.log(chalk.red(`✗ Target workspace '${targetWorkspace.name}' has uncommitted changes`));
      console.log(chalk.gray(`Commit or stash changes in: ${targetWorkspace.path}`));
      return;
    }

    // Step 4: Show merge preview
    const method = options.squash ? 'squash' : 'merge';
    console.log(chalk.blue(`\nMerging into ${targetBranch}:`));
    console.log(chalk.gray(`  ${sourceWorkspace.branchName} → ${targetBranch}`));
    console.log(chalk.gray(`  ${commitsAhead} commit${commitsAhead === 1 ? '' : 's'} · ${method}`));

    // Step 5: Execute merge
    try {
      if (options.squash) {
        await executeCommand(
          ['git', 'merge', '--squash', sourceWorkspace.branchName],
          targetWorkspace.path
        );

        // Build squash commit message including branch name (for merge detection)
        const logResult = await executeCommand(
          ['git', 'log', '--oneline', `${targetBranch}..${sourceWorkspace.branchName}`],
          targetWorkspace.path
        );
        const commitLines = logResult.trim().split('\n').filter(l => l.trim());
        const commitList = commitLines.map(l => `- ${l}`).join('\n');

        const commitMsg = `Merge ${sourceWorkspace.branchName} (squash)\n\n${commitList}`;
        await executeCommand(
          ['git', 'commit', '-m', commitMsg],
          targetWorkspace.path
        );
      } else {
        await executeCommand(
          ['git', 'merge', sourceWorkspace.branchName],
          targetWorkspace.path
        );
      }

      console.log(chalk.green(`\n✓ Merged ${sourceWorkspace.branchName} into ${targetBranch}`));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('conflict')) {
        console.log(chalk.red(`\n✗ Merge conflicts detected`));
        console.log(chalk.gray(`\nResolve in: ${targetWorkspace.path}`));
        console.log(chalk.gray(`  cd "${targetWorkspace.path}"`));
        console.log(chalk.gray(`  # resolve conflicts, then: git add . && git commit`));
        console.log(chalk.gray(`  # or abort: git merge --abort`));
        return;
      }
      throw new GitRepositoryError(`Merge failed: ${msg}`);
    }

    // Step 6: Re-point workspaces stacked on the just-merged branch.
    if (!sourceIsMain && targetBranch === project.defaultBranch) {
      await repointStackedChildren(dbManager, project, sourceWorkspace);
    }

    // Step 7: Optional cleanup (skip for main → feature merges)
    if (sourceIsMain) {
      console.log(chalk.gray(`\n  git push origin ${targetBranch}          # push when ready`));
    } else if (options.clean) {
      await cleanupSourceWorkspace(sourceWorkspace, project, dbManager);
    } else {
      console.log(chalk.gray(`\n  wkt clean ${sourceWorkspace.name}     # remove merged workspace`));
      console.log(chalk.gray(`  git push origin ${targetBranch}          # push when ready`));
    }
  } catch (error) {
    ErrorHandler.handle(error);
  }
}

async function resolveSourceWorkspace(
  dbManager: DatabaseManager,
  workspace: string | undefined,
  options: MergeCommandOptions
): Promise<Workspace | null> {
  if (workspace) {
    // Find by name or branch name
    const allWorkspaces = dbManager.getAllWorkspaces();
    const found = allWorkspaces.find(w =>
      w.name === workspace || w.branchName === workspace
    );
    if (!found) {
      const available = allWorkspaces.map(w => w.name);
      throw new WorkspaceNotFoundError(workspace, available);
    }
    return found;
  }

  // Try current workspace context
  const current = dbManager.getCurrentWorkspaceContext();
  if (current) {
    const project = dbManager.getProject(current.projectName);
    const mainBranches = [project?.defaultBranch, 'main', 'master'].filter(Boolean);
    const isMain = mainBranches.some(b => current.branchName === b || current.name === b);

    if (!isMain) {
      // In a feature workspace — use it as source
      return current;
    }

    // In main workspace with --into: use main as source (merge main → feature)
    if (options.into) {
      return current;
    }

    // In main workspace — interactive selection within this project
    return selectSourceWorkspace(dbManager, current.projectName);
  }

  // Not in any workspace — interactive selection
  return selectSourceWorkspace(dbManager, options.project);
}

async function selectSourceWorkspace(
  dbManager: DatabaseManager,
  projectName?: string
): Promise<Workspace | null> {
  // Determine project
  let resolvedProject = projectName;

  if (!resolvedProject) {
    const projects = dbManager.getAllProjects();
    if (projects.length === 0) {
      console.log(chalk.yellow('No projects initialized.'));
      return null;
    }
    if (projects.length === 1 && projects[0]) {
      resolvedProject = projects[0].name;
    } else {
      if (isNonInteractive()) {
        requireInput('project selection', `Multiple projects exist (${projects.map(p => p.name).join(', ')}). Pass -p <project>.`);
      }
      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: 'Select project:',
        choices: [
          ...projects.map(p => ({ name: p.name, value: p.name })),
          new inquirer.Separator(),
          { name: chalk.gray('Cancel'), value: null }
        ]
      }]);
      if (!selected) return null;
      resolvedProject = selected as string;
    }
  }

  const project = dbManager.getProject(resolvedProject);
  if (!project) {
    console.log(chalk.red(`Project '${resolvedProject}' not found`));
    return null;
  }

  // Filter to non-main workspaces in this project
  const mainBranches = [project.defaultBranch, 'main', 'master'];
  const featureWorkspaces = dbManager.getWorkspacesByProject(resolvedProject).filter(w =>
    !mainBranches.some(b => w.branchName === b || w.name === b)
  );

  if (featureWorkspaces.length === 0) {
    console.log(chalk.yellow('No feature workspaces to merge.'));
    return null;
  }

  if (isNonInteractive()) {
    requireInput('workspace selection', `Pass the workspace name as an argument: wkt merge <workspace>. Available: ${featureWorkspaces.map(w => w.name).join(', ')}`);
  }
  const { selected } = await inquirer.prompt([{
    type: 'list',
    name: 'selected',
    message: 'Select workspace to merge:',
    choices: [
      ...featureWorkspaces.map(w => ({
        name: `${w.name} ${chalk.gray(`(${w.branchName})`)}`,
        value: w,
        short: w.name
      })),
      new inquirer.Separator(),
      { name: chalk.gray('Cancel'), value: null }
    ],
    pageSize: 10
  }]);

  return selected;
}

function isMainBranch(workspace: Workspace, project?: Project): boolean {
  const mainBranches = [project?.defaultBranch, 'main', 'master'].filter(Boolean);
  return mainBranches.some(b => workspace.branchName === b || workspace.name === b);
}

async function resolveRebaseFeature(
  dbManager: DatabaseManager,
  workspace: string | undefined,
  options: MergeCommandOptions
): Promise<Workspace | null> {
  // `--into <X> --rebase` names the feature to rebase (mirrors the merge CLI).
  const target = options.into || workspace;
  if (target) {
    const allWorkspaces = dbManager.getAllWorkspaces();
    const found = allWorkspaces.find(w => w.name === target || w.branchName === target);
    if (!found) {
      throw new WorkspaceNotFoundError(target, allWorkspaces.map(w => w.name));
    }
    return found;
  }

  // No explicit feature: use the current workspace if it's a feature branch.
  const current = dbManager.getCurrentWorkspaceContext();
  if (current && !isMainBranch(current, dbManager.getProject(current.projectName))) {
    return current;
  }

  // Otherwise fall back to interactive selection.
  return selectSourceWorkspace(dbManager, options.project ?? current?.projectName);
}

async function rebaseFeatureCommand(
  dbManager: DatabaseManager,
  workspace: string | undefined,
  options: MergeCommandOptions
): Promise<void> {
  const feature = await resolveRebaseFeature(dbManager, workspace, options);
  if (!feature) {
    console.log(chalk.yellow('Rebase cancelled'));
    return;
  }

  const project = dbManager.getProject(feature.projectName);
  if (!project) {
    throw new Error(`Project '${feature.projectName}' not found`);
  }

  const base = normalizeBaseBranch(feature.baseBranch || project.defaultBranch);

  if (base === feature.branchName) {
    console.log(chalk.red(`✗ '${feature.name}' is its own base ('${base}') — nothing to rebase onto`));
    return;
  }

  if (!existsSync(feature.path)) {
    console.log(chalk.red(`✗ Workspace directory missing: ${feature.path}`));
    return;
  }

  const status = await getWorkspaceStatus(feature.path);
  if (!status.clean) {
    console.log(chalk.red(`✗ '${feature.name}' has uncommitted changes — commit or stash before rebasing`));
    console.log(chalk.gray(`   ${feature.path}`));
    return;
  }

  await fetchAll(project.bareRepoPath);

  const before = await getCommitsDiff(feature.path, base);
  if (before.behind === 0 && !options.force) {
    console.log(chalk.green(`✓ '${feature.name}' is already up to date with '${base}'`));
    return;
  }

  console.log(chalk.blue(`\nRebasing onto ${base}:`));
  console.log(chalk.gray(`  ${feature.branchName} onto ${base}`));
  console.log(chalk.gray(`  replaying over ${before.behind} new commit${before.behind === 1 ? '' : 's'}`));

  try {
    await rebaseBranch(feature.path, base);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.toLowerCase().includes('conflict')) {
      console.log(chalk.red(`\n✗ Rebase conflicts detected`));
      console.log(chalk.gray(`\nResolve in: ${feature.path}`));
      console.log(chalk.gray(`  cd "${feature.path}"`));
      console.log(chalk.gray(`  # resolve conflicts, then: git rebase --continue`));
      console.log(chalk.gray(`  # or abort: git rebase --abort`));
      return;
    }
    throw new GitRepositoryError(`Rebase failed: ${msg}`);
  }

  const after = await getCommitsDiff(feature.path, base);
  feature.status = await getWorkspaceStatus(feature.path);
  feature.baseBranch = base;
  feature.commitsAhead = after.ahead;
  feature.commitsBehind = after.behind;
  feature.lastUsed = new Date();
  dbManager.updateWorkspace(feature);

  console.log(chalk.green(`\n✓ Rebased ${feature.branchName} onto ${base}`));
  console.log(chalk.gray(`  +${after.ahead} / -${after.behind}`));
}

async function repointStackedChildren(
  dbManager: DatabaseManager,
  project: Project,
  source: Workspace
): Promise<void> {
  const merged = normalizeBaseBranch(source.branchName);
  const children = dbManager
    .getWorkspacesByProject(project.name)
    .filter(w => w.id !== source.id && normalizeBaseBranch(w.baseBranch) === merged);

  if (children.length === 0) {
    return;
  }

  for (const child of children) {
    child.baseBranch = project.defaultBranch;
    if (existsSync(child.path)) {
      const diff = await getCommitsDiff(child.path, project.defaultBranch);
      child.commitsAhead = diff.ahead;
      child.commitsBehind = diff.behind;
    }
    dbManager.updateWorkspace(child);
  }

  console.log(
    chalk.blue(
      `\n↳ Re-pointed ${children.length} stacked workspace${children.length === 1 ? '' : 's'} to ${project.defaultBranch}:`
    )
  );
  for (const child of children) {
    console.log(chalk.gray(`  ${child.name}  base: ${merged} → ${project.defaultBranch}`));
  }
  console.log(
    chalk.gray(`  (rebase to pick up the changes: wkt merge --into <name> --rebase)`)
  );
}

async function cleanupSourceWorkspace(
  workspace: Workspace,
  project: Project,
  dbManager: DatabaseManager
): Promise<void> {
  console.log(chalk.blue(`Cleaning workspace '${workspace.name}'...`));
  try {
    if (existsSync(workspace.path)) {
      await removeWorktree(project.bareRepoPath, workspace.path);
    }

    // Delete the merged branch
    try {
      await executeCommand(
        ['git', 'branch', '-d', workspace.branchName],
        project.bareRepoPath
      );
    } catch {
      // Branch deletion failed (maybe already deleted or not fully merged) — not critical
    }

    dbManager.removeWorkspace(workspace.id);
    console.log(chalk.green(`✓ Cleaned workspace '${workspace.name}'`));
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Could not clean workspace: ${error instanceof Error ? error.message : 'Unknown error'}`));
    console.log(chalk.gray(`Clean manually: wkt clean ${workspace.name}`));
  }
}
