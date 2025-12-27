# WKT

Workspace manager for git repositories. Create isolated development environments using git worktrees.

## Features

- **Workspaces** - Parallel branches via git worktrees
- **Local Files** - Shared configs (`.env`, IDE settings) across workspaces
- **Lifecycle Hooks** - Auto-run scripts on create, switch, clean
- **Fuzzy Navigation** - Quick switching with search

## Install

```bash
git clone https://github.com/user/wkt.git
cd wkt && bun install && bun run build && npm link
```

Requires Node.js >= 20 and Bun.

## Quick Start

```bash
wkt init git@github.com:user/my-project.git   # Initialize project
wkt create my-project feature/auth             # Create workspace
wkt switch auth                                # Switch (fuzzy match)
wkt list                                       # List workspaces
wkt clean                                      # Remove merged branches
```

## Commands

| Command | Description |
|---------|-------------|
| `init <url>` | Initialize project from repository |
| `create <project> <branch>` | Create workspace |
| `switch [name]` | Switch workspace (interactive if omitted) |
| `list` | List all workspaces |
| `clean` | Remove merged workspaces |
| `rename <name>` | Rename/recycle workspace |
| `info` | Current workspace details |
| `run [script]` | Execute configured script |
| `sync` | Sync local files |
| `config` | View/edit configuration |

See `wkt <command> --help` for options.

## Shell Integration

```bash
# Add to .zshrc/.bashrc
wkts() {
  local path=$(wkt switch "$@" --path-only)
  [ $? -eq 0 ] && [ -n "$path" ] && cd "$path"
}
```

## Documentation

- [User Guide](docs/reference/user-guide.md) - Complete usage documentation
- [Configuration](docs/reference/configuration.md) - Config file reference
- [Architecture](docs/dev/architecture.md) - Codebase overview
- [Contributing](docs/dev/contributing.md) - Development guide

## Development

```bash
bun run dev       # Run from source
bun run build     # Build
bun test          # Test
```

## License

MIT
