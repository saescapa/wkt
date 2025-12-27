# Project Context

## What is WKT?

WKT (Worktree Kit) is a CLI tool for managing git worktrees as isolated development workspaces. It solves the problem of context-switching between branches by giving each branch its own directory.

## Core Problem

Traditional git branching forces developers into a single working directory:
- Switching branches loses uncommitted work (requires stashing)
- Can't work on multiple features simultaneously
- IDE state, build caches, and node_modules get mixed
- Multiple agents (human + AI) can't work on different branches at once

## Solution

WKT uses git worktrees to create parallel working directories:
- Each workspace is a separate directory with its own branch
- Switch between workspaces by changing directories (no git checkout)
- Shared configuration via symlinks
- Lifecycle hooks for setup automation

## Use Cases

**Ready-to-use from the start**
New workspaces should be immediately usable. Hooks run on creation to copy local files (`.env`), symlink shared docs, install dependencies. The `sync` command keeps things consistent. This enables true parallel work—the whole point of git worktrees.

**Easy navigation with awareness**
Switch between workspaces quickly while knowing what's in progress. `list` shows status, dirty state, and staleness. Fuzzy search gets you where you need to be fast.

**Accident-proof by default**
The worst outcome is losing work. WKT protects main branches, warns before cleaning dirty workspaces, and requires confirmation for destructive operations.

**Scales with usage**
Works for someone with 3 workspaces or 30. Filtering, grouping, and stale detection keep things manageable at any scale.

**Serve the user**
`run` executes custom scripts—set a VS Code theme, download files, start services. The tool adapts to your workflow, not the other way around.

**Clean, efficient UX**
No unnecessary output. Fuzzy search over menus. Path-only mode for shell integration. Fast feedback loops.

## Architecture Overview

```
~/.wkt/
├── config.yaml        # Global configuration
├── database.json      # Workspace metadata
├── projects/          # Bare repositories (git data)
│   └── my-project/
└── workspaces/        # Worktrees (working directories)
    └── my-project/
        ├── main/
        └── feature-auth/
```

## Target Users

- Developers who frequently switch between branches
- Teams using AI coding assistants (parallel work)
- Anyone working across multiple repositories
- Projects with expensive build/setup processes

## Design Principles

1. **Zero-config start** - Works immediately with sensible defaults
2. **Workspace isolation** - Each workspace is independent
3. **Automation** - Hooks handle repetitive setup
4. **Performance** - Fast operations, lazy loading
5. **Safety** - Protect main branches, validate before destructive ops
