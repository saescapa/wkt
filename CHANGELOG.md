# Changelog

All notable changes to WKT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Shared-file mirroring now skips backup/swap artifacts (`.backup*`, `*~`, `*.swp`) so stray files in a project's `shared/` directory no longer leak into workspaces as symlinks

### Added
- `wkt merge --rebase` to replay a feature workspace onto its recorded base branch instead of merging
- `wkt list` now tags stacked workspaces (base ≠ project default) with `↳stacked` and their commits ahead/behind their base
- Interactive mode for bare commands (`wkt create`, `wkt rename`, `wkt init`, `wkt run`)
- Autocomplete search with fuzzy filtering for `wkt run` script selection
- Grouped script display by location (Scripts, Workspace, Shortcuts)
- `-s, --search` flag for `wkt run` to filter scripts
- `wkt init` now auto-creates main workspace, making projects immediately usable
- Tree structure display for `wkt list` with hierarchical grouping
- `WKT_HOME` environment variable for isolated testing and development
- `dev:safe` script for safe manual testing in isolated environment

### Changed
- Merging a branch into the default branch now re-points workspaces stacked on it back to the default branch
- Base branches are normalized (a leading `origin/` is stripped) when stored and grouped, so `origin/main` and `main` no longer split into separate `wkt list` groups
- Command arguments are now optional with interactive prompts as fallback
- `wkt list` output now groups workspaces with tree connectors (├─ └─)

### Removed
- Workspace pool system (`wkt claim`, `wkt release`, `wkt save`) - removed due to complexity

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
