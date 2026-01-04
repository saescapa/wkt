# Plan: Workspace Pool with Claim/Release

## Summary

Add a workspace recycling system via `claim`/`release` commands. Pool workspaces are branchless (detached HEAD) and retain installed dependencies for fast reuse. The existing `create` command remains unchanged.

**Key insight**: The value is warm dependencies (cached builds, installed packages), not faster `git worktree add`.

---

## Command Changes

### `wkt create` (unchanged)

Creates a branched workspace. Existing behavior preserved.

### `wkt claim` (new)

Claims a workspace from the pool. If pool is empty, creates a new branchless workspace.

```bash
# Pool has available workspace
$ wkt claim myproject
Claiming workspace from pool...
✓ Claimed 'wksp-1' (tracking main)
✓ Updated to latest main (abc1234)
✓ Running post_claim hooks...
  → quick-setup (2.1s)
✓ Workspace ready at ~/.wkt/workspaces/myproject/wksp-1

# Pool is empty - falls back to creating new
$ wkt claim myproject
Pool empty, creating new workspace...
✓ Created 'wksp-2' (tracking main)
✓ Running post_claim hooks...
  → quick-setup (31.2s)
✓ Workspace ready

# Track a different branch
$ wkt claim myproject --from staging
Claiming workspace from pool...
✓ Claimed 'wksp-1' (tracking staging)
```

### `wkt release` (new)

Returns a workspace to the pool for reuse.

```bash
# Release current workspace (clean state)
$ wkt release
Releasing 'wksp-1' back to pool...
✓ Reset to main (abc1234)
✓ Running post_release hooks...
✓ Released to pool

# Release with uncommitted changes
$ wkt release
Error: Workspace has uncommitted changes

  3 files modified, 1 file untracked

Hints:
  → Use 'wkt save' to handle your changes first
  → Use 'wkt release --force' to discard changes

# Release branched workspace (converts to pooled)
$ wkt release
Warning: This will detach from branch 'feat/old-experiment'
The branch will remain but workspace becomes pooled.
Continue? [y/N] y
✓ Released to pool
```

### `wkt save` (new)

Handles "what to do with my changes" workflow for claimed workspaces.

```bash
# Interactive mode (default)
$ wkt save
You have changes in 'wksp-1':
  3 files modified

What would you like to do?
  ❯ Create a branch from these changes
    Stash changes
    Discard changes

# Direct branch creation
$ wkt save --branch feat/new-feature
✓ Created branch 'feat/new-feature'
✓ Workspace 'wksp-1' is now branched

# From branched workspace (no-op)
$ wkt save
Workspace is already on branch 'feat/auth'.
Use 'git commit' to commit your changes.
```

### `wkt list` (updated)

Shows pool status with mode indicators.

```bash
$ wkt list
myproject/
  ● main                    active, main
  ○ feat-auth               3 days ago, feat/auth
  ◇ wksp-1                  claimed, tracking main
  ◇ wksp-2                  pooled
  ◇ wksp-3                  pooled

Legend: ● active ○ branched ◇ claimed/pooled

$ wkt list --pool
myproject/ (2 available in pool)
  ◇ wksp-2    pooled    last used 2 hours ago
  ◇ wksp-3    pooled    last used 1 day ago
```

### `wkt info` (updated)

Shows mode-specific details.

```bash
# Branched workspace
$ wkt info
Workspace:    myproject/feat-auth
Mode:         branched
Branch:       feat/auth
Base:         main
Path:         ~/.wkt/workspaces/myproject/feat-auth
Created:      3 days ago
Status:       2 files modified

# Claimed workspace
$ wkt info
Workspace:    myproject/wksp-1
Mode:         claimed
Tracking:     main
Base commit:  abc1234
Claimed:      10 minutes ago
Status:       clean

# Pooled workspace
$ wkt info
Workspace:    myproject/wksp-2
Mode:         pooled
Last used:    2 hours ago
```

### `wkt clean` (updated)

Handles pooled workspaces appropriately.

```bash
$ wkt clean
Checking workspaces...

Branched (merged, safe to remove):
  ○ feat-old        merged 5 days ago

Claimed (have changes):
  ◇ wksp-1          3 files modified
    → Use 'wkt release' or 'wkt save' first

Pooled (2 workspaces):
  ◇ wksp-2, wksp-3
    → Pooled workspaces are kept for reuse

Remove 1 merged workspace? [y/N] y
✓ Removed 'feat-old'

# Force clean pooled workspaces
$ wkt clean --include-pool
This will permanently delete pooled workspaces.
Remove 2 pooled workspaces? [y/N] y
✓ Removed 'wksp-2', 'wksp-3'
```

---

## Configuration

```yaml
workspace:
  pool:
    max_size: 5              # Max pooled workspaces per project
    max_age_days: 30         # Auto-clean old pooled workspaces

scripts:
  hooks:
    post_create:
      - script: full-setup       # Full dependency install
    post_claim:
      - script: quick-setup      # Faster, deps usually cached
    post_release:
      - script: clean-artifacts  # Prep for next use
```

Example hook configs by language:

```yaml
# Node.js
scripts:
  scripts:
    quick-setup: { command: ["pnpm", "install", "--frozen-lockfile"] }
    clean-artifacts: { command: ["rm", "-rf", "dist", ".next"] }

# Python
scripts:
  scripts:
    quick-setup: { command: ["pip", "install", "-r", "requirements.txt"] }
    clean-artifacts: { command: ["rm", "-rf", "__pycache__", ".pytest_cache"] }

# Rust
scripts:
  scripts:
    quick-setup: { command: ["cargo", "fetch"] }
    clean-artifacts: { command: ["cargo", "clean", "--release"] }

# Go
scripts:
  scripts:
    quick-setup: { command: ["go", "mod", "download"] }
    clean-artifacts: { command: ["go", "clean"] }
```

---

## Implementation

### Phase 1: Types & Database

**File: `src/core/types.ts`**

```typescript
export type WorkspaceMode = 'branched' | 'claimed' | 'pooled';

export interface Workspace {
  // ... existing fields ...
  mode: WorkspaceMode;           // NEW
  trackingBranch?: string;       // NEW: for claimed/pooled
  baseCommit?: string;           // NEW: commit SHA
  claimedAt?: Date;              // NEW: when claimed
}

export interface PoolConfig {
  max_size?: number;
  max_age_days?: number;
}

// Add pool to WorkspaceConfig
// Add post_claim/post_release to ScriptConfig hooks
```

**File: `src/core/migrations.ts`**

Migration to add `mode: 'branched'` to existing workspaces.

**File: `src/core/database.ts`**

New methods:
- `getPooledWorkspaces(projectName)` - Get available pool
- `getClaimedWorkspaces(projectName)` - Get in-use claimed
- `claimWorkspace(id, trackingBranch)` - Mark as claimed
- `releaseWorkspace(id)` - Return to pool

---

### Phase 2: Git Operations

**File: `src/utils/git/worktrees.ts`**

```typescript
// Create detached worktree tracking a branch
createDetachedWorktree(bareRepoPath, workspacePath, trackingBranch): Promise<{ commit: string }>

// Reset detached worktree to latest of tracking branch
resetDetachedWorktree(workspacePath, bareRepoPath, trackingBranch): Promise<{ commit: string }>

// Convert detached worktree to branch
createBranchFromDetached(workspacePath, branchName): Promise<void>
```

---

### Phase 3: New Commands

**File: `src/commands/claim.ts`** (new)

1. Try to get pooled workspace
2. If found: reset to tracking branch, mark as claimed
3. If empty: create new detached worktree, mark as claimed
4. Run post_claim hooks
5. Output path

**File: `src/commands/release.ts`** (new)

1. Check for uncommitted changes (error unless --force)
2. If branched: confirm detaching from branch
3. Reset to main (detached)
4. Mark as pooled
5. Run post_release hooks

**File: `src/commands/save.ts`** (new)

1. If already branched: no-op, tell user to use git
2. Check for changes
3. Interactive: create branch / stash / discard
4. Or direct: --branch or --stash flags

---

### Phase 4: Update Existing Commands

**File: `src/commands/list.ts`**
- Mode indicators (●, ○, ◇)
- `--pool` flag for pool-only view

**File: `src/commands/info.ts`**
- Show mode-specific fields
- Tracking branch for claimed/pooled
- Claimed timestamp

**File: `src/commands/clean.ts`**
- Skip pooled by default
- `--include-pool` flag
- Warn about claimed with changes

**File: `src/utils/script-executor.ts`**
- Add `executePostClaimHooks()`
- Add `executePostReleaseHooks()`

**File: `src/index.ts`**
- Register `claim`, `release`, `save` commands

---

## Files to Modify/Create

| File | Action | Changes |
|------|--------|---------|
| `src/core/types.ts` | Modify | Add `WorkspaceMode`, `PoolConfig`, new hooks |
| `src/core/migrations.ts` | Modify | Add migration for `mode` field |
| `src/core/database.ts` | Modify | Add pool query/claim/release methods |
| `src/utils/git/worktrees.ts` | Modify | Add detached worktree functions |
| `src/utils/script-executor.ts` | Modify | Add claim/release hook methods |
| `src/commands/claim.ts` | Create | New claim command |
| `src/commands/release.ts` | Create | New release command |
| `src/commands/save.ts` | Create | New save command |
| `src/commands/list.ts` | Modify | Mode indicators, pool display |
| `src/commands/info.ts` | Modify | Mode-specific details |
| `src/commands/clean.ts` | Modify | Handle pooled workspaces |
| `src/index.ts` | Modify | Register new commands |

---

## Migration Path

1. Existing workspaces get `mode: 'branched'` automatically
2. No behavior change for existing `create`/`switch`/`clean` workflows
3. New `claim`/`release`/`save` commands are additive
4. Users opt-in to pool workflow when ready

---

## Edge Cases

1. **Pool empty**: Falls back to creating new branchless workspace
2. **Claim with changes**: Must `save` or `release --force` first
3. **Release branched**: Confirm detaching, branch remains in git
4. **Tracking branch deleted**: Fall back to default branch with warning
5. **Max pool size**: When releasing and pool full, delete oldest
6. **Stale pool**: `clean --include-pool` or `max_age_days` handles cleanup
