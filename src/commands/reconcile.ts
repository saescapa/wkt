import { basename, dirname, resolve } from 'path';
import { existsSync, realpathSync, statSync } from 'fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { Project, ReconcileCommandOptions, Workspace } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';
import {
  listWorktrees,
  getWorkspaceStatus,
  getCommitsDiff,
} from '../utils/git/index.js';
import { isNonInteractive } from '../utils/interactive.js';
import { ErrorHandler, ProjectNotFoundError } from '../utils/errors.js';

/**
 * Drift between git's worktree truth and the wkt database.
 *
 * - adopt:       git has a workspace-level worktree wkt never recorded -> add db entry
 * - branch-drift: db and git disagree on the checked-out branch -> update db
 * - dead:        db references a worktree whose directory is gone -> remove db entry
 * - stale-git:   git references a worktree directory that is gone -> `git worktree prune`
 * - broken-link: directory exists but git doesn't list it as a worktree -> `git worktree repair`
 * - conflict:    an orphan whose derived id is already taken by another workspace
 * - foreign:     a nested worktree not directly under the project's workspaces dir (ignored)
 */
type FindingKind =
  | 'adopt'
  | 'branch-drift'
  | 'dead'
  | 'stale-git'
  | 'broken-link'
  | 'conflict'
  | 'foreign';

interface Finding {
  kind: FindingKind;
  projectName: string;
  name: string;
  path: string;
  detail: string;
  /** Populated for kinds the --apply step can resolve in the database. */
  apply?: () => Promise<void>;
  /** Populated for kinds that need a manual git command instead. */
  hint?: string;
}

const FIXABLE: ReadonlySet<FindingKind> = new Set(['adopt', 'branch-drift', 'dead']);

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function stripRef(branch: string): string {
  return branch.replace(/^refs\/heads\//, '');
}

const KIND_LABEL: Record<FindingKind, string> = {
  adopt: chalk.green('adopt'),
  'branch-drift': chalk.yellow('branch-drift'),
  dead: chalk.red('dead'),
  'stale-git': chalk.magenta('stale-git'),
  'broken-link': chalk.magenta('broken-link'),
  conflict: chalk.red('conflict'),
  foreign: chalk.gray('foreign'),
};

async function buildWorkspaceFromWorktree(
  project: Project,
  workspacePath: string,
  branchName: string
): Promise<Workspace> {
  const baseBranch = project.defaultBranch;
  const status = await getWorkspaceStatus(workspacePath);
  const commitsDiff = await getCommitsDiff(workspacePath, baseBranch);

  let createdAt = new Date();
  try {
    createdAt = statSync(workspacePath).mtime;
  } catch {
    // Fall back to now if the directory can't be stat'd.
  }

  const name = basename(workspacePath);
  return {
    id: `${project.name}/${name}`,
    projectName: project.name,
    name,
    branchName,
    path: workspacePath,
    baseBranch,
    createdAt,
    lastUsed: new Date(),
    status,
    commitsAhead: commitsDiff.ahead,
    commitsBehind: commitsDiff.behind,
  };
}

async function analyzeProject(
  project: Project,
  dbManager: DatabaseManager
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const workspacesRoot = canonical(project.workspacesPath);

  const liveWorktrees = await listWorktrees(project.bareRepoPath);
  const gitByPath = new Map<string, { branch: string; rawPath: string }>();
  for (const wt of liveWorktrees) {
    gitByPath.set(canonical(wt.path), { branch: stripRef(wt.branch), rawPath: wt.path });
  }

  const dbWorkspaces = dbManager.getWorkspacesByProject(project.name);
  const dbByPath = new Map<string, Workspace>();
  for (const ws of dbWorkspaces) {
    dbByPath.set(canonical(ws.path), ws);
  }

  // git -> db: orphan worktrees (and nested/foreign ones we ignore)
  for (const [path, { branch, rawPath }] of gitByPath) {
    if (dbByPath.has(path)) continue;

    // Only direct children of the project's workspaces dir are wkt workspaces.
    if (dirname(path) !== workspacesRoot) {
      findings.push({
        kind: 'foreign',
        projectName: project.name,
        name: basename(path),
        path: rawPath,
        detail: `nested worktree on '${branch}' — not a wkt workspace, ignored`,
      });
      continue;
    }

    if (!existsSync(path)) {
      findings.push({
        kind: 'stale-git',
        projectName: project.name,
        name: basename(path),
        path: rawPath,
        detail: `git lists '${branch}' here but the directory is gone`,
        hint: `git -C "${project.bareRepoPath}" worktree prune`,
      });
      continue;
    }

    const name = basename(path);
    const id = `${project.name}/${name}`;
    const existing = dbManager.getWorkspace(id);
    if (existing) {
      findings.push({
        kind: 'conflict',
        projectName: project.name,
        name,
        path: rawPath,
        detail: `id '${id}' already maps to ${existing.path} — resolve manually`,
      });
      continue;
    }

    findings.push({
      kind: 'adopt',
      projectName: project.name,
      name,
      path: rawPath,
      detail: `orphan worktree on '${branch}' — add to database`,
      apply: async () => {
        const workspace = await buildWorkspaceFromWorktree(project, path, branch);
        dbManager.addWorkspace(workspace);
      },
    });
  }

  // db -> git: branch drift, dead entries, broken links
  for (const [path, ws] of dbByPath) {
    const live = gitByPath.get(path);

    if (live) {
      if (live.branch && ws.branchName !== live.branch) {
        findings.push({
          kind: 'branch-drift',
          projectName: project.name,
          name: ws.name,
          path: ws.path,
          detail: `db='${ws.branchName}' git='${live.branch}' — update database`,
          apply: async () => {
            ws.branchName = live.branch;
            ws.status = await getWorkspaceStatus(path);
            const diff = await getCommitsDiff(path, ws.baseBranch);
            ws.commitsAhead = diff.ahead;
            ws.commitsBehind = diff.behind;
            dbManager.updateWorkspace(ws);
          },
        });
      }
      continue;
    }

    if (existsSync(ws.path)) {
      findings.push({
        kind: 'broken-link',
        projectName: project.name,
        name: ws.name,
        path: ws.path,
        detail: `directory exists but git doesn't list it as a worktree`,
        hint: `git -C "${ws.path}" worktree repair`,
      });
    } else {
      findings.push({
        kind: 'dead',
        projectName: project.name,
        name: ws.name,
        path: ws.path,
        detail: `database entry has no worktree on disk — remove it`,
        apply: async () => {
          dbManager.removeWorkspace(ws.id);
        },
      });
    }
  }

  return findings;
}

function printFindings(findings: Finding[]): void {
  const byProject = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byProject.get(f.projectName) || [];
    list.push(f);
    byProject.set(f.projectName, list);
  }

  for (const [projectName, list] of [...byProject].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(chalk.bold(`\n${projectName}`));
    for (const f of list) {
      console.log(`  ${KIND_LABEL[f.kind].padEnd(22)} ${chalk.cyan(f.name)}`);
      console.log(`    ${chalk.gray(f.detail)}`);
      if (f.hint) {
        console.log(`    ${chalk.gray('run:')} ${f.hint}`);
      }
    }
  }
}

export async function reconcileCommand(
  options: ReconcileCommandOptions = {}
): Promise<void> {
  try {
    const dbManager = new DatabaseManager();

    let projects: Project[];
    if (options.project) {
      const project = dbManager.getProject(options.project);
      if (!project) {
        throw new ProjectNotFoundError(options.project);
      }
      projects = [project];
    } else {
      projects = dbManager.getAllProjects();
    }

    if (projects.length === 0) {
      console.log(chalk.yellow('No projects to reconcile.'));
      return;
    }

    const findings: Finding[] = [];
    for (const project of projects) {
      findings.push(...(await analyzeProject(project, dbManager)));
    }

    const actionable = findings.filter(f => f.kind !== 'foreign');
    if (actionable.length === 0) {
      console.log(chalk.green('✓ Database is in sync with git — no drift found.'));
      const foreign = findings.length - actionable.length;
      if (foreign > 0) {
        console.log(chalk.gray(`  (${foreign} nested/foreign worktree(s) ignored)`));
      }
      return;
    }

    printFindings(findings);

    const fixable = findings.filter(f => f.apply && FIXABLE.has(f.kind));
    const manual = actionable.filter(f => f.hint);

    console.log();
    if (manual.length > 0) {
      console.log(
        chalk.yellow(
          `${manual.length} item(s) need a manual git command (shown above) — wkt won't touch git plumbing for you.`
        )
      );
    }

    if (!options.apply) {
      if (fixable.length > 0) {
        console.log(
          chalk.blue(
            `${fixable.length} item(s) can be fixed in the database. Re-run with ${chalk.bold('--apply')} to apply.`
          )
        );
      }
      return;
    }

    if (fixable.length === 0) {
      console.log(chalk.gray('Nothing for --apply to do in the database.'));
      return;
    }

    if (!options.force && !isNonInteractive()) {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: `Apply ${fixable.length} database change(s)?`,
          default: true,
        },
      ]);
      if (!confirmed) {
        console.log(chalk.yellow('Aborted — no changes made.'));
        return;
      }
    }

    for (const f of fixable) {
      await f.apply!();
      console.log(chalk.green(`✓ ${f.kind}: ${f.projectName}/${f.name}`));
    }

    console.log(chalk.green(`\n✓ Applied ${fixable.length} change(s).`));
  } catch (error) {
    ErrorHandler.handle(error);
  }
}
