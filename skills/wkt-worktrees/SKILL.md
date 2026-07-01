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

## Worktree or a branch in place?

Two ways to open a new line of work in a wkt repo:

- **A new wkt workspace** (`wkt create`) — its own directory on its own branch.
- **A branch in the workspace you're already in** (`git checkout -b`) — a new
  branch, same directory.

A new workspace is the instinct, but it isn't free: it costs a fresh directory
(dependency install, build warm-up), and if you branch *in place* instead, wkt's
database keeps pointing at the old branch — a `branch-drift` that `wkt reconcile`
later has to fix. Pick by what the work actually needs.

**Reach for a new workspace when *any* of these is true:**

- **Concurrency** — two or more tasks must make progress at the same time
  (parallel subagents; or you want a build / dev server / test run holding in one
  directory while you edit in another). One directory checks out one branch.
- **Preserve in-flight state** — the current workspace has uncommitted changes or
  a running process you don't want to stash or interrupt.
- **Clean isolation** — you want to start from the current default branch without
  inheriting whatever the current directory is carrying.
- **Independent shippable feature** — it'll be reviewed and merged on its own
  cadence.

**A branch in place is fine — and lighter — when *all* of these hold:**

- The work is **sequential** (nothing else running alongside it).
- The current tree is **clean and committed** (nothing to preserve, nothing to
  collide with).
- It's a short continuation in the same context, where a second directory's setup
  cost buys nothing.
- You'll merge or delete that branch before moving on — or run `wkt reconcile` so
  the database catches up to the branch you actually switched to.

When two tasks touch the **same files or depend on each other's output**, neither
parallel workspaces nor parallel branches help: that work is not independent, so
do it sequentially in one place.

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

Before merging any workspace, confirm it's merge-*ready* — see
[Before you merge](#before-you-merge--readiness) below. Then merge sequentially,
one workspace at a time, after its subagent reports done:

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
- Resolve in the source workspace: rebase it onto the updated default branch
  with `wkt merge --into <workspace> --rebase` (replays the feature onto its
  base; resolve any conflicts it reports), then retry the merge.
- If tasks conflict structurally, that's the signal they weren't actually
  independent — fold them into one sequential workspace.

## Before you merge — readiness

`wkt merge` moves git history; it does **not** check whether the change is
*complete*. A clean merge of an incomplete branch still lands an incomplete
default. Before merging — whether it's a fanned-out workspace or a branch you
made in place — confirm:

- **Work is committed.** `wkt merge` only moves committed history; uncommitted
  changes stay behind in the source. This is the most common mistake.
- **Docs travel with the code.** The branch isn't merge-ready until the docs that
  describe its change are updated *in the same branch* — user guide / reference
  for user-facing behavior, architecture docs if structure changed, and `--help`
  / error-message text in the source. Don't leave them for "after the merge."
- **CHANGELOG updated.** Add an entry under `## [Unreleased]` for any user-facing
  change before the branch lands, so the changelog never lags the code.

Why it matters here specifically: the next task forks from the default branch
(see [Starting the next task from a fresh base](#starting-the-next-task-from-a-fresh-base)).
Merge code without its docs and changelog, and every later branch inherits that
gap — the drift compounds instead of getting caught.

## Shared docs.local across parallel workspaces

If the project keeps working notes in a `docs.local/` that resolves (via symlink) to a
**shared, remote-backed** docs repo — one every workspace and every machine points at —
then parallel subagents all write into the *same* git repo, so it can race and drift.
Keep it consistent:

- **Pull before, push after.** Fetch latest before writing (`git -C <docs-root> pull
  --rebase --autostash`) and push right after committing. Don't let a workspace sit on a
  stale docs base or leave notes unpushed at the end of a run.
- **Let the pipeline skill do it.** `/local-plan` (new/handoff/promote/activate/archive/
  sync) already pulls-then-commits-then-pushes and scopes commits to the project's folder.
  Prefer it over hand-rolled git in the docs repo.
- **One file per item, `YYYY-MM-DD-slug`.** Each plan/handoff/idea is its own dated file, so
  two subagents writing different notes touch different files → no conflict. Never have two
  agents edit the same doc, and avoid shared index files everyone appends to.
- **It's a separate repo from the code.** A docs-repo conflict never blocks a `wkt merge` of
  the code branch, and vice-versa — resolve each in its own repo. Never force-push the docs repo.

Run `/docs-review` periodically — it flags unpushed / behind-remote state so drift surfaces early.

## Cleanup

`--force` is required non-interactively (it skips the interactive selection),
but it is also **irreversible** — it deletes the workspace directory. Be 100%
certain no work is lost before running it:

```bash
wkt -y list --dirty                # FIRST: any workspace with uncommitted work?
wkt -y clean --merged --force      # only removes workspaces whose branches merged
```

Rules for `--force` clean:

- **Audit with `wkt -y list --dirty` first, every time.** A dirty workspace has
  uncommitted changes that no merge captured — force-cleaning it loses them
  permanently. Resolve every dirty workspace (commit + merge, or confirm the
  changes are genuinely disposable) *before* you clean.
- **Scope it tightly.** Prefer `--merged` (only branches already merged into the
  default) over `--all`. Treat `wkt -y clean --all --force` as off-limits unless
  you have confirmed *every* matching workspace is both clean and merged.
- **When unsure about one workspace, clean it by name**, not via a bulk match —
  act on exactly what you intend, nothing more.
- There is no undo. Uncommitted or unmerged work cannot be recovered once the
  directory is gone. Any doubt → stop and commit/merge first.

## Starting the next task from a fresh base

A new workspace is only as current as the branch it forks from. After finishing
a task, bring the default branch up to date **before** branching the next one,
so new work never starts from stale history:

- **Preferred:** merge the finished task into the default branch first
  (`wkt -y merge <workspace> --clean`), then
  `wkt -y create <project> <new-branch>` — the new workspace forks from the
  now-updated default.
- **If you reuse a workspace** instead of creating a fresh one, reset it to the
  current default first (e.g. `git fetch origin && git reset --hard
  origin/<default>`) so it carries no leftover state from the previous task.

Either way the goal is the same: every task starts from a clean, current base.

## Stacked branches

Creating a workspace with `--from <branch>` (where `<branch>` is another feature,
not the default) *stacks* it on that branch — it inherits the parent's unmerged
work. This is deliberate for dependent work, but cuts against "fresh base," so
prefer it only when the second task genuinely builds on the first.

- `wkt -y list` tags stacked workspaces `↳stacked` with their commits ahead/behind
  their base, so you can see the dependency at a glance.
- When the parent branch merges into the default branch, `wkt merge` automatically
  re-points the stack's base to the default branch and tells you so.
- After that, replay the stacked workspace onto the updated default with
  `wkt -y merge --into <workspace> --rebase` before continuing or merging it.

## Quick reference

| Goal | Command |
|------|---------|
| Find project / current workspace | `wkt info --json` · `wkt -y list` |
| New line of work, concurrent / isolated | `wkt -y create <project> <branch> --path-only` |
| New line of work, sequential on a clean tree | `git checkout -b <branch>` (then `wkt reconcile`) |
| Create a workspace (print path) | `wkt -y create <project> <branch> --path-only` |
| Merge a workspace into default + clean | `wkt -y merge <workspace> --clean` |
| Squash-merge | `wkt -y merge <workspace> --squash --clean` |
| Merge into a non-default branch | `wkt -y merge <workspace> --into <branch>` |
| Rebase a feature onto its base | `wkt -y merge --into <workspace> --rebase` |
| Remove merged workspaces | `wkt -y clean --merged --force` |
| Fix git ↔ database drift (e.g. after branching in place) | `wkt reconcile` |
| Full agent contract from the CLI | `wkt help agent` |
