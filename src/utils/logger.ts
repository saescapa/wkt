import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LoggerOptions {
  level: LogLevel;
  prefix?: string;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export class Logger {
  private static instance: Logger | null = null;
  private level: LogLevel;
  private prefix: string;

  private constructor(options: LoggerOptions) {
    this.level = options.level;
    this.prefix = options.prefix ?? 'wkt';
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger({
        level: Logger.getDefaultLevel(),
      });
    }
    return Logger.instance;
  }

  static initialize(options: Partial<LoggerOptions>): void {
    const level = options.level ?? Logger.getDefaultLevel();
    const prefix = options.prefix ?? 'wkt';
    Logger.instance = new Logger({ level, prefix });
  }

  private static getDefaultLevel(): LogLevel {
    if (process.env.WKT_DEBUG === '1' || process.env.WKT_DEBUG === 'true') {
      return 'debug';
    }
    if (process.env.NODE_ENV === 'development') {
      return 'debug';
    }
    return 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(chalk.gray(`[${this.prefix}:debug]`), message, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.log(message, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(chalk.yellow(message), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(chalk.red(message), ...args);
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  isDebugEnabled(): boolean {
    return this.level === 'debug';
  }
}

export const logger = Logger.getInstance();
