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
│   ├── config.ts         # Configuration loading/merging
│   ├── database.ts       # Workspace metadata storage
│   └── types.ts          # TypeScript types
└── utils/                # Utilities
    ├── git.ts            # Git operations
    ├── branch-inference.ts   # Branch name patterns
    ├── local-files.ts    # Symlinks and templates
    ├── script-executor.ts    # Script execution
    ├── validation.ts     # Input validation
    ├── format.ts         # Output formatting
    ├── errors.ts         # Error handling
    └── constants.ts      # Shared constants
```

## Core Concepts

### Database (`src/core/database.ts`)

JSON file storing project and workspace metadata:

```typescript
interface Database {
  projects: Record<string, Project>;
  workspaces: Record<string, Workspace>;
  currentWorkspace: string | null;
}

interface Project {
  id: string;
  name: string;
  repoPath: string;           // Bare repo path
  workspacesPath: string;     // Workspaces directory
  createdAt: string;
}

interface Workspace {
  id: string;
  projectID: string;
  name: string;
  branch: string;
  path: string;
  description?: string;
  createdAt: string;
  lastAccessedAt: string;
}
```

The database is stored at `~/.wkt/database.json`.

### Configuration (`src/core/config.ts`)

YAML configuration with hierarchy:

1. Workspace `.wkt.yaml`
2. Project section in global config
3. Global `~/.wkt/config.yaml`

Key functions:

```typescript
loadConfig(): Config
loadProjectConfig(projectName: string): ProjectConfig
mergeConfigs(base: Config, override: Partial<Config>): Config
```

### Git Operations (`src/utils/git.ts`)

Wrapper around git commands:

```typescript
// Core operations
cloneBare(url: string, path: string): void
addWorktree(repoPath: string, worktreePath: string, branch: string): void
removeWorktree(repoPath: string, worktreePath: string): void

// Branch operations
getCurrentBranch(path: string): string
branchExists(repoPath: string, branch: string): boolean
isBranchMerged(repoPath: string, branch: string, base: string): boolean

// Status
hasUncommittedChanges(path: string): boolean
getCommitInfo(path: string): CommitInfo
```

### Local Files (`src/utils/local-files.ts`)

Manages shared (symlinked) and copied files:

```typescript
syncLocalFiles(workspace: Workspace, config: Config): void
createSymlink(source: string, target: string): void
copyFromTemplate(template: string, target: string, variables: Record<string, string>): void
```

### Script Executor (`src/utils/script-executor.ts`)

Secure script execution:

```typescript
interface ScriptDefinition {
  name: string;
  command: string[];
  conditions?: ScriptConditions;
  timeout?: number;
  optional?: boolean;
  env?: Record<string, string>;
}

executeScript(script: ScriptDefinition, context: ExecutionContext): Promise<void>
validateCommand(command: string[], allowlist: string[]): boolean
```

Security features:
- Command allowlisting
- Timeout enforcement
- Variable substitution (no shell injection)

### Branch Inference (`src/utils/branch-inference.ts`)

Pattern matching for branch names:

```typescript
inferBranchName(input: string, patterns: InferencePattern[]): string
sanitizeWorkspaceName(branch: string, strategy: NamingStrategy): string
```

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

## Error Handling

Errors are thrown with context and caught at the command level:

```typescript
// src/utils/errors.ts
class WKTError extends Error {
  constructor(
    message: string,
    public code: string,
    public suggestions?: string[]
  ) {
    super(message);
  }
}

// Usage
throw new WKTError(
  'Workspace already exists',
  'WORKSPACE_EXISTS',
  ['Use --force to overwrite', 'Choose a different name']
);
```

## Testing

```
test/
├── unit/                 # Pure function tests
│   ├── branch-inference.test.ts
│   ├── config.test.ts
│   ├── database.test.ts
│   └── duration.test.ts
└── e2e/                  # CLI integration tests
    └── basic-workflow.test.ts
```

**Unit tests:** Test pure logic without git or filesystem.

**E2E tests:** Create real git repos in `/tmp` and run the CLI.

```bash
bun test              # All tests
bun test:unit         # Unit only
bun test:e2e          # E2E only
```

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

## Adding a New Command

1. Create `src/commands/mycommand.ts`:

```typescript
import { Command } from 'commander';
import { loadDatabase } from '../core/database.js';

export function myCommand(arg: string, options: MyOptions): void {
  const db = loadDatabase();
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

3. Add tests in `test/unit/` or `test/e2e/`.

## Contributing

See [Contributing Guide](contributing.md) for development setup and PR process.
