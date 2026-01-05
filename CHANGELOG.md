# Changelog

All notable changes to WKT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Workspace Pool System** - Recycle workspaces to preserve installed dependencies
  - `wkt claim [project]` - Claim a workspace from the pool (or create new if empty)
  - `wkt release` - Return workspace to pool for reuse
  - `wkt save` - Handle changes from claimed workspace (create branch, stash, or discard)
  - `--from <branch>` flag on `wkt claim` to track a specific branch
- Pool configuration options in `workspace.pool`:
  - `max_size` - Maximum pooled workspaces per project (default: 5)
  - `max_age_days` - Auto-clean old pooled workspaces (default: 30)
- New lifecycle hooks: `post_claim` and `post_release`
- `--include-pool` flag for `wkt clean` to remove pooled workspaces
- Mode-specific output in `wkt info` (shows tracking branch, base commit, claimed time)
- Pool summary in `wkt list --pool` output
- Database migration (v3) for pool workspace fields
- Interactive mode for bare commands (`wkt create`, `wkt rename`, `wkt init`, `wkt run`)
- Autocomplete search with fuzzy filtering for `wkt run` script selection
- Grouped script display by location (Scripts, Workspace, Shortcuts)
- `-s, --search` flag for `wkt run` to filter scripts
- `wkt init` now auto-creates main workspace, making projects immediately usable
- Tree structure display for `wkt list` with hierarchical grouping by tracking branch
- Workspace mode system (`branched`, `claimed`, `pooled`) preparing for workspace pool feature
- Mode icons in `wkt list`: `●` active, `○` branched, `◇` claimed/pooled
- `--pool` flag for `wkt list` to filter pooled/claimed workspaces
- Database migration (v2) to add mode field to existing workspaces

### Changed
- Command arguments are now optional with interactive prompts as fallback
- `wkt list` output now groups workspaces under their tracking branch with tree connectors (├─ └─)

### Fixed
- Ctrl+C during interactive prompts now exits silently (exit code 130) instead of showing stack trace

## [0.1.0] - 2024-12-27

### Added
- Initial release of WKT (Worktree Kit)
- Core commands: `init`, `create`, `switch`, `list`, `clean`, `rename`, `info`, `run`, `sync`, `config`
- Git worktree management with bare repository storage
- Local files management (symlinks and templates)
- Lifecycle hooks (`post_create`, `pre_switch`, `post_switch`, `pre_clean`, `post_clean`)
- Safe script execution with command allowlisting
- Branch name inference patterns
- Fuzzy search for workspace switching
- YAML configuration with hierarchy (workspace > project > global)
