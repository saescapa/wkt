import { join } from 'path';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import type { GlobalConfig, Project, Workspace } from '../../src/core/types.js';

export class TestEnvironment {
  public testDir: string;
  public configDir: string;
  public workspacesDir: string;
  public projectsDir: string;

  constructor() {
    this.testDir = join(tmpdir(), `wkt-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    this.configDir = join(this.testDir, '.wkt');
    this.workspacesDir = join(this.configDir, 'workspaces');
    this.projectsDir = join(this.configDir, 'projects');
  }

  setup(): void {
    mkdirSync(this.testDir, { recursive: true });
    mkdirSync(this.configDir, { recursive: true });
    mkdirSync(this.workspacesDir, { recursive: true });
    mkdirSync(this.projectsDir, { recursive: true });
  }

  cleanup(): void {
    if (existsSync(this.testDir)) {
      rmSync(this.testDir, { recursive: true, force: true });
    }
  }

  getTestConfig(): GlobalConfig {
    return {
      wkt: {
        workspace_root: this.workspacesDir,
        projects_root: this.projectsDir,
      },
      workspace: {
        naming_strategy: 'sanitized',
        auto_cleanup: true,
        max_age_days: 30,
      },
      git: {
        default_base: 'main',
        auto_fetch: true,
        auto_rebase: false,
        push_on_create: false,
      },
      inference: {
        patterns: [
          { pattern: '^(\\d+)$', template: 'feature/eng-{}' },
          { pattern: '^eng-(\\d+)$', template: 'feature/{}' },
          { pattern: '^(feature/.+)$', template: '{}' },
        ],
      },
      projects: {},
      aliases: {
        ls: 'list',
        sw: 'switch',
        rm: 'clean',
      },
    };
  }

  createMockProject(name: string = 'test-project'): Project {
    return {
      name,
      repositoryUrl: `https://github.com/test/${name}.git`,
      bareRepoPath: join(this.projectsDir, name),
      workspacesPath: join(this.workspacesDir, name),
      defaultBranch: 'main',
      createdAt: new Date(),
    };
  }

  createMockWorkspace(projectName: string = 'test-project', workspaceName: string = 'test-workspace'): Workspace {
    return {
      id: `${projectName}/${workspaceName}`,
      projectName,
      name: workspaceName,
      branchName: `feature/${workspaceName}`,
      path: join(this.workspacesDir, projectName, workspaceName),
      baseBranch: 'main',
      createdAt: new Date(),
      lastUsed: new Date(),
      status: {
        clean: true,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
      },
      commitsAhead: 0,
      commitsBehind: 0,
    };
  }

  createMockGitRepo(path: string): void {
    mkdirSync(path, { recursive: true });
    mkdirSync(join(path, '.git'), { recursive: true });
    
    // Create some basic files
    writeFileSync(join(path, 'README.md'), '# Test Repository\n');
    writeFileSync(join(path, 'package.json'), JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
    }, null, 2));
  }
}

export class MockGitUtils {
  static mockCommands: Map<string, { stdout?: string; stderr?: string; exitCode?: number }> = new Map();

  static mockCommand(command: string, response: { stdout?: string; stderr?: string; exitCode?: number }): void {
    this.mockCommands.set(command, response);
  }

  static clearMocks(): void {
    this.mockCommands.clear();
  }

  static async executeCommand(command: string, cwd?: string): Promise<string> {
    const mock = this.mockCommands.get(command);
    if (mock) {
      if (mock.exitCode && mock.exitCode !== 0) {
        throw new Error(mock.stderr || 'Command failed');
      }
      return mock.stdout || '';
    }

    // Default mocks for common commands
    if (command.includes('git remote get-url origin')) {
      return 'https://github.com/test/repo.git';
    }
    if (command.includes('git branch --show-current')) {
      return 'main';
    }
    if (command.includes('git status --porcelain')) {
      return '';
    }
    if (command.includes('git symbolic-ref refs/remotes/origin/HEAD')) {
      return 'refs/remotes/origin/main';
    }

    return '';
  }
}

export function mockEnvironmentVariables(overrides: Record<string, string> = {}): () => void {
  const originalEnv = { ...process.env };
  
  // Clear existing HOME and set new one
  Object.keys(process.env).forEach(key => {
    if (key in overrides) {
      delete process.env[key];
    }
  });
  
  Object.assign(process.env, overrides);
  
  return () => {
    process.env = originalEnv;
  };
}

export function captureConsoleOutput(): { 
  logs: string[]; 
  errors: string[]; 
  restore: () => void;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  
  const originalLog = console.log;
  const originalError = console.error;
  
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  
  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}