# WKT Testing Guide

This document outlines the testing strategy and available tests for the WKT CLI tool.

## Test Structure

```
test/
├── unit/                    # Unit tests for individual modules
│   ├── branch-inference.test.ts    # ✅ Branch inference logic
│   ├── config.test.ts              # ⚠️  Config management (needs isolation fixes)
│   └── database.test.ts            # ⚠️  Database operations (needs isolation fixes)
├── integration/             # Integration tests for commands
│   ├── init-command.test.ts        # ⚠️  Init command (needs mocking fixes)
│   └── create-command.test.ts      # ⚠️  Create command (needs mocking fixes)
├── e2e/                     # End-to-end tests
│   └── basic-workflow.test.ts      # ✅ CLI behavior and command structure
├── fixtures/                # Test data and fixtures
│   └── clean-database.json         # Clean database state for tests
└── utils/                   # Test utilities and helpers
    ├── test-helpers.ts             # Test environment and mocking utilities
    └── test-managers.ts            # Test-specific manager classes
```

## Running Tests

### All Working Tests
```bash
bun test test/unit/branch-inference.test.ts test/e2e/basic-workflow.test.ts
```

### Individual Test Suites
```bash
# Unit tests (branch inference only - fully working)
bun test test/unit/branch-inference.test.ts

# End-to-end tests (CLI behavior - fully working)
bun test test/e2e/basic-workflow.test.ts

# All unit tests (some need fixes)
bun test test/unit

# Integration tests (need mocking fixes)
bun test test/integration
```

### Test Scripts
```bash
bun run test:unit          # Run unit tests
bun run test:integration   # Run integration tests  
bun run test:e2e          # Run end-to-end tests
bun run test:watch        # Run tests in watch mode
```

## Test Status

### ✅ **Working Tests (31 tests passing)**

#### Branch Inference Tests
- ✅ Infer branch name from ticket number (`1234` → `feature/eng-1234`)
- ✅ Infer branch name from eng-prefixed ticket (`eng-5678` → `feature/5678`)
- ✅ Pass through feature/hotfix/bugfix branches unchanged
- ✅ Handle custom patterns and templates
- ✅ Sanitize workspace names with different strategies
- ✅ Generate workspace IDs correctly

#### CLI E2E Tests
- ✅ Show help when no arguments provided
- ✅ Handle version flag correctly
- ✅ Show appropriate messages for empty state
- ✅ Handle errors for non-existent projects/workspaces
- ✅ Validate command structure and help text
- ✅ All commands have proper help documentation

### ⚠️ **Tests Needing Fixes**

#### Database & Config Tests
**Issue**: Tests interfere with each other and real WKT data
**Solution Needed**: Better test isolation with temporary directories

#### Integration Tests  
**Issue**: Git operations mocking needs improvement
**Solution Needed**: More robust mocking of git commands

## Test Coverage Areas

### ✅ **Well Covered**
- Branch name inference patterns
- Workspace name sanitization
- CLI command structure and help
- Error handling for non-existent resources
- Basic CLI behavior

### 🔄 **Partially Covered**
- Configuration management (logic works, tests need isolation)
- Database operations (logic works, tests need isolation)
- Command integration (basic structure tested)

### ❌ **Not Yet Covered**
- Git operations (GitUtils class)
- Real git worktree creation/management
- File system operations
- Cross-platform compatibility
- Performance under load

## Manual Testing

The CLI has been thoroughly manually tested with:
- ✅ Real repository initialization (`slingshot/eslint-config-slingshot`)
- ✅ Workspace creation with various branch patterns
- ✅ Workspace switching and listing
- ✅ Error scenarios and edge cases
- ✅ Configuration and database persistence

## Future Testing Improvements

1. **Fix Test Isolation**: Update config/database tests to use isolated environments
2. **Improve Git Mocking**: Create more realistic git operation mocks
3. **Add Performance Tests**: Test with many projects/workspaces
4. **Cross-Platform Tests**: Test on Windows, macOS, Linux
5. **Real Git Integration Tests**: Test with actual git repositories
6. **Add Coverage Reporting**: Track test coverage metrics

## Continuous Integration

Tests run automatically on:
- ✅ All pushes to `main` and `develop` branches
- ✅ All pull requests to `main`
- ✅ Lint, typecheck, build, and working tests
- ✅ Basic CLI functionality verification

GitHub Actions workflow: `.github/workflows/test.yml`