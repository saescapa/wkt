import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { createCommand } from '../../src/commands/create.js';
import { DatabaseManager } from '../../src/core/database.js';
import { TestEnvironment, mockEnvironmentVariables, captureConsoleOutput, MockGitUtils } from '../utils/test-helpers.js';

describe('Create Command Integration', () => {
  let testEnv: TestEnvironment;
  let dbManager: DatabaseManager;
  let restoreEnv: () => void;
  let consoleCapture: ReturnType<typeof captureConsoleOutput>;

  beforeEach(() => {
    testEnv = new TestEnvironment();
    testEnv.setup();
    
    restoreEnv = mockEnvironmentVariables({ HOME: testEnv.testDir });
    consoleCapture = captureConsoleOutput();
    
    dbManager = new DatabaseManager();
    
    // Add a test project
    const testProject = testEnv.createMockProject('test-project');
    mkdirSync(testProject.bareRepoPath, { recursive: true });
    dbManager.addProject(testProject);
    
    // Mock git operations
    MockGitUtils.mockCommand('git fetch --all', { stdout: '' });
    MockGitUtils.mockCommand(
      `git worktree add "${join(testEnv.workspacesDir, 'test-project', 'test-workspace')}" -b "feature/test-workspace" "main"`,
      { stdout: 'Preparing worktree...' }
    );
    MockGitUtils.mockCommand('git status --porcelain', { stdout: '' });
    MockGitUtils.mockCommand('git rev-list --count main..feature/test-workspace', { stdout: '0' });
    MockGitUtils.mockCommand('git rev-list --count feature/test-workspace..main', { stdout: '0' });
  });

  afterEach(() => {
    MockGitUtils.clearMocks();
    consoleCapture.restore();
    restoreEnv();
    testEnv.cleanup();
  });

  it('should create workspace with feature branch', async () => {
    await createCommand('test-project', 'feature/auth-system');
    
    expect(consoleCapture.logs.some(log => log.includes('Successfully created workspace'))).toBe(true);
    expect(consoleCapture.logs.some(log => log.includes('auth-system'))).toBe(true);
    
    const workspaces = dbManager.getAllWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].name).toBe('auth-system');
    expect(workspaces[0].branchName).toBe('feature/auth-system');
  });

  it('should create workspace with branch inference', async () => {
    MockGitUtils.mockCommand(
      `git worktree add "${join(testEnv.workspacesDir, 'test-project', 'eng-1234')}" -b "feature/eng-1234" "main"`,
      { stdout: 'Preparing worktree...' }
    );
    MockGitUtils.mockCommand('git rev-list --count main..feature/eng-1234', { stdout: '0' });
    MockGitUtils.mockCommand('git rev-list --count feature/eng-1234..main', { stdout: '0' });
    
    await createCommand('test-project', '1234');
    
    expect(consoleCapture.logs.some(log => log.includes('Successfully created workspace'))).toBe(true);
    expect(consoleCapture.logs.some(log => log.includes('eng-1234'))).toBe(true);
    
    const workspaces = dbManager.getAllWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].name).toBe('eng-1234');
    expect(workspaces[0].branchName).toBe('feature/eng-1234');
  });

  it('should create workspace with custom name', async () => {
    MockGitUtils.mockCommand(
      `git worktree add "${join(testEnv.workspacesDir, 'test-project', 'custom-name')}" -b "feature/auth-system" "main"`,
      { stdout: 'Preparing worktree...' }
    );
    MockGitUtils.mockCommand('git rev-list --count main..feature/auth-system', { stdout: '0' });
    MockGitUtils.mockCommand('git rev-list --count feature/auth-system..main', { stdout: '0' });
    
    await createCommand('test-project', 'feature/auth-system', { name: 'custom-name' });
    
    const workspaces = dbManager.getAllWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].name).toBe('custom-name');
    expect(workspaces[0].branchName).toBe('feature/auth-system');
  });

  it('should create workspace from different base branch', async () => {
    MockGitUtils.mockCommand(
      `git worktree add "${join(testEnv.workspacesDir, 'test-project', 'hotfix-branch')}" -b "hotfix/critical-fix" "develop"`,
      { stdout: 'Preparing worktree...' }
    );
    MockGitUtils.mockCommand('git rev-list --count develop..hotfix/critical-fix', { stdout: '0' });
    MockGitUtils.mockCommand('git rev-list --count hotfix/critical-fix..develop', { stdout: '0' });
    
    await createCommand('test-project', 'hotfix/critical-fix', { from: 'develop' });
    
    expect(consoleCapture.logs.some(log => log.includes('Base: develop'))).toBe(true);
    
    const workspaces = dbManager.getAllWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].baseBranch).toBe('develop');
  });

  it('should error when project does not exist', async () => {
    let exitCode = 0;
    const originalExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; }) as never;
    
    try {
      await createCommand('non-existent-project', 'feature/test');
    } catch (error) {
      // Expected to throw due to process.exit
    }
    
    process.exit = originalExit;
    
    expect(exitCode).toBe(1);
    expect(consoleCapture.errors.some(error => error.includes('Project \'non-existent-project\' not found'))).toBe(true);
  });

  it('should error when workspace already exists', async () => {
    // Create first workspace
    await createCommand('test-project', 'feature/auth-system');
    consoleCapture.errors.length = 0; // Clear errors
    
    let exitCode = 0;
    const originalExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; }) as never;
    
    try {
      await createCommand('test-project', 'feature/auth-system');
    } catch (error) {
      // Expected to throw due to process.exit
    }
    
    process.exit = originalExit;
    
    expect(exitCode).toBe(1);
    expect(consoleCapture.errors.some(error => error.includes('already exists'))).toBe(true);
  });

  it('should handle git worktree creation errors', async () => {
    MockGitUtils.mockCommand(
      `git worktree add "${join(testEnv.workspacesDir, 'test-project', 'failing-workspace')}" -b "feature/failing-workspace" "main"`,
      {
        stderr: 'fatal: failed to create worktree',
        exitCode: 1,
      }
    );
    
    let exitCode = 0;
    const originalExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; }) as never;
    
    try {
      await createCommand('test-project', 'feature/failing-workspace');
    } catch (error) {
      // Expected to throw due to process.exit
    }
    
    process.exit = originalExit;
    
    expect(exitCode).toBe(1);
    expect(consoleCapture.errors.some(error => error.includes('Error creating workspace'))).toBe(true);
  });
});