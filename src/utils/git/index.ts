// Re-export all git utilities from their modules
export { executeCommand, parseDuration } from './command.js';
export { isGitRepository, getBareRepoUrl, cloneBareRepository, getDefaultBranch } from './repository.js';
export {
  getCurrentBranch,
  branchExists,
  getLatestBranchReference,
  rebaseBranch,
  isBranchMerged,
  getBranchAge,
} from './branches.js';
export { createWorktree, removeWorktree, moveWorktree, listWorktrees } from './worktrees.js';
export {
  getWorkspaceStatus,
  isWorkingTreeClean,
  getCommitsDiff,
  getCommitCountAhead,
  getLastCommitInfo,
} from './status.js';
export { fetchAll, fetchInWorkspace, pullWithRebase, pushBranch } from './network.js';
