# Development Workflow

## Code Style (TypeScript)

**Naming:**
- Variables/functions: `camelCase`
- Types/interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Acronyms uppercase: `userID`, `apiURL` (not `userId`)
- Files: `kebab-case.ts`

**Types:**
- Strict mode enabled
- No `any` without justification
- Explicit types for function parameters and returns
- Prefer interfaces over type aliases for objects

**Code:**
- Self-documenting code over comments
- Comments only for non-obvious "why"
- ESM imports only (no CommonJS)
- Absolute paths in tool calls

**Imports order:**
```typescript
// 1. Node built-ins
import { execSync } from 'child_process';

// 2. External packages
import chalk from 'chalk';

// 3. Internal (relative)
import { loadDatabase } from '../core/database.js';
```

## Testing

Tests live in `test/`:
```
test/
├── unit/           # Pure function tests
├── e2e/            # CLI integration tests
└── TESTING.md      # Testing guide
```

**Commands:**
```bash
bun test            # All tests
bun test:unit       # Unit only
bun test:e2e        # E2E only
bun test:watch      # Watch mode
```

**Requirements (mandatory for all work):**
- **New features** - Write tests before marking complete
- **Bug fixes** - Add regression tests that would have caught the issue
- **Refactors** - Verify existing tests pass; update if behavior changed
- **Modified code** - Update any tests that reference changed functionality
- **CLI commands** - E2E tests for any command changes

No code change is complete without corresponding test coverage.

## Development Setup

**Setup:**
```bash
bun install
bun run dev         # Run from source (uses real ~/.wkt) - DANGEROUS
bun run dev:safe    # Run in isolated temp directory (ALWAYS USE THIS)
```

**⚠️ CRITICAL: Always use `dev:safe` for manual testing**

The `dev:safe` script sets `WKT_HOME` to a temporary directory, preventing accidental modifications to your production `~/.wkt` data during development.

**Never use `bun run dev` for testing** - it operates on your real workspaces and can:
- Delete or corrupt production workspaces
- Release or rename your main workspace (breaking symlinks)
- Modify your actual project data

**Environment Isolation:**
```bash
# ALWAYS use dev:safe for manual testing
bun run dev:safe list
bun run dev:safe create my-project feature/test
bun run dev:safe clean my-project/test

# Or set WKT_HOME explicitly for a persistent test directory
WKT_HOME=/tmp/wkt-test bun run dev list

# Automated tests use isolated directories automatically via WKT_HOME
bun test
```

**Before committing:**
```bash
bun run lint        # ESLint
bun run typecheck   # TypeScript
bun test            # All tests
```

Pre-commit hooks (Husky) run lint + typecheck automatically.

**Build:**
```bash
bun run build       # Output to dist/
```

## Code Ethos

1. **Simplicity over cleverness** - Readable code wins
2. **Explicit over implicit** - Clear intent, no magic
3. **Fail fast** - Validate early, error with context
4. **No dead code** - Delete unused code, don't comment it out
5. **Test behavior, not implementation** - Tests should survive refactors

## Worktrees: a workspace or a branch in place?

wkt manages git worktrees, but not every new branch needs one. Choose by what
the work needs:

- **New workspace (`wkt create`)** when work runs **concurrently** (parallel
  agents, or a build/server held in one directory while you edit another), must
  **preserve in-flight state** (uncommitted changes, a running process), or needs
  **clean isolation** from the current tree.
- **Branch in place (`git checkout -b`)** when work is **sequential** on a
  **clean, committed** tree and a second directory's setup cost buys nothing.
  Branching in place drifts the wkt database off the recorded branch — run
  `wkt reconcile` afterward so it catches up.

The full decision criteria and the parallel fan-out workflow live in the
`wkt-worktrees` skill (`skills/wkt-worktrees/SKILL.md`).

## Merge-readiness

A feature branch isn't ready to merge into the default just because it's
committed. The **Documentation** and **CHANGELOG** items in the Session Exit
Checklist below *are* the merge-readiness gate: docs that describe a change must
land in the same branch as the change. Merging code without its docs leaves every
later branch — which forks from the default — inheriting the gap.

## Session Exit Checklist

Before ending a development session:

### Testing
- [ ] **Tests written/updated** - All code changes have corresponding test coverage
- [ ] **Tests pass** - `bun test` succeeds
- [ ] **Changes verified** - Manual smoke test using `bun run dev:safe` (NEVER `bun run dev`)

### Code Quality
- [ ] **Types check** - `bun run typecheck` succeeds
- [ ] **Lint clean** - `bun run lint` succeeds

### TODO Lists
- [ ] **Project TODOs** - Update `docs.local/todos.md` with progress
- [ ] **Code TODOs** - Remove stale/resolved TODO comments from code
- [ ] **CHANGELOG** - Add entry for user-facing changes

### Documentation
- [ ] **Architecture docs** - Update `docs/dev/architecture.md` if codebase structure changed
- [ ] **User guide** - Update `docs/reference/user-guide.md` if user-facing behavior changed
- [ ] **Code examples** - Ensure examples in docs still work

### UI Copy & Help
- [ ] **CLI help text** - Update command descriptions and option help in source
- [ ] **Error messages** - Update if behavior changed
- [ ] **Help/docs sync** - Ensure `--help` output matches documentation
