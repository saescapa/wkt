import { join } from 'path';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import type { GlobalConfig, Project, Workspace, WorkspaceMode } from '../../src/core/types.js';

export class TestEnvironment {
  public testDir: string;
  public wktHome: string;
  public workspacesDir: string;
  public projectsDir: string;

  constructor() {
    this.testDir = join(tmpdir(), `wkt-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    this.wktHome = join(this.testDir, '.wkt');
    this.workspacesDir = join(this.wktHome, 'workspaces');
    this.projectsDir = join(this.wktHome, 'projects');
  }

  setup(): void {
    mkdirSync(this.testDir, { recursive: true });
    mkdirSync(this.wktHome, { recursive: true });
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

  createMockWorkspace(
    projectName: string = 'test-project',
    workspaceName: string = 'test-workspace',
    mode: WorkspaceMode = 'branched'
  ): Workspace {
    return {
      id: `${projectName}/${workspaceName}`,
      projectName,
      name: workspaceName,
      branchName: mode === 'branched' ? `feature/${workspaceName}` : 'HEAD',
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
      mode,
      trackingBranch: mode !== 'branched' ? 'main' : undefined,
      claimedAt: mode === 'claimed' ? new Date() : undefined,
      baseCommit: mode !== 'branched' ? 'abc1234567890' : undefined,
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

export function mockEnvironmentVariables(overrides: Record<string, string> = {}): () => void {
  const originalEnv = { ...process.env };

  Object.keys(process.env).forEach((key) => {
    if (key in overrides) {
      delete process.env[key];
    }
  });

  Object.assign(process.env, overrides);

  return () => {
    process.env = originalEnv;
  };
}