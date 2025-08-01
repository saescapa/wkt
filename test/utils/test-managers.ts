import { join } from 'path';
import { ConfigManager } from '../../src/core/config.js';
import { DatabaseManager } from '../../src/core/database.js';
import type { TestEnvironment } from './test-helpers.js';

export class TestConfigManager extends ConfigManager {
  private testEnv: TestEnvironment;

  constructor(testEnv: TestEnvironment) {
    super();
    this.testEnv = testEnv;
  }

  protected get configDir(): string {
    return this.testEnv.configDir;
  }

  protected get configPath(): string {
    return join(this.testEnv.configDir, 'config.yaml');
  }
}

export class TestDatabaseManager extends DatabaseManager {
  private testEnv: TestEnvironment;

  constructor(testEnv: TestEnvironment) {
    super();
    this.testEnv = testEnv;
  }

  protected get dbPath(): string {
    return join(this.testEnv.configDir, 'database.json');
  }
}