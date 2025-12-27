import { spawn } from 'child_process';
import { logger } from '../logger.js';

export async function executeCommand(command: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command;
    if (!cmd) {
      reject(new Error('Invalid command: empty command array'));
      return;
    }

    logger.debug(`Executing: ${command.join(' ')}${cwd ? ` in ${cwd}` : ''}`);

    const proc = spawn(cmd, args, {
      cwd: cwd ?? undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    // Handle spawn errors (command not found, permissions, etc.)
    proc.on('error', (error: Error) => {
      logger.debug(`Spawn error for command '${cmd}': ${error.message}`);
      reject(new Error(`Failed to spawn command '${cmd}': ${error.message}`));
    });

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        logger.debug(`Command succeeded: ${command.join(' ')}`);
        resolve(stdout.trim());
      } else {
        logger.debug(`Command failed (code ${code}): ${command.join(' ')}`);
        reject(new Error(`Command failed: ${command.join(' ')}\n${stderr}`));
      }
    });
  });
}

export function parseDuration(duration: string): number {
  const regex = /^(\d+)([dwmy])$/;
  const match = duration.match(regex);

  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like '30d', '2w', '6m', '1y'`);
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;

  const msInDay = 24 * 60 * 60 * 1000;

  switch (unit) {
    case 'd':
      return value * msInDay;
    case 'w':
      return value * 7 * msInDay;
    case 'm':
      return value * 30 * msInDay;
    case 'y':
      return value * 365 * msInDay;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}
