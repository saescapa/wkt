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
  local_files?: {
    shared?: string[];        // Files symlinked to main worktree (e.g., CLAUDE.md)
    copied?: string[];        // Files copied from templates (e.g., .env)
    templates?: Record<string, string | TemplateConfig>;  // target -> source or config
    workspace_templates?: Record<string, Record<string, string | TemplateConfig>>; // workspace-specific overrides
  };
  scripts?: ScriptConfig;     // Script execution configuration
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
  display: {
    hide_inactive_main_branches: boolean;
    main_branch_inactive_days: number;
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
  scripts: ScriptConfig;      // Global script configuration
  projects: Record<string, ProjectConfig>;
  project_templates?: Record<string, ProjectConfig>;  // Reusable project templates
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
}

export interface CleanCommandOptions extends BaseCommandOptions {
  project?: string;
  all?: boolean;
  merged?: boolean;
  olderThan?: string;
}

export interface ConfigCommandOptions {
  project?: string;
  global?: boolean;
}

export interface SyncCommandOptions extends BaseCommandOptions {
  project?: string;
  workspace?: string;
  all?: boolean;
}

export interface ExecCommandOptions extends BaseCommandOptions {
  timeout?: number;
}

export interface RunCommandOptions extends BaseCommandOptions {
  timeout?: number;
}

export interface InitCommandOptions {
  list?: boolean;
  template?: string;
  applyTemplate?: boolean;  // For applying to existing projects
}

// Legacy interface for backward compatibility - will be deprecated
export interface CommandOptions extends BaseCommandOptions {
  from?: string;
  name?: string;
  template?: string;
  checkout?: boolean;
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
  // Script execution options
  confirm?: boolean;
  background?: boolean;
  timeout?: number;
  workspace?: string;
  global?: boolean;
  // Recycle options
  rebase?: boolean;
  description?: string;
}

// Safe script execution types
export interface ScriptDefinition {
  name: string;
  command: string[];           // Array of command parts (safer than string)
  description?: string;
  working_dir?: string;        // Relative to workspace root
  env?: Record<string, string>;
  timeout?: number;            // milliseconds
  background?: boolean;
  optional?: boolean;          // If true, failure won't stop execution
  conditions?: {
    file_exists?: string[];    // Only run if these files exist
    file_missing?: string[];   // Only run if these files don't exist
    branch_pattern?: string;   // Regex pattern for branch names
    workspace_pattern?: string; // Regex pattern for workspace names
  };
}

export interface ScriptHook {
  script: string;              // Reference to predefined script
  args?: string[];             // Arguments to pass to script
  variables?: Record<string, string>; // Template variables
  conditions?: {
    file_exists?: string[];
    file_missing?: string[];
    branch_pattern?: string;
    workspace_pattern?: string;
  };
}

export interface ScriptConfig {
  // Predefined safe scripts
  scripts?: Record<string, ScriptDefinition>;
  
  // Allowed commands (security allowlist)
  allowed_commands?: string[];
  
  // Hooks that run automatically
  hooks?: {
    post_create?: ScriptHook[];
    pre_switch?: ScriptHook[];
    post_switch?: ScriptHook[];
    pre_clean?: ScriptHook[];
    post_clean?: ScriptHook[];
  };
  
  // Named script shortcuts
  shortcuts?: Record<string, string>; // shortcut -> script name
  
  // Workspace-specific overrides
  workspace_scripts?: Record<string, {
    post_create?: ScriptHook[];
    pre_switch?: ScriptHook[];
    post_switch?: ScriptHook[];
    pre_clean?: ScriptHook[];
    post_clean?: ScriptHook[];
    scripts?: Record<string, ScriptDefinition>;
  }>;
}