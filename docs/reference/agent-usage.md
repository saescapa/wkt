# Using WKT from LLM Agents

This guide documents the non-interactive contract for automated / agent use of the `wkt` CLI.

## Non-Interactive Mode

WKT detects non-interactive mode from any of:

- `--yes` / `-y` global flag
- `WKT_NON_INTERACTIVE=1` environment variable
- stdin is not a TTY (e.g. piped input)

In non-interactive mode:

- **Confirmations** auto-accept the safe default (proceed when progress is the goal, skip when the prompt is an optional enhancement).
- **Required input** (missing project/branch/workspace name, repo URL, etc.) fails fast with a `NonInteractiveError` whose message names the exact flag or argument to pass.
- **Optional prompts** (e.g. "use a template?", "update description?") resolve to the negative default.

Agents should always pass `-y` or set `WKT_NON_INTERACTIVE=1` to guarantee the process never hangs waiting for input.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | Success |
| `1`  | Error (validation, git failure, non-interactive input required, etc.) |
| `130` | User interrupt (Ctrl+C). Not produced in non-interactive mode. |

## Command Contract

For each command, this table shows what must be passed on the CLI when running non-interactively.

### `wkt init`

Initialize a project.

| Scenario | Required flags/args |
|----------|--------------------|
| From remote | `wkt init <repository-url> [project-name]` |
| From current git repo | run inside a git repo with an `origin` remote |
| Local-only | `wkt init --local <project-name>` |
| Apply template | `wkt init --apply-template <project-name> --template <template-name>` |

Template selection prompts are skipped in non-interactive mode. Pass `--template` explicitly.

### `wkt create`

Create a new workspace.

```
wkt create <project> <branch-name> [--from <base>] [--description "<text>"]
```

Both `<project>` and `<branch-name>` are required non-interactively when more than one project is initialized.

### `wkt switch`

Switch to a workspace.

```
wkt switch <workspace> [-p <project>]
```

Workspace name is required. If the name is ambiguous across projects, qualify with `-p <project>` or use `project/workspace` form.

### `wkt list` / `wkt ls`

Fully non-interactive. Filters: `-p`, `--filter`, `--dirty`, `--stale`, `--all`.

### `wkt info`

```
wkt info                            # human-readable
wkt info --json                     # JSON output (recommended for agents)
wkt info --name-only                # just the workspace name
wkt info --branch-only
wkt info --description-only
wkt info --set-description "<text>" # must pass text non-interactively
```

### `wkt merge`

```
wkt merge <workspace> [-p <project>] [--into <branch>] [--squash] [--clean] [--force]
```

Workspace name required when not running from within a workspace. If the source has uncommitted changes, the merge cancels unless `--force` is passed.

### `wkt clean`

```
wkt clean [workspace] [--merged|--older-than <dur>|--all] --force
```

`--force` is **required** non-interactively to skip the checkbox selection. Orphan cleanup is skipped non-interactively (it requires interactive selection).

### `wkt rename`

```
wkt rename <new-name> [--from <base>] [--no-rebase] [--description "<text>"] [--force]
```

`<new-name>` is required. If the new branch already exists, the command fails — pass a different name.

### `wkt shared`

```
wkt shared [-p <project>]
```

Prints the path to the project's shared directory (`~/.wkt/shared/<project>/`). The directory is created on first call. Project is inferred from the current workspace; pass `-p` if running outside a workspace and more than one project is initialized.

### `wkt config`

```
wkt config show [--project <name>|--global]
wkt config path
wkt config debug
```

Non-interactive.

## Recipes

### Create a workspace, do work, merge, clean up

```bash
wkt -y create myproj feature-xyz
wkt -y switch feature-xyz
# ... make commits inside the workspace ...
wkt -y merge feature-xyz --clean
```

### Discover current workspace programmatically

```bash
wkt info --json
# {"name":"feature-xyz","branchName":"feature/xyz",...}
```

### List dirty workspaces across all projects

```bash
wkt -y list --dirty
```

### Initialize a local-only project

```bash
wkt -y init --local my-scratch
```

## Discovery

Run `wkt help agent` to print a condensed form of this contract from the CLI itself.
