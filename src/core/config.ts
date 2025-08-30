import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse, stringify } from 'yaml';
import type { GlobalConfig, ProjectConfig } from './types.js';

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private config: GlobalConfig | null = null;

  constructor() {
    const homeDirectory = process.env.HOME || homedir();
    this.configDir = join(homeDirectory, '.wkt');
    this.configPath = join(this.configDir, 'config.yaml');
  }

  private getDefaultConfig(): GlobalConfig {
    const homeDirectory = process.env.HOME || homedir();
    return {
      wkt: {
        workspace_root: join(homeDirectory, '.wkt', 'workspaces'),
        projects_root: join(homeDirectory, '.wkt', 'projects'),
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
      local_files: {
        shared: [],
        copied: [],
        templates: {},
        workspace_templates: {}
      },
      scripts: {
        scripts: {},
        allowed_commands: [],
        hooks: {},
        shortcuts: {},
        workspace_scripts: {},
      },
      projects: {},
      aliases: {
        ls: 'list',
        sw: 'switch',
        rm: 'clean',
      },
    };
  }

  getConfig(): GlobalConfig {
    if (this.config) {
      return this.config;
    }

    if (!existsSync(this.configPath)) {
      this.config = this.getDefaultConfig();
      this.saveConfig();
      return this.config;
    }

    try {
      const configFile = readFileSync(this.configPath, 'utf-8');
      const parsedConfig = parse(configFile) as Partial<GlobalConfig>;
      this.config = { ...this.getDefaultConfig(), ...parsedConfig };
      return this.config;
    } catch (error) {
      console.warn('Error reading config file, using defaults:', error);
      this.config = this.getDefaultConfig();
      return this.config;
    }
  }

  saveConfig(): void {
    if (!this.config) return;

    this.ensureConfigDir();
    try {
      const configYaml = stringify(this.config);
      writeFileSync(this.configPath, configYaml, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save config: ${error}`);
    }
  }

  updateConfig(updates: Partial<GlobalConfig>): void {
    this.config = { ...this.getConfig(), ...updates };
    this.saveConfig();
  }

  getProjectConfig(projectName: string): ProjectConfig {
    const globalConfig = this.getConfig();
    return globalConfig.projects[projectName] || {};
  }

  updateProjectConfig(projectName: string, config: ProjectConfig): void {
    const globalConfig = this.getConfig();
    globalConfig.projects[projectName] = config;
    this.updateConfig({ projects: globalConfig.projects });
  }

  ensureConfigDir(): void {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }

    const workspacesDir = this.getConfig().wkt.workspace_root;
    const projectsDir = this.getConfig().wkt.projects_root;

    if (!existsSync(workspacesDir)) {
      mkdirSync(workspacesDir, { recursive: true });
    }

    if (!existsSync(projectsDir)) {
      mkdirSync(projectsDir, { recursive: true });
    }
  }

  getWorkspaceRoot(): string {
    return this.getConfig().wkt.workspace_root;
  }

  getProjectsRoot(): string {
    return this.getConfig().wkt.projects_root;
  }
}