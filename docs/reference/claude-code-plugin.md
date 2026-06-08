# Claude Code Plugin

WKT ships a [Claude Code](https://code.claude.com) plugin so that Claude knows
how to use `wkt` to parallelize work across isolated worktrees and merge it
back. The wkt repo is its own plugin marketplace — there is nothing to build and
nothing is written into your `~/.claude` directory.

## Install

In any Claude Code session:

```
/plugin marketplace add saescapa/wkt
/plugin install wkt@wkt-marketplace
```

Then run `/reload-plugins` (or restart the session). The plugin's skill is now
available **globally** — in every project you open, including all the other
repos that wkt manages, not just the wkt repo itself.

To update later, re-add the marketplace (it re-pulls the latest), or use the
`/plugin` menu. To remove it: `/plugin uninstall wkt@wkt-marketplace`.

## What it provides

A single skill, **`wkt-worktrees`**, that triggers when you ask Claude to run
independent tasks in parallel in a wkt-managed repo (e.g. "work on these in
parallel", "spin up worktrees", "fan these out to subagents"). It teaches the
fan-out → commit → `wkt merge --clean` workflow and points Claude at
`wkt help agent` and [agent-usage.md](agent-usage.md) for the full
non-interactive command contract.

The skill does not duplicate the command reference — it is the *orchestration
playbook*. The CLI's `wkt help agent` output and `agent-usage.md` remain the
source of truth for per-command flags.

## Layout in the repo

```
.claude-plugin/
  plugin.json         # plugin manifest (name, description, version)
  marketplace.json    # makes the repo its own marketplace
skills/
  wkt-worktrees/
    SKILL.md          # the orchestration skill
```

Keeping the skill in the repo means it is versioned with the CLI: a change to
wkt's command surface and the skill that documents it land in the same commit.
