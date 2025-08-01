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

## Development Status

### ✅ Implemented
- Project initialization (`wkt init`)
- Workspace creation (`wkt create`)
- Workspace switching (`wkt switch`) 
- Workspace listing (`wkt list`)
- Branch name inference
- Configuration management
- Interactive selection with fuzzy search

### 🚧 Planned
- Status command (`wkt status`)
- Cleanup command (`wkt clean`)
- Project management (`wkt project`)
- Sync command (`wkt sync`)
- Execute in workspace (`wkt exec`)
- Zsh completions
- Workspace templates
- SQLite database (currently using JSON)

## Architecture

- **TypeScript** with Bun for development
- **Commander.js** for CLI framework
- **Inquirer** for interactive prompts
- **Fuse.js** for fuzzy search
- **Chalk** for colored output
- **YAML** for configuration
- **Git worktrees** for workspace isolation

Built with modern Node.js practices and designed for extensibility.