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
export {
  createWorktree,
  removeWorktree,
  moveWorktree,
  listWorktrees,
  createDetachedWorktree,
  resetDetachedWorktree,
  createBranchFromDetached,
} from './worktrees.js';
export {
  getWorkspaceStatus,
  isWorkingTreeClean,
  getCommitsDiff,
  getCommitCountAhead,
  getCommitsAheadOfRemote,
  getLastCommitInfo,
} from './status.js';
export { fetchAll, fetchInWorkspace, pullWithRebase, pushBranch, pushHEADToRemote } from './network.js';
