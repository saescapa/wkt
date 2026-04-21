import chalk from 'chalk';

const AGENT_HELP = `WKT — Non-Interactive / Agent Usage

Enable non-interactive mode via any of:
  --yes / -y                Global flag
  WKT_NON_INTERACTIVE=1     Environment variable
  (non-TTY stdin)           Automatic when stdin is piped

In non-interactive mode:
  - Confirmations auto-accept safe defaults.
  - Missing required input fails fast with a hint naming the CLI arg to pass.
  - Optional enhancement prompts resolve to "no".

Exit codes:
  0   success
  1   error (validation, git, missing required input, etc.)
  130 SIGINT (not produced non-interactively)

Command contract (non-interactive):

  wkt init <repository-url> [project-name]
  wkt init --local <project-name>
  wkt init --apply-template <project-name> --template <name>

  wkt create <project> <branch-name> [--from <base>] [--description "<text>"]

  wkt switch <workspace> [-p <project>]

  wkt list [-p <project>] [--dirty] [--stale <dur>] [--all]

  wkt info [--json|--name-only|--branch-only|--description-only]
  wkt info --set-description "<text>"

  wkt merge <workspace> [-p <project>] [--into <branch>] [--squash] [--clean] [--force]

  wkt clean [workspace] --force [--merged|--older-than <dur>|--all]

  wkt rename <new-name> [--from <base>] [--no-rebase] [--description "<text>"] [--force]

  wkt run <script-name> [workspace] --force [--dry]

  wkt sync [--project <p>|--workspace <w>|--all] [--force] [--dry]

  wkt config [show|path|debug] [--project <name>|--global]

Full reference: docs/reference/agent-usage.md
`;

export function helpCommand(topic?: string): void {
  if (topic === 'agent' || topic === 'agents' || topic === 'llm') {
    console.log(AGENT_HELP);
    return;
  }

  if (topic) {
    console.error(chalk.red(`Unknown help topic: ${topic}`));
    console.log('Available topics: agent');
    process.exit(1);
  }

  console.log('Available help topics:');
  console.log('  agent    Non-interactive / LLM agent usage contract');
  console.log('\nRun `wkt --help` for the full command list.');
}
