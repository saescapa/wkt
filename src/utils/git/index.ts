// Re-export all git utilities from their modules
export { executeCommand, parseDuration } from './command.js';
export { isGitRepository, getBareRepoUrl, cloneBareRepository, initBareRepository, getDefaultBranch } from './repository.js';
export {
  getCurrentBranch,
  branchExists,
  getLatestBranchReference,
  normalizeBaseBranch,
  rebaseBranch,
  getMergeStatus,
  getBranchAge,
} from './branches.js';
export type { MergeStatus, MergeCheckResult } from './branches.js';
export {
  createWorktree,
  removeWorktree,
  moveWorktree,
  listWorktrees,
} from './worktrees.js';
export {
  getWorkspaceStatus,
  isWorkingTreeClean,
  getCommitsDiff,
  getCommitCountAhead,
  getLastCommitInfo,
} from './status.js';
export { fetchAll } from './network.js';
