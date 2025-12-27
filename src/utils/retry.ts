import { logger } from './logger.js';

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    'could not resolve host',
    'connection refused',
    'connection timed out',
    'network is unreachable',
    'failed to connect',
    'ssl certificate problem',
    'unable to access',
    'the remote end hung up',
    'operation timed out',
    'connection reset by peer',
  ],
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error: Error, patterns: string[]): boolean {
  const message = error.message.toLowerCase();
  return patterns.some(pattern => message.includes(pattern.toLowerCase()));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const shouldRetry = isRetryableError(lastError, opts.retryableErrors);

      if (!shouldRetry || attempt === opts.maxAttempts) {
        logger.debug(
          `${operationName} failed after ${attempt} attempt(s): ${lastError.message}`
        );
        throw lastError;
      }

      logger.warn(
        `${operationName} failed (attempt ${attempt}/${opts.maxAttempts}), retrying in ${Math.round(delay / 1000)}s...`
      );

      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError;
}
