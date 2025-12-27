# Contributing to WKT

Guide for contributing to WKT development.

## Development Setup

### Prerequisites

- Node.js >= 20.0.0
- Bun (for development)
- Git

### Getting Started

```bash
# Clone the repository
git clone https://github.com/user/wkt.git
cd wkt

# Install dependencies
bun install

# Run from source
bun run dev

# Build
bun run build

# Run tests
bun test
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Run CLI from source |
| `bun run build` | Build to `dist/` |
| `bun test` | Run all tests |
| `bun test:unit` | Run unit tests only |
| `bun test:e2e` | Run E2E tests only |
| `bun test:watch` | Run tests in watch mode |
| `bun test:coverage` | Run with coverage |
| `bun run lint` | Run ESLint |
| `bun run typecheck` | Run TypeScript type checking |

### Pre-commit Hooks

Husky + lint-staged runs automatically on commit:
- ESLint with auto-fix
- TypeScript type checking

## Code Style

### TypeScript

- Strict mode enabled
- No `any` without justification
- Prefer explicit types for function parameters and returns
- Use interfaces over type aliases for objects

### Naming Conventions

- **Variables/functions:** camelCase
- **Types/interfaces:** PascalCase
- **Constants:** UPPER_SNAKE_CASE
- **Acronyms:** Uppercase (`userID`, `apiURL`, not `userId`)
- **Files:** kebab-case (`branch-inference.ts`)

### Code Organization

- Self-documenting code over comments
- Comments only for non-obvious "why" (not "what")
- One export per file for commands
- Group related utilities in same file

### Imports

```typescript
// Node built-ins first
import { execSync } from 'child_process';
import { existsSync } from 'fs';

// External packages
import chalk from 'chalk';
import { Command } from 'commander';

// Internal imports (relative)
import { loadDatabase } from '../core/database.js';
import { formatWorkspace } from '../utils/format.js';
```

### Error Handling

```typescript
// Throw descriptive errors with suggestions
throw new WKTError(
  'Project not found: my-project',
  'PROJECT_NOT_FOUND',
  [
    'Run "wkt init --list" to see available projects',
    'Run "wkt init <url>" to add a new project'
  ]
);
```

## Testing

### Unit Tests

For pure functions without side effects:

```typescript
// test/unit/my-feature.test.ts
import { describe, it, expect } from 'bun:test';
import { myFunction } from '../../src/utils/my-feature.js';

describe('myFunction', () => {
  it('should handle normal input', () => {
    expect(myFunction('input')).toBe('expected');
  });

  it('should handle edge case', () => {
    expect(myFunction('')).toBe('');
  });
});
```

### E2E Tests

For testing CLI commands with real git operations:

```typescript
// test/e2e/my-workflow.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';

describe('my workflow', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = `/tmp/wkt-test-${Date.now()}`;
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should do something', () => {
    const result = execSync(`bun run dev init ${testDir}/repo`, {
      encoding: 'utf-8',
      env: { ...process.env, WKT_HOME: testDir }
    });
    expect(result).toContain('Success');
  });
});
```

### Test Coverage

Focus testing on:
- Core logic (branch inference, config merging)
- Edge cases and error conditions
- CLI command structure
- Full workflows (E2E)

Less critical:
- Simple wrapper functions
- Output formatting

## Pull Request Process

### Before Submitting

1. **Run all checks:**
   ```bash
   bun run lint
   bun run typecheck
   bun test
   ```

2. **Add tests** for new features or bug fixes

3. **Update documentation** if behavior changes

### PR Guidelines

- Clear, descriptive title
- Link related issues
- Describe what changed and why
- Include test coverage for changes

### Commit Messages

Follow conventional commits:

```
feat: add workspace description support
fix: handle missing config gracefully
refactor: simplify branch inference logic
docs: update configuration reference
test: add E2E tests for clean command
chore: upgrade dependencies
```

## Architecture Notes

### Adding a Command

1. Create handler in `src/commands/`
2. Register in `src/index.ts`
3. Add to appropriate command group
4. Add tests
5. Update docs

### Adding Configuration Options

1. Update types in `src/core/types.ts`
2. Update loading in `src/core/config.ts`
3. Update `.wkt.yaml.example`
4. Update docs/configuration.md

### Adding a Utility

1. Create in `src/utils/`
2. Export functions (not classes unless stateful)
3. Add unit tests
4. Document in architecture.md if significant

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG (if exists)
3. Create git tag
4. Push to main
5. (Future: npm publish)

## Questions?

Open an issue for:
- Bug reports
- Feature requests
- Questions about the codebase
