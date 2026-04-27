# WKT Configuration Reference

Complete reference for WKT configuration options.

## Configuration Files

### Hierarchy (highest to lowest priority)

1. **Workspace config** — `.wkt.yaml` in workspace directory
2. **Project config** — `~/.wkt/config.yaml` `projects` section
3. **Global config** — `~/.wkt/config.yaml`

### File Locations

```
~/.wkt/
├── config.yaml          # Global configuration
├── database.json        # Workspace metadata (managed by WKT)
├── projects/            # Bare repositories (one dir per project)
├── workspaces/          # Worktrees (grouped by project)
└── shared/              # Per-project shared directories
    └── <project>/       # Top-level entries auto-symlinked into each workspace
```

---

## Global Configuration

`~/.wkt/config.yaml`

```yaml
# Filesystem layout
wkt:
  workspace_root: "/Users/me/.wkt/workspaces"
  projects_root: "/Users/me/.wkt/projects"
  shared_root: "/Users/me/.wkt/shared"

# Git settings
git:
  default_base: "main"              # Default base branch
  auto_fetch: true                  # Auto fetch before operations
  auto_rebase: false
  push_on_create: false             # Auto push new branches

# Workspace settings
workspace:
  naming_strategy: "sanitized"      # sanitized, kebab-case, snake_case
  auto_cleanup: true                # Auto cleanup merged branches
  max_age_days: 30

# Display
display:
  hide_inactive_main_branches: true
  main_branch_inactive_days: 7

# Branch inference patterns
inference:
  patterns:
    - pattern: '^(\d+)$'
      template: 'feature/eng-{}'
    - pattern: '^(feature/.+)$'
      template: '{}'

# Project-specific overrides
projects:
  my-project:
    git:
      default_base: "develop"
    inference:
      patterns:
        - pattern: '^(\d+)$'
          template: 'feature/PROJ-{}'

# Command aliases
aliases:
  ls: list
  sw: switch
  rm: clean
```

---

## Shared Directory

WKT does not configure shared files via YAML. Each project has a directory at `~/.wkt/shared/<project>/`. Every top-level entry inside it is symlinked into each new workspace at the same name.

```bash
# Print the shared dir for the current project
wkt shared

# Populate it
cd "$(wkt shared)"
mkdir docs.local
echo "X=secret" > .env

# Optional: version-control the shared dir on its own
cd "$(wkt shared)"
git init
git remote add origin git@github.com:me/my-project-shared.git
```

`.git/`, `.gitignore`, and `.DS_Store` inside the shared dir are skipped (so it can safely be its own git repo). Existing files in a workspace are never overwritten.

---

## Lifecycle Hooks

WKT does not run lifecycle scripts. Use git's built-in `post-checkout` hook for setup work. See [Post-Checkout Hook Pattern](post-checkout-hook.md).

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

---

## Git Settings

```yaml
git:
  default_base: "main"           # Default branch for new workspaces
  auto_fetch: true               # Fetch before operations
  auto_rebase: false
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

Override any global setting per project under the `projects` key:

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
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WKT_HOME` | Override WKT base directory (default: `~/.wkt`) |
| `WKT_DEBUG` | Enable debug logging |
| `WKT_NON_INTERACTIVE` | Disable interactive prompts (also `--yes`/`-y`) |

### WKT_HOME

Override the base directory where WKT stores its configuration, database, workspaces, and shared dirs. Useful for:

- **Development/testing** — avoid modifying production data
- **CI environments** — use isolated directories per job
- **Multiple configurations** — run separate WKT instances

```bash
WKT_HOME=/tmp/wkt-test wkt list
bun run dev:safe    # Automatically uses temp directory
```

**Priority:** `WKT_HOME` > `HOME/.wkt` > `os.homedir()/.wkt`
