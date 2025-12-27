# WKT (Worktree Kit)

A CLI tool for managing parallel development workflows using git worktrees.

**Why WKT?**
- No more `git clone` overload — one bare repo, unlimited workspaces
- Local files (`.env`, configs) preserved across branches
- Parallel work on multiple features without stashing

## Installation

```bash
git clone https://github.com/user/wkt.git
cd wkt
bun install
bun run build
npm link  # Make globally available
```

## Quick Start

```bash
# Initialize a project
wkt init git@github.com:user/repo.git myproject

# Create workspaces
wkt create myproject feature/auth
wkt create myproject 1234  # Inferred: feature/eng-1234

# Switch between workspaces
wkt switch                      # Interactive selection
wkt switch auth                 # Fuzzy match
cd "$(wkt switch auth --path-only)"  # Shell integration

# List and clean up
wkt list
wkt clean  # Remove merged branches
```

## Commands

### Setup

| Command | Description |
|---------|-------------|
| `wkt init <url> [name]` | Initialize project from repository |
| `wkt init --list` | List all managed projects |
| `wkt config` | View/edit configuration |

### Workspace Management

| Command | Description |
|---------|-------------|
| `wkt create <project> <branch>` | Create new workspace |
| `wkt switch [workspace]` | Switch to workspace (interactive if no arg) |
| `wkt list` | List all workspaces |
| `wkt clean` | Remove merged workspaces |
| `wkt rename <new-name>` | Rename current workspace/branch |

### Workspace Info

| Command | Description |
|---------|-------------|
| `wkt info` | Show current workspace details |
| `wkt info -d "text"` | Set workspace description |
| `wkt info --json` | Output as JSON |

### Execution

| Command | Description |
|---------|-------------|
| `wkt run [script]` | Run predefined script |
| `wkt sync` | Sync local files to workspaces |

## Local Files

Keep files synced across workspaces. Add to `~/.wkt/config.yaml`:

```yaml
local_files:
  shared:              # Symlinked to main workspace
    - "CLAUDE.md"
    - ".cursor/rules"
  copied:              # Copied from template
    - ".env.local"
  templates:
    ".env.local": ".env.local.example"
```

**Shared files** are symlinked — edit once, available everywhere.
**Copied files** are workspace-specific — each gets its own copy.

## Lifecycle Hooks

Run scripts on workspace events:

```yaml
scripts:
  scripts:
    install-deps:
      command: ["pnpm", "install"]
      conditions:
        file_exists: ["package.json"]
    docker-up:
      command: ["docker", "compose", "up", "-d"]

  hooks:
    post_create:
      - script: "install-deps"
    post_switch:
      - script: "docker-up"
        optional: true
```

## Shell Integration

Add to your `.zshrc` or `.bashrc`:

```bash
# Switch and cd in one command
function wkts() {
    local path=$(wkt switch "$@" --path-only)
    if [ $? -eq 0 ] && [ -n "$path" ]; then
        cd "$path"
    fi
}

# Show workspace description in prompt
wkt_info() {
  local desc=$(wkt info --description-only 2>/dev/null)
  [ -n "$desc" ] && echo " [$desc]"
}
```

## Configuration

WKT stores data in `~/.wkt/`:

```
~/.wkt/
├── config.yaml      # Global configuration
├── database.json    # Workspace metadata
├── projects/        # Bare repositories
└── workspaces/      # All worktrees
```

### Branch Inference

Shortcuts for common patterns:

```yaml
inference:
  patterns:
    - pattern: '^(\d+)$'
      template: 'feature/eng-{}'  # 1234 → feature/eng-1234
    - pattern: '^eng-(\d+)$'
      template: 'feature/{}'      # eng-1234 → feature/eng-1234
```

## Directory Structure

```
~/.wkt/workspaces/myproject/
├── main/
│   ├── CLAUDE.md              # Original shared file
│   └── .env.local             # Workspace-specific
└── feature-auth/
    ├── CLAUDE.md -> ../main/CLAUDE.md  # Symlink
    └── .env.local             # Independent copy
```

## Development

```bash
bun run dev          # Run from source
bun run build        # Build for production
bun test             # Run tests
bun run typecheck    # Type check
bun run lint         # Lint
```

## License

MIT
