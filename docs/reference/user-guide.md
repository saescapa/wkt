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

Initialize WKT with a repository. Automatically creates a main workspace so you can start working immediately.

```bash
# Interactive mode (prompts for repository URL)
wkt init

# From a remote repository
wkt init git@github.com:user/repo.git [project-name]

# From current directory (if it's a git repo)
wkt init

# List all managed projects
wkt init --list

# Apply a template to existing project
wkt init project-name --apply-template --template my-template
```

**What happens:**
1. Clones the repository as a bare repo to `~/.wkt/projects/`
2. Creates the main workspace in `~/.wkt/workspaces/<project>/main`
3. Runs post-creation hooks (if configured)

**Interactive Mode:**

When run without arguments and not in a git repository, prompts for the repository URL interactively.

**Options:**
- `-l, --list` - List all managed projects
- `-t, --template <name>` - Apply a project template
- `--apply-template` - Apply template to existing project

### `wkt create`

Create a new workspace.

```bash
wkt create [project] [branch-name] [options]
```

**Examples:**

```bash
# Interactive mode (prompts for project and branch)
wkt create

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
- `--pool` - Show only pooled and claimed workspaces
- `--group-by <field>` - Group results (default: project)
- `-a, --all` - Include inactive main branches

**Output Format:**

```
myproject/
  main:
    ├─ ● main                  active - just now
    ├─ ○ feat-auth             branched - 3d ago
    └─ ◇ wksp-1                claimed - 2h ago
```

**Icons:**
- `●` Active workspace (current)
- `○` Branched workspace
- `◇` Claimed or pooled workspace
- `◐` Has uncommitted changes (overrides mode icon)
- `✗` Has conflicts (overrides mode icon)

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

---

## Pool Commands

Pool workspaces allow quick, temporary work without creating permanent branches.

### `wkt claim`

Claim a workspace from the pool for temporary work.

```bash
wkt claim [project] [options]
```

**Examples:**

```bash
# Claim from default project
wkt claim

# Claim from specific project
wkt claim my-project

# Track a specific branch
wkt claim my-project --from develop
```

**Options:**
- `--from <branch>` - Track a specific branch (default: project's default branch)

### `wkt release`

Release a workspace back to the pool.

```bash
wkt release [options]
```

**Examples:**

```bash
# Release current workspace
wkt release

# Force release with uncommitted changes
wkt release --force
```

**Options:**
- `--force` - Force release even with uncommitted changes

### `wkt save`

Save changes from a claimed workspace. Can create a branch, stash changes, discard changes, or push commits to remote.

```bash
wkt save [options]
```

**Examples:**

```bash
# Interactive mode (prompts for action)
wkt save

# Create a branch from changes
wkt save --branch feature/my-feature

# Stash uncommitted changes
wkt save --stash

# Discard uncommitted changes
wkt save --discard

# Push commits to remote without confirmation
wkt save --push
```

**Options:**
- `--branch <name>` - Create a branch from changes
- `--stash` - Stash uncommitted changes
- `--discard` - Discard uncommitted changes
- `--push` - Push commits to remote without confirmation

**Behavior:**

1. **Uncommitted changes**: If you have uncommitted changes, save prompts to:
   - Create a branch
   - Stash changes
   - Discard changes

2. **Commits ahead**: If you have commits ahead of the remote tracking branch, save prompts to push them directly to remote.

3. **--push flag**: Pushes commits to `origin/<tracking-branch>` (e.g., `origin/main`) without confirmation. Requires no uncommitted changes.

---

### `wkt rename`

Rename current workspace.

```bash
wkt rename [new-name] [options]
```

**Examples:**

```bash
# Interactive mode (prompts for new name)
wkt rename

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
# Interactive script selection (autocomplete with fuzzy search)
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

**Interactive Mode:**

When run without arguments, shows an autocomplete prompt:
- Type to filter scripts with fuzzy matching
- Scripts grouped by location (Scripts, Workspace, Shortcuts)
- Arrow keys to navigate, Enter to select

**Options:**
- `-s, --search <query>` - Filter scripts by fuzzy search
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
