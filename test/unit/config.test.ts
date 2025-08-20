import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { writeFileSync, existsSync } from 'fs';
import { ConfigManager } from '../../src/core/config.js';
import { TestEnvironment, mockEnvironmentVariables } from '../utils/test-helpers.js';

describe('ConfigManager', () => {
  let testEnv: TestEnvironment;
  let configManager: ConfigManager;
  let restoreEnv: () => void;

  beforeEach(() => {
    testEnv = new TestEnvironment();
    testEnv.setup();
    
    // Mock HOME directory to use test directory
    restoreEnv = mockEnvironmentVariables({ HOME: testEnv.testDir });
    
    configManager = new ConfigManager();
  });

  afterEach(() => {
    restoreEnv();
    testEnv.cleanup();
  });

  describe('getConfig', () => {
    it('should return default config when no config file exists', () => {
      const config = configManager.getConfig();
      
      expect(config.wkt.workspace_root).toContain('.wkt/workspaces');
      expect(config.wkt.projects_root).toContain('.wkt/projects');
      expect(config.workspace.naming_strategy).toBe('sanitized');
      expect(config.git.default_base).toBe('main');
      expect(config.inference.patterns).toHaveLength(3);
    });

    it('should merge custom config with defaults', () => {
      const configPath = join(testEnv.configDir, 'config.yaml');
      const customConfig = `
wkt:
  default_project: "my-project"
workspace:
  naming_strategy: "kebab-case"
projects:
  test-project:
    git:
      default_base: "develop"
`;
      
      writeFileSync(configPath, customConfig);
      
      const config = configManager.getConfig();
      
      expect(config.wkt.default_project).toBe('my-project');
      expect(config.workspace.naming_strategy).toBe('kebab-case');
      expect(config.projects['test-project'].git?.default_base).toBe('develop');
      // Should still have defaults
      expect(config.git.default_base).toBe('main');
    });

    it('should handle malformed config file gracefully', () => {
      const configPath = join(testEnv.configDir, 'config.yaml');
      writeFileSync(configPath, 'invalid: yaml: content: [');
      
      const config = configManager.getConfig();
      
      // Should fall back to defaults
      expect(config.git.default_base).toBe('main');
    });
  });

  describe('saveConfig', () => {
    it('should save config to YAML file', () => {
      const config = configManager.getConfig();
      config.wkt.default_project = 'test-project';
      
      configManager.saveConfig();
      
      const configPath = join(testEnv.configDir, 'config.yaml');
      expect(existsSync(configPath)).toBe(true);
      
      // Reload and verify
      const newConfigManager = new ConfigManager();
      const reloadedConfig = newConfigManager.getConfig();
      expect(reloadedConfig.wkt.default_project).toBe('test-project');
    });
  });

  describe('updateConfig', () => {
    it('should update and save config', () => {
      const customWorkspaces = join(testEnv.testDir, 'custom', 'workspaces');
      const customProjects = join(testEnv.testDir, 'custom', 'projects');
      
      configManager.updateConfig({
        wkt: {
          workspace_root: customWorkspaces,
          projects_root: customProjects,
        },
      });
      
      const config = configManager.getConfig();
      expect(config.wkt.workspace_root).toBe(customWorkspaces);
      expect(config.wkt.projects_root).toBe(customProjects);
    });
  });

  describe('getProjectConfig', () => {
    it('should return empty config for non-existent project', () => {
      const projectConfig = configManager.getProjectConfig('non-existent');
      expect(projectConfig).toEqual({});
    });

    it('should return project-specific config', () => {
      configManager.updateConfig({
        projects: {
          'test-project': {
            git: { default_base: 'develop' },
            workspace: { naming_strategy: 'snake_case' },
          },
        },
      });
      
      const projectConfig = configManager.getProjectConfig('test-project');
      expect(projectConfig.git?.default_base).toBe('develop');
      expect(projectConfig.workspace?.naming_strategy).toBe('snake_case');
    });
  });

  describe('updateProjectConfig', () => {
    it('should update project-specific config', () => {
      configManager.updateProjectConfig('test-project', {
        git: { default_base: 'staging' },
      });
      
      const projectConfig = configManager.getProjectConfig('test-project');
      expect(projectConfig.git?.default_base).toBe('staging');
    });
  });

  describe('ensureConfigDir', () => {
    it('should create config directories if they do not exist', () => {
      testEnv.cleanup(); // Remove test directories
      
      configManager.ensureConfigDir();
      
      const workspacesDir = configManager.getWorkspaceRoot();
      const projectsDir = configManager.getProjectsRoot();
      
      expect(existsSync(workspacesDir)).toBe(true);
      expect(existsSync(projectsDir)).toBe(true);
    });
  });

  describe('getWorkspaceRoot and getProjectsRoot', () => {
    it('should return correct paths', () => {
      const workspaceRoot = configManager.getWorkspaceRoot();
      const projectsRoot = configManager.getProjectsRoot();
      
      expect(workspaceRoot).toContain('.wkt/workspaces');
      expect(projectsRoot).toContain('.wkt/projects');
    });
  });
});