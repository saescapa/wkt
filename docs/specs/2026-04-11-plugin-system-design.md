# Plugin System Design

## Overview

A local, manifest-driven plugin system for WKT that lets plugins hook into workspace lifecycle events, provide run scripts, and manage persistent data. Plugins are directories with a `plugin.yaml` manifest and scripts — no JS plugin API, no distribution mechanism, no CLI namespace extension.

## Plugin Structure

A plugin is a directory:

```
my-plugin/
├── plugin.yaml          # Manifest (required)
├── scripts/             # Hook and run scripts
│   ├── setup.sh         # Runs on plugin install
│   ├── teardown.sh      # Runs on plugin remove
│   ├── project-init.sh  # Runs first time a project uses this plugin
│   ├── post-create.sh   # Lifecycle hook
│   └── status.sh        # Run script (wkt run my-plugin:status)
└── templates/           # Optional scaffolding templates
```

### Manifest (`plugin.yaml`)

```yaml
name: my-plugin
version: 1.0.0
description: What this plugin does

# Plugin-injected variables available to all hooks
variables:
  brain_path: "{{plugin_data_path}}/{{project_name}}/brain"

# Plugin lifecycle scripts
setup: scripts/setup.sh
teardown: scripts/teardown.sh
project_init: scripts/project-init.sh

# Lifecycle hooks — same events as existing wkt hooks
hooks:
  post_create:
    - script: post-create
      conditions:
        file_exists: [package.json]
  pre_clean:
    - script: pre-clean

# Scripts — both hook targets and wkt run commands
scripts:
  post-create:
    name: Post-create setup
    command: [bash, scripts/post-create.sh]
    timeout: 300000
  pre-clean:
    name: Pre-clean archive
    command: [bash, scripts/pre-clean.sh]
  status:
    name: Brain status
    command: [bash, scripts/status.sh]
    run: true  # Exposes as wkt run my-plugin:status

# Allowed commands this plugin uses (merged into allowlist for its scripts only)
allowed_commands:
  - git
  - bun
  - biome
```

Key decisions:
- **Two kinds of scripts:** Lifecycle scripts (`setup`, `teardown`, `project_init`) are direct paths executed as shell commands. Hook scripts are named entries in the `scripts` map, run through `SafeScriptExecutor` with full condition evaluation and variable substitution.
- `run: true` on a script exposes it as `wkt run <plugin>:<script>`
- `variables` injected into hook context; `{{plugin_data_path}}` is a built-in pointing to the plugin's data directory
- `allowed_commands` extends the allowlist scoped to the plugin's scripts only

## Storage and Data

```
~/.wkt/
├── plugins/
│   ├── registry.json
│   └── installed/
│       └── my-plugin/
│           ├── plugin.yaml
│           ├── scripts/
│           ├── templates/
│           └── data/
│               └── my-project/
│                   └── brain/
│                       ├── .git/
│                       ├── overview.md
│                       ├── tasks.md
│                       └── handoffs/
```

### Registry (`registry.json`)

Tracks installed plugins and per-project initialization state:

```json
{
  "plugins": {
    "my-plugin": {
      "enabled": true,
      "installedAt": "2026-04-11T...",
      "source": "/path/to/original/my-plugin"
    }
  },
  "projectInits": {
    "my-plugin": ["my-project", "other-project"]
  }
}
```

### Project Init Trigger

When any lifecycle hook fires for a project, wkt checks `projectInits` to see if each enabled plugin has been initialized for that project. If not, runs `project_init` first, then records it in `projectInits`.

### Built-in Variables

Available to all plugin scripts:

| Variable | Value |
|----------|-------|
| `plugin_path` | Path to the installed plugin directory |
| `plugin_data_path` | Path to the plugin's data directory |
| `project_name` | Current project name |
| `workspace_name` | Current workspace name |
| `workspace_path` | Current workspace path |
| `branch_name` | Current branch |
| `base_branch` | Project's default branch |

Plugin-declared variables in the manifest can reference these with `{{...}}` syntax.

**Variable availability by lifecycle stage:**

| Stage | Available variables |
|-------|-------------------|
| `setup` / `teardown` | `plugin_path`, `plugin_data_path` only (no project/workspace context) |
| `project_init` | Above + `project_name`, `base_branch` |
| Hook scripts / run scripts | All variables (full workspace context) |

## Plugin Management Commands

```
wkt plugin install <path>    # Install from local directory
wkt plugin remove <name>     # Remove plugin and optionally its data
wkt plugin list              # Show installed plugins + status
wkt plugin enable <name>     # Enable a disabled plugin
wkt plugin disable <name>    # Disable without removing
```

### Install Flow

1. Read `plugin.yaml` from `<path>`, validate manifest
2. Copy plugin directory to `~/.wkt/plugins/installed/<name>/`
3. Create `data/` directory
4. Run `setup` script if declared
5. Register in `registry.json`

### Remove Flow

1. Run `teardown` script if declared
2. Prompt: "Remove plugin data too?" — default no
3. Remove from `~/.wkt/plugins/installed/<name>/` (and optionally `data/`)
4. Remove from `registry.json`

### Enable/Disable

Flips the `enabled` flag in `registry.json`. Disabled plugins are skipped during hook execution but keep their data.

## Hook Execution Pipeline

When a lifecycle event fires (e.g., `post_create`):

```
1. Check enabled plugins for project_init needs
   └── Run project_init for any plugin not yet initialized for this project

2. Execute user-defined hooks (from config.yaml / .wkt.yaml)
   └── Existing behavior, untouched

3. Execute plugin hooks (from each enabled plugin's manifest)
   └── Alphabetical by plugin name
   └── Each plugin's hooks run through SafeScriptExecutor
   └── Plugin variables injected into context
   └── Plugin's allowed_commands merged for its scripts
```

### Execution Rules

- **User hooks first.** User config always takes priority. If a user hook fails and isn't marked `optional`, plugin hooks don't run.
- **Plugin isolation.** Each plugin's `allowed_commands` only applies to that plugin's scripts.
- **Variable namespacing.** If two plugins declare the same variable name, wkt warns at install time.
- **Plugin failure scope.** A failing non-optional plugin hook stops that plugin's remaining hooks but doesn't block other plugins. User hook failures stop everything (existing behavior preserved).

### SafeScriptExecutor Changes

The executor accepts an additional `PluginContext` that carries:
- The plugin's script definitions
- The plugin's allowed commands
- The plugin's variables

Additive change — existing behavior unchanged when no plugin context is present.

## Run Script Integration

Scripts with `run: true` register as `wkt run <plugin>:<script>`. Running `wkt run` with no args lists all available scripts including plugin-provided ones.

```bash
wkt run my-plugin:status
wkt run my-plugin:handoff
wkt run my-plugin:tasks
```

## Code Changes

### New Files

| File | Purpose |
|------|---------|
| `src/commands/plugin.ts` | `wkt plugin install/remove/list/enable/disable` |
| `src/core/plugin-manager.ts` | Plugin discovery, registry, manifest loading, variable injection |
| `src/core/plugin-types.ts` | `PluginManifest`, `PluginRegistry`, `PluginContext` interfaces |

### Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Register `plugin` command |
| `src/utils/script-executor.ts` | Accept `PluginContext` in hook execution methods, merge plugin variables + allowed commands |
| `src/commands/create.ts` | After user hooks, call plugin hooks via plugin manager |
| `src/commands/switch.ts` | Same — plugin hooks after user hooks |
| `src/commands/clean.ts` | Same |
| `src/commands/run.ts` | List and execute plugin run scripts alongside user scripts |
| `src/utils/constants.ts` | Add plugin directory paths |

### Not Changed

- `config.ts`, `database.ts`, `migrations.ts` — plugins have their own registry
- Existing hook behavior — user hooks run exactly as before

## First Plugin: Scaffolding + Brain

This validates the design but is a separate implementation. The brain plugin's internals will be shaped by testing and usage.

**Scaffolding (`project_init`):** Templates monorepo structure (bun, biome, TS, husky, tests), optional frontend, AGENT.md/MCP/skills config, initializes brain git repo.

**Brain hooks:**

| Event | Behavior |
|-------|----------|
| `post_create` | Creates handoff template for workspace, commits to brain |
| `pre_clean` | Prompts to finalize handoff, commits |
| `post_clean` | Archives handoff, commits |

**Brain run scripts:**

| Command | Purpose |
|---------|---------|
| `wkt run brain:status` | Overview, open tasks, active workspaces |
| `wkt run brain:handoff` | Create/update handoff for current workspace |
| `wkt run brain:tasks` | List tasks |
| `wkt run brain:commit` | Commit brain state |

**Agent discovery:** AGENT.md in each workspace points to the brain path and explains usage conventions.

## Out of Scope

- Plugin distribution (npm, git repos) — local filesystem only
- CLI namespace extension (`wkt brain status`) — use `wkt run brain:status`
- Plugin-to-plugin dependencies
- New hook events (e.g., `post_merge`) — can be added later independently
- Brain plugin implementation details — separate iteration, shaped by usage
