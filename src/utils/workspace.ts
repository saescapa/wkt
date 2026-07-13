import type { Workspace, Project } from '../core/types.js';

/**
 * A workspace is a "main" workspace when it holds the project's default
 * branch (or a conventional main/master). Main workspaces own the shared
 * files other workspaces symlink to, so destructive commands must never
 * touch them.
 */
export function isMainBranchWorkspace(workspace: Workspace, project?: Project): boolean {
  const mainBranchNames = [project?.defaultBranch, 'main', 'master'].filter(
    (branch): branch is string => Boolean(branch)
  );
  return mainBranchNames.some(
    branch => workspace.branchName === branch || workspace.name === branch
  );
}
