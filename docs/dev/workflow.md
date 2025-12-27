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

**Requirements:**
- New features need tests
- Bug fixes need regression tests
- E2E tests for CLI command changes

## Development Setup

**Setup:**
```bash
bun install
bun run dev         # Run from source
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

- [ ] **Tests pass** - `bun test` succeeds
- [ ] **Types check** - `bun run typecheck` succeeds
- [ ] **Lint clean** - `bun run lint` succeeds
- [ ] **Docs updated** - If behavior changed, update relevant docs
- [ ] **CHANGELOG updated** - Add entry for user-facing changes
- [ ] **TODOs updated** - Update `docs.local/todos.md` with progress
- [ ] **Changes verified** - Manual smoke test of changed functionality
