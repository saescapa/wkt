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
│   ├── rename.ts         # wkt rename
│   ├── info.ts           # wkt info
│   ├── run.ts            # wkt run
│   ├── sync.ts           # wkt sync
│   └── config.ts         # wkt config
├── core/                 # Core abstractions
│   ├── config.ts         # ConfigManager class
│   ├── database.ts       # DatabaseManager class
│   ├── migrations.ts     # Database schema migrations
│   └── types.ts          # All TypeScript interfaces
└── utils/                # Utilities
    ├── git/              # Git operations (modular)
    │   ├── index.ts      # Re-exports all git functions
    │   ├── command.ts    # Base command execution
    │   ├── repository.ts # Repository operations
    │   ├── branches.ts   # Branch operations
    │   ├── worktrees.ts  # Worktree operations
    │   ├── status.ts     # Status and diff operations
    │   └── network.ts    # Network operations with retry
    ├── branch-inference.ts   # BranchInference class
    ├── local-files.ts    # LocalFilesManager class
    ├── script-executor.ts    # SafeScriptExecutor class
    ├── validation.ts     # Input validation
    ├── format.ts         # Output formatting
    ├── errors.ts         # WKTError and error classes
    ├── logger.ts         # Debug logging utility
    ├── retry.ts          # Network retry with backoff
    └── constants.ts      # Shared constants
```

## Core Concepts

### Types (`src/core/types.ts`)

All TypeScript interfaces are defined in `src/core/types.ts`. Key types include:

| Interface | Purpose |
|-----------|---------|
| `WKTDatabase` | Root database structure with projects, workspaces, and metadata |
| `Project` | Repository metadata (name, paths, default branch) |
| `Workspace` | Worktree metadata (branch, path, status, mode, timestamps) |
| `WorkspaceMode` | Workspace type: `branched`, `claimed`, or `pooled` |
| `WorkspaceStatus` | Git status counts (staged, unstaged, untracked, conflicted) |
| `GlobalConfig` | Full configuration structure |
| `ProjectConfig` | Project-specific configuration overrides |
| `ScriptDefinition` | Safe script execution configuration |
| `ScriptHook` | Lifecycle hook configuration |

> **Note:** Always refer to `src/core/types.ts` for the authoritative type definitions.

### Database (`src/core/database.ts`)

The `DatabaseManager` class handles persistence of project and workspace metadata to `~/.wkt/database.json`.

Key methods:
- `getDatabase()` / `saveDatabase()` — Load and persist
- `addProject()` / `getProject()` / `getAllProjects()` — Project CRUD
- `addWorkspace()` / `getWorkspace()` / `getAllWorkspaces()` — Workspace CRUD
- `getWorkspaceFromPath()` — Detect workspace from current directory
- `getCurrentWorkspaceContext()` — Get workspace from current directory (calls `getWorkspaceFromPath`)

### Database Migrations (`src/core/migrations.ts`)

Schema versioning and migration system for database upgrades:

```typescript
export const CURRENT_SCHEMA_VERSION = 2;

export const migrations: Migration[] = [
  {
    version: 2,
    description: 'Add mode field to workspaces',
    migrate: (db) => {
      for (const workspace of Object.values(db.workspaces)) {
        if (!workspace.mode) {
          workspace.mode = 'branched';
        }
      }
      return db;
    }
  }
];
```

The `DatabaseManager` automatically runs migrations when loading the database. Add new migrations to the `migrations` array when schema changes are needed.

### Configuration (`src/core/config.ts`)

The `ConfigManager` class handles YAML configuration with a merge hierarchy:

1. Workspace `.wkt.yaml` (highest priority)
2. Project section in global config
3. Global `~/.wkt/config.yaml` (lowest priority)

Key methods:
- `getConfig()` — Load merged global configuration
- `getProjectConfig(projectName)` — Get project-specific overrides
- `getWorkspaceConfig(workspacePath)` — Load workspace-local config
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
- `isBranchMerged()` — Detect if branch was merged (supports squash merges)
- `getBranchAge()` — Get last commit date
- `rebaseBranch()` — Rebase onto target branch

**`worktrees.ts`** — Worktree management:
- `createWorktree()` / `removeWorktree()` / `moveWorktree()` — CRUD operations
- `listWorktrees()` — List all worktrees for a repo

**`status.ts`** — Status operations:
- `getWorkspaceStatus()` — Get staged/unstaged/untracked counts
- `isWorkingTreeClean()` — Check for uncommitted changes
- `getCommitsDiff()` — Count commits ahead/behind base

**`network.ts`** — Network operations with automatic retry:
- `fetchAll()` / `fetchInWorkspace()` — Fetch from remotes
- `pullWithRebase()` — Pull with rebase
- `pushBranch()` — Push to remote

All functions use debug logging and network operations automatically retry up to 3 times with exponential backoff.

### Local Files (`src/utils/local-files.ts`)

The `LocalFilesManager` class manages shared and copied files across workspaces:

- **Shared files** — Symlinked from the main workspace (stay synchronized)
- **Copied files** — Templated per workspace (become independent)

Key method: `setupLocalFiles(project, workspacePath, projectConfig, globalConfig, workspace)`

### Script Executor (`src/utils/script-executor.ts`)

The `SafeScriptExecutor` class provides secure script execution with:

- Command allowlisting (only whitelisted commands can run)
- Timeout enforcement
- Variable substitution (no shell injection)
- Condition checking (file_exists, branch_pattern, etc.)

Key methods:
- `executeScript()` — Run a named script
- `executePostCreationHooks()` / `executePreSwitchHooks()` / etc. — Lifecycle hooks
- `createContext()` — Build execution context with template variables

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
| `CommandNotAllowedError` | Script command not in allowlist |
| `ScriptNotFoundError` | Referenced script doesn't exist |
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

### Constants (`src/utils/constants.ts`)

Shared constants including:
- Default timeouts and limits
- Allowed commands list
- Validation patterns
- Error and success message templates

## Command Flow

### Example: `wkt create`

```
1. Parse arguments (Commander)
   └── project, branch, options

2. Load configuration
   └── Global → Project → Workspace config merge

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

6. Sync local files
   ├── Create symlinks for shared files
   └── Copy templates for copied files

7. Run post_create hooks
   ├── Validate commands against allowlist
   ├── Check conditions
   └── Execute scripts

8. Output result
   └── Success message with path
```

## Testing

```
test/
├── unit/                 # Pure function tests
│   ├── branch-inference.test.ts
│   ├── config.test.ts
│   ├── database.test.ts
│   └── duration.test.ts
├── e2e/                  # CLI integration tests
│   └── basic-workflow.test.ts
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
