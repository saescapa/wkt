# WKT Architecture

Technical overview for contributors and maintainers.

## Overview

WKT is a CLI tool built with:

- **Runtime:** Node.js (>=20) / Bun
- **Language:** TypeScript (ESM)
- **CLI Framework:** Commander.js
- **UI:** Chalk (colors), Inquirer (prompts)
- **Search:** Fuse.js (fuzzy matching)
- **Config:** YAML

## Directory Structure

```
src/
├── index.ts              # CLI entry point, command registration
├── commands/             # Command handlers
│   ├── init.ts           # wkt init
│   ├── create.ts         # wkt create
│   ├── switch.ts         # wkt switch
│   ├── list.ts           # wkt list
│   ├── clean.ts          # wkt clean
│   ├── merge.ts          # wkt merge (and --rebase)
│   ├── rename.ts         # wkt rename
│   ├── reconcile.ts      # wkt reconcile
│   ├── info.ts           # wkt info
│   ├── shared.ts         # wkt shared
│   ├── config.ts         # wkt config
│   └── help.ts           # wkt help (topic help, e.g. agent)
├── core/                 # Core abstractions
│   ├── config.ts         # ConfigManager class
│   ├── database.ts       # DatabaseManager class
│   ├── migrations.ts     # Database schema migrations
│   └── types.ts          # All TypeScript interfaces
└── utils/                # Utilities
    ├── git/              # Git operations (modular)
    │   ├── index.ts      # Re-exports all git functions
    │   ├── command.ts    # Base command execution + parseDuration
    │   ├── repository.ts # Repository operations
    │   ├── branches.ts   # Branch operations, merge detection
    │   ├── worktrees.ts  # Worktree operations
    │   ├── status.ts     # Status and diff operations
    │   └── network.ts    # Network operations with retry
    ├── branch-inference.ts   # BranchInference class
    ├── shared-symlinks.ts    # setupSharedSymlinks for shared-dir → workspace
    ├── validation.ts     # Input validation at the CLI trust boundary
    ├── workspace.ts      # isMainBranchWorkspace predicate
    ├── interactive.ts    # Non-interactive (-y) mode helpers
    ├── format.ts         # Output formatting
    ├── errors.ts         # WKTError and error classes
    ├── logger.ts         # Debug logging utility
    └── retry.ts          # Network retry with backoff
```

## Core Concepts

### Types (`src/core/types.ts`)

All TypeScript interfaces are defined in `src/core/types.ts`. Key types include:

| Interface | Purpose |
|-----------|---------|
| `WKTDatabase` | Root database structure with projects, workspaces, and metadata |
| `Project` | Repository metadata (name, paths, default branch) |
| `Workspace` | Worktree metadata (branch, path, status, timestamps) |
| `WorkspaceStatus` | Git status counts (staged, unstaged, untracked, conflicted) |
| `GlobalConfig` | Full configuration structure |
| `ProjectConfig` | Project-specific configuration overrides |

> **Note:** Always refer to `src/core/types.ts` for the authoritative type definitions.

### Database (`src/core/database.ts`)

The `DatabaseManager` class handles persistence of project and workspace metadata to `~/.wkt/database.json`.

Key methods:
- `getDatabase()` / `saveDatabase()` — Load and persist
- `addProject()` / `getProject()` / `getAllProjects()` — Project CRUD
- `addWorkspace()` / `getWorkspace()` / `getAllWorkspaces()` — Workspace CRUD
- `getWorkspaceFromPath()` — Detect workspace from current directory
- `getCurrentWorkspaceContext()` — Get workspace from current directory (calls `getWorkspaceFromPath`)

Every mutating method goes through an exclusive on-disk lock
(`database.json.lock`, a directory created with atomic `mkdir`): the file is
re-read under the lock, the mutation applied, and the result saved. This keeps
concurrent wkt processes (the parallel-agent workflow) from clobbering each
other's writes. Locks older than 10s are treated as abandoned and stolen.

Note that `Workspace.status` / `commitsAhead` / `commitsBehind` are cached
snapshots refreshed only by mutating commands. `wkt list --dirty` recomputes
status live because it is used as a safety check before `wkt clean`.

### Database Migrations (`src/core/migrations.ts`)

Schema versioning and migration system for database upgrades. `DatabaseManager.getDatabase()` runs `migrateDatabase()` automatically whenever a loaded `~/.wkt/database.json` reports a schema version below `CURRENT_SCHEMA_VERSION`, then persists the upgraded file.

Each migration bumps the version *and* transforms the data. A migration that introduces or requires a new field **must backfill it for existing databases** — the version bump alone does nothing. For example, the v4 migration defaults `defaultBranch`, `baseBranch`, and workspace `status` on databases written before those became required:

```typescript
{
  version: 4,
  description: 'Backfill required workspace/project fields (defaultBranch, baseBranch, status)',
  migrate: (db) => {
    for (const workspace of Object.values(db.workspaces)) {
      if (!workspace.baseBranch) {
        workspace.baseBranch =
          db.projects[workspace.projectName]?.defaultBranch ?? 'main';
      }
      // ...
    }
    return db;
  }
}
```

The guard in `migrateDatabase()` also warns (and leaves the data untouched) when a database reports a version *newer* than the running code supports — so a user on an older build won't silently corrupt state written by a newer one.

**When you change the schema:** add a migration that backfills, and add a fixture test in `test/unit/migrations.test.ts` that loads a legacy shape and asserts the required fields end up populated. See [Contributing → Schema changes](contributing.md#schema-changes).

### Configuration (`src/core/config.ts`)

The `ConfigManager` class handles YAML configuration with a merge hierarchy:

1. Project template config stored on the DB `Project.config` record (highest priority)
2. Project section (`projects.<name>`) in the global config
3. Global `~/.wkt/config.yaml` defaults (lowest priority)

Key methods:
- `getConfig()` — Load merged global configuration
- `getProjectConfig(projectName, projectOverrides?)` — Resolve a project's effective config (callers pass the DB project's stored `config`)
- `getConfigPath()` — Path to the config file (honors `WKT_HOME`)
- `ensureConfigDir()` — Initialize WKT directories

### Git Operations (`src/utils/git/`)

Git operations are organized into focused modules with direct function exports:

**`command.ts`** — Base execution:
- `executeCommand()` — Run git commands with error handling and debug logging

**`repository.ts`** — Repository operations:
- `cloneBareRepository()` — Clone as bare repo
- `isGitRepository()` — Check if path is a git repo
- `getBareRepoUrl()` — Extract remote URL
- `getDefaultBranch()` — Detect main/master

**`branches.ts`** — Branch operations:
- `getCurrentBranch()` — Get checked-out branch
- `branchExists()` — Check if branch exists (local or remote)
- `getLatestBranchReference()` / `normalizeBaseBranch()` — Resolve remote-vs-local refs for a base branch
- `getMergeStatus()` — Tri-state merge detection (`merged` / `unmerged` / `unknown`), including squash merges via patch-id
- `getBranchAge()` — Get last commit date
- `rebaseBranch()` — Rebase onto target branch

**`worktrees.ts`** — Worktree management:
- `createWorktree()` / `removeWorktree()` / `moveWorktree()` — CRUD operations (createWorktree also seeds empty repos)
- `listWorktrees()` — List all worktrees for a repo

**`status.ts`** — Status operations:
- `getWorkspaceStatus()` — Get staged/unstaged/untracked counts
- `isWorkingTreeClean()` — Check for uncommitted changes
- `getCommitsDiff()` — Count commits ahead/behind base
- `getCommitCountAhead()` — Commits ahead of a base (`null` when the comparison fails)
- `getLastCommitInfo()` — Hash/date/message of the last commit

**`network.ts`** — Network operations with automatic retry:
- `fetchAll()` — Fetch all remotes (tolerates empty repositories)

All functions use debug logging and network operations automatically retry up to 3 times with exponential backoff.

### Shared Symlinks (`src/utils/shared-symlinks.ts`)

`setupSharedSymlinks(sharedPath, workspacePath)` reads top-level entries from `~/.wkt/shared/<project>/` and creates relative symlinks at the same name inside the workspace. Existing entries in the workspace are not overwritten. `.git`, `.gitignore`, and `.DS_Store` are skipped so the shared dir can itself be a git repo.

Called from `init.ts` (for the auto-created main workspace) and `create.ts` (for every subsequent workspace).

### Lifecycle Hooks

WKT does not implement lifecycle scripts. Setup work belongs in git's `post-checkout` hook, which fires automatically on `git worktree add`. See [`docs/reference/post-checkout-hook.md`](../reference/post-checkout-hook.md).

### Branch Inference (`src/utils/branch-inference.ts`)

The `BranchInference` class handles pattern matching for branch names:

- `inferBranchName(input, patterns)` — Expand short input to full branch name
- `sanitizeWorkspaceName(branch, strategy)` — Convert branch to directory name
- `generateWorkspaceId(project, workspace)` — Create unique workspace identifier

### Error Handling (`src/utils/errors.ts`)

Custom error classes provide structured error handling:

| Class | Purpose |
|-------|---------|
| `WKTError` | Base error with code and user-facing flag |
| `ProjectNotFoundError` | Project doesn't exist |
| `WorkspaceNotFoundError` | Workspace doesn't exist |
| `WorkspaceExistsError` | Workspace already exists |
| `ConfigurationError` | Invalid configuration |

The `ErrorHandler` class provides consistent error display with helpful hints.

### Logger (`src/utils/logger.ts`)

Debug logging utility with log levels:

```typescript
import { logger } from './utils/logger.js';

logger.debug('Detailed info');  // Only shown with --debug flag
logger.info('General info');
logger.warn('Warning message');
logger.error('Error message');
```

Enable debug mode via:
- `--debug` CLI flag
- `WKT_DEBUG=1` environment variable

### Retry Utility (`src/utils/retry.ts`)

Exponential backoff retry for network operations:

```typescript
import { withRetry } from './utils/retry.js';

const result = await withRetry(
  () => someNetworkOperation(),
  'operation name',
  { maxAttempts: 3, initialDelayMs: 1000 }
);
```

Automatically retries on network errors like connection timeouts and DNS failures.

### Validation (`src/utils/validation.ts`)

Input validation at the CLI trust boundary, called before values reach git or
the filesystem:

- `validateProjectName()` — project names become directory names (no traversal, no leading `-`)
- `validateBranchName()` — branch names reach git as positionals (no leading `-`)
- `validateRepositoryUrl()` — restricts `wkt init` URLs to http(s)/ssh/git/file, scp-style, or existing local paths (blocks `ext::` and option-injection transports)

## Command Flow

### Example: `wkt create`

```
1. Parse arguments (Commander)
   └── project, branch, options

2. Load configuration
   └── Global → project section → project template merge

3. Validate inputs
   ├── Project exists?
   ├── Branch name valid?
   └── Workspace doesn't exist?

4. Infer branch name
   └── Apply inference patterns

5. Create worktree
   ├── git fetch (if auto_fetch)
   ├── git worktree add
   └── Update database

6. Setup shared symlinks
   └── Symlink top-level entries from ~/.wkt/shared/<project>/

7. Output result
   └── Success message with path
```

## Testing

```
test/
├── unit/                 # Pure function / module tests
│   ├── branch-inference.test.ts
│   ├── config.test.ts
│   ├── database.test.ts
│   ├── duration.test.ts
│   ├── git-status.test.ts
│   ├── migrations.test.ts
│   ├── normalize-base-branch.test.ts
│   └── shared-symlinks.test.ts
├── e2e/                  # CLI integration tests (run the built binary)
│   ├── basic-workflow.test.ts
│   ├── clean-workflow.test.ts
│   ├── config-workflow.test.ts
│   ├── init-bare-hooks.test.ts
│   ├── init-local-workflow.test.ts
│   ├── merge-conflict.test.ts
│   ├── reconcile-workflow.test.ts
│   ├── rename-workflow.test.ts
│   ├── stacking-workflow.test.ts
│   └── switch-workflow.test.ts
└── utils/                # Test utilities
    └── test-helpers.ts
```

**Unit tests:** Test pure logic without git or filesystem.

**E2E tests:** Create real git repos in `/tmp` and run the CLI.

```bash
bun test              # All tests
bun test:unit         # Unit only
bun test:e2e          # E2E only
```

See `test/TESTING.md` for the full testing guide.

## Build

```bash
bun run build         # Build to dist/
bun run dev           # Run from source
```

Output is ESM targeting Node.js.

## Key Design Decisions

### 1. Bare Repositories

Projects are stored as bare repos to:
- Save disk space (no working directory)
- Enable multiple worktrees
- Centralize git data

### 2. JSON Database

Simple JSON file instead of SQLite because:
- No native dependencies
- Easy to debug and edit
- Sufficient for typical use (dozens of workspaces)

### 3. YAML Configuration

YAML over JSON because:
- Supports comments
- More readable for nested structures
- Standard for config files

### 4. ESM Only

ES modules only (no CommonJS) because:
- Modern Node.js standard
- Better tree shaking
- Cleaner import syntax

### 5. Bun for Development

Bun used for:
- Fast TypeScript execution (no compile step for dev)
- Built-in test runner
- Fast builds

But the output runs on Node.js for broader compatibility.

### 6. Mixed Patterns for Utilities

Core utilities use classes where state management is needed (`DatabaseManager`, `ConfigManager`, `Logger`) and direct function exports for stateless operations (git functions, retry utility):
- Classes encapsulate state and provide clear APIs
- Function modules offer simpler imports and better tree shaking
- Both patterns support testing and mocking

## Adding a New Command

1. Create `src/commands/mycommand.ts`:

```typescript
import type { MyCommandOptions } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';
import { ConfigManager } from '../core/config.js';

export async function myCommand(arg: string, options: MyCommandOptions): Promise<void> {
  const dbManager = new DatabaseManager();
  const configManager = new ConfigManager();

  // Implementation
}
```

2. Register in `src/index.ts`:

```typescript
import { myCommand } from './commands/mycommand.js';

program
  .command('mycommand')
  .description('What it does')
  .argument('<arg>', 'Argument description')
  .option('-f, --flag', 'Flag description')
  .action(myCommand);
```

3. Add types to `src/core/types.ts` if needed.

4. Add tests in `test/unit/` or `test/e2e/`.

## Contributing

See [Contributing Guide](contributing.md) for development setup and PR process.
