# WKT

Workspace manager for git repositories. Create isolated development environments with shared configuration.

## Features

- **Workspaces** — Parallel branches via git worktrees
- **Local Files** — Shared configs (`.env`, IDE settings) across workspaces
- **Lifecycle Hooks** — Auto-run scripts on create, switch, clean
- **Fuzzy Navigation** — Quick switching with search

## Install

```bash
git clone https://github.com/user/wkt.git
cd wkt && bun install && bun run build && npm link
```

## Usage

```bash
wkt init <repo-url> [project-name]    # Initialize project
wkt create <project> <branch>          # Create workspace
wkt switch [name]                      # Switch workspace
wkt list                               # List workspaces
wkt clean                              # Remove merged branches
```

## Commands

| Command | Description |
|---------|-------------|
| `init <url>` | Initialize project from repository |
| `create <project> <branch>` | Create workspace |
| `switch [name]` | Switch workspace (interactive if omitted) |
| `list` | List all workspaces |
| `list --dirty` | Workspaces with uncommitted changes |
| `list --stale <duration>` | Workspaces older than duration |
| `clean` | Remove merged workspaces |
| `clean --older-than <duration>` | Remove stale workspaces |
| `info` | Current workspace details |
| `rename <name>` | Rename/recycle workspace |
| `run [script]` | Execute configured script |
| `sync` | Sync local files |
| `config` | View/edit configuration |

## Configuration

`~/.wkt/config.yaml`

```yaml
local_files:
  shared:                          # Symlinked from main workspace
    - ".cursor/rules"
    - "docs.local/"
  copied:                          # Copied per workspace
    - ".env.local"
  templates:
    ".env.local": ".env.example"   # Template mapping

scripts:
  scripts:
    install:
      command: ["pnpm", "install"]
      conditions:
        file_exists: ["package.json"]
  hooks:
    post_create:
      - script: "install"
    post_switch:
      - script: "install"
        optional: true
```

## Shell Integration

```bash
# Add to .zshrc/.bashrc
wkts() {
  local path=$(wkt switch "$@" --path-only)
  [ $? -eq 0 ] && [ -n "$path" ] && cd "$path"
}
```

## Structure

```
~/.wkt/
├── config.yaml        # Configuration
├── database.json      # Workspace metadata
├── projects/          # Bare repositories
└── workspaces/        # Worktrees
    └── <project>/
        ├── main/
        └── feature-xyz/
```

## Development

```bash
bun run dev       # Run from source
bun run build     # Build
bun test          # Test
```

## License

MIT
