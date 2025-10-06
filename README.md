# WKT (Worktree Kit)

A flexible CLI tool for managing multiple project working directories using git worktrees, designed to enable parallel development workflows across multiple repositories.

## Features

- **Multi-repository management** - Handle multiple projects with intelligent discovery
- **Zero-configuration start** - Works immediately with sensible defaults
- **Workspace isolation** - Each workspace is completely independent
- **🆕 Project templates** - Apply reusable configurations across projects
- **🆕 Smart workspace detection** - Automatically detects current workspace from directory path
- **🆕 Interactive script selection** - Choose scripts from a beautiful menu interface
- **🆕 Hierarchical configuration** - Global, project, and workspace-level script configurations
- **Smart automation** - Branch name inference, auto-cleanup, conflict prevention
- **Rich CLI experience** - Interactive selection, fuzzy search, colored output

## Installation

```bash
# Clone and build
git clone <this-repo>
cd wkt
bun install
bun run build

# Make globally available (optional)
npm link
```

## Quick Start

```bash
# Initialize a project
wkt init git@github.com:user/repo.git myproject

# Create a workspace
wkt create myproject feature/awesome-feature

# List workspaces
wkt list

# Switch between workspaces  
wkt switch feature-awesome-feature

# Switch interactively
wkt switch

# Shell integration - automatically cd to workspace
cd "$(wkt switch feature-awesome-feature --path-only)"
```

## Core Commands

### `wkt init [repository-url] [project-name]`
Initialize WKT with a repository.

```bash
# Initialize with URL
wkt init git@github.com:user/repo.git myproject

# Initialize with a project template
wkt init git@github.com:user/repo.git myproject --template dev

# Initialize from current git repo
cd ~/my-project && wkt init

# Apply template to existing project
wkt init --apply-template paris dev

# Apply template interactively
wkt init --apply-template

# List all projects
wkt init --list
```

### `wkt create <project> <branch-name>`
Create a new workspace.

```bash
# Basic creation
wkt create myproject feature/auth-system

# With branch inference (1234 → feature/eng-1234)
wkt create myproject 1234

# From specific base branch
wkt create myproject hotfix/bug --from develop

# Custom workspace name
wkt create myproject feature/auth --name auth-system
```

### `wkt switch [workspace]`
Switch to an existing workspace.

```bash
# Switch by name (searches all projects)
wkt switch auth-system

# Interactive selection
wkt switch

# Switch to last workspace
wkt switch -

# Fuzzy search
wkt switch auth --search

# Output only the path (for shell integration)
wkt switch auth-system --path-only
```

### `wkt list`
List all workspaces.

```bash
# List all (grouped by project)
wkt list

# List specific project
wkt list --project myproject

# Show detailed info
wkt list --details

# Filter by pattern
wkt list --filter "feature/*"
```

### `wkt recycle <new-branch-name>`
Recycle current workspace to a new branch while preserving all files (including node_modules, build artifacts, etc.).

```bash
# Recycle to new feature branch, rebase from latest main
wkt recycle feature/new-auth

# Recycle without rebasing (just switch branches, keep files)
wkt recycle feature/quick-test --no-rebase

# Recycle from specific base branch
wkt recycle hotfix/critical --from develop

# Custom workspace name
wkt recycle feature/ui-redesign --name ui-redesign

# Force recycle even with uncommitted changes
wkt recycle feature/experiment --force
```

**Benefits:**
- **Preserve dependencies** - Keep node_modules, vendor/, etc.
- **Keep build artifacts** - Preserve dist/, build/, compiled files
- **Maintain local config** - Keep .env.local and other workspace-specific files
- **Stay in same directory** - No need to switch paths or reinstall
- **Optional sync** - Pull and rebase from latest main before starting

### `wkt clean`
Clean up workspaces with interactive selection (defaults to merged branches only).

```bash
# Clean merged workspaces with interactive selection (default behavior)
wkt clean

# Clean all workspaces with interactive selection (bypass merged filter)
wkt clean --all

# Clean specific project with interactive selection
wkt clean --project myproject

# Remove workspaces older than 30 days with interactive selection
wkt clean --older-than 30d

# Combine filters: merged branches older than 2 weeks
wkt clean --merged --older-than 2w

# Force clean (overrides safety checks) with interactive selection
wkt clean --force

# Force remove specific workspace (overrides safety checks)
wkt clean feature-auth --force
```

### `wkt exec`
Execute commands directly in workspaces with safety checks.

```bash
# Execute command in specific workspace
wkt exec myproject/feature-auth pnpm build

# Execute in current workspace
wkt exec . "npm test"

# Execute with confirmation bypass
wkt exec feature-auth pnpm install --force

# Dry run to see what would be executed
wkt exec main docker-compose up --dry

# Execute with custom timeout (in milliseconds)
wkt exec feature-auth "npm run build" --timeout 300000
```

### `wkt run`
Run predefined scripts in workspaces (safer than direct execution).

```bash
# Interactive script selection - shows all available scripts
wkt run

# Run script in current workspace
wkt run install-deps

# Run script in specific workspace
wkt run build myproject/main

# List all available scripts
wkt run list

# Run with dry-run mode
wkt run setup-database --dry

# Run workspace-specific script
wkt run dev-server  # Only available for feature/* branches

# Use script shortcuts
wkt run i           # Shortcut for "install-deps"
```

**🆕 Interactive Script Selection:**
- **Smart detection**: Automatically detects workspace from current directory
- **Interactive menu**: Run `wkt run` without arguments to see available scripts
- **Multi-source scripts**: Combines global, project, and workspace-specific scripts
- **Clear descriptions**: Shows script descriptions and sources for easy selection

**Interactive Selection:**
- **Checkbox interface**: Select/deselect workspaces with spacebar, confirm with enter
- **All checked by default**: All eligible workspaces are pre-selected for convenience
- **Visual indicators**: ⚠️ for protected workspaces (main branches), • for regular workspaces
- **Always available**: Interactive selection shown for both normal and `--force` modes

**Safety Features:**
- **Enhanced merge detection**: Detects GitHub-style squash merges and PR-based merges
- **Local branch protection**: Never cleans local-only branches that were never pushed
- **Main branch protection**: Never cleans main/master workspaces (contain shared files) unless forced
- **Multiple filters**: Combine `--merged`, `--older-than`, and `--project` options
- **Force override**: Use `--force` to clean protected workspaces (still shows interactive selection)

**Duration formats**: `30d` (days), `2w` (weeks), `6m` (months), `1y` (years)

## Configuration

WKT stores configuration in `~/.wkt/config.yaml` and workspace metadata in `~/.wkt/database.json`.

Default directory structure:
```
~/.wkt/
├── config.yaml           # Global configuration
├── database.json         # Workspace metadata
├── projects/             # Bare repositories
│   ├── myproject/
│   └── other-project/
└── workspaces/           # All worktrees
    ├── myproject/
    │   ├── feature-auth/
    │   └── bugfix-login/
    └── other-project/
        └── feature-docs/
```

### Project Templates

**🆕 Reusable Project Templates** - Define templates to apply consistent configurations across multiple projects.

Project templates allow you to define reusable configurations that can be applied to projects during initialization or later. This is particularly useful for applying the same local files, scripts, and git settings across multiple development projects.

**Defining Templates:**

Add templates to `~/.wkt/config.yaml`:

```yaml
project_templates:
  dev:
    local_files:
      shared:
        - "docs.local"      # Shared documentation
        - "prompts.local"   # AI prompts
        - "rfc.local"       # RFCs and design docs
      copied:
        - ".env.local"
    git:
      auto_fetch: true
      push_on_create: false

  production:
    local_files:
      shared:
        - "SECURITY.md"
        - ".incident-response"
    git:
      auto_fetch: true
      auto_rebase: false
```

**Using Templates:**

```bash
# Apply during project initialization
wkt init git@github.com:user/repo.git myproject --template dev

# Apply to existing project
wkt init --apply-template myproject dev

# Interactive template selection
wkt init --apply-template

# Interactive during init (if templates are configured)
wkt init git@github.com:user/repo.git myproject
# → Prompts: "Would you like to apply a project template?"
```

**Benefits:**
- **Consistency**: Same configuration across all dev projects
- **Quick setup**: Apply comprehensive configs with one command
- **Retroactive**: Apply templates to existing projects
- **Flexible**: Different templates for different project types

### Script Configuration

WKT supports secure script execution through `.wkt.yaml` configuration files. Scripts are predefined, use command allowlisting, and require confirmation before execution.

**🆕 Configuration Hierarchy:**
- **Global**: `~/.wkt/config.yaml` - Available across all projects
- **Project**: `~/.wkt/config.yaml` projects section - Project-specific scripts
- **Workspace**: `.wkt.yaml` in workspace directory - Workspace-specific scripts
- **Priority**: Workspace → Project → Global (higher priority configs override lower ones)

#### Basic Script Configuration

```yaml
scripts:
  # Security: Only these commands are allowed
  allowed_commands:
    - "pnpm"
    - "npm"
    - "docker"
    - "planetscale"
    - "./scripts/"    # Local scripts only

  # Predefined scripts (safer than arbitrary commands)
  scripts:
    install-deps:
      name: "Install Dependencies"
      command: ["pnpm", "install"]
      description: "Install npm dependencies"
      conditions:
        file_exists: ["package.json"]
      timeout: 300000  # 5 minutes
      
    create-db-branch:
      name: "Create Database Branch"
      command: ["pscale", "branch", "create", "{{project_name}}", "{{branch_name}}"]
      description: "Create PlanetScale database branch"
      conditions:
        file_exists: [".env.local"]
      optional: true    # Won't fail workspace creation

  # Scripts that run automatically
  hooks:
    post_create:
      - script: "install-deps"
      - script: "create-db-branch"
        variables:
          branch_name: "{{workspace_name}}"

  # Convenient shortcuts
  shortcuts:
    i: "install-deps"
    db: "create-db-branch"
```

#### Advanced Features

**Workspace-Specific Scripts**: Different scripts based on branch patterns
```yaml
workspace_scripts:
  "feature/*":
    scripts:
      dev-server:
        command: ["pnpm", "run", "dev"]
        background: true
  "*staging*":
    post_create:
      - script: "setup-staging-env"
```

**Template Variables**: Dynamic values in script commands
- `{{workspace_name}}` - Current workspace name
- `{{branch_name}}` - Current branch name  
- `{{project_name}}` - Current project name
- `{{workspace_path}}` - Workspace directory path

**Security Features**:
- Command allowlisting prevents unauthorized execution
- Confirmation prompts for all script execution (bypass with `--force`)
- Workspace path restrictions prevent directory traversal
- Timeout limits prevent runaway processes
- Dry-run mode shows what would be executed (`--dry`)

See [`.wkt.yaml.example`](.wkt.yaml.example) for comprehensive configuration examples.

## Branch Inference

WKT can automatically infer branch names from patterns:

- `1234` → `feature/eng-1234`
- `eng-1234` → `feature/eng-1234` 
- `feature/auth` → `feature/auth`

Configure custom patterns in `~/.wkt/config.yaml`.

## Local Files Management

WKT automatically manages local development files across workspaces, enabling seamless sharing of configuration and context while preserving workspace-specific customizations.

### Features

- **Shared Files**: Symlinked across all workspaces (e.g., `CLAUDE.md`, `.cursor/rules`)
- **Workspace-Specific Files**: Copied from templates for per-workspace customization (e.g., `.env.local`)
- **Environment-Specific Templates**: Different templates based on workspace/branch patterns
- **Template Variables**: Dynamic variable substitution in template files
- **Conditional Templates**: Templates with branch/workspace matching conditions
- **Automatic Setup**: Files are configured during workspace creation
- **Smart Main Detection**: Automatically finds your main worktree as the source

### Configuration

Add to your `~/.wkt/config.yaml`:

```yaml
local_files:
  shared:                           # Files symlinked to main worktree
    - "CLAUDE.md"                  # AI context shared across workspaces
    - ".cursor/rules"              # Editor rules
    - "docs/development.md"        # Shared documentation
  
  copied:                          # Files copied from templates
    - ".env.local"                 # Environment variables
    - ".vscode/launch.json"        # Debug configurations
  
  templates:                       # Template mappings
    ".env.local": ".env.local.example"
    ".vscode/launch.json": ".vscode/launch.json.template"
```

Or configure per-project by adding `.wkt.yaml` to your project root:

```yaml
local_files:
  shared: ["CLAUDE.md", "README-dev.md"]
  copied: [".env.local"]
  templates:
    ".env.local": ".env.local.example"
  
  # Workspace-specific templates for different environments
  workspace_templates:
    "*staging*":                          # Any workspace with "staging" in name
      ".env.local": ".env.staging.example"
    "feature/*":                          # Feature branches
      ".env.local":
        source: ".env.dev.example"
        variables:
          debug_mode: "true"
          feature_flag: "{{workspace_name}}"
```

> See [`.wkt.yaml.example`](.wkt.yaml.example) for a complete configuration example with advanced workspace templates.

### Workflow

1. **Create main workspace**: `wkt create myproject main` 
2. **Add shared files**: Create `CLAUDE.md`, `.cursor/rules` in main workspace
3. **Create feature workspace**: `wkt create myproject feature-auth`
   - Shared files are automatically symlinked
   - Template files are copied for workspace-specific use

4. **Update shared context**: Edit `CLAUDE.md` in any workspace → all workspaces see changes
5. **Workspace-specific config**: Edit `.env.local` in each workspace independently

### Example Structure

```
~/.wkt/workspaces/myproject/
├── main/
│   ├── CLAUDE.md                 # Original file
│   ├── .cursor/rules            # Original file  
│   └── .env.local               # Workspace-specific
└── feature-auth/
    ├── CLAUDE.md -> ../main/CLAUDE.md        # Symlinked
    ├── .cursor/rules -> ../main/.cursor/rules # Symlinked
    └── .env.local               # Independent copy
```

### Workspace-Specific Templates

WKT supports environment-specific configurations by allowing different templates based on workspace or branch patterns:

#### Pattern Matching
- `"staging"` - Exact workspace name match
- `"*staging*"` - Workspace name contains "staging"
- `"feature/*"` - Branch pattern matching
- `"*prod*"` - Any workspace containing "prod"

#### Template Configuration Options

**Simple Template Path:**
```yaml
workspace_templates:
  "*staging*":
    ".env.local": ".env.staging.example"
```

**Advanced Template Config:**
```yaml
workspace_templates:
  "feature/*":
    ".env.local":
      source: ".env.dev.example"                # Template file
      variables:                                 # Variable substitution
        debug_mode: "true"
        feature_flag: "{{workspace_name}}"      # Built-in variables
      conditions:                               # Additional conditions
        branch_pattern: "^feature/.*"
        environment: "development"
```

**Built-in Variables:**
- `{{workspace_name}}` - Current workspace name
- `{{branch_name}}` - Current branch name
- Custom variables defined in the `variables` section

#### Real-World Example

```yaml
local_files:
  copied: [".env.local", "docker-compose.override.yml"]
  workspace_templates:
    # Development workspaces
    "feature/*":
      ".env.local":
        source: ".env.dev.example"
        variables:
          DATABASE_URL: "postgresql://localhost:5432/myapp_dev"
          DEBUG: "true"
    
    # Staging workspaces
    "*staging*":
      ".env.local": ".env.staging.example"
      "docker-compose.override.yml":
        source: "docker-compose.staging.yml"
        variables:
          API_URL: "https://api-staging.mycompany.com"
    
    # Production-like workspaces
    "hotfix/*":
      ".env.local":
        source: ".env.prod.example"
        conditions:
          branch_pattern: "^(hotfix|release)/.*"
        variables:
          DATABASE_URL: "postgresql://prod-replica.mycompany.com:5432/myapp"
          DEBUG: "false"
```

## Development Status

### ✅ Implemented
- Project initialization (`wkt init`)
- Workspace creation (`wkt create`)
- **🆕 Workspace recycling (`wkt recycle`)** - Reuse workspace for new branch, preserving all files and dependencies
- Workspace switching (`wkt switch`)
- Workspace listing (`wkt list`)
- **Interactive cleanup command (`wkt clean`)** - Enhanced merge detection, interactive selection, and local branch protection
- **Smart workspace detection** - Automatic workspace detection from current directory path
- **Interactive script selection (`wkt run`)** - Beautiful menu interface for script selection
- **Hierarchical script configuration** - Global, project, and workspace-level `.wkt.yaml` support
- **Script execution (`wkt exec` / `wkt run`)** - Secure command execution with allowlisting, confirmation, and hooks
- **Post-creation automation** - Automatic script execution after workspace creation
- Sync command (`wkt sync`)
- Configuration management (`wkt config`)
- Branch name inference
- Interactive selection with fuzzy search
- **Local files management** - Symlinked shared files and workspace-specific copies

### 💭 Future Ideas
- Status command (`wkt status`) - show git status across workspaces
- Project management (`wkt project`) - manage multiple projects
- Zsh completions
- Workspace templates
- SQLite database (currently using JSON)
- Pre/post switch hooks
- Script scheduling and background job management

## Testing

WKT includes comprehensive automated tests:

```bash
# Run all working tests
bun test test/unit/branch-inference.test.ts test/e2e/basic-workflow.test.ts

# Run specific test suites
bun run test:unit          # Unit tests
bun run test:e2e          # End-to-end tests
bun run test:watch        # Watch mode
```

**Test Coverage:**
- ✅ **31 tests passing** - Branch inference, CLI behavior, error handling
- ⚠️ **Integration tests** - Some need better test isolation (functionality works)
- 🔄 **Continuous Integration** - GitHub Actions for all PRs

See [TESTING.md](TESTING.md) for detailed testing information.

## Architecture

- **TypeScript** with Bun for development
- **Commander.js** for CLI framework
- **Inquirer** for interactive prompts
- **Fuse.js** for fuzzy search
- **Chalk** for colored output
- **YAML** for configuration
- **Git worktrees** for workspace isolation

Built with modern Node.js practices, comprehensive testing, and designed for extensibility.

## Shell Integration

WKT includes a `--path-only` option that outputs just the workspace path, making it easy to integrate with shell functions for automatic directory changes.

### Basic Usage

```bash
# Switch and cd in one command
cd "$(wkt switch workspace-name --path-only)"

# Interactive switch with cd
cd "$(wkt switch --path-only)"
```

### Shell Functions

Add these to your `.bashrc`, `.zshrc`, or equivalent:

```bash
# Switch to workspace and cd automatically
function wkts() {
    local path=$(wkt switch "$@" --path-only)
    if [ $? -eq 0 ] && [ -n "$path" ]; then
        cd "$path"
    fi
}

# Interactive workspace switch with cd
function wkti() {
    local path=$(wkt switch --path-only)
    if [ $? -eq 0 ] && [ -n "$path" ]; then
        cd "$path"
    fi
}

# Quick switch to last workspace
function wktl() {
    local path=$(wkt switch - --path-only)
    if [ $? -eq 0 ] && [ -n "$path" ]; then
        cd "$path"
    fi
}
```

### Usage Examples

```bash
# Switch and cd to workspace
wkts feature-auth

# Interactive switch with cd
wkti

# Switch to last workspace with cd  
wktl

# Fuzzy search switch with cd
wkts auth --search
```

### Advanced Shell Integration

For more sophisticated workflows, you can create aliases that combine multiple operations:

```bash
# Switch workspace and run common setup
function wktdev() {
    local path=$(wkt switch "$@" --path-only)
    if [ $? -eq 0 ] && [ -n "$path" ]; then
        cd "$path"
        echo "Switched to workspace: $(basename "$path")"
        
        # Optional: run common development commands
        if [ -f "package.json" ]; then
            echo "📦 Node.js project detected"
        fi
        
        git status --short
    fi
}
```