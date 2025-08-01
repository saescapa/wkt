import chalk from 'chalk';

export async function projectCommand(
  subcommand: string,
  ...args: string[]
): Promise<void> {
  console.log(chalk.yellow('Project command not yet implemented'));
  console.log('Subcommand:', subcommand);
  console.log('Arguments:', args);
}