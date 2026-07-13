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
    
    // Use WKT_HOME for complete isolation
    restoreEnv = mockEnvironmentVariables({ WKT_HOME: testEnv.wktHome });
    
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
      expect(config.display.hide_inactive_main_branches).toBe(true);
      expect(config.inference.patterns).toHaveLength(3);
    });

    it('should merge custom config with defaults', () => {
      const configPath = join(testEnv.wktHome, 'config.yaml');
      const customConfig = `
workspace:
  naming_strategy: "kebab-case"
projects:
  test-project:
    workspace:
      naming_strategy: "snake_case"
`;

      writeFileSync(configPath, customConfig);

      const config = configManager.getConfig();

      expect(config.workspace.naming_strategy).toBe('kebab-case');
      expect(config.projects['test-project'].workspace?.naming_strategy).toBe('snake_case');
      // Should still have defaults
      expect(config.display.main_branch_inactive_days).toBe(7);
      expect(config.inference.patterns).toHaveLength(3);
    });

    it('should handle malformed config file gracefully', () => {
      const configPath = join(testEnv.wktHome, 'config.yaml');
      writeFileSync(configPath, 'invalid: yaml: content: [');

      const config = configManager.getConfig();

      // Should fall back to defaults
      expect(config.workspace.naming_strategy).toBe('sanitized');
    });
  });

  describe('saveConfig', () => {
    it('should save config to YAML file', () => {
      const config = configManager.getConfig();
      config.workspace.naming_strategy = 'kebab-case';

      configManager.saveConfig();

      const configPath = join(testEnv.wktHome, 'config.yaml');
      expect(existsSync(configPath)).toBe(true);

      // Reload and verify
      const newConfigManager = new ConfigManager();
      const reloadedConfig = newConfigManager.getConfig();
      expect(reloadedConfig.workspace.naming_strategy).toBe('kebab-case');
    });
  });

  describe('updateConfig', () => {
    it('should update and save config', () => {
      const customWorkspaces = join(testEnv.testDir, 'custom', 'workspaces');
      const customProjects = join(testEnv.testDir, 'custom', 'projects');
      const customShared = join(testEnv.testDir, 'custom', 'shared');

      configManager.updateConfig({
        wkt: {
          workspace_root: customWorkspaces,
          projects_root: customProjects,
          shared_root: customShared,
        },
      });

      const config = configManager.getConfig();
      expect(config.wkt.workspace_root).toBe(customWorkspaces);
      expect(config.wkt.projects_root).toBe(customProjects);
      expect(config.wkt.shared_root).toBe(customShared);
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
            workspace: { naming_strategy: 'snake_case' },
          },
        },
      });

      const projectConfig = configManager.getProjectConfig('test-project');
      expect(projectConfig.workspace?.naming_strategy).toBe('snake_case');
    });

    it('should overlay stored project overrides (templates) on the global section', () => {
      configManager.updateConfig({
        projects: {
          'test-project': {
            workspace: { naming_strategy: 'snake_case' },
            inference: { patterns: [{ pattern: '^(x-.+)$', template: '{}' }] },
          },
        },
      });

      const projectConfig = configManager.getProjectConfig('test-project', {
        workspace: { naming_strategy: 'kebab-case' },
      });

      // Override wins where set, global project section fills the rest
      expect(projectConfig.workspace?.naming_strategy).toBe('kebab-case');
      expect(projectConfig.inference?.patterns).toHaveLength(1);
    });
  });

  describe('updateProjectConfig', () => {
    it('should update project-specific config', () => {
      configManager.updateProjectConfig('test-project', {
        workspace: { naming_strategy: 'kebab-case' },
      });

      const projectConfig = configManager.getProjectConfig('test-project');
      expect(projectConfig.workspace?.naming_strategy).toBe('kebab-case');
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