# Workspace Hooks Requirements

## Overview
WKT should support repo-specific automation through configurable hooks that run at different lifecycle events. This allows each repository to define its own build processes, dependency management, and setup routines while WKT orchestrates the execution.

## Requirements

### 1. Configuration System

#### 1.1 Project-Level Configuration
- Configuration file: `<project-root>/.wkt.yaml` or `<project-root>/wkt.yaml`
- Fallback to global configuration in `~/.wkt/config.yaml`
- YAML format for readability and comments support

#### 1.2 Configuration Schema
```yaml
hooks:
  post_create:      # After workspace creation
    - "pnpm install --frozen-lockfile"
    - "pnpm build"
  pre_switch:       # Before switching to workspace
    - "pnpm install --prefer-offline"
  post_switch:      # After switching to workspace
    - "echo 'Switched to {{workspace_name}}'"
  pre_clean:        # Before cleaning workspace
    - "pnpm store prune"

cache:
  directories:      # Directories that contain cached data
    - "node_modules"
    - "dist"
    - ".next/cache"
    - "target"      # Rust
  commands:
    install: "pnpm install"
    build: "pnpm build"
    dev: "pnpm dev"
    test: "pnpm test"

workspace:
  auto_setup: true          # Run post_create hooks automatically
  parallel_hooks: false     # Run hooks sequentially by default
  timeout: 300              # Hook timeout in seconds
  ignore_errors: false     # Fail fast on hook errors
```

### 2. Hook Types and Execution

#### 2.1 Lifecycle Hooks
- `post_create`: After workspace creation (git worktree created)
- `pre_switch`: Before switching to workspace
- `post_switch`: After switching to workspace (cwd changed)
- `pre_clean`: Before workspace cleanup/removal
- `post_clean`: After workspace cleanup/removal

#### 2.2 Manual Hooks
- `wkt exec <project> <command>`: Run command in project context
- `wkt setup <workspace>`: Run setup hooks manually
- `wkt cache <action>`: Cache management operations

#### 2.3 Hook Execution Context
- **Working Directory**: Workspace directory (not bare repo)
- **Environment Variables**: 
  - `WKT_PROJECT_NAME`: Current project name
  - `WKT_WORKSPACE_NAME`: Current workspace name
  - `WKT_WORKSPACE_PATH`: Full path to workspace
  - `WKT_BRANCH_NAME`: Current branch name
  - `WKT_BASE_BRANCH`: Base branch name

### 3. Command Line Interface

#### 3.1 New Flags
```bash
# Workspace creation with automatic setup
wkt create <project> <branch> --setup          # Run post_create hooks
wkt create <project> <branch> --no-setup       # Skip post_create hooks

# Manual hook execution
wkt setup <workspace>                           # Run setup hooks manually
wkt exec <project> -- <command>                # Execute command in project context

# Cache management
wkt cache status [project]                      # Show cache information
wkt cache clean [project]                       # Clean cache directories
wkt cache info                                  # Show cache configuration
```

#### 3.2 Enhanced Existing Commands
```bash
# Enhanced switching with pre/post hooks
wkt switch <workspace> --no-hooks               # Skip pre/post switch hooks
wkt switch <workspace> --setup                  # Run setup after switch

# Enhanced listing with hook status
wkt list --show-cache                           # Show cache status
wkt list --show-hooks                           # Show hook configuration
```

### 4. Error Handling and Logging

#### 4.1 Hook Execution Results
- Display hook command being executed
- Show execution time and exit code
- Capture and display stdout/stderr
- Continue or fail based on `ignore_errors` setting

#### 4.2 Logging
- Log hook execution to `~/.wkt/logs/hooks.log`
- Include timestamps, project, workspace, and command
- Rotate logs to prevent excessive disk usage

#### 4.3 Error Recovery
- Partial failure handling (some hooks succeed, others fail)
- Rollback mechanism for critical failures
- Manual retry capability

### 5. Security and Safety

#### 5.1 Command Validation
- No arbitrary code execution from external sources
- Commands must be defined in project's own configuration
- Shell injection protection through proper escaping

#### 5.2 Resource Limits
- Configurable timeouts for hook execution
- Memory and CPU usage monitoring (future enhancement)
- Concurrent hook execution limits

### 6. Performance Considerations

#### 6.1 Hook Execution
- Parallel execution support where safe
- Caching of hook results for identical operations
- Skip unnecessary hooks (e.g., if no changes detected)

#### 6.2 Cache Optimization
- Intelligent cache invalidation based on file changes
- Cache sharing across workspaces for same project
- Cleanup of stale cache entries

### 7. Compatibility and Migration

#### 7.1 Backwards Compatibility
- All existing WKT functionality remains unchanged
- Hooks are opt-in (no configuration = no hooks)
- Graceful degradation if hook configuration is invalid

#### 7.2 Migration Path
- Existing projects can gradually adopt hook configuration
- No breaking changes to existing workflows
- Clear documentation for migration from manual processes

### 8. Future Enhancements

#### 8.1 Advanced Features
- Conditional hooks based on file changes
- Hook templates for common project types
- Integration with CI/CD systems
- Remote hook execution for distributed teams

#### 8.2 Ecosystem Integration
- Built-in templates for popular frameworks (Next.js, React, Vue)
- Integration with package managers (npm, yarn, pnpm, bun)
- Support for monorepo tools (Turborepo, Nx, Lerna)

## Success Criteria

1. **Developer Experience**: Workspace creation should be fully automated for configured projects
2. **Performance**: Hook execution should not significantly slow down WKT operations
3. **Reliability**: Hook failures should be clearly reported and recoverable
4. **Flexibility**: Support diverse project types and build processes
5. **Safety**: No security vulnerabilities from command execution
6. **Maintainability**: Clean, well-documented code that's easy to extend

## Non-Requirements

1. **Universal Caching**: WKT won't implement its own caching system
2. **Build System**: WKT won't replace existing build tools
3. **Package Management**: WKT won't manage dependencies directly
4. **Remote Execution**: Initial version won't support remote hook execution
5. **GUI**: Command-line interface only