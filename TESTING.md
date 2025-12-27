# WKT Testing Guide

This document outlines the testing strategy for the WKT CLI tool.

## Test Structure

```
test/
├── unit/                           # Unit tests for pure logic
│   ├── branch-inference.test.ts    # Branch inference and sanitization
│   ├── config.test.ts              # Config management
│   ├── database.test.ts            # Database operations
│   └── duration.test.ts            # Duration parsing
├── e2e/                            # End-to-end tests with real git
│   └── basic-workflow.test.ts      # Full CLI workflows
└── utils/                          # Test utilities
    └── test-helpers.ts             # Test environment helpers
```

## Running Tests

```bash
# All tests
bun test

# Unit tests only
bun test:unit

# E2E tests only
bun test:e2e

# Watch mode
bun test:watch

# With coverage
bun test:coverage
```

## Test Layers

### Unit Tests (53 tests)

Test pure logic without external dependencies:

- **Branch Inference** — Pattern matching, branch name inference, workspace name sanitization
- **Config** — Loading, merging, saving YAML config, project-specific overrides
- **Database** — CRUD operations for projects/workspaces, search, current workspace tracking
- **Duration** — Parsing duration strings (`30d`, `2w`, `6m`, `1y`)

### E2E Tests (23 tests)

Test the actual CLI binary with real git operations:

- **Basic Commands** — Help, version, error handling for missing resources
- **Command Help** — All commands have proper help text and options
- **Full Workflow** — Real git repo creation, init → create → list → switch → clean

E2E tests create temporary git repositories in `/tmp` and run the built CLI against them.

## Test Coverage

### Well Covered
- Branch name inference and sanitization
- Config loading, merging, and persistence
- Database CRUD operations
- CLI command structure
- Full init → create → switch → list → clean workflow
- Error handling for edge cases

### Not Yet Covered
- Local files management (symlinks, templates)
- Cross-platform compatibility (Windows)
- Performance under load
- Lifecycle hooks execution

## Adding Tests

### Unit Tests

For pure functions and class methods that don't require git:

```typescript
import { describe, it, expect } from 'bun:test';

describe('MyFunction', () => {
  it('should do something', () => {
    expect(myFunction('input')).toBe('expected');
  });
});
```

### E2E Tests

For testing CLI commands with real git operations:

```typescript
import { execSync } from 'child_process';

function createTestGitRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  execSync('git init', { cwd: path, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: path, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: path, stdio: 'pipe' });
  writeFileSync(join(path, 'README.md'), '# Test\n');
  execSync('git add . && git commit -m "Initial"', { cwd: path, stdio: 'pipe' });
}

it('should init project', async () => {
  const result = await wkt(['init', repoPath, 'my-project'], testDir);
  expect(result.exitCode).toBe(0);
});
```

## CI Integration

Tests run on all pushes and PRs via GitHub Actions (`.github/workflows/test.yml`):

1. Lint check
2. Type check
3. Build
4. Unit tests
5. E2E tests
