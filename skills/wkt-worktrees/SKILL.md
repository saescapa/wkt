---
name: wkt-worktrees
description: >-
  Use wkt to run work in parallel across isolated git-worktree workspaces, then
  merge it back. Trigger when you have two or more independent tasks in a
  wkt-managed repo that you want to fan out to subagents, when asked to
  "parallelize", "work on these in parallel", "spin up worktrees", or when
  deploying subagents that each need their own branch/working directory.
  Also covers merging a workspace back and cleaning up.
---

# Parallel work with wkt

`wkt` manages git worktrees as isolated workspaces — each is its own directory
on its own branch. That makes it the right tool for fanning independent tasks
out to subagents: every subagent gets a private working directory, so their
edits, builds, and commits never collide.

This skill is the *when and how to orchestrate*. For the exact non-interactive
flag contract of any command, run **`wkt help agent`**, and see
`docs/reference/agent-usage.md` in the wkt repo for the full reference.

## When to reach for this

Use the parallel pattern when **the tasks are independent and touch disjoint
files**. Parallel worktrees give no benefit — and create merge conflicts — when
tasks edit the same files or depend on each other's output. In that case do the
work sequentially in one workspace instead.

## Non-interactive contract (always)

Subagents and scripted runs must never hang on a prompt. Pass `-y` (or set
`WKT_NON_INTERACTIVE=1`) on **every** `wkt` call:

```bash
wkt -y create my-project feature/auth
```

In non-interactive mode confirmations auto-accept the safe default, and any
missing required argument fails fast with a message naming the exact flag to
pass. Exit code `0` = success, `1` = error.

## The parallel-subagent workflow (local merge)

### 1. Identify the project

```bash
wkt info --json          # if you're already inside a workspace
wkt -y list              # otherwise — shows projects and their workspaces
```

The project name is the first path segment in `wkt list` output.

### 2. Create one workspace per task

Create a workspace per independent task and capture its path. `--path-only`
prints just the absolute directory, which is what you hand to the subagent:

```bash
WS_A=$(wkt -y create my-project feature/task-a --description "Task A" --path-only)
WS_B=$(wkt -y create my-project feature/task-b --description "Task B" --path-only)
```

Each workspace starts from the project's default branch (override with
`--from <base>`). Short branch inputs may be expanded by the project's branch
patterns (e.g. `1234` → `feature/eng-1234`).

### 3. Fan out to subagents

Spawn one subagent per workspace. Each subagent's instructions **must**:

- Operate with its workspace path as the working directory (`cd "<path>"` as the
  first step, using the absolute path from step 2).
- Stay inside that directory — never touch another workspace's files.
- **Commit its work before finishing.** `wkt merge` only moves *committed*
  history; uncommitted changes are left behind in the workspace. This is the
  most common mistake — be explicit about it in the subagent prompt.

### 4. Merge each workspace back into the default branch

Merge sequentially, one workspace at a time, after its subagent reports done:

```bash
wkt -y merge feature-task-a --clean      # merge, then remove the workspace
wkt -y merge feature-task-b --clean
```

Use the **workspace name** (the directory name, e.g. `feature-task-a`), not the
branch. Add `--squash` to collapse the branch into a single commit. `--clean`
deletes the source workspace after a successful merge.

`wkt merge` checks that the target (default-branch) workspace is clean before
merging and merges into the project default branch unless you pass
`--into <branch>`.

### 5. Handle conflicts

If a merge hits a conflict, `wkt merge` **aborts** (leaving the target clean) and
prints resolution instructions. Because merges are sequential, a later
workspace can conflict with an earlier one that already landed. When that
happens:

- Do **not** pass `--clean` on a conflicting merge — you'll want the workspace.
- Resolve in the source workspace: rebase it on the updated default branch
  (`git fetch` + `git rebase`), re-commit, then retry the merge.
- If tasks conflict structurally, that's the signal they weren't actually
  independent — fold them into one sequential workspace.

## Cleanup

```bash
wkt -y clean --merged --force      # remove workspaces whose branches merged
wkt -y list --dirty                # audit: any workspace with uncommitted work
```

`--force` is required non-interactively (it skips the interactive selection).

## Quick reference

| Goal | Command |
|------|---------|
| Find project / current workspace | `wkt info --json` · `wkt -y list` |
| Create a workspace (print path) | `wkt -y create <project> <branch> --path-only` |
| Merge a workspace into default + clean | `wkt -y merge <workspace> --clean` |
| Squash-merge | `wkt -y merge <workspace> --squash --clean` |
| Merge into a non-default branch | `wkt -y merge <workspace> --into <branch>` |
| Remove merged workspaces | `wkt -y clean --merged --force` |
| Full agent contract from the CLI | `wkt help agent` |
