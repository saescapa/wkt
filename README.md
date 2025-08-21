# WKT (Worktree Kit)

A flexible CLI tool for managing multiple project working directories using git worktrees, designed to enable parallel development workflows across multiple repositories.

## Features

- **Multi-repository management** - Handle multiple projects with intelligent discovery
- **Zero-configuration start** - Works immediately with sensible defaults  
- **Workspace isolation** - Each workspace is completely independent
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

# Initialize from current git repo
cd ~/my-project && wkt init

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

### `wkt clean`
Clean up workspaces (defaults to merged branches only).

```bash
# Clean merged workspaces (default behavior)
wkt clean

# Clean all workspaces (bypass merged filter)
wkt clean --all

# Clean specific project
wkt clean --project myproject

# Remove workspaces older than 30 days
wkt clean --older-than 30d

# Combine filters: merged branches older than 2 weeks
wkt clean --merged --older-than 2w

# Force remove specific workspace without confirmation
wkt clean feature-auth --force

# Force clean all without confirmation
wkt clean --all --force
```

**Safety Features:**
- **Merged branches only**: By default, only cleans branches merged into main/master
- **Main branch protection**: Never cleans main/master workspaces (contain shared files)
- **Confirmation prompts**: Shows what will be cleaned and asks for confirmation
- **Multiple filters**: Combine `--merged`, `--older-than`, and `--project` options

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
- Workspace switching (`wkt switch`) 
- Workspace listing (`wkt list`)
- **Smart cleanup command (`wkt clean`)** - Defaults to merged branches only, with age filters and confirmation prompts
- Sync command (`wkt sync`)
- Configuration management (`wkt config`)
- Branch name inference
- Interactive selection with fuzzy search
- **Local files management** - Symlinked shared files and workspace-specific copies

### 💭 Future Ideas
- Status command (`wkt status`) - show git status across workspaces
- Project management (`wkt project`) - manage multiple projects
- Execute in workspace (`wkt exec`) - run commands in specific workspaces
- Zsh completions
- Workspace templates
- SQLite database (currently using JSON)

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