import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  needsMigration,
  migrateDatabase,
} from '../../src/core/migrations.js';
import type { WKTDatabase } from '../../src/core/types.js';
import { DatabaseManager } from '../../src/core/database.js';
import { TestEnvironment, mockEnvironmentVariables } from '../utils/test-helpers.js';

// Build a pre-v4 database whose workspaces/projects lack fields that later
// became required. Cast through unknown because these shapes are intentionally
// missing fields the current type guarantees.
function makeLegacyDatabase(schemaVersion?: number): WKTDatabase {
  return {
    projects: {
      alpha: {
        name: 'alpha',
        repositoryUrl: 'https://github.com/test/alpha.git',
        bareRepoPath: '/tmp/alpha',
        workspacesPath: '/tmp/ws/alpha',
        // defaultBranch intentionally omitted
        createdAt: new Date('2024-01-01'),
      },
    },
    workspaces: {
      'alpha/feature': {
        id: 'alpha/feature',
        projectName: 'alpha',
        name: 'feature',
        branchName: 'feature/x',
        path: '/tmp/ws/alpha/feature',
        // baseBranch and status intentionally omitted
        createdAt: new Date('2024-01-02'),
        lastUsed: new Date('2024-01-03'),
      },
    },
    metadata: {
      version: '1.0.0',
      schemaVersion: schemaVersion as number,
      lastCleanup: new Date('2024-01-01'),
    },
  } as unknown as WKTDatabase;
}

describe('migrations', () => {
  describe('getSchemaVersion', () => {
    it('defaults to 0 when schemaVersion is absent', () => {
      const db = makeLegacyDatabase(undefined);
      expect(getSchemaVersion(db)).toBe(0);
    });

    it('returns the stored schemaVersion', () => {
      const db = makeLegacyDatabase(3);
      expect(getSchemaVersion(db)).toBe(3);
    });
  });

  describe('needsMigration', () => {
    it('is true for an older schema version', () => {
      expect(needsMigration(makeLegacyDatabase(3))).toBe(true);
    });

    it('is false at the current schema version', () => {
      expect(needsMigration(makeLegacyDatabase(CURRENT_SCHEMA_VERSION))).toBe(false);
    });
  });

  describe('migrateDatabase', () => {
    it('backfills required fields on a legacy database', () => {
      const migrated = migrateDatabase(makeLegacyDatabase(1));

      expect(migrated.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(migrated.projects.alpha?.defaultBranch).toBe('main');

      const ws = migrated.workspaces['alpha/feature'];
      expect(ws?.baseBranch).toBe('main');
      expect(ws?.status).toEqual({
        clean: true,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
      });
    });

    it('derives baseBranch from the project default branch', () => {
      const db = makeLegacyDatabase(1);
      db.projects.alpha!.defaultBranch = 'develop';

      const migrated = migrateDatabase(db);
      expect(migrated.workspaces['alpha/feature']?.baseBranch).toBe('develop');
    });

    it('is a no-op when already at the current version', () => {
      const current = makeLegacyDatabase(CURRENT_SCHEMA_VERSION);
      current.projects.alpha!.defaultBranch = 'main';
      current.workspaces['alpha/feature']!.baseBranch = 'main';
      current.workspaces['alpha/feature']!.status = {
        clean: true,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
      };

      const migrated = migrateDatabase(current);
      expect(migrated).toEqual(current);
    });

    it('leaves a newer-than-supported database untouched', () => {
      const future = makeLegacyDatabase(CURRENT_SCHEMA_VERSION + 1);
      const migrated = migrateDatabase(future);
      expect(migrated.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 1);
    });
  });

  describe('DatabaseManager integration', () => {
    let testEnv: TestEnvironment;
    let restoreEnv: () => void;

    beforeEach(() => {
      testEnv = new TestEnvironment();
      testEnv.setup();
      restoreEnv = mockEnvironmentVariables({ WKT_HOME: testEnv.wktHome });
    });

    afterEach(() => {
      restoreEnv();
      testEnv.cleanup();
    });

    it('migrates a legacy database.json on load and persists the upgrade', () => {
      const dbPath = join(testEnv.wktHome, 'database.json');
      writeFileSync(dbPath, JSON.stringify(makeLegacyDatabase(1), null, 2), 'utf-8');

      const db = new DatabaseManager().getDatabase();
      expect(db.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(db.workspaces['alpha/feature']?.baseBranch).toBe('main');

      // A fresh manager reads the persisted, already-migrated file.
      const reloaded = new DatabaseManager().getDatabase();
      expect(reloaded.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(needsMigration(reloaded)).toBe(false);
    });
  });
});
