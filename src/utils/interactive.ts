/**
 * Non-interactive mode utilities.
 *
 * Non-interactive mode is enabled when:
 * - Global `--yes`/`-y` flag is passed (sets WKT_NON_INTERACTIVE=1 in preAction hook)
 * - WKT_NON_INTERACTIVE=1 env var is set
 * - stdin is not a TTY (piped input)
 *
 * In non-interactive mode, inquirer prompts must be guarded: confirmation
 * prompts auto-resolve with a default, and prompts for required input throw
 * a descriptive error pointing to the CLI flag/argument the caller should use.
 */

export function isNonInteractive(): boolean {
  return process.env.WKT_NON_INTERACTIVE === '1' || !process.stdin.isTTY;
}

export class NonInteractiveError extends Error {
  constructor(context: string, hint: string) {
    super(`Cannot prompt for ${context} in non-interactive mode. ${hint}`);
    this.name = 'NonInteractiveError';
  }
}

/**
 * Throw when a prompt needs user input that cannot be defaulted.
 * The hint should tell the caller which CLI arg/flag to use instead.
 */
export function requireInput(context: string, hint: string): never {
  throw new NonInteractiveError(context, hint);
}
