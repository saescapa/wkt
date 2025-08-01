import chalk from 'chalk';
import type { CommandOptions } from '../core/types.js';

export async function statusCommand(
  workspace?: string,
  options: CommandOptions = {}
): Promise<void> {
  console.log(chalk.yellow('Status command not yet implemented'));
  console.log('Arguments:', { workspace, options });
}