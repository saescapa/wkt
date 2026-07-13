import { readFileSync, writeFileSync, existsSync, mkdirSync, rmdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import type { WKTDatabase, Project, Workspace } from './types.js';
import { ConfigManager } from './config.js';
import { CURRENT_SCHEMA_VERSION, needsMigration, migrateDatabase } from './migrations.js';
import { logger } from '../utils/logger.js';

export class DatabaseManager {
  private configManager: ConfigManager;
  private dbPath: string;
  private db: WKTDatabase | null = null;

  constructor(configManager?: ConfigManager) {
    this.configManager = configManager || new ConfigManager();
    this.dbPath = join(this.configManager.getConfig().wkt.workspace_root, '..', 'database.json');
  }

  private getEmptyDatabase(): WKTDatabase {
    return {
      projects: {},
      workspaces: {},
      metadata: {
        version: '1.0.0',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        lastCleanup: new Date(),
      },
    };
  }

  getDatabase(): WKTDatabase {
    if (this.db) {
      return this.db;
    }

    if (!existsSync(this.dbPath)) {
      this.db = this.getEmptyDatabase();
      this.saveDatabase();
      return this.db;
    }

    try {
      const dbFile = readFileSync(this.dbPath, 'utf-8');
      let parsedDb = JSON.parse(dbFile, (key, value) => {
        if (key.includes('At') || key.includes('Used') || key === 'lastCleanup') {
          return new Date(value);
        }
        return value;
      }) as WKTDatabase;

      // Run migrations if needed
      if (needsMigration(parsedDb)) {
        logger.info('Upgrading database schema...');
        parsedDb = migrateDatabase(parsedDb);
        this.db = parsedDb;
        this.saveDatabase();
        logger.info('Database schema upgraded successfully.');
      } else {
        this.db = parsedDb;
      }

      return this.db;
    } catch (error) {
      logger.warn(`Error reading database file, creating new one: ${error}`);
      this.db = this.getEmptyDatabase();
      this.saveDatabase();
      return this.db;
    }
  }

  saveDatabase(): void {
    if (!this.db) return;

    this.configManager.ensureConfigDir();
    try {
      const dbJson = JSON.stringify(this.db, null, 2);
      writeFileSync(this.dbPath, dbJson, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save database: ${error}`);
    }
  }

  /**
   * Serialize mutations across concurrent wkt processes (parallel `wkt create`
   * is a core workflow). Each mutation re-reads the file under an exclusive
   * lock before applying, so one process's write can't clobber another's.
   * The lock is a directory (mkdir is atomic); a lock older than 10s is
   * treated as abandoned by a crashed process and stolen.
   */
  private withLock<T>(fn: () => T): T {
    this.configManager.ensureConfigDir();
    const lockPath = this.dbPath + '.lock';
    const deadline = Date.now() + 5000;

    for (;;) {
      try {
        mkdirSync(lockPath);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
        try {
          const age = Date.now() - statSync(lockPath).mtimeMs;
          if (age > 10_000) {
            rmdirSync(lockPath);
            continue;
          }
        } catch {
          continue; // lock released between checks — retry immediately
        }
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for database lock: ${lockPath}`);
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }

    try {
      return fn();
    } finally {
      try {
        rmdirSync(lockPath);
      } catch {
        // already removed (e.g. stolen as stale) — nothing to release
      }
    }
  }

  private mutate(apply: (db: WKTDatabase) => void): void {
    this.withLock(() => {
      this.db = null; // drop cache; re-read the file under the lock
      const db = this.getDatabase();
      apply(db);
      this.saveDatabase();
    });
  }

  addProject(project: Project): void {
    this.mutate(db => {
      db.projects[project.name] = project;
    });
  }

  getProject(name: string): Project | undefined {
    const db = this.getDatabase();
    return db.projects[name];
  }

  getAllProjects(): Project[] {
    const db = this.getDatabase();
    return Object.values(db.projects);
  }

  updateProject(project: Project): void {
    this.mutate(db => {
      if (db.projects[project.name]) {
        db.projects[project.name] = project;
      }
    });
  }

  removeProject(name: string): void {
    this.mutate(db => {
      delete db.projects[name];

      Object.keys(db.workspaces).forEach(workspaceId => {
        if (db.workspaces[workspaceId]?.projectName === name) {
          delete db.workspaces[workspaceId];
        }
      });
    });
  }

  addWorkspace(workspace: Workspace): void {
    this.mutate(db => {
      db.workspaces[workspace.id] = workspace;
    });
  }

  getWorkspace(id: string): Workspace | undefined {
    const db = this.getDatabase();
    return db.workspaces[id];
  }

  getAllWorkspaces(): Workspace[] {
    const db = this.getDatabase();
    return Object.values(db.workspaces);
  }

  getWorkspacesByProject(projectName: string): Workspace[] {
    const db = this.getDatabase();
    return Object.values(db.workspaces).filter(w => w.projectName === projectName);
  }

  updateWorkspace(workspace: Workspace): void {
    this.mutate(db => {
      if (db.workspaces[workspace.id]) {
        db.workspaces[workspace.id] = workspace;
      }
    });
  }

  removeWorkspace(id: string): void {
    this.mutate(db => {
      delete db.workspaces[id];
    });
  }

  searchWorkspaces(query: string, projectName?: string): Workspace[] {
    const workspaces = projectName
      ? this.getWorkspacesByProject(projectName)
      : this.getAllWorkspaces();

    return workspaces.filter(workspace =>
      workspace.name.toLowerCase().includes(query.toLowerCase()) ||
      workspace.branchName.toLowerCase().includes(query.toLowerCase())
    );
  }

  getWorkspaceFromPath(currentPath?: string): Workspace | undefined {
    const targetPath = resolve(currentPath || process.cwd());
    const allWorkspaces = this.getAllWorkspaces();

    // Find workspace whose path matches the current directory
    return allWorkspaces.find(workspace => {
      const workspacePath = resolve(workspace.path);
      return targetPath === workspacePath || targetPath.startsWith(workspacePath + '/');
    });
  }

  getCurrentWorkspaceContext(): Workspace | undefined {
    return this.getWorkspaceFromPath();
  }

}