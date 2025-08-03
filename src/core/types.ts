export interface Project {
  name: string;
  repositoryUrl: string;
  bareRepoPath: string;
  workspacesPath: string;
  defaultBranch: string;
  createdAt: Date;
  config?: ProjectConfig;
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
  inference: {
    patterns: InferencePattern[];
  };
  projects: Record<string, ProjectConfig>;
  aliases: Record<string, string>;
}

export interface WKTDatabase {
  projects: Record<string, Project>;
  workspaces: Record<string, Workspace>;
  metadata: {
    version: string;
    lastCleanup: Date;
    currentWorkspace?: string;
  };
}

export interface CommandOptions {
  from?: string;
  name?: string;
  template?: string;
  checkout?: boolean;
  force?: boolean;
  search?: boolean;
  project?: string;
  create?: boolean;
  details?: boolean;
  filter?: string;
  groupBy?: string;
  all?: boolean;
  merged?: boolean;
  olderThan?: string;
  list?: boolean;
  pathOnly?: boolean;
}