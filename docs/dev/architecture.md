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
│   └── types.ts          # All TypeScript interfaces
└── utils/                # Utilities
    ├── git.ts            # GitUtils class
    ├── branch-inference.ts   # BranchInference class
    ├── local-files.ts    # LocalFilesManager class
    ├── script-executor.ts    # SafeScriptExecutor class
    ├── validation.ts     # Input validation
    ├── format.ts         # Output formatting
    ├── errors.ts         # WKTError and error classes
    └── constants.ts      # Shared constants
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
- `getCurrentWorkspaceContext()` — Get active workspace (path-based or stored)

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

### Git Operations (`src/utils/git.ts`)

The `GitUtils` class wraps git commands with async execution:

**Repository operations:**
- `cloneBareRepository()` — Clone as bare repo
- `createWorktree()` / `removeWorktree()` / `moveWorktree()` — Worktree management
- `fetchAll()` / `fetchInWorkspace()` — Fetch from remotes

**Branch operations:**
- `getCurrentBranch()` — Get checked-out branch
- `branchExists()` — Check if branch exists (local or remote)
- `isBranchMerged()` — Detect if branch was merged (supports squash merges)
- `getDefaultBranch()` — Detect main/master

**Status operations:**
- `getWorkspaceStatus()` — Get staged/unstaged/untracked counts
- `isWorkingTreeClean()` — Check for uncommitted changes
- `getCommitsDiff()` — Count commits ahead/behind base

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

### 6. Class-Based Utilities

Core utilities use classes (`DatabaseManager`, `ConfigManager`, `GitUtils`, etc.) to:
- Encapsulate state where needed
- Provide clear public APIs
- Enable easier testing and mocking

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
