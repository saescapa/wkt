# WKT Configuration Reference

Complete reference for WKT configuration options.

## Configuration Files

### Hierarchy (highest to lowest priority)

1. **Workspace config** - `.wkt.yaml` in workspace directory
2. **Project config** - `~/.wkt/config.yaml` projects section
3. **Global config** - `~/.wkt/config.yaml`

### File Locations

```
~/.wkt/
├── config.yaml          # Global configuration
├── database.json        # Workspace metadata (managed by WKT)
├── projects/            # Bare repositories
└── workspaces/          # Worktrees
```

---

## Global Configuration

`~/.wkt/config.yaml`

```yaml
# Local files to sync across workspaces
local_files:
  # Symlinked from main workspace (stay synchronized)
  shared:
    - ".cursor/rules"
    - "docs/"
    - "CLAUDE.md"

  # Copied per workspace (become independent)
  copied:
    - ".env.local"
    - ".vscode/launch.json"

  # Template mappings (source -> target)
  templates:
    ".env.local": ".env.example"
    ".vscode/launch.json": ".vscode/launch.json.template"

# Git settings
git:
  default_base: "main"              # Default base branch
  auto_fetch: true                  # Auto fetch before operations
  push_on_create: false             # Auto push new branches

# Workspace settings
workspace:
  naming_strategy: "sanitized"      # sanitized, kebab-case, snake_case
  auto_cleanup: true                # Auto cleanup merged branches
  max_age_days: 30                  # Auto cleanup after N days

# Branch inference patterns
inference:
  patterns:
    - pattern: '^(\d+)$'
      template: 'feature/eng-{}'
    - pattern: '^(feature/.+)$'
      template: '{}'
    - pattern: '^(bugfix/.+)$'
      template: '{}'

# Script execution
scripts:
  # Security allowlist
  allowed_commands:
    - "pnpm"
    - "npm"
    - "bun"
    - "node"
    - "git"
    - "docker"
    - "./scripts/"

  # Predefined scripts
  scripts:
    install-deps:
      name: "Install Dependencies"
      command: ["pnpm", "install"]
      conditions:
        file_exists: ["package.json"]
      timeout: 300000

  # Lifecycle hooks
  hooks:
    post_create:
      - script: "install-deps"

  # Shortcuts
  shortcuts:
    i: "install-deps"

# Project-specific overrides
projects:
  my-project:
    git:
      default_base: "develop"
    inference:
      patterns:
        - pattern: '^(\d+)$'
          template: 'feature/PROJ-{}'
```

---

## Local Files

### Shared Files (Symlinked)

Files listed under `shared` are symlinked from the main workspace:

```yaml
local_files:
  shared:
    - ".cursor/rules"          # Single file
    - "docs/"                  # Entire directory
    - ".github/workflows/"     # Nested path
```

**Behavior:**
- Created as symlinks pointing to main workspace
- Changes in any workspace reflect everywhere
- Breaking the main workspace breaks all symlinks

### Copied Files (Templated)

Files listed under `copied` are copied per workspace:

```yaml
local_files:
  copied:
    - ".env.local"
    - ".vscode/settings.json"
```

**Behavior:**
- Copied from main workspace or template
- Each workspace gets its own independent copy
- Changes are workspace-specific

### Template Mappings

Specify source templates for copied files:

```yaml
local_files:
  templates:
    ".env.local": ".env.example"
    ".vscode/launch.json": ".vscode/launch.json.template"
```

If no template is specified, the file is copied directly from the main workspace.

### Workspace-Specific Templates

Different templates based on workspace/branch patterns:

```yaml
local_files:
  workspace_templates:
    "feature/*":
      ".env.local": ".env.dev.example"

    "*staging*":
      ".env.local": ".env.staging.example"

    "hotfix/*":
      ".env.local":
        source: ".env.prod.example"
        variables:
          debug_mode: "false"
```

---

## Scripts

### Script Definition

```yaml
scripts:
  scripts:
    my-script:
      name: "Human Readable Name"
      command: ["cmd", "arg1", "arg2"]
      description: "What this script does"
      timeout: 60000                    # ms, default: 120000
      optional: true                    # Don't fail if script fails
      background: true                  # Run in background
      conditions:
        file_exists: ["package.json"]
        file_missing: ["dist/"]
        branch_pattern: "^feature/.*"
      env:
        MY_VAR: "value"
```

### Template Variables

Available in script commands:

| Variable | Description |
|----------|-------------|
| `{{workspace_name}}` | Current workspace name |
| `{{branch_name}}` | Current branch name |
| `{{project_name}}` | Project name |
| `{{workspace_path}}` | Full workspace path |
| `{{base_branch}}` | Base branch name |

**Example:**

```yaml
scripts:
  scripts:
    create-db:
      command: ["pscale", "branch", "create", "mydb", "{{branch_name}}"]
```

### Conditions

| Condition | Description |
|-----------|-------------|
| `file_exists` | Run only if all files exist |
| `file_missing` | Run only if all files are missing |
| `branch_pattern` | Run only if branch matches regex |

### Hooks

Automatic script execution at lifecycle events:

```yaml
scripts:
  hooks:
    post_create:
      - script: "install-deps"
      - script: "build"
        conditions:
          file_missing: ["dist/"]

    pre_switch:
      - script: "docker-down"
        optional: true

    post_switch:
      - script: "docker-up"
        optional: true

    pre_clean:
      - script: "cleanup"
        optional: true
```

### Workspace-Specific Scripts

Override scripts for specific workspace patterns:

```yaml
scripts:
  workspace_scripts:
    "feature/*":
      post_create:
        - script: "install-deps"
        - script: "start-dev-server"
      scripts:
        dev-server:
          command: ["pnpm", "dev"]
          background: true

    "hotfix/*":
      post_create:
        - script: "install-deps"
        # No dev server for hotfixes
```

### Shortcuts

Quick aliases for scripts:

```yaml
scripts:
  shortcuts:
    i: "install-deps"
    b: "build"
    t: "test"
    up: "docker-up"
    down: "docker-down"
```

Usage: `wkt run i` runs `install-deps`

---

## Branch Inference

Automatically expand short branch names:

```yaml
inference:
  patterns:
    # Ticket number -> feature branch
    - pattern: '^(\d+)$'
      template: 'feature/eng-{}'

    # Prefixed ticket -> feature branch
    - pattern: '^eng-(\d+)$'
      template: 'feature/eng-{}'

    # Already a feature branch -> pass through
    - pattern: '^(feature/.+)$'
      template: '{}'

    # Already a bugfix branch -> pass through
    - pattern: '^(bugfix/.+)$'
      template: '{}'
```

**Examples with above config:**
- `1234` → `feature/eng-1234`
- `eng-1234` → `feature/eng-1234`
- `feature/auth` → `feature/auth`
- `auth` → `feature/auth` (if no match, prepends `feature/`)

---

## Git Settings

```yaml
git:
  default_base: "main"           # Default branch for new workspaces
  auto_fetch: true               # Fetch before operations
  push_on_create: false          # Push branch after creation
```

Per-project overrides:

```yaml
projects:
  legacy-project:
    git:
      default_base: "master"
```

---

## Workspace Settings

```yaml
workspace:
  naming_strategy: "sanitized"   # How to name workspace directories
  auto_cleanup: true             # Auto-remove merged branches
  max_age_days: 30               # Remove workspaces older than this
```

**Naming Strategies:**

| Strategy | Input | Output |
|----------|-------|--------|
| `sanitized` | `feature/auth-system` | `feature-auth-system` |
| `kebab-case` | `feature/AUTH_System` | `feature-auth-system` |
| `snake_case` | `feature/auth-system` | `feature_auth_system` |

---

## Project-Specific Configuration

Override any global setting per project:

```yaml
projects:
  my-project:
    git:
      default_base: "develop"

    workspace:
      max_age_days: 14

    inference:
      patterns:
        - pattern: '^(\d+)$'
          template: 'feature/PROJ-{}'

    local_files:
      shared:
        - "custom-shared-file.md"
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WKT_HOME` | Override WKT home directory (default: `~/.wkt`) |
| `WKT_DEBUG` | Enable debug logging |

---

## Example: Full Configuration

See `.wkt.yaml.example` in the repository for a comprehensive example with all options demonstrated.
