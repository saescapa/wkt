# Git Workflows with WKT Worktrees

This document explains how to work with git in the WKT worktree environment, including rebasing, merging, and other common workflows.

## Understanding WKT's Git Setup

WKT uses **git worktrees** to create isolated working directories. Here's how it works:

```
~/.wkt/
├── projects/
│   └── myproject/          # Bare repository (no working directory)
│       └── .git/           # All git data stored here
└── workspaces/
    └── myproject/
        ├── main/           # Main branch worktree
        ├── feature-auth/   # Feature branch worktree  
        └── bugfix-login/   # Bugfix branch worktree
```

Each workspace is a **separate working directory** pointing to the same git repository but with different branches checked out.

## Key Differences from Normal Git

### 1. All Workspaces Share the Same Repository
- Commits, branches, and refs are shared across all workspaces
- When you commit in one workspace, other workspaces can see those commits immediately
- `git fetch` in any workspace updates refs for all workspaces

### 2. Remote Configuration
- Each workspace has an `origin` remote configured automatically
- You can push/pull from any workspace normally
- All workspaces point to the same remote repository

## Common Git Workflows

### Rebasing a Feature Branch

**The Standard Way (works in any workspace):**

```bash
# Switch to your feature workspace
cd ~/.wkt/workspaces/myproject/feature-auth

# Fetch latest changes from remote
git fetch origin

# Rebase onto latest main
git rebase origin/main

# If there are conflicts, resolve them, then:
git add .
git rebase --continue

# Push the rebased branch (use force-with-lease for safety)
git push origin feature-auth --force-with-lease
```

**The WKT Way (recommended):**

```bash
# WKT will provide these commands in future versions:
wkt sync feature-auth --rebase      # Fetch and rebase automatically
wkt push feature-auth              # Push with safe force options
```

### Working with Multiple Branches Simultaneously

This is where worktrees really shine:

```bash
# Work on feature branch
cd ~/.wkt/workspaces/myproject/feature-auth
# Make changes, commit, test...

# Quickly switch to main to check something (no git checkout needed!)
cd ~/.wkt/workspaces/myproject/main
git pull origin main  # Update main branch

# Go back to feature work
cd ~/.wkt/workspaces/myproject/feature-auth
# Your work is exactly as you left it!

# Start another feature while first is in progress
wkt create myproject feature-dashboard
cd ~/.wkt/workspaces/myproject/feature-dashboard
# Work on second feature...
```

### Merging Changes

**Option 1: GitHub/GitLab PR (Recommended)**

```bash
# In your feature workspace
cd ~/.wkt/workspaces/myproject/feature-auth

# Push your branch
git push origin feature-auth

# Create PR via web interface or CLI
gh pr create --title "Add authentication" --body "..."

# After PR is approved and merged, clean up
wkt clean feature-auth
```

**Option 2: Local Merge**

```bash
# Switch to main workspace
cd ~/.wkt/workspaces/myproject/main

# Update main
git pull origin main

# Merge your feature branch
git merge feature-auth

# Push the merge
git push origin main

# Clean up feature workspace
wkt clean feature-auth
```

### Handling Merge Conflicts During Rebase

```bash
# Start rebase
git rebase origin/main

# If conflicts occur, git will pause and show conflicted files
git status

# Edit files to resolve conflicts, then:
git add .
git rebase --continue

# If you want to abort the rebase:
git rebase --abort

# If you want to skip a problematic commit:
git rebase --skip
```

### Cherry-Picking Between Workspaces

```bash
# In workspace A, find the commit hash
cd ~/.wkt/workspaces/myproject/feature-auth
git log --oneline
# Note: abc1234 Some important fix

# Switch to workspace B
cd ~/.wkt/workspaces/myproject/feature-dashboard

# Cherry-pick the commit
git cherry-pick abc1234
```

## Advanced Workflows

### Interactive Rebase

```bash
# In your feature workspace
cd ~/.wkt/workspaces/myproject/feature-auth

# Interactive rebase to clean up commits
git rebase -i origin/main

# This opens an editor where you can:
# - squash commits together
# - reword commit messages  
# - reorder commits
# - drop unwanted commits
```

### Working with Stashes

Stashes work normally but are **shared across all workspaces**:

```bash
# In feature-auth workspace
git stash push -m "WIP: authentication work"

# Switch to main workspace
cd ~/.wkt/workspaces/myproject/main

# Your stash is available here too
git stash list
git stash pop  # Apply the stash if needed
```

### Syncing with Upstream

```bash
# In main workspace, add upstream remote (one-time setup)
cd ~/.wkt/workspaces/myproject/main
git remote add upstream https://github.com/original/repo.git

# Fetch from upstream
git fetch upstream

# Update your main branch
git checkout main
git merge upstream/main
git push origin main

# Now rebase feature branches as needed
cd ~/.wkt/workspaces/myproject/feature-auth
git rebase origin/main
```

## Main Branch Protection

WKT protects main branch workspaces from accidental deletion:

```bash
# This will be blocked
wkt clean main

# Output:
# ⚠️  Cannot clean main branch workspace 'main' (contains shared files)
# Main workspaces are used as source for symlinked shared files
# Use --force to override this protection

# To force clean (dangerous!)
wkt clean main --force
```

**Why main workspaces are protected:**
- They contain the original shared files (like `CLAUDE.md`, `.cursor/rules`)
- Other workspaces symlink to files in the main workspace
- Deleting main workspace breaks symlinks in other workspaces

## Troubleshooting

### "Repository locked" errors

If you get locking errors, it's usually because multiple git operations are running:

```bash
# Wait for other git operations to complete, or force unlock:
rm ~/.wkt/projects/myproject/.git/index.lock
```

### Symlinks broken after cleaning main workspace

If you accidentally cleaned the main workspace:

```bash
# Recreate main workspace
wkt create myproject main

# Resync all workspaces
wkt sync --all --project myproject
```

### Workspace out of sync

If a workspace seems out of sync:

```bash
# Fetch latest refs
git fetch origin

# Check workspace status
git status
git log --oneline origin/main..HEAD  # Commits ahead
git log --oneline HEAD..origin/main  # Commits behind
```

## Best Practices

1. **Always fetch before rebasing**: `git fetch origin` before `git rebase origin/main`

2. **Use force-with-lease**: `git push --force-with-lease` instead of `--force`

3. **Keep main workspace clean**: Don't do development work in main workspace

4. **Regular cleanup**: Use `wkt clean` to remove finished feature workspaces

5. **Atomic commits**: Make small, focused commits that are easy to rebase

6. **Descriptive branch names**: Use clear naming like `feature/user-auth` or `bugfix/login-error`

7. **Test before pushing**: Run tests in your workspace before pushing changes

## Future WKT Commands

These commands are planned for future versions:

```bash
wkt rebase [workspace] [base-branch]    # Rebase workspace onto base branch
wkt sync [workspace] --rebase           # Fetch and rebase in one command  
wkt push [workspace] [--force-lease]    # Safe push with force-with-lease
wkt merge [workspace] [target-branch]   # Merge workspace into target branch
wkt conflicts [workspace]               # Show and help resolve conflicts
```

## Summary

Working with git in WKT worktrees is similar to normal git, with these key advantages:

- **Parallel Development**: Work on multiple branches simultaneously
- **No Context Switching**: No need to stash/unstash when switching branches  
- **Shared Repository**: All workspaces see commits immediately
- **Safe Isolation**: Each workspace is completely independent

The main difference is that you work in separate directories for each branch, but all git operations work exactly the same way within each workspace.