# Changelog

All notable changes to WKT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-01

### Added
- `wkt merge` to merge a feature workspace into its base branch, with `--squash`, `--into <branch>`, `--rebase` (replay onto the recorded base), and `--clean`
- `wkt reconcile` to detect and fix drift between git and the wkt database — adopts orphaned worktrees, corrects branch drift, and prunes dead entries
- `wkt create --path-only` to print only the new workspace path (e.g. `cd "$(wkt create feat/x --path-only)"`)
- Stacked workspaces: `wkt list` tags workspaces whose base ≠ the project default with `↳stacked` and shows their commits ahead/behind that base
- Per-project shared directory — top-level entries under `~/.wkt/shared/<project>/` are auto-symlinked into every new workspace
- Non-interactive mode for agents (`-y, --yes`, or `WKT_NON_INTERACTIVE=1`)
- `wkt init --local` to register a project from a local repo with no remote
- Interactive prompts as a fallback for bare commands (`wkt create`, `wkt rename`, `wkt init`)
- Tree-structured `wkt list` output with hierarchical grouping (├─ └─)
- Claude Code plugin exposing the parallel-worktree workflow as a skill
- `WKT_HOME` environment variable and `dev:safe` script for isolated development and testing
- `wkt init` now auto-creates the main workspace, making projects immediately usable
- Database schema migrations that backfill required fields (`defaultBranch`, `baseBranch`, workspace `status`) when loading an older `~/.wkt/database.json`

### Changed
- Merging a branch into the default branch now re-points workspaces stacked on it back to the default branch
- Base branches are normalized (a leading `origin/` is stripped) when stored and grouped, so `origin/main` and `main` no longer split into separate `wkt list` groups
- Config sections now deep-merge with defaults, so keys added in newer versions backfill into an existing `~/.wkt/config.yaml`
- Command arguments are now optional, with interactive prompts as fallback
- `wkt --version` now reports the installed package version instead of a hardcoded string

### Removed
- `wkt run` and the scripts/hooks system — superseded by git's `post-checkout` hook (see `docs/reference/post-checkout-hook.md`)
- `wkt sync` and the local_files system
- Workspace pool system (`wkt claim`, `wkt release`, `wkt save`) — removed due to complexity

### Fixed
- Merged-branch detection now uses git-native checks and handles squash merges reliably
- Project repos are kept bare so `wkt init` succeeds, and `core.bare` no longer blocks `post-checkout` hooks
- Ctrl+C during interactive prompts now exits silently (exit code 130) instead of showing a stack trace

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
