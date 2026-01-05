import type { WKTDatabase, Workspace } from './types.js';
import { logger } from '../utils/logger.js';

export const CURRENT_SCHEMA_VERSION = 3;

export interface Migration {
  version: number;
  description: string;
  migrate: (db: WKTDatabase) => WKTDatabase;
}

// Define migrations in order - add new migrations here as the schema evolves
export const migrations: Migration[] = [
  {
    version: 2,
    description: 'Add mode field to workspaces',
    migrate: (db): WKTDatabase => {
      for (const workspace of Object.values(db.workspaces)) {
        if (!(workspace as Workspace).mode) {
          (workspace as Workspace).mode = 'branched';
        }
      }
      return db;
    }
  },
  {
    version: 3,
    description: 'Add claimedAt and baseCommit fields for pool workspaces',
    migrate: (db): WKTDatabase => {
      // No data transformation needed - new fields are optional
      // claimedAt and baseCommit will be populated when workspaces are claimed/released
      return db;
    }
  }
];

export function getSchemaVersion(db: WKTDatabase): number {
  return db.metadata.schemaVersion ?? 0;
}

export function needsMigration(db: WKTDatabase): boolean {
  const currentVersion = getSchemaVersion(db);
  return currentVersion < CURRENT_SCHEMA_VERSION;
}

export function migrateDatabase(db: WKTDatabase): WKTDatabase {
  const currentVersion = getSchemaVersion(db);

  if (currentVersion === CURRENT_SCHEMA_VERSION) {
    return db;
  }

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    logger.warn(
      `Database schema version (${currentVersion}) is newer than supported (${CURRENT_SCHEMA_VERSION}). ` +
      'Some features may not work correctly.'
    );
    return db;
  }

  logger.debug(`Migrating database from schema v${currentVersion} to v${CURRENT_SCHEMA_VERSION}`);

  let migratedDb = { ...db };

  for (const migration of migrations) {
    if (migration.version > currentVersion && migration.version <= CURRENT_SCHEMA_VERSION) {
      logger.debug(`Running migration v${migration.version}: ${migration.description}`);
      migratedDb = migration.migrate(migratedDb);
      migratedDb.metadata.schemaVersion = migration.version;
    }
  }

  // Set to current version even if no migrations ran (handles initial setup)
  migratedDb.metadata.schemaVersion = CURRENT_SCHEMA_VERSION;

  return migratedDb;
}
