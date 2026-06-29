export interface Project {
  name: string;
  repositoryUrl: string;
  bareRepoPath: string;
  workspacesPath: string;
  defaultBranch: string;
  createdAt: Date;
  config?: ProjectConfig;
  template?: string;  // Template name applied to this project
}

export interface Workspace {
  id: string;
  projectName: string;
  name: string;
  branchName: string;
  path: string;
  baseBranch: string;
  createdAt: Date;
  lastUsed: Date;
  status: WorkspaceStatus;
  commitsAhead?: number;
  commitsBehind?: number;
  description?: string;
}

export interface WorkspaceStatus {
  clean: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

export interface ProjectConfig {
  git?: {
    default_base?: string;
    auto_fetch?: boolean;
    auto_rebase?: boolean;
    push_on_create?: boolean;
  };
  workspace?: {
    naming_strategy?: 'sanitized' | 'kebab-case' | 'snake_case';
    auto_cleanup?: boolean;
    max_age_days?: number;
  };
  inference?: {
    patterns?: InferencePattern[];
  };
}

export interface InferencePattern {
  pattern: string;
  template: string;
}

export interface GlobalConfig {
  wkt: {
    workspace_root: string;
    projects_root: string;
    shared_root: string;
    default_project?: string;
  };
  workspace: {
    naming_strategy: 'sanitized' | 'kebab-case' | 'snake_case';
    auto_cleanup: boolean;
    max_age_days: number;
  };
  git: {
    default_base: string;
    auto_fetch: boolean;
    auto_rebase: boolean;
    push_on_create: boolean;
  };
  display: {
    hide_inactive_main_branches: boolean;
    main_branch_inactive_days: number;
  };
  inference: {
    patterns: InferencePattern[];
  };
  projects: Record<string, ProjectConfig>;
  project_templates?: Record<string, ProjectConfig>;  // Reusable project templates
  aliases: Record<string, string>;
}

export interface WKTDatabase {
  projects: Record<string, Project>;
  workspaces: Record<string, Workspace>;
  metadata: {
    version: string;
    schemaVersion: number;
    lastCleanup: Date;
  };
}

// Base interface for common options
export interface BaseCommandOptions {
  force?: boolean;
  dry?: boolean;
}

// Command-specific option interfaces
export interface CreateCommandOptions extends BaseCommandOptions {
  from?: string;
  name?: string;
  template?: string;
  checkout?: boolean;
  description?: string;
  pathOnly?: boolean;
}

export interface SwitchCommandOptions extends BaseCommandOptions {
  search?: boolean;
  project?: string;
  create?: boolean;
  pathOnly?: boolean;
}

export interface ListCommandOptions {
  project?: string;
  details?: boolean;
  filter?: string;
  groupBy?: string;
  all?: boolean;
  dirty?: boolean;
  stale?: string;
}

export interface CleanCommandOptions extends BaseCommandOptions {
  project?: string;
  all?: boolean;
  merged?: boolean;
  olderThan?: string;
  fetch?: boolean;
}

export interface MergeCommandOptions extends BaseCommandOptions {
  squash?: boolean;
  into?: string;
  clean?: boolean;
  rebase?: boolean;
  project?: string;
}

export interface ConfigCommandOptions {
  project?: string;
  global?: boolean;
}

export interface InitCommandOptions {
  list?: boolean;
  template?: string;
  applyTemplate?: boolean;
  local?: boolean;
}

export interface RenameCommandOptions extends BaseCommandOptions {
  from?: string;
  name?: string;
  rebase?: boolean;
  description?: string;
}

export interface ReconcileCommandOptions {
  project?: string;
  apply?: boolean;
  force?: boolean;
}

