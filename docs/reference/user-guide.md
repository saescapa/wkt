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

### Shared Directory

Each project gets a directory at `~/.wkt/shared/<project>/` that is auto-created on `wkt init`. Every top-level entry inside it is symlinked into each new workspace. Use it for files that should be shared but never committed: `docs.local/`, `.env`, editor configs, agent instructions, etc.

The directory itself can be its own git repo (or git submodule) if you want to version-control its contents independently.

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
3. Creates the shared directory at `~/.wkt/shared/<project>/`
4. Symlinks any existing entries from the shared directory into the main workspace

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
- `--group-by <field>` - Group results (default: project)
- `-a, --all` - Include inactive main branches

**Output Format:**

```
myproject/
  main:
    ├─ ● main                  active - just now
    └─ ○ feat-auth             - 3d ago
```

**Icons:**
- `●` Active workspace (current)
- `○` Workspace
- `◐` Has uncommitted changes
- `✗` Has conflicts

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
- `--no-fetch` - Skip fetching remote refs before merge detection

### `wkt merge`

Merge a workspace branch into the target branch locally.

```bash
wkt merge [workspace] [options]
```

**Examples:**

```bash
# Merge current workspace into main (run from a feature workspace)
wkt merge

# Merge specific workspace into main
wkt merge auth-system

# Squash merge into a single commit
wkt merge auth-system --squash

# Merge and clean up the workspace afterwards
wkt merge auth-system --clean

# Merge into a different target branch
wkt merge auth-system --into develop

# Merge main into a feature branch (run from main workspace)
wkt merge --into feat/bot-prevention
```

**Options:**
- `--squash` - Squash all commits into a single merge commit
- `--into <branch>` - Target branch (default: project default branch)
- `--clean` - Remove the source workspace after a successful merge
- `-p, --project <name>` - Specify project (for disambiguation)
- `--force` - Merge even if source has uncommitted changes

**Behavior:**
- From a **feature workspace**: auto-selects the current workspace as the merge source
- From the **main workspace** with `--into`: merges main into the specified feature branch (does not clean)
- From the **main workspace** or outside any workspace (without `--into`): shows an interactive workspace picker
- Checks that the target workspace is clean before merging
- Warns if the source workspace has uncommitted changes (only committed work is merged)
- On conflict, shows resolution instructions and aborts

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

### `wkt reconcile`

Detect and fix drift between git's worktrees and the wkt database. Useful when a
worktree was created or modified outside wkt — e.g. a raw `git worktree add`, a
branch renamed with `git branch -m`, or a workspace directory deleted by hand —
which leaves it invisible to `wkt list` / `wkt switch`.

Runs as a **dry-run report by default**; pass `--apply` to write the fixes.

```bash
wkt reconcile [options]
```

**Examples:**

```bash
# Report drift across all projects (no changes)
wkt reconcile

# Scope to a single project
wkt reconcile -p my-project

# Apply the database fixes (prompts to confirm)
wkt reconcile --apply

# Apply without the confirmation prompt
wkt reconcile --apply --force
```

**Options:**
- `-p, --project <name>` - Reconcile a single project (default: all)
- `--apply` - Apply database fixes (default: dry-run report only)
- `--force` - Skip the confirmation prompt when applying

**What it detects:**
- `adopt` — git has a workspace-level worktree wkt never recorded → adds a database entry
- `branch-drift` — the database and git disagree on the checked-out branch → updates the database
- `dead` — a database entry whose worktree directory is gone → removes the entry
- `stale-git` — git references a worktree directory that no longer exists → suggests `git worktree prune`
- `broken-link` — a directory exists but git no longer lists it as a worktree → suggests `git worktree repair`

**Behavior:**
- Only `adopt`, `branch-drift`, and `dead` are fixed automatically (database-only changes)
- `stale-git` and `broken-link` are reported with the exact git command to run — wkt never touches git plumbing for you
- Nested worktrees that aren't direct children of the project's workspaces directory (e.g. an agent's isolated worktrees) are reported as `foreign` and ignored

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

### `wkt shared`

Print the path to the project's shared directory. Creates the directory if it doesn't yet exist.

```bash
wkt shared [options]
```

**Examples:**

```bash
# Print shared dir for the current workspace's project
wkt shared

# cd into it
cd "$(wkt shared)"

# Specify a project explicitly
wkt shared --project my-project
```

**Options:**
- `-p, --project <name>` - Project name (default: inferred from current workspace, or the only project)

The shared directory's top-level entries are auto-symlinked into every new workspace at `wkt create` time.

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

## Claude Code Integration

WKT ships a Claude Code plugin so Claude can drive `wkt` to parallelize work
across worktrees and merge it back. The repo is its own marketplace:

```
/plugin marketplace add saescapa/wkt
/plugin install wkt@wkt-marketplace
```

The bundled `wkt-worktrees` skill becomes available in every project you open.
See [Claude Code Plugin](claude-code-plugin.md) for details, and
[Agent Usage](agent-usage.md) for the non-interactive command contract.

---

## Lifecycle Hooks

WKT does not run lifecycle scripts. Use git's built-in `post-checkout` hook — it fires on `git worktree add` (which is what `wkt create` uses) and is shared across every worktree via the bare repo's hooks dir.

See [Post-Checkout Hook Pattern](post-checkout-hook.md) for a copy-pasteable template covering dependency installs, codegen, husky/lefthook integration, and fresh-tree detection.

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

### Local Merge Workflow

Merge feature branches into main locally without pushing to a remote. Useful for personal projects or when you want to batch changes before deploying.

```bash
# Work on a feature
wkt create my-project feature/auth
cd ~/.wkt/workspaces/my-project/feature-auth
# make changes, commit...

# Merge locally into main
wkt merge feature-auth

# Or squash merge for a clean history
wkt merge feature-auth --squash --clean

# Push to remote whenever you're ready
cd ~/.wkt/workspaces/my-project/main
git push origin main
```

### Remote (PR) Workflow

Use GitHub/GitLab pull requests to merge branches remotely.

```bash
# Push feature branch and create PR
cd ~/.wkt/workspaces/my-project/feature-auth
git push origin feature/auth
# Create PR, review, merge on GitHub...

# Clean up locally (fetches remote to detect merged PRs)
wkt clean
```

### Main Branch Protection

Main workspaces are protected from accidental cleanup because they typically reflect the project's default branch.

```bash
# This will warn
wkt clean main

# Force if needed
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

If shared files show as broken symlinks, the source in `~/.wkt/shared/<project>/` was likely moved or deleted. Recreate the entry under `wkt shared` and the symlinks resolve again. To force-rebuild symlinks for a workspace, delete the broken links and re-run `wkt create` with `--force`, or remove and recreate the workspace.

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
