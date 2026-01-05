import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DatabaseManager } from '../../src/core/database.js';
import { TestEnvironment, mockEnvironmentVariables } from '../utils/test-helpers.js';
import type { Project, Workspace } from '../../src/core/types.js';

describe('DatabaseManager', () => {
  let testEnv: TestEnvironment;
  let dbManager: DatabaseManager;
  let restoreEnv: () => void;

  beforeEach(() => {
    testEnv = new TestEnvironment();
    testEnv.setup();
    
    restoreEnv = mockEnvironmentVariables({ HOME: testEnv.testDir });
    
    dbManager = new DatabaseManager();
  });

  afterEach(() => {
    restoreEnv();
    testEnv.cleanup();
  });

  describe('getDatabase', () => {
    it('should return empty database when no database file exists', () => {
      const db = dbManager.getDatabase();
      
      expect(db.projects).toEqual({});
      expect(db.workspaces).toEqual({});
      expect(db.metadata.version).toBe('1.0.0');
      expect(db.metadata.lastCleanup).toBeInstanceOf(Date);
    });

    it('should persist database between instances', () => {
      const project = testEnv.createMockProject('test-project');
      dbManager.addProject(project);
      
      // Create new instance
      const newDbManager = new DatabaseManager();
      const projects = newDbManager.getAllProjects();
      
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('test-project');
    });
  });

  describe('project management', () => {
    let testProject: Project;

    beforeEach(() => {
      testProject = testEnv.createMockProject('test-project');
    });

    it('should add and retrieve project', () => {
      dbManager.addProject(testProject);
      
      const retrieved = dbManager.getProject('test-project');
      expect(retrieved).toEqual(testProject);
    });

    it('should return undefined for non-existent project', () => {
      const retrieved = dbManager.getProject('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('should list all projects', () => {
      const project1 = testEnv.createMockProject('project-1');
      const project2 = testEnv.createMockProject('project-2');
      
      dbManager.addProject(project1);
      dbManager.addProject(project2);
      
      const projects = dbManager.getAllProjects();
      expect(projects).toHaveLength(2);
      expect(projects.map(p => p.name).sort()).toEqual(['project-1', 'project-2']);
    });

    it('should remove project and associated workspaces', () => {
      const workspace = testEnv.createMockWorkspace('test-project', 'test-workspace');
      
      dbManager.addProject(testProject);
      dbManager.addWorkspace(workspace);
      
      expect(dbManager.getAllWorkspaces()).toHaveLength(1);
      
      dbManager.removeProject('test-project');
      
      expect(dbManager.getProject('test-project')).toBeUndefined();
      expect(dbManager.getAllWorkspaces()).toHaveLength(0);
    });
  });

  describe('workspace management', () => {
    let testProject: Project;
    let testWorkspace: Workspace;

    beforeEach(() => {
      testProject = testEnv.createMockProject('test-project');
      testWorkspace = testEnv.createMockWorkspace('test-project', 'test-workspace');
      dbManager.addProject(testProject);
    });

    it('should add and retrieve workspace', () => {
      dbManager.addWorkspace(testWorkspace);
      
      const retrieved = dbManager.getWorkspace(testWorkspace.id);
      expect(retrieved).toEqual(testWorkspace);
    });

    it('should return undefined for non-existent workspace', () => {
      const retrieved = dbManager.getWorkspace('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('should list all workspaces', () => {
      const workspace1 = testEnv.createMockWorkspace('test-project', 'workspace-1');
      const workspace2 = testEnv.createMockWorkspace('test-project', 'workspace-2');
      
      dbManager.addWorkspace(workspace1);
      dbManager.addWorkspace(workspace2);
      
      const workspaces = dbManager.getAllWorkspaces();
      expect(workspaces).toHaveLength(2);
      expect(workspaces.map(w => w.name).sort()).toEqual(['workspace-1', 'workspace-2']);
    });

    it('should get workspaces by project', () => {
      const project2 = testEnv.createMockProject('project-2');
      const workspace1 = testEnv.createMockWorkspace('test-project', 'workspace-1');
      const workspace2 = testEnv.createMockWorkspace('project-2', 'workspace-2');
      
      dbManager.addProject(project2);
      dbManager.addWorkspace(workspace1);
      dbManager.addWorkspace(workspace2);
      
      const projectWorkspaces = dbManager.getWorkspacesByProject('test-project');
      expect(projectWorkspaces).toHaveLength(1);
      expect(projectWorkspaces[0].name).toBe('workspace-1');
    });

    it('should update workspace', () => {
      dbManager.addWorkspace(testWorkspace);
      
      testWorkspace.status.clean = false;
      testWorkspace.status.staged = 2;
      
      dbManager.updateWorkspace(testWorkspace);
      
      const retrieved = dbManager.getWorkspace(testWorkspace.id);
      expect(retrieved?.status.clean).toBe(false);
      expect(retrieved?.status.staged).toBe(2);
    });

    it('should remove workspace', () => {
      dbManager.addWorkspace(testWorkspace);
      expect(dbManager.getWorkspace(testWorkspace.id)).toBeDefined();
      
      dbManager.removeWorkspace(testWorkspace.id);
      expect(dbManager.getWorkspace(testWorkspace.id)).toBeUndefined();
    });

    it('should search workspaces', () => {
      const workspace1 = testEnv.createMockWorkspace('test-project', 'auth-feature');
      const workspace2 = testEnv.createMockWorkspace('test-project', 'payment-system');
      const workspace3 = testEnv.createMockWorkspace('test-project', 'user-auth');
      
      workspace1.branchName = 'feature/auth-system';
      workspace3.branchName = 'feature/user-authentication';
      
      dbManager.addWorkspace(workspace1);
      dbManager.addWorkspace(workspace2);
      dbManager.addWorkspace(workspace3);
      
      const authWorkspaces = dbManager.searchWorkspaces('auth');
      expect(authWorkspaces).toHaveLength(2);
      expect(authWorkspaces.map(w => w.name).sort()).toEqual(['auth-feature', 'user-auth']);
    });

    it('should search workspaces by project', () => {
      const project2 = testEnv.createMockProject('project-2');
      const workspace1 = testEnv.createMockWorkspace('test-project', 'auth-feature');
      const workspace2 = testEnv.createMockWorkspace('project-2', 'auth-system');
      
      dbManager.addProject(project2);
      dbManager.addWorkspace(workspace1);
      dbManager.addWorkspace(workspace2);
      
      const projectAuthWorkspaces = dbManager.searchWorkspaces('auth', 'test-project');
      expect(projectAuthWorkspaces).toHaveLength(1);
      expect(projectAuthWorkspaces[0].name).toBe('auth-feature');
    });
  });

  describe('pool workspace management', () => {
    let testProject: Project;

    beforeEach(() => {
      testProject = testEnv.createMockProject('test-project');
      dbManager.addProject(testProject);
    });

    it('should get pooled workspaces sorted by lastUsed (oldest first)', () => {
      const pooled1 = testEnv.createMockWorkspace('test-project', 'wksp-1', 'pooled');
      const pooled2 = testEnv.createMockWorkspace('test-project', 'wksp-2', 'pooled');
      const branched = testEnv.createMockWorkspace('test-project', 'feature-1', 'branched');

      // Set different lastUsed times
      pooled1.lastUsed = new Date('2024-01-01');
      pooled2.lastUsed = new Date('2024-01-02');

      dbManager.addWorkspace(pooled1);
      dbManager.addWorkspace(pooled2);
      dbManager.addWorkspace(branched);

      const pooled = dbManager.getPooledWorkspaces('test-project');
      expect(pooled).toHaveLength(2);
      expect(pooled[0].name).toBe('wksp-1'); // Oldest first
      expect(pooled[1].name).toBe('wksp-2');
    });

    it('should get claimed workspaces sorted by lastUsed (most recent first)', () => {
      const claimed1 = testEnv.createMockWorkspace('test-project', 'wksp-1', 'claimed');
      const claimed2 = testEnv.createMockWorkspace('test-project', 'wksp-2', 'claimed');
      const pooled = testEnv.createMockWorkspace('test-project', 'wksp-3', 'pooled');

      // Set different lastUsed times
      claimed1.lastUsed = new Date('2024-01-01');
      claimed2.lastUsed = new Date('2024-01-02');

      dbManager.addWorkspace(claimed1);
      dbManager.addWorkspace(claimed2);
      dbManager.addWorkspace(pooled);

      const claimed = dbManager.getClaimedWorkspaces('test-project');
      expect(claimed).toHaveLength(2);
      expect(claimed[0].name).toBe('wksp-2'); // Most recent first
      expect(claimed[1].name).toBe('wksp-1');
    });

    it('should return empty array when no pooled workspaces exist', () => {
      const branched = testEnv.createMockWorkspace('test-project', 'feature-1', 'branched');
      dbManager.addWorkspace(branched);

      const pooled = dbManager.getPooledWorkspaces('test-project');
      expect(pooled).toHaveLength(0);
    });

    it('should get next pool workspace name', () => {
      const name1 = dbManager.getNextPoolWorkspaceName('test-project');
      expect(name1).toBe('wksp-1');

      const wksp1 = testEnv.createMockWorkspace('test-project', 'wksp-1', 'pooled');
      dbManager.addWorkspace(wksp1);

      const name2 = dbManager.getNextPoolWorkspaceName('test-project');
      expect(name2).toBe('wksp-2');

      const wksp5 = testEnv.createMockWorkspace('test-project', 'wksp-5', 'claimed');
      dbManager.addWorkspace(wksp5);

      const name3 = dbManager.getNextPoolWorkspaceName('test-project');
      expect(name3).toBe('wksp-6');
    });

    it('should filter pooled workspaces by project', () => {
      const project2 = testEnv.createMockProject('project-2');
      dbManager.addProject(project2);

      const pooled1 = testEnv.createMockWorkspace('test-project', 'wksp-1', 'pooled');
      const pooled2 = testEnv.createMockWorkspace('project-2', 'wksp-2', 'pooled');

      dbManager.addWorkspace(pooled1);
      dbManager.addWorkspace(pooled2);

      const testProjectPooled = dbManager.getPooledWorkspaces('test-project');
      expect(testProjectPooled).toHaveLength(1);
      expect(testProjectPooled[0].name).toBe('wksp-1');

      const project2Pooled = dbManager.getPooledWorkspaces('project-2');
      expect(project2Pooled).toHaveLength(1);
      expect(project2Pooled[0].name).toBe('wksp-2');
    });
  });
});