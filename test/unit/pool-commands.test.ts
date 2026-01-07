import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DatabaseManager } from '../../src/core/database.js';
import { TestEnvironment, mockEnvironmentVariables } from '../utils/test-helpers.js';
import type { Project, Workspace } from '../../src/core/types.js';

describe('Pool Commands - Database Operations', () => {
  let testEnv: TestEnvironment;
  let dbManager: DatabaseManager;
  let restoreEnv: () => void;
  let testProject: Project;

  beforeEach(() => {
    testEnv = new TestEnvironment();
    testEnv.setup();

    restoreEnv = mockEnvironmentVariables({ HOME: testEnv.testDir });

    dbManager = new DatabaseManager();
    testProject = testEnv.createMockProject('test-project');
    dbManager.addProject(testProject);
  });

  afterEach(() => {
    restoreEnv();
    testEnv.cleanup();
  });

  describe('claim workflow', () => {
    it('should select oldest pooled workspace when claiming', () => {
      // Setup: create pooled workspaces with different ages
      const oldPooled = testEnv.createMockWorkspace('test-project', 'wksp-1', 'pooled');
      const newPooled = testEnv.createMockWorkspace('test-project', 'wksp-2', 'pooled');

      oldPooled.lastUsed = new Date('2024-01-01');
      newPooled.lastUsed = new Date('2024-01-15');

      dbManager.addWorkspace(oldPooled);
      dbManager.addWorkspace(newPooled);

      // Action: get pooled workspaces (claim would pick first one)
      const pooled = dbManager.getPooledWorkspaces('test-project');

      // Assert: oldest workspace should be first
      expect(pooled[0].name).toBe('wksp-1');
    });

    it('should transition workspace from pooled to claimed', () => {
      const pooledWorkspace = testEnv.createMockWorkspace('test-project', 'wksp-1', 'pooled');
      dbManager.addWorkspace(pooledWorkspace);

      // Simulate claim operation
      const workspace = dbManager.getPooledWorkspaces('test-project')[0];
      expect(workspace).toBeDefined();

      workspace!.mode = 'claimed';
      workspace!.claimedAt = new Date();
      workspace!.trackingBranch = 'main';
      workspace!.baseCommit = 'abc123';
      workspace!.lastUsed = new Date();

      dbManager.updateWorkspace(workspace!);

      // Verify state change
      const updated = dbManager.getWorkspace(workspace!.id);
      expect(updated?.mode).toBe('claimed');
      expect(updated?.claimedAt).toBeInstanceOf(Date);
      expect(updated?.trackingBranch).toBe('main');
      expect(updated?.baseCommit).toBe('abc123');

      // Should no longer appear in pooled list
      expect(dbManager.getPooledWorkspaces('test-project')).toHaveLength(0);
      expect(dbManager.getClaimedWorkspaces('test-project')).toHaveLength(1);
    });

    it('should create new workspace when pool is empty', () => {
      // No pooled workspaces exist
      expect(dbManager.getPooledWorkspaces('test-project')).toHaveLength(0);

      // Should generate new workspace name with tracking branch
      const name = dbManager.getNextPoolWorkspaceName('test-project', 'main');
      expect(name).toBe('main-wksp-1');

      // Create new claimed workspace
      const newWorkspace = testEnv.createMockWorkspace('test-project', name, 'claimed');
      dbManager.addWorkspace(newWorkspace);

      expect(dbManager.getClaimedWorkspaces('test-project')).toHaveLength(1);
    });
  });

  describe('release workflow', () => {
    it('should transition workspace from claimed to pooled', () => {
      const claimedWorkspace = testEnv.createMockWorkspace('test-project', 'wksp-1', 'claimed');
      dbManager.addWorkspace(claimedWorkspace);

      // Verify initial state
      expect(dbManager.getClaimedWorkspaces('test-project')).toHaveLength(1);
      expect(dbManager.getPooledWorkspaces('test-project')).toHaveLength(0);

      // Simulate release operation
      const workspace = dbManager.getClaimedWorkspaces('test-project')[0];
      workspace!.mode = 'pooled';
      workspace!.claimedAt = undefined;
      workspace!.lastUsed = new Date();

      dbManager.updateWorkspace(workspace!);

      // Verify state change
      expect(dbManager.getClaimedWorkspaces('test-project')).toHaveLength(0);
      expect(dbManager.getPooledWorkspaces('test-project')).toHaveLength(1);

      const updated = dbManager.getWorkspace(workspace!.id);
      expect(updated?.mode).toBe('pooled');
      expect(updated?.claimedAt).toBeUndefined();
    });

    it('should transition workspace from branched to pooled', () => {
      // Use pool-style name - renamed workspaces won't be returned by getPooledWorkspaces
      const branchedWorkspace = testEnv.createMockWorkspace('test-project', 'main-wksp-1', 'branched');
      dbManager.addWorkspace(branchedWorkspace);

      // Verify initial state
      expect(branchedWorkspace.mode).toBe('branched');

      // Simulate release operation (branched -> pooled)
      const workspace = dbManager.getWorkspace(branchedWorkspace.id);
      workspace!.mode = 'pooled';
      workspace!.branchName = 'HEAD';
      workspace!.trackingBranch = 'main';
      workspace!.lastUsed = new Date();

      dbManager.updateWorkspace(workspace!);

      // Verify state change
      const updated = dbManager.getWorkspace(workspace!.id);
      expect(updated?.mode).toBe('pooled');
      expect(updated?.branchName).toBe('HEAD');
      expect(dbManager.getPooledWorkspaces('test-project')).toHaveLength(1);
    });

    it('should not return renamed workspaces from pool', () => {
      // A workspace that was renamed should not be claimable from pool
      const renamedWorkspace = testEnv.createMockWorkspace('test-project', 'perf-test', 'pooled');
      dbManager.addWorkspace(renamedWorkspace);

      // Should not appear in pooled workspaces (doesn't match wksp-N pattern)
      expect(dbManager.getPooledWorkspaces('test-project')).toHaveLength(0);

      // But it's still in the database with mode 'pooled'
      const ws = dbManager.getWorkspace(renamedWorkspace.id);
      expect(ws?.mode).toBe('pooled');
    });

    it('should handle pool overflow by removing oldest workspaces', () => {
      // Create 6 pooled workspaces (max is typically 5)
      for (let i = 1; i <= 6; i++) {
        const ws = testEnv.createMockWorkspace('test-project', `wksp-${i}`, 'pooled');
        ws.lastUsed = new Date(`2024-01-${String(i).padStart(2, '0')}`);
        dbManager.addWorkspace(ws);
      }

      const pooled = dbManager.getPooledWorkspaces('test-project');
      expect(pooled).toHaveLength(6);

      // Simulate pool overflow cleanup (remove oldest beyond max 5)
      const maxPoolSize = 5;
      if (pooled.length > maxPoolSize) {
        const toRemove = pooled.slice(maxPoolSize);
        for (const ws of toRemove) {
          dbManager.removeWorkspace(ws.id);
        }
      }

      expect(dbManager.getPooledWorkspaces('test-project')).toHaveLength(5);
    });
  });

  describe('save workflow', () => {
    it('should transition workspace from claimed to branched when creating branch', () => {
      const claimedWorkspace = testEnv.createMockWorkspace('test-project', 'wksp-1', 'claimed');
      dbManager.addWorkspace(claimedWorkspace);

      // Verify initial state
      expect(claimedWorkspace.mode).toBe('claimed');

      // Simulate save --branch operation
      const workspace = dbManager.getWorkspace(claimedWorkspace.id);
      workspace!.mode = 'branched';
      workspace!.branchName = 'feature/new-feature';
      workspace!.claimedAt = undefined;

      dbManager.updateWorkspace(workspace!);

      // Verify state change
      const updated = dbManager.getWorkspace(workspace!.id);
      expect(updated?.mode).toBe('branched');
      expect(updated?.branchName).toBe('feature/new-feature');
      expect(updated?.claimedAt).toBeUndefined();

      // Should no longer appear in claimed list
      expect(dbManager.getClaimedWorkspaces('test-project')).toHaveLength(0);
    });

    it('should keep claimed workspace as claimed after stash (mode unchanged)', () => {
      const claimedWorkspace = testEnv.createMockWorkspace('test-project', 'wksp-1', 'claimed');
      dbManager.addWorkspace(claimedWorkspace);

      // After stash, mode should remain claimed
      const workspace = dbManager.getWorkspace(claimedWorkspace.id);
      expect(workspace?.mode).toBe('claimed');

      // No state change needed for stash - just git operation
      expect(dbManager.getClaimedWorkspaces('test-project')).toHaveLength(1);
    });
  });

  describe('workspace mode filtering', () => {
    it('should correctly filter by all three modes', () => {
      const branched = testEnv.createMockWorkspace('test-project', 'feature-1', 'branched');
      const claimed = testEnv.createMockWorkspace('test-project', 'wksp-1', 'claimed');
      const pooled = testEnv.createMockWorkspace('test-project', 'wksp-2', 'pooled');

      dbManager.addWorkspace(branched);
      dbManager.addWorkspace(claimed);
      dbManager.addWorkspace(pooled);

      const allWorkspaces = dbManager.getAllWorkspaces();
      expect(allWorkspaces).toHaveLength(3);

      const pooledOnly = dbManager.getPooledWorkspaces('test-project');
      expect(pooledOnly).toHaveLength(1);
      expect(pooledOnly[0].name).toBe('wksp-2');

      const claimedOnly = dbManager.getClaimedWorkspaces('test-project');
      expect(claimedOnly).toHaveLength(1);
      expect(claimedOnly[0].name).toBe('wksp-1');

      // Branched workspaces accessed via getWorkspacesByProject filtered by mode
      const branchedOnly = dbManager.getWorkspacesByProject('test-project')
        .filter(w => w.mode === 'branched');
      expect(branchedOnly).toHaveLength(1);
      expect(branchedOnly[0].name).toBe('feature-1');
    });
  });

  describe('workspace naming', () => {
    it('should generate sequential branch-wksp-N names', () => {
      expect(dbManager.getNextPoolWorkspaceName('test-project', 'main')).toBe('main-wksp-1');

      dbManager.addWorkspace(testEnv.createMockWorkspace('test-project', 'main-wksp-1', 'pooled'));
      expect(dbManager.getNextPoolWorkspaceName('test-project', 'main')).toBe('main-wksp-2');

      dbManager.addWorkspace(testEnv.createMockWorkspace('test-project', 'main-wksp-2', 'claimed'));
      expect(dbManager.getNextPoolWorkspaceName('test-project', 'main')).toBe('main-wksp-3');
    });

    it('should handle gaps in branch-wksp-N naming', () => {
      // Add main-wksp-1 and main-wksp-5 (skipping 2,3,4)
      dbManager.addWorkspace(testEnv.createMockWorkspace('test-project', 'main-wksp-1', 'pooled'));
      dbManager.addWorkspace(testEnv.createMockWorkspace('test-project', 'main-wksp-5', 'pooled'));

      // Should return main-wksp-6 (highest + 1)
      expect(dbManager.getNextPoolWorkspaceName('test-project', 'main')).toBe('main-wksp-6');
    });

    it('should not conflict with branched workspace names', () => {
      // Add a branched workspace with wksp- prefix (unusual but possible)
      const branched = testEnv.createMockWorkspace('test-project', 'main-wksp-3', 'branched');
      dbManager.addWorkspace(branched);

      // Should still return main-wksp-4
      expect(dbManager.getNextPoolWorkspaceName('test-project', 'main')).toBe('main-wksp-4');
    });

    it('should be backwards compatible with old wksp-N format', () => {
      // Old format workspaces should still be counted
      dbManager.addWorkspace(testEnv.createMockWorkspace('test-project', 'wksp-1', 'pooled'));
      dbManager.addWorkspace(testEnv.createMockWorkspace('test-project', 'wksp-3', 'claimed'));

      // Should continue from highest number
      expect(dbManager.getNextPoolWorkspaceName('test-project', 'main')).toBe('main-wksp-4');
    });
  });

  describe('workspace field preservation', () => {
    it('should preserve all fields when transitioning modes', () => {
      const workspace = testEnv.createMockWorkspace('test-project', 'wksp-1', 'pooled');
      workspace.description = 'Test workspace';
      workspace.commitsAhead = 5;
      workspace.commitsBehind = 2;
      dbManager.addWorkspace(workspace);

      // Transition to claimed
      const ws = dbManager.getWorkspace(workspace.id)!;
      ws.mode = 'claimed';
      ws.claimedAt = new Date();
      dbManager.updateWorkspace(ws);

      // Verify other fields preserved
      const updated = dbManager.getWorkspace(workspace.id)!;
      expect(updated.description).toBe('Test workspace');
      expect(updated.commitsAhead).toBe(5);
      expect(updated.commitsBehind).toBe(2);
      expect(updated.mode).toBe('claimed');
    });

    it('should handle baseCommit and trackingBranch fields', () => {
      const workspace = testEnv.createMockWorkspace('test-project', 'wksp-1', 'claimed');
      workspace.baseCommit = 'abc123def456';
      workspace.trackingBranch = 'develop';
      dbManager.addWorkspace(workspace);

      const retrieved = dbManager.getWorkspace(workspace.id);
      expect(retrieved?.baseCommit).toBe('abc123def456');
      expect(retrieved?.trackingBranch).toBe('develop');
    });
  });
});
