# WKT (Worktree Kit) CLI Specification

## Overview
A flexible CLI tool for managing multiple project working directories using git worktrees, designed to enable parallel development workflows across multiple repositories where multiple agents (human developers, AI assistants, CI/CD processes) need to work on different versions simultaneously.

## Core Problem Statement
Traditional git branching forces developers into a single working directory per repository, creating conflicts when:
- Multiple AI agents need to work on different features simultaneously
- Developers need to quickly switch contexts without losing work-in-progress
- CI/CD processes need isolated environments for testing different branches
- Large repositories make cloning expensive and time-consuming
- Teams work across multiple related repositories

## Design Principles

### 1. Zero-Configuration Start
- Works immediately after installation with sensible defaults
- Automatically detects git repositories and suggests optimal configurations
- No required setup files or complex initialization

### 2. Multi-Repository Management
- Seamless handling of multiple project repositories
- Intelligent workspace discovery across all managed repos
- No need to specify repository context when switching

### 3. Workspace Isolation
- Each workspace is completely independent
- No shared state that could cause conflicts
- Safe parallel execution across multiple processes

### 4. Intelligent Automation
- Smart branch name inference and completion
- Automatic cleanup and maintenance
- Proactive conflict prevention
- Repository context inference from workspace names

### 5. Performance First
- Minimal disk usage through git worktree efficiency
- Fast workspace creation and switching
- Lazy loading of expensive operations

### 6. Developer Experience
- Intuitive command structure following Unix conventions
- Rich feedback and helpful error messages
- Extensive customization without complexity
- Designed for zsh-based shells with rich completions

## Command Specification

### Core Commands

#### `wkt init [repository-url] [project-name]`
Initialize WKT with a repository, optionally naming the project.

```bash
# Initialize with automatic project name inference
wkt init git@github.com:taylorswift/midnights.git
# Creates project "midnights" from repo name

# Initialize with custom project name
wkt init git@github.com:taylorswift/1989.git paris
# Creates project "paris" 

# Initialize in existing git repo
cd ~/projects/folklore
wkt init
# Creates project "folklore" from current directory name

# List all managed projects
wkt init --list
```

**Behavior:**
- Creates `.wkt/` directory in user home for global configuration
- Registers repository with project name mapping
- Sets up bare repository in centralized location
- Project names are unique identifiers for repositories

#### `wkt create <project> <branch-name> [options]`
Create a new workspace from a specific project.

```bash
# Basic creation
wkt create midnights feature/vault-door

# Create with automatic branch inference
wkt create midnights 1234                    # -> feature/eng-1234
wkt create midnights eng-1234               # -> feature/eng-1234
wkt create midnights feature/eng-1234       # -> feature/eng-1234

# Create from specific base branch
wkt create paris hotfix/critical-bug --from develop

# Create with custom workspace name
wkt create folklore feature/auth --name auth-system

# Quick create with merged syntax
wkt midnights feature/new-song              # Shorthand for create
```

**Options:**
- `--from <branch>`: Base branch (default: main/master)
- `--name <name>`: Custom workspace directory name
- `--template <template>`: Apply workspace template
- `--no-checkout`: Create but don't checkout
- `--force`: Overwrite existing workspace

#### `wkt switch <workspace> [options]`
Switch to an existing workspace - intelligently finds workspace across all projects.

```bash
# Switch to workspace (searches all projects)
wkt switch vault-door

# Switch with fuzzy search
wkt switch vault              # Finds workspaces matching "vault"

# Interactive switch with preview
wkt switch                    # Shows all workspaces across projects

# Switch to last used workspace
wkt switch -

# If multiple matches found, presents selection:
# Multiple workspaces found:
# 1. midnights/feature-vault-door
# 2. folklore/feature-vault-design
# Select workspace [1-2]:
```

**Options:**
- `-s, --search`: Enable fuzzy search mode
- `-p, --project <name>`: Limit search to specific project
- `--create`: Create workspace if it doesn't exist

#### `wkt list [options]`
List all workspaces across all projects.

```bash
# List all workspaces
wkt list

# List workspaces for specific project
wkt list --project midnights

# List with details
wkt list --details

# Filter by pattern
wkt list --filter "feature/*"

# Group by project
wkt list --group-by project
```

**Output Formats:**
```
# Basic (grouped by project)
midnights:
  feature-vault-door     feature/vault-door     clean
  hotfix-tracklist      hotfix/tracklist       dirty (2 files)

folklore:
  * feature-lakes       feature/lakes          clean
  experiment-woods      experiment/woods       clean

# Flat list
midnights/feature-vault-door     clean      2h ago
midnights/hotfix-tracklist      dirty      1d ago
* folklore/feature-lakes         clean      active
folklore/experiment-woods        clean      3h ago
```

#### `wkt status [workspace]`
Show detailed status of workspace(s).

```bash
# Current workspace status
wkt status

# All workspaces status with project info
wkt status --all

# Specific project status
wkt status --project midnights
```

#### `wkt clean [options]`
Clean up workspaces and maintenance.

```bash
# Interactive cleanup across all projects
wkt clean

# Clean specific project
wkt clean --project folklore

# Remove merged workspaces
wkt clean --merged

# Remove workspaces older than 30 days
wkt clean --older-than 30d

# Force remove specific workspace
wkt clean vault-door --force
```

### Project Management Commands

#### `wkt project <subcommand>`
Manage projects (repositories).

```bash
# List all projects
wkt project list

# Show project details
wkt project info midnights

# Rename project
wkt project rename 1989 paris

# Remove project (and all its workspaces)
wkt project remove folklore --confirm

# Clone new project
wkt project add git@github.com:user/repo.git custom-name

# Set default project
wkt project default midnights
```

### Advanced Commands

#### `wkt sync [workspace] [options]`
Synchronize workspace with upstream.

```bash
# Sync current workspace
wkt sync

# Sync all workspaces in a project
wkt sync --project midnights --all

# Sync with rebase
wkt sync --rebase
```

#### `wkt exec <workspace> <command> [options]` ✅ IMPLEMENTED
Execute commands directly in specific workspaces with safety checks.

```bash
# Execute in specific workspace
wkt exec myproject/feature-auth pnpm build

# Execute in current workspace
wkt exec . "npm test"

# Execute with safety bypass
wkt exec feature-auth pnpm install --force

# Dry run to preview execution
wkt exec main docker-compose up --dry
```

#### `wkt run <script-name> [workspace] [options]` ✅ IMPLEMENTED
Run predefined scripts in workspaces (safer than direct execution).

```bash
# Run script in current workspace
wkt run install-deps

# Run script in specific workspace
wkt run build myproject/main

# List available scripts
wkt run list

# Run with dry-run preview
wkt run setup-database --dry
```

**Security Features**: Command allowlisting, confirmation prompts, workspace path restrictions, timeout limits, and dry-run mode.

### Utility Commands

#### `wkt info [workspace]`
Show detailed workspace information including project context.

```bash
# Current workspace info
wkt info

# Specific workspace info (auto-detects project)
wkt info vault-door
```

Output:
```
Project: midnights
Workspace: feature-vault-door
Branch: feature/vault-door
Path: ~/.wkt/workspaces/midnights/feature-vault-door
Base: main (abc1234)
Created: 2025-07-31 10:30:00
Last Used: 2025-07-31 16:45:00
Status: clean
Commits ahead: 5
Commits behind: 2
```

## Configuration System

### Global Configuration: `~/.wkt/config.yaml`

```yaml
# Global settings
wkt:
  workspace_root: "~/.wkt/workspaces"      # Where all workspaces live
  projects_root: "~/.wkt/projects"         # Where bare repos are stored
  default_project: "midnights"             # Optional default project

# Workspace settings
workspace:
  naming_strategy: "sanitized"             # sanitized, kebab-case, snake_case
  auto_cleanup: true                       # Auto cleanup merged branches
  max_age_days: 30                         # Auto cleanup after N days

# Git settings  
git:
  default_base: "main"                     # Default base branch
  auto_fetch: true                         # Auto fetch before operations
  auto_rebase: false                       # Auto rebase on sync
  push_on_create: false                    # Auto push new branches

# Branch inference patterns (global)
inference:
  patterns:
    - pattern: "^(\\d+)$"                  # 1234 -> feature/eng-1234
      template: "feature/eng-{}"
    - pattern: "^eng-(\\d+)$"              # eng-1234 -> feature/eng-1234  
      template: "feature/{}"
    - pattern: "^(feature/.+)$"            # feature/auth -> feature/auth
      template: "{}"

# Project-specific overrides
projects:
  folklore:
    git:
      default_base: "master"
    inference:
      patterns:
        - pattern: "^song-(\\d+)$"
          template: "feature/song-{}"
  
  midnights:
    workspace:
      auto_cleanup: false

# Aliases
aliases:
  ls: "list"
  sw: "switch"
  rm: "clean"
  m: "create midnights"                   # wkt m 1234
  f: "create folklore"                    # wkt f song-123
```

### Project Configuration: `~/.wkt/projects/<project-name>/config.yaml`
Additional project-specific configuration that overrides global settings.

### Environment Variables

```bash
WKT_WORKSPACE_ROOT    # Override workspace root directory
WKT_CONFIG_FILE       # Custom config file path
WKT_NO_AUTO_FETCH     # Disable auto-fetch
WKT_DEBUG             # Enable debug logging
WKT_DEFAULT_PROJECT   # Override default project
```

## Workspace Organization

```
~/.wkt/
├── config.yaml                           # Global configuration
├── projects/                             # Bare repositories
│   ├── midnights/                       # Bare repo for midnights
│   │   └── .git/
│   ├── folklore/                        # Bare repo for folklore
│   │   └── .git/
│   └── paris/                          # Bare repo for paris
│       └── .git/
└── workspaces/                          # All worktrees
    ├── midnights/
    │   ├── feature-vault-door/
    │   ├── hotfix-tracklist/
    │   └── experiment-3am/
    ├── folklore/
    │   ├── feature-lakes/
    │   └── feature-woods/
    └── paris/
        ├── feature-style/
        └── bugfix-blank-space/
```

## Advanced Features

### 1. Smart Workspace Discovery
When switching workspaces, WKT searches across all projects:
- Exact name match first
- Fuzzy search if no exact match
- If multiple matches, present interactive selection
- Remember recent selections for better predictions

### 2. Project Templates
Pre-configured setups for different project types.

```bash
# Create project-specific template
wkt template create midnights-setup \
  --project midnights \
  --files ".env.local,package-lock.json" \
  --commands "npm install,npm run setup"

# Apply template when creating workspace
wkt create midnights feature/new --template midnights-setup
```

### 3. Cross-Project Operations
Work across multiple projects simultaneously.

```bash
# Sync all feature branches across all projects
wkt sync --filter "feature/*" --all-projects

# Find workspaces across projects
wkt find "auth"  # Lists all workspaces with "auth" across projects

# Execute in all workspaces across specific projects
wkt exec --projects "midnights,folklore" --all npm update
```

### 4. Zsh Completions and Integration

```bash
# Smart completions
wkt switch <TAB>        # Shows all workspaces across projects
wkt create mid<TAB>     # Completes to "midnights"
wkt folklore <TAB>      # Shows branch completion for folklore project

# Quick switch function (add to .zshrc)
function ws() {
    wkt switch "$@"
}

# Project-specific aliases
alias wm="wkt create midnights"
alias wf="wkt create folklore"
alias wp="wkt create paris"
```

## Error Handling & User Experience

### Multi-Project Considerations

1. **Ambiguous Workspace Names**
```
Error: Multiple workspaces found matching 'auth-system'
Found in:
  1. midnights/feature-auth-system
  2. folklore/feature-auth-system
  
Use 'wkt switch auth-system --project midnights' to specify
Or select interactively with 'wkt switch'
```

2. **Project Not Found**
```
Error: No project named 'evermore' found
Did you mean: folklore?

To add a new project: wkt project add <repository-url> evermore
```

3. **Workspace Migration**
When workspaces need to move between projects:
```
wkt workspace migrate feature-song folklore midnights
```

## Implementation Notes

### Key Differences for Multi-Repo Support

1. **Global State Management**
   - Central `~/.wkt` directory for all projects
   - SQLite database for workspace metadata and search indexing
   - Project registry maintaining repo URL to name mappings

2. **Workspace Naming**
   - Workspaces internally tracked as `project/workspace-name`
   - Display names can omit project when unambiguous
   - Search works across all projects by default

3. **Performance Optimizations**
   - Lazy loading of project information
   - Cached workspace listings with filesystem watchers
   - Background indexing for instant search

4. **Zsh-Specific Features**
   - Rich completions using `_wkt` completion function
   - Integration with `cd` via `chpwd` hook
   - Custom prompt segments showing current workspace/project

This specification provides a comprehensive foundation for building a professional-grade CLI tool that elegantly handles multiple repository management while maintaining the simplicity of single-project workflows.