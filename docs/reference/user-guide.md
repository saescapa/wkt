# WKT User Guide

Complete guide to using WKT for workspace management.

## Installation

### From Source

```bash
git clone https://github.com/user/wkt.git
cd wkt
bun install
bun run build
npm link
```

### Requirements

- Node.js >= 20.0.0
- Git
- Bun (for building from source)

## Quick Start

```bash
# Initialize a project from a repository
wkt init git@github.com:user/my-project.git

# Create a workspace for a feature branch
wkt create my-project feature/new-feature

# Switch to the workspace
wkt switch new-feature

# List all workspaces
wkt list

# Clean up merged branches
wkt clean
```

## Core Concepts

### Projects

A project is a git repository managed by WKT. Projects are stored as bare repositories in `~/.wkt/projects/` with workspaces in `~/.wkt/workspaces/`.

### Workspaces

A workspace is a git worktree - an isolated working directory with its own branch. Multiple workspaces can exist for the same project, allowing parallel development.

### Local Files

Files that should be shared or templated across workspaces:
- **Shared files** - Symlinked from the main workspace (e.g., `.cursor/rules`)
- **Copied files** - Templated per workspace (e.g., `.env.local`)

---

## Commands

### `wkt init`

Initialize WKT with a repository.

```bash
# From a remote repository
wkt init git@github.com:user/repo.git [project-name]

# From current directory (if it's a git repo)
wkt init

# List all managed projects
wkt init --list

# Apply a template to existing project
wkt init project-name --apply-template --template my-template
```

**Options:**
- `-l, --list` - List all managed projects
- `-t, --template <name>` - Apply a project template
- `--apply-template` - Apply template to existing project

### `wkt create`

Create a new workspace.

```bash
wkt create <project> <branch-name> [options]
```

**Examples:**

```bash
# Basic creation
wkt create my-project feature/auth

# From specific base branch
wkt create my-project hotfix/bug --from develop

# With custom workspace directory name
wkt create my-project feature/auth --name auth-system

# With description
wkt create my-project feature/auth --description "User authentication system"
```

**Options:**
- `--from <branch>` - Base branch (default: main)
- `--name <name>` - Custom workspace directory name
- `--description <text>` - Workspace description
- `--template <template>` - Apply workspace template
- `--no-checkout` - Create but don't checkout
- `--force` - Overwrite existing workspace

**Branch Inference:**

WKT can infer full branch names from short inputs based on configured patterns:
- `1234` → `feature/eng-1234`
- `eng-1234` → `feature/eng-1234`
- `auth` → `feature/auth`

### `wkt switch`

Switch to an existing workspace.

```bash
wkt switch [workspace] [options]
```

**Examples:**

```bash
# Interactive selection
wkt switch

# Direct switch
wkt switch auth-system

# Fuzzy search
wkt switch -s auth

# Limit to specific project
wkt switch auth -p my-project

# Output path only (for shell integration)
wkt switch auth --path-only
```

**Options:**
- `-s, --search` - Enable fuzzy search mode
- `-p, --project <name>` - Limit to specific project
- `--create` - Create workspace if it doesn't exist
- `--path-only` - Output only the path (for shell integration)

### `wkt list`

List all workspaces. Also available as `wkt ls`.

```bash
wkt list [options]
```

**Examples:**

```bash
# List all workspaces
wkt list

# With details
wkt list --details

# Filter by project
wkt list -p my-project

# Show only dirty workspaces
wkt list --dirty

# Show stale workspaces (older than 30 days)
wkt list --stale 30d

# Include inactive main branches
wkt list --all
```

**Options:**
- `-p, --project <name>` - Filter by project
- `-d, --details` - Show detailed information
- `--filter <pattern>` - Filter by pattern
- `--dirty` - Show only workspaces with uncommitted changes
- `--stale <duration>` - Show workspaces older than duration
- `--group-by <field>` - Group results (default: project)
- `-a, --all` - Include inactive main branches

**Duration Format:**

- `30d` - 30 days
- `2w` - 2 weeks
- `6m` - 6 months
- `1y` - 1 year

### `wkt clean`

Remove workspaces.

```bash
wkt clean [workspace] [options]
```

**Examples:**

```bash
# Interactive cleanup of merged branches
wkt clean

# Clean specific workspace
wkt clean auth-system

# Clean merged branches in specific project
wkt clean -p my-project --merged

# Clean workspaces older than 30 days
wkt clean --older-than 30d

# Force without confirmation
wkt clean auth-system --force
```

**Options:**
- `-p, --project <name>` - Clean specific project
- `--merged` - Remove merged workspaces (default)
- `--older-than <duration>` - Remove stale workspaces
- `--force` - Skip confirmation
- `--all` - Clean all (overrides --merged)

### `wkt rename`

Rename current workspace.

```bash
wkt rename <new-name> [options]
```

**Examples:**

```bash
# Rename with new branch (rebased from main)
wkt rename feature/new-name

# Simple rename without rebasing
wkt rename feature/new-name --no-rebase

# Rename from specific base branch
wkt rename feature/new-name --from develop

# Update description
wkt rename feature/new-name --description "Updated feature"
```

**Options:**
- `--from <branch>` - Base branch for rebase
- `--no-rebase` - Rename in-place without creating new branch
- `--name <name>` - Custom directory name
- `--description <text>` - Update description
- `--force` - Force rename even if dirty

### `wkt info`

Show current workspace information.

```bash
wkt info [options]
```

**Examples:**

```bash
# Full information
wkt info

# Output only description
wkt info --description-only

# Output as JSON
wkt info --json

# Set description
wkt info --set-description "Working on auth"
```

**Options:**
- `--description-only` - Output only description
- `--branch-only` - Output only branch name
- `--name-only` - Output only workspace name
- `--json` - Output as JSON
- `-d, --set-description [text]` - Set or update description

### `wkt run`

Execute predefined scripts.

```bash
wkt run [script-name] [workspace] [options]
```

**Examples:**

```bash
# Interactive script selection
wkt run

# Run specific script
wkt run install-deps

# Run in specific workspace
wkt run build my-project/feature-auth

# Dry run
wkt run setup --dry

# List available scripts
wkt run list
```

**Options:**
- `--force` - Skip confirmation
- `--dry` - Show what would run
- `--timeout <ms>` - Script timeout

### `wkt sync`

Sync local files to workspaces.

```bash
wkt sync [options]
```

**Examples:**

```bash
# Sync all workspaces (with confirmation)
wkt sync

# Sync specific project
wkt sync --project my-project

# Sync specific workspace
wkt sync --workspace feature-auth

# Sync all without confirmation
wkt sync --all

# Dry run
wkt sync --dry
```

**Options:**
- `--project <name>` - Sync specific project
- `--workspace <name>` - Sync specific workspace
- `--all` - Sync all without confirmation
- `--force` - Skip confirmation
- `--dry` - Show what would be synced

### `wkt config`

Manage configuration.

```bash
wkt config [subcommand] [options]
```

**Subcommands:**
- `show` - Display configuration (default)
- `edit` - Open in editor
- `open` - Open config directory
- `path` - Show config file path
- `debug` - Show debug information

**Options:**
- `--project <name>` - Work with project-specific config
- `--global` - Work with global config (default)

---

## Shell Integration

### Zsh/Bash Function

Add to your `.zshrc` or `.bashrc`:

```bash
# Switch and cd to workspace
wkts() {
  local path=$(wkt switch "$@" --path-only)
  [ $? -eq 0 ] && [ -n "$path" ] && cd "$path"
}

# Create and cd to workspace
wktc() {
  local path=$(wkt create "$@" --path-only 2>/dev/null)
  [ $? -eq 0 ] && [ -n "$path" ] && cd "$path"
}
```

### Prompt Integration

Show current workspace in your prompt:

```bash
# Get current workspace info
wkt_prompt() {
  local info=$(wkt info --name-only 2>/dev/null)
  [ -n "$info" ] && echo "[$info]"
}

# Add to PS1
PS1='$(wkt_prompt) %~ $ '
```

---

## Lifecycle Hooks

WKT can run scripts automatically at workspace lifecycle events.

### Available Hooks

- `post_create` - After workspace creation
- `pre_switch` - Before switching away from workspace
- `post_switch` - After switching to workspace
- `pre_clean` - Before workspace removal
- `post_clean` - After workspace removal

### Configuration

In `.wkt.yaml` or `~/.wkt/config.yaml`:

```yaml
scripts:
  # Commands allowed to execute (security allowlist)
  allowed_commands:
    - "pnpm"
    - "npm"

  # Script definitions
  scripts:
    install-deps:
      name: "Install Dependencies"
      command: ["pnpm", "install"]
      conditions:
        file_exists: ["package.json"]

  # Lifecycle hooks
  hooks:
    post_create:
      - script: "install-deps"
    post_switch:
      - script: "install-deps"
        optional: true
```

See [Configuration Reference](configuration.md) for full details.

---

## Git Workflows

### Working with Multiple Branches

```bash
# Create workspaces for parallel work
wkt create my-project feature/auth
wkt create my-project feature/dashboard

# Work on auth
cd ~/.wkt/workspaces/my-project/feature-auth
# make changes...

# Switch to dashboard (no stash needed!)
cd ~/.wkt/workspaces/my-project/feature-dashboard
# auth changes are safe in their directory
```

### Rebasing

```bash
cd ~/.wkt/workspaces/my-project/feature-auth
git fetch origin
git rebase origin/main
git push origin feature/auth --force-with-lease
```

### Main Branch Protection

Main workspaces are protected because they contain shared files that other workspaces symlink to.

```bash
# This will warn
wkt clean main

# Force if needed (breaks symlinks in other workspaces)
wkt clean main --force
```

---

## Troubleshooting

### Debug Mode

Enable debug logging to diagnose issues:

```bash
# Via command-line flag
wkt --debug <command>

# Via environment variable
WKT_DEBUG=1 wkt <command>
```

Debug mode shows:
- Git commands being executed
- Network retry attempts
- Silent fallback operations
- Migration status

### Broken Symlinks

If shared files show as broken symlinks:

```bash
# Recreate main workspace
wkt create my-project main

# Resync all workspaces
wkt sync --all --project my-project
```

### Repository Locked

If git operations fail with lock errors:

```bash
rm ~/.wkt/projects/my-project/.git/index.lock
```

### Workspace Out of Sync

```bash
cd ~/.wkt/workspaces/my-project/feature-auth
git fetch origin
git status
```

### Network Issues

WKT automatically retries network operations (clone, fetch, push) up to 3 times with exponential backoff. If you see retry messages:

```bash
# Check network connectivity
git ls-remote origin

# Force a fresh fetch
cd ~/.wkt/projects/my-project
git fetch --all
```
