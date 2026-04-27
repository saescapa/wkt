# Lifecycle Hooks via `post-checkout`

WKT does not run lifecycle scripts. Use git's built-in `post-checkout`
hook instead — it fires on `git worktree add` (which is what `wkt
create` invokes under the hood) and is shared across every worktree
through the bare repo's common hooks directory.

This page documents the pattern so you can wire up dependency installs,
codegen, environment setup, etc.

## Where the hook lives

For a WKT-managed project, the bare repo lives at
`~/.wkt/projects/<project>/`. Hooks are read from
`<bare-repo>/hooks/post-checkout`. Every worktree shares this single
hook file, so installing it once covers all workspaces.

```bash
# Find the hook path for the project of your current workspace:
HOOK="$(git rev-parse --git-common-dir)/hooks/post-checkout"
```

## When `post-checkout` fires

Git invokes `post-checkout` with three positional arguments:

1. `$1` — previous HEAD ref
2. `$2` — new HEAD ref
3. `$3` — flag: `1` if a branch checkout, `0` if a file checkout

`git worktree add` triggers `post-checkout` with `$3 == 1`. So is `git
checkout <branch>`. To run only on fresh worktree creation (where `$1`
is the all-zeroes "null" SHA), check both:

```bash
NULL_SHA="0000000000000000000000000000000000000000"
if [ "$3" = "1" ] && [ "$1" = "$NULL_SHA" ]; then
  # Fresh worktree — run setup.
fi
```

## Minimal template

Drop this in `<bare-repo>/hooks/post-checkout` and `chmod +x` it.

```bash
#!/usr/bin/env bash
set -euo pipefail

prev_head="$1"
new_head="$2"
is_branch_checkout="$3"

null_sha="0000000000000000000000000000000000000000"

# Only run on fresh worktree creation.
if [ "$is_branch_checkout" != "1" ] || [ "$prev_head" != "$null_sha" ]; then
  exit 0
fi

# $PWD is the new worktree root when invoked by `git worktree add`.
cd "$PWD"

# --- Add your setup steps below ---

# Install dependencies (skip if no manifest):
if [ -f bun.lock ] || [ -f bun.lockb ]; then
  bun install
elif [ -f pnpm-lock.yaml ]; then
  pnpm install
elif [ -f package-lock.json ]; then
  npm ci
fi

# Codegen, db migrations, etc. — add as needed.
# bun run codegen
```

## Integrating with husky / lefthook

Both tools manage hook contents under `.git/hooks/` and respect git's
common hooks dir, so they work transparently with WKT's bare-repo
layout. Install once from any worktree:

```bash
# Inside a workspace:
bun add -D husky && bunx husky init
# Then drop your post-checkout logic in .husky/post-checkout
```

The hook lands in the shared `<bare-repo>/hooks/` dir and runs for
every future `wkt create`.

## What about cleanup hooks?

Git has no `pre-worktree-remove` hook. If you need teardown logic on
`wkt clean` (e.g., stop a docker compose stack, drop a local db), put
it in a Makefile or shell function and run it manually before cleaning.
This is intentional — cleanup logic is rare, error-prone, and usually
better as an explicit step than an implicit one.
