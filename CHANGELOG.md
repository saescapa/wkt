# Changelog

All notable changes to WKT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `wkt clean` now honors `-p/--project` (previously accepted but ignored): scopes bulk cleanup to one project and disambiguates workspace names that exist in multiple projects (ambiguous names now error instead of removing an arbitrary match)
- `wkt clean` refuses to remove a workspace with uncommitted changes unless `--force` is passed (previously deleted them silently via `git worktree remove --force`)
- Input validation at the CLI boundary: `wkt init` rejects repository URLs outside http(s)/ssh/git/file/scp-style/local-path forms (blocks `ext::` and `--upload-pack` transport tricks) and project names with path separators; `git clone` is invoked with a `--` separator
- Database writes are serialized across concurrent wkt processes via an on-disk lock, so parallel `wkt create` runs no longer clobber each other's records

### Changed
- Main workspaces and workspaces whose merge status cannot be verified (e.g. after a failed fetch) can no longer be removed with `clean --force` — unverifiable is not treated as merged
- `wkt create --from` no longer defaults to `main` in the CLI parser, so projects whose default branch is `master` (or anything else) base new workspaces on their actual default branch
- Project template config (applied via `wkt init --template` / `--apply-template`) now actually takes effect for naming strategy and inference patterns in `create`/`rename`; `wkt config --project <name>` shows the effective merged config and errors on unknown projects
- `wkt list --dirty` recomputes git status live instead of trusting the cached status, so it is reliable as a pre-cleanup audit
- `wkt config path|edit|debug` honor `WKT_HOME` instead of hardcoding `~/.wkt`
- `wkt merge --clean` after a squash merge now deletes the source branch (`-d` refused non-ancestor branches); merge failures to compare against the target ref are reported instead of masquerading as "no commits ahead"
- Removed unread config keys (`git.*`, `workspace.auto_cleanup`, `workspace.max_age_days`, `wkt.default_project`, `aliases`) and the never-read workspace `.wkt.yaml` tier; `.wkt.yaml.example` replaced by `config.yaml.example` matching the real schema
- Removed the no-op `wkt switch --create` flag

### Fixed
- Shared-file mirroring now skips backup/swap artifacts (`.backup*`, `*~`, `*.swp`) so stray files in a project's `shared/` directory no longer leak into workspaces as symlinks

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

## [0.1.0] - 2025-12-27

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
