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
  local_files?: {
    shared?: string[];        // Files symlinked to main worktree (e.g., CLAUDE.md)
    copied?: string[];        // Files copied from templates (e.g., .env)
    templates?: Record<string, string | TemplateConfig>;  // target -> source or config
    workspace_templates?: Record<string, Record<string, string | TemplateConfig>>; // workspace-specific overrides
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
  local_files: {
    shared: string[];
    copied: string[];
    templates: Record<string, string | TemplateConfig>;
    workspace_templates: Record<string, Record<string, string | TemplateConfig>>;
  };
  projects: Record<string, ProjectConfig>;
  aliases: Record<string, string>;
}

export interface TemplateConfig {
  source: string;           // Template file path
  conditions?: {
    branch_pattern?: string;    // Regex pattern for branch names
    workspace_pattern?: string; // Regex pattern for workspace names  
    environment?: string;       // Environment type (staging, production, etc.)
  };
  variables?: Record<string, string>; // Template variables to substitute
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