# WKT Configuration Reference

Complete reference for WKT configuration options.

## Configuration Files

All configuration lives in one file: `~/.wkt/config.yaml`. A project's
effective config is resolved from two sources:

1. **Project template config** — stored on the project record when a template
   is applied (`wkt init --template <name>` or `wkt init --apply-template`);
   highest priority
2. **Project section** — the `projects.<name>` section of `config.yaml`
3. **Global defaults** — the top-level sections of `config.yaml`

There is no per-workspace config file. Inspect a project's effective config
with `wkt config --project <name>`.

### File Locations

```
~/.wkt/
├── config.yaml          # All configuration (global + per-project sections)
├── database.json        # Project/workspace metadata (managed by WKT)
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

# Workspace settings
workspace:
  naming_strategy: "sanitized"      # sanitized, kebab-case, snake_case

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
    workspace:
      naming_strategy: "kebab-case"
    inference:
      patterns:
        - pattern: '^(\d+)$'
          template: 'feature/PROJ-{}'

# Reusable project templates (applied via wkt init --template / --apply-template)
project_templates:
  ticket-flow:
    inference:
      patterns:
        - pattern: '^(\d+)$'
          template: 'feature/TICKET-{}'
```

The base branch for new workspaces is not configured — it is the project's
detected default branch (recorded at `wkt init` time), overridable per
invocation with `wkt create --from <branch>`.

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

## Workspace Settings

```yaml
workspace:
  naming_strategy: "sanitized"   # How to name workspace directories
```

**Naming Strategies:**

| Strategy | Input | Output |
|----------|-------|--------|
| `sanitized` | `feature/auth-system` | `feature-auth-system` |
| `kebab-case` | `feature/AUTH_System` | `feature-auth-system` |
| `snake_case` | `feature/auth-system` | `feature_auth_system` |

---

## Project-Specific Configuration

Override naming strategy or inference patterns per project under the
`projects` key:

```yaml
projects:
  my-project:
    workspace:
      naming_strategy: "snake_case"
    inference:
      patterns:
        - pattern: '^(\d+)$'
          template: 'feature/PROJ-{}'
```

Templates in `project_templates` have the same shape and take priority over
the `projects` section once applied to a project.

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
