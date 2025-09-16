import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import type { WKTDatabase, Project, Workspace } from './types.js';
import { ConfigManager } from './config.js';

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
      this.db = JSON.parse(dbFile, (key, value) => {
        if (key.includes('At') || key.includes('Used') || key === 'lastCleanup') {
          return new Date(value);
        }
        return value;
      });
      return this.db!;
    } catch (error) {
      console.warn('Error reading database file, creating new one:', error);
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

  addProject(project: Project): void {
    const db = this.getDatabase();
    db.projects[project.name] = project;
    this.saveDatabase();
  }

  getProject(name: string): Project | undefined {
    const db = this.getDatabase();
    return db.projects[name];
  }

  getAllProjects(): Project[] {
    const db = this.getDatabase();
    return Object.values(db.projects);
  }

  removeProject(name: string): void {
    const db = this.getDatabase();
    delete db.projects[name];
    
    Object.keys(db.workspaces).forEach(workspaceId => {
      if (db.workspaces[workspaceId]?.projectName === name) {
        delete db.workspaces[workspaceId];
      }
    });
    
    this.saveDatabase();
  }

  addWorkspace(workspace: Workspace): void {
    const db = this.getDatabase();
    db.workspaces[workspace.id] = workspace;
    this.saveDatabase();
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

  getProjectWorkspaces(projectName: string): Workspace[] {
    return this.getWorkspacesByProject(projectName);
  }

  updateWorkspace(workspace: Workspace): void {
    const db = this.getDatabase();
    if (db.workspaces[workspace.id]) {
      db.workspaces[workspace.id] = workspace;
      this.saveDatabase();
    }
  }

  removeWorkspace(id: string): void {
    const db = this.getDatabase();
    delete db.workspaces[id];
    this.saveDatabase();
  }

  setCurrentWorkspace(workspaceId: string | undefined): void {
    const db = this.getDatabase();
    db.metadata.currentWorkspace = workspaceId;
    this.saveDatabase();
  }

  getCurrentWorkspace(): Workspace | undefined {
    const db = this.getDatabase();
    const currentId = db.metadata.currentWorkspace;
    return currentId ? db.workspaces[currentId] : undefined;
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
    // First try to detect from current directory
    const pathBasedWorkspace = this.getWorkspaceFromPath();
    if (pathBasedWorkspace) {
      return pathBasedWorkspace;
    }

    // Fall back to stored current workspace
    return this.getCurrentWorkspace();
  }
}