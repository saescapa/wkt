import type { WKTDatabase } from './types.js';
import { logger } from '../utils/logger.js';

export const CURRENT_SCHEMA_VERSION = 4;

const DEFAULT_BRANCH = 'main';

export interface Migration {
  version: number;
  description: string;
  migrate: (db: WKTDatabase) => WKTDatabase;
}

// Define migrations in order - add new migrations here as the schema evolves.
// A migration that adds or requires a new field MUST backfill it for existing
// databases; see docs/dev/contributing.md ("Schema changes").
export const migrations: Migration[] = [
  {
    version: 2,
    description: 'Schema update (no-op)',
    migrate: (db): WKTDatabase => db
  },
  {
    version: 3,
    description: 'Schema update (no-op)',
    migrate: (db): WKTDatabase => db
  },
  {
    version: 4,
    description: 'Backfill required workspace/project fields (defaultBranch, baseBranch, status)',
    migrate: (db): WKTDatabase => {
      for (const project of Object.values(db.projects)) {
        if (!project.defaultBranch) {
          project.defaultBranch = DEFAULT_BRANCH;
        }
      }
      for (const workspace of Object.values(db.workspaces)) {
        if (!workspace.baseBranch) {
          workspace.baseBranch =
            db.projects[workspace.projectName]?.defaultBranch ?? DEFAULT_BRANCH;
        }
        if (!workspace.status) {
          workspace.status = {
            clean: true,
            staged: 0,
            unstaged: 0,
            untracked: 0,
            conflicted: 0,
          };
        }
      }
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
