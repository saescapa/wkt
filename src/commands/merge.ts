import chalk from 'chalk';
import inquirer from 'inquirer';
import { existsSync } from 'fs';
import type { MergeCommandOptions, Workspace, Project } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';
import {
  executeCommand,
  getWorkspaceStatus,
  getCommitCountAhead,
  removeWorktree,
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

    // Prevent merging main into itself
    const mainBranches = [project.defaultBranch, 'main', 'master'];
    if (mainBranches.some(b => sourceWorkspace.branchName === b)) {
      console.log(chalk.red(`✗ Cannot merge '${sourceWorkspace.branchName}' — it's a main branch`));
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

    // Step 6: Optional cleanup
    if (options.clean) {
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
