import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { initCommand } from '../../src/commands/init.js';
import { TestEnvironment, mockEnvironmentVariables, captureConsoleOutput, MockGitUtils } from '../utils/test-helpers.js';

describe('Init Command Integration', () => {
  let testEnv: TestEnvironment;
  let restoreEnv: () => void;
  let consoleCapture: ReturnType<typeof captureConsoleOutput>;

  beforeEach(() => {
    testEnv = new TestEnvironment();
    testEnv.setup();
    
    restoreEnv = mockEnvironmentVariables({ HOME: testEnv.testDir });
    consoleCapture = captureConsoleOutput();
    
    // Mock git operations
    MockGitUtils.mockCommand('git clone --bare "https://github.com/test/repo.git" ' + `"${join(testEnv.projectsDir, 'test-repo')}"`, {
      stdout: 'Cloning...',
    });
    MockGitUtils.mockCommand('git fetch --all', { stdout: '' });
    MockGitUtils.mockCommand('git symbolic-ref refs/remotes/origin/HEAD', {
      stdout: 'refs/remotes/origin/main',
    });
  });

  afterEach(() => {
    MockGitUtils.clearMocks();
    consoleCapture.restore();
    restoreEnv();
    testEnv.cleanup();
  });

  it('should initialize project with repository URL', async () => {
    await initCommand('https://github.com/test/repo.git', 'test-repo');
    
    expect(consoleCapture.logs.some(log => log.includes('Successfully initialized project'))).toBe(true);
    expect(consoleCapture.logs.some(log => log.includes('test-repo'))).toBe(true);
  });

  it('should initialize project with inferred name from URL', async () => {
    await initCommand('https://github.com/test/my-awesome-project.git');
    
    expect(consoleCapture.logs.some(log => log.includes('my-awesome-project'))).toBe(true);
  });

  it('should show error for duplicate project', async () => {
    // Initialize first time
    await initCommand('https://github.com/test/repo.git', 'test-repo');
    consoleCapture.logs.length = 0; // Clear logs
    consoleCapture.errors.length = 0; // Clear errors
    
    // Try to initialize again
    let exitCode = 0;
    const originalExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; }) as never;
    
    try {
      await initCommand('https://github.com/test/repo.git', 'test-repo');
    } catch (error) {
      // Expected to throw due to process.exit
    }
    
    process.exit = originalExit;
    
    expect(exitCode).toBe(1);
    expect(consoleCapture.errors.some(error => error.includes('already exists'))).toBe(true);
  });

  it('should list projects when --list flag is used', async () => {
    // First initialize a project
    await initCommand('https://github.com/test/repo.git', 'test-repo');
    consoleCapture.logs.length = 0; // Clear logs
    
    // Then list projects
    await initCommand(undefined, undefined, { list: true });
    
    expect(consoleCapture.logs.some(log => log.includes('Managed Projects'))).toBe(true);
    expect(consoleCapture.logs.some(log => log.includes('test-repo'))).toBe(true);
  });

  it('should show message when no projects exist and listing', async () => {
    await initCommand(undefined, undefined, { list: true });
    
    expect(consoleCapture.logs.some(log => log.includes('No projects initialized yet'))).toBe(true);
  });

  it('should handle git clone errors gracefully', async () => {
    MockGitUtils.mockCommand('git clone --bare "https://github.com/test/invalid.git" ' + `"${join(testEnv.projectsDir, 'invalid')}"`, {
      stderr: 'Repository not found',
      exitCode: 128,
    });
    
    let exitCode = 0;
    const originalExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; }) as never;
    
    try {
      await initCommand('https://github.com/test/invalid.git', 'invalid');
    } catch (error) {
      // Expected to throw due to process.exit
    }
    
    process.exit = originalExit;
    
    expect(exitCode).toBe(1);
    expect(consoleCapture.errors.some(error => error.includes('Error initializing project'))).toBe(true);
  });
});