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
bun run dev         # Run from source (uses real ~/.wkt)
bun run dev:safe    # Run in isolated temp directory (safe for testing)
```

The `dev:safe` script sets `WKT_HOME` to a temporary directory, preventing accidental modifications to your production `~/.wkt` data during development.

**Environment Isolation:**
```bash
# Use a custom WKT directory (useful for testing)
WKT_HOME=/tmp/wkt-test bun run dev list

# Tests automatically use isolated directories via WKT_HOME
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

## Session Exit Checklist

Before ending a development session:

### Testing
- [ ] **Tests written/updated** - All code changes have corresponding test coverage
- [ ] **Tests pass** - `bun test` succeeds
- [ ] **Changes verified** - Manual smoke test of changed functionality

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
