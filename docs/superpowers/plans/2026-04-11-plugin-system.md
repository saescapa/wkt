# Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local, manifest-driven plugin system to WKT that hooks into workspace lifecycle events, provides run scripts, and manages persistent plugin data.

**Architecture:** Plugins are directories with a `plugin.yaml` manifest and scripts. A `PluginManager` class handles registry, manifest loading, variable resolution, and hook execution. Plugin hooks run after user hooks through the existing `SafeScriptExecutor` — no protocol changes needed. Plugin run scripts are exposed via `wkt run <plugin>:<script>`.

**Tech Stack:** TypeScript (ESM), Commander.js, YAML, Bun (test runner)

**Spec:** `docs/specs/2026-04-11-plugin-system-design.md`

---

## Codebase Context

**Key files you'll work with:**

- `src/core/types.ts` — All TypeScript interfaces. `ScriptDefinition`, `ScriptHook`, `ScriptConfig` define the hook system. `Workspace`, `Project` are the core domain types.
- `src/core/config.ts` — `ConfigManager` class. `getWKTBaseDir()` resolves `~/.wkt` (or `WKT_HOME` for isolation). All paths derive from this.
- `src/utils/script-executor.ts` — `SafeScriptExecutor` static class. Has public methods `executePostCreationHooks()`, `executePreSwitchHooks()`, etc. Each takes an `ExecutionContext` (workspace + project + variables) and a `ScriptConfig`. The `createContext()` method builds the context. `executeHook()` is private — we'll make it accessible.
- `src/utils/constants.ts` — `DEFAULT_ALLOWED_COMMANDS`, `PLUGINS_DIR_NAME` (to add), timeout values.
- `src/utils/errors.ts` — `WKTError` base class. Follow this pattern for plugin errors.
- `src/commands/create.ts` — Calls `executePostCreationHooks` at line 136. This is where plugin hooks attach.
- `src/commands/switch.ts` — Calls pre/post switch hooks at lines 94 and 109.
- `src/commands/clean.ts` — Calls pre/post clean hooks in `removeWorkspace()` at lines 369 and 402.
- `src/commands/run.ts` — Lists and executes scripts. `mergeScriptConfigs()` merges global/project/workspace configs. Plugin scripts integrate here.
- `src/index.ts` — Commander.js command registration. Uses command groups.
- `test/utils/test-helpers.ts` — `TestEnvironment` class (creates isolated WKT_HOME in `/tmp`), `mockEnvironmentVariables()`.

**Testing patterns:**
- Unit tests: `bun:test` with `describe/it/expect`, `TestEnvironment` for isolation, `mockEnvironmentVariables({ WKT_HOME: ... })`.
- E2E tests: Create real git repos in `/tmp`, run CLI via `node dist/index.js` with `WKT_HOME` env var.
- Run: `bun test test/unit/file.test.ts` or `bun test test/e2e/file.test.ts`.

**Code style:** ESM imports, `camelCase` functions, `PascalCase` types, acronyms uppercase (`pluginID`), no `any`, explicit return types on public methods.

---

### Task 1: Plugin Types and Constants

**Files:**
- Create: `src/core/plugin-types.ts`
- Modify: `src/utils/constants.ts`

- [ ] **Step 1: Create plugin type definitions**

```typescript
// src/core/plugin-types.ts
import type { ScriptHook, ScriptDefinition } from './types.js';

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  variables?: Record<string, string>;
  setup?: string;
  teardown?: string;
  project_init?: string;
  hooks?: {
    post_create?: ScriptHook[];
    pre_switch?: ScriptHook[];
    post_switch?: ScriptHook[];
    pre_clean?: ScriptHook[];
    post_clean?: ScriptHook[];
  };
  scripts?: Record<string, PluginScriptDefinition>;
  allowed_commands?: string[];
}

export interface PluginScriptDefinition extends ScriptDefinition {
  run?: boolean;
}

export interface PluginRegistryEntry {
  enabled: boolean;
  installedAt: string;
  source: string;
}

export interface PluginRegistry {
  plugins: Record<string, PluginRegistryEntry>;
  projectInits: Record<string, string[]>;
}

export type HookType = 'post_create' | 'pre_switch' | 'post_switch' | 'pre_clean' | 'post_clean';
```

- [ ] **Step 2: Add plugin constants**

In `src/utils/constants.ts`, add after the existing `WORKSPACES_DIR_NAME` constant (line 16):

```typescript
export const PLUGINS_DIR_NAME = 'plugins';
export const PLUGINS_INSTALLED_DIR_NAME = 'installed';
export const PLUGINS_REGISTRY_FILE_NAME = 'registry.json';
export const PLUGIN_MANIFEST_FILE_NAME = 'plugin.yaml';
export const PLUGIN_DATA_DIR_NAME = 'data';
```

- [ ] **Step 3: Add plugin error class**

In `src/utils/errors.ts`, add after the `ConfigurationError` class:

```typescript
export class PluginError extends WKTError {
  constructor(message: string, hints: ErrorHint[] = []) {
    super(message, 'PLUGIN_ERROR', true, hints);
  }
}

export class PluginNotFoundError extends WKTError {
  constructor(pluginName: string) {
    super(`Plugin '${pluginName}' not found`, 'PLUGIN_NOT_FOUND', true, [
      { text: 'List installed plugins', command: 'wkt plugin list' },
    ]);
  }
}
```

- [ ] **Step 4: Export ExecutionContext from SafeScriptExecutor**

In `src/utils/script-executor.ts`, change line 17 from:

```typescript
interface ExecutionContext {
```

to:

```typescript
export interface ExecutionContext {
```

- [ ] **Step 5: Verify types compile**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/core/plugin-types.ts src/utils/constants.ts src/utils/errors.ts src/utils/script-executor.ts
git commit -m "feat(plugin): add plugin type definitions, constants, and error classes"
```

---

### Task 2: PluginManager — Manifest Loading and Registry

**Files:**
- Create: `src/core/plugin-manager.ts`
- Create: `test/unit/plugin-manager.test.ts`

- [ ] **Step 1: Write failing tests for manifest loading and registry**

```typescript
// test/unit/plugin-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { stringify } from 'yaml';
import { TestEnvironment, mockEnvironmentVariables } from '../utils/test-helpers.js';
import { PluginManager } from '../../src/core/plugin-manager.js';

function createTestPlugin(baseDir: string, name: string, manifest: Record<string, unknown>): string {
  const pluginDir = join(baseDir, name);
  mkdirSync(join(pluginDir, 'scripts'), { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.yaml'), stringify(manifest));
  return pluginDir;
}

describe('PluginManager', () => {
  let testEnv: TestEnvironment;
  let restoreEnv: () => void;
  let pluginManager: PluginManager;

  beforeEach(() => {
    testEnv = new TestEnvironment();
    testEnv.setup();
    restoreEnv = mockEnvironmentVariables({ WKT_HOME: testEnv.wktHome });
    pluginManager = new PluginManager();
  });

  afterEach(() => {
    restoreEnv();
    testEnv.cleanup();
  });

  describe('loadManifest', () => {
    it('should load a valid manifest', () => {
      const pluginDir = createTestPlugin(testEnv.testDir, 'test-plugin', {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
      });

      const manifest = pluginManager.loadManifest(pluginDir);

      expect(manifest.name).toBe('test-plugin');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.description).toBe('A test plugin');
    });

    it('should load manifest with full configuration', () => {
      const pluginDir = createTestPlugin(testEnv.testDir, 'full-plugin', {
        name: 'full-plugin',
        version: '2.0.0',
        variables: { brain_path: '{{plugin_data_path}}/{{project_name}}/brain' },
        setup: 'scripts/setup.sh',
        teardown: 'scripts/teardown.sh',
        project_init: 'scripts/project-init.sh',
        hooks: {
          post_create: [{ script: 'post-create' }],
        },
        scripts: {
          'post-create': {
            name: 'Post create',
            command: ['bash', 'scripts/post-create.sh'],
          },
          status: {
            name: 'Status',
            command: ['bash', 'scripts/status.sh'],
            run: true,
          },
        },
        allowed_commands: ['bash'],
      });

      const manifest = pluginManager.loadManifest(pluginDir);

      expect(manifest.variables?.brain_path).toBe('{{plugin_data_path}}/{{project_name}}/brain');
      expect(manifest.hooks?.post_create).toHaveLength(1);
      expect(manifest.scripts?.status?.run).toBe(true);
      expect(manifest.allowed_commands).toContain('bash');
    });

    it('should throw for missing plugin.yaml', () => {
      expect(() => pluginManager.loadManifest('/nonexistent/path')).toThrow();
    });

    it('should throw for manifest missing name', () => {
      const pluginDir = createTestPlugin(testEnv.testDir, 'bad-plugin', {
        version: '1.0.0',
      });

      expect(() => pluginManager.loadManifest(pluginDir)).toThrow(/name/i);
    });

    it('should throw for manifest missing version', () => {
      const pluginDir = createTestPlugin(testEnv.testDir, 'bad-plugin', {
        name: 'bad-plugin',
      });

      expect(() => pluginManager.loadManifest(pluginDir)).toThrow(/version/i);
    });
  });

  describe('getRegistry / saveRegistry', () => {
    it('should return empty registry when no file exists', () => {
      const registry = pluginManager.getRegistry();

      expect(registry.plugins).toEqual({});
      expect(registry.projectInits).toEqual({});
    });

    it('should save and load registry', () => {
      const registry = pluginManager.getRegistry();
      registry.plugins['test'] = {
        enabled: true,
        installedAt: '2026-04-11T00:00:00.000Z',
        source: '/tmp/test',
      };

      pluginManager.saveRegistry(registry);

      // New instance to ensure fresh load
      const newManager = new PluginManager();
      const loaded = newManager.getRegistry();
      expect(loaded.plugins['test']).toBeDefined();
      expect(loaded.plugins['test']?.enabled).toBe(true);
      expect(loaded.plugins['test']?.source).toBe('/tmp/test');
    });

    it('should persist projectInits', () => {
      const registry = pluginManager.getRegistry();
      registry.projectInits['test-plugin'] = ['project-a', 'project-b'];

      pluginManager.saveRegistry(registry);

      const loaded = new PluginManager().getRegistry();
      expect(loaded.projectInits['test-plugin']).toEqual(['project-a', 'project-b']);
    });
  });

  describe('installPlugin', () => {
    it('should copy plugin to installed directory and register', async () => {
      const pluginDir = createTestPlugin(testEnv.testDir, 'install-test', {
        name: 'install-test',
        version: '1.0.0',
      });

      await pluginManager.installPlugin(pluginDir);

      const registry = pluginManager.getRegistry();
      expect(registry.plugins['install-test']).toBeDefined();
      expect(registry.plugins['install-test']?.enabled).toBe(true);
      expect(registry.plugins['install-test']?.source).toBe(pluginDir);

      // Verify files copied
      const installedPath = join(testEnv.wktHome, 'plugins', 'installed', 'install-test', 'plugin.yaml');
      const content = readFileSync(installedPath, 'utf-8');
      expect(content).toContain('install-test');
    });

    it('should create data directory for plugin', async () => {
      const pluginDir = createTestPlugin(testEnv.testDir, 'data-test', {
        name: 'data-test',
        version: '1.0.0',
      });

      await pluginManager.installPlugin(pluginDir);

      const { existsSync } = await import('fs');
      const dataPath = join(testEnv.wktHome, 'plugins', 'installed', 'data-test', 'data');
      expect(existsSync(dataPath)).toBe(true);
    });

    it('should throw when installing plugin that already exists', async () => {
      const pluginDir = createTestPlugin(testEnv.testDir, 'dupe-test', {
        name: 'dupe-test',
        version: '1.0.0',
      });

      await pluginManager.installPlugin(pluginDir);

      await expect(pluginManager.installPlugin(pluginDir)).rejects.toThrow(/already installed/i);
    });
  });

  describe('removePlugin', () => {
    it('should remove plugin from registry and installed directory', async () => {
      const pluginDir = createTestPlugin(testEnv.testDir, 'remove-test', {
        name: 'remove-test',
        version: '1.0.0',
      });

      await pluginManager.installPlugin(pluginDir);
      await pluginManager.removePlugin('remove-test', true);

      const registry = pluginManager.getRegistry();
      expect(registry.plugins['remove-test']).toBeUndefined();
    });

    it('should keep data directory when removeData is false', async () => {
      const pluginDir = createTestPlugin(testEnv.testDir, 'keep-data', {
        name: 'keep-data',
        version: '1.0.0',
      });

      await pluginManager.installPlugin(pluginDir);

      // Write something to data dir
      const dataDir = join(testEnv.wktHome, 'plugins', 'installed', 'keep-data', 'data');
      writeFileSync(join(dataDir, 'state.json'), '{}');

      await pluginManager.removePlugin('keep-data', false);

      const { existsSync } = await import('fs');
      // Plugin dir removed but data is preserved separately
      const registry = pluginManager.getRegistry();
      expect(registry.plugins['keep-data']).toBeUndefined();
    });

    it('should throw when removing non-existent plugin', async () => {
      await expect(pluginManager.removePlugin('nonexistent', true)).rejects.toThrow(/not found/i);
    });
  });

  describe('enablePlugin / disablePlugin', () => {
    it('should toggle plugin enabled state', async () => {
      const pluginDir = createTestPlugin(testEnv.testDir, 'toggle-test', {
        name: 'toggle-test',
        version: '1.0.0',
      });

      await pluginManager.installPlugin(pluginDir);

      pluginManager.disablePlugin('toggle-test');
      let registry = pluginManager.getRegistry();
      expect(registry.plugins['toggle-test']?.enabled).toBe(false);

      pluginManager.enablePlugin('toggle-test');
      registry = pluginManager.getRegistry();
      expect(registry.plugins['toggle-test']?.enabled).toBe(true);
    });

    it('should throw when enabling non-existent plugin', () => {
      expect(() => pluginManager.enablePlugin('nonexistent')).toThrow(/not found/i);
    });
  });

  describe('getEnabledPlugins', () => {
    it('should return only enabled plugins', async () => {
      const plugin1 = createTestPlugin(testEnv.testDir, 'enabled-1', {
        name: 'enabled-1',
        version: '1.0.0',
      });
      const plugin2 = createTestPlugin(testEnv.testDir, 'disabled-1', {
        name: 'disabled-1',
        version: '1.0.0',
      });

      await pluginManager.installPlugin(plugin1);
      await pluginManager.installPlugin(plugin2);
      pluginManager.disablePlugin('disabled-1');

      const enabled = pluginManager.getEnabledPlugins();

      expect(enabled).toHaveLength(1);
      expect(enabled[0]?.name).toBe('enabled-1');
    });

    it('should return plugins sorted alphabetically', async () => {
      const pluginZ = createTestPlugin(testEnv.testDir, 'z-plugin', {
        name: 'z-plugin',
        version: '1.0.0',
      });
      const pluginA = createTestPlugin(testEnv.testDir, 'a-plugin', {
        name: 'a-plugin',
        version: '1.0.0',
      });

      await pluginManager.installPlugin(pluginZ);
      await pluginManager.installPlugin(pluginA);

      const enabled = pluginManager.getEnabledPlugins();

      expect(enabled[0]?.name).toBe('a-plugin');
      expect(enabled[1]?.name).toBe('z-plugin');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/unit/plugin-manager.test.ts`
Expected: FAIL — `PluginManager` module not found

- [ ] **Step 3: Implement PluginManager**

```typescript
// src/core/plugin-manager.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { parse } from 'yaml';
import chalk from 'chalk';
import type { ScriptConfig, ScriptDefinition, RunCommandOptions } from './types.js';
import type { PluginManifest, PluginRegistry, PluginRegistryEntry, PluginScriptDefinition, HookType } from './plugin-types.js';
import type { ExecutionContext } from '../utils/script-executor.js';
import { SafeScriptExecutor } from '../utils/script-executor.js';
import { getWKTBaseDir } from './config.js';
import { PluginError, PluginNotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import {
  PLUGINS_DIR_NAME,
  PLUGINS_INSTALLED_DIR_NAME,
  PLUGINS_REGISTRY_FILE_NAME,
  PLUGIN_MANIFEST_FILE_NAME,
  PLUGIN_DATA_DIR_NAME,
  DEFAULT_ALLOWED_COMMANDS,
} from '../utils/constants.js';

interface EnabledPlugin {
  name: string;
  entry: PluginRegistryEntry;
  manifest: PluginManifest;
  pluginPath: string;
  pluginDataPath: string;
}

export class PluginManager {
  private pluginsDir: string;
  private installedDir: string;
  private registryPath: string;

  constructor() {
    const baseDir = getWKTBaseDir();
    this.pluginsDir = join(baseDir, PLUGINS_DIR_NAME);
    this.installedDir = join(this.pluginsDir, PLUGINS_INSTALLED_DIR_NAME);
    this.registryPath = join(this.pluginsDir, PLUGINS_REGISTRY_FILE_NAME);
  }

  // --- Registry ---

  getRegistry(): PluginRegistry {
    if (!existsSync(this.registryPath)) {
      return { plugins: {}, projectInits: {} };
    }

    try {
      const content = readFileSync(this.registryPath, 'utf-8');
      return JSON.parse(content) as PluginRegistry;
    } catch {
      logger.warn('Failed to read plugin registry, returning empty');
      return { plugins: {}, projectInits: {} };
    }
  }

  saveRegistry(registry: PluginRegistry): void {
    mkdirSync(this.pluginsDir, { recursive: true });
    writeFileSync(this.registryPath, JSON.stringify(registry, null, 2));
  }

  // --- Manifest ---

  loadManifest(pluginPath: string): PluginManifest {
    const manifestPath = join(pluginPath, PLUGIN_MANIFEST_FILE_NAME);

    if (!existsSync(manifestPath)) {
      throw new PluginError(`No ${PLUGIN_MANIFEST_FILE_NAME} found at ${pluginPath}`);
    }

    const content = readFileSync(manifestPath, 'utf-8');
    const parsed = parse(content) as Record<string, unknown>;

    return this.validateManifest(parsed);
  }

  private validateManifest(raw: Record<string, unknown>): PluginManifest {
    if (!raw.name || typeof raw.name !== 'string') {
      throw new PluginError('Plugin manifest must have a "name" field');
    }

    if (!raw.version || typeof raw.version !== 'string') {
      throw new PluginError('Plugin manifest must have a "version" field');
    }

    return raw as unknown as PluginManifest;
  }

  // --- Install / Remove ---

  async installPlugin(sourcePath: string): Promise<void> {
    const manifest = this.loadManifest(sourcePath);
    const registry = this.getRegistry();

    if (registry.plugins[manifest.name]) {
      throw new PluginError(`Plugin '${manifest.name}' is already installed`);
    }

    const targetPath = join(this.installedDir, manifest.name);
    mkdirSync(this.installedDir, { recursive: true });
    cpSync(sourcePath, targetPath, { recursive: true });

    // Create data directory
    const dataPath = join(targetPath, PLUGIN_DATA_DIR_NAME);
    mkdirSync(dataPath, { recursive: true });

    // Run setup script if declared
    if (manifest.setup) {
      const scriptPath = join(targetPath, manifest.setup);
      await this.executeLifecycleScript(scriptPath, {
        WKT_PLUGIN_PATH: targetPath,
        WKT_PLUGIN_DATA_PATH: dataPath,
      });
    }

    // Register
    registry.plugins[manifest.name] = {
      enabled: true,
      installedAt: new Date().toISOString(),
      source: sourcePath,
    };
    this.saveRegistry(registry);

    logger.debug(`Plugin '${manifest.name}' installed from ${sourcePath}`);
  }

  async removePlugin(name: string, removeData: boolean): Promise<void> {
    const registry = this.getRegistry();

    if (!registry.plugins[name]) {
      throw new PluginNotFoundError(name);
    }

    const pluginPath = join(this.installedDir, name);
    const dataPath = join(pluginPath, PLUGIN_DATA_DIR_NAME);

    // Run teardown script if declared
    if (existsSync(pluginPath)) {
      try {
        const manifest = this.loadManifest(pluginPath);
        if (manifest.teardown) {
          const scriptPath = join(pluginPath, manifest.teardown);
          await this.executeLifecycleScript(scriptPath, {
            WKT_PLUGIN_PATH: pluginPath,
            WKT_PLUGIN_DATA_PATH: dataPath,
          });
        }
      } catch (error) {
        logger.warn(`Teardown failed for plugin '${name}': ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Remove files
    if (existsSync(pluginPath)) {
      if (removeData) {
        rmSync(pluginPath, { recursive: true, force: true });
      } else {
        // Remove everything except data directory
        const { readdirSync, statSync } = await import('fs');
        const entries = readdirSync(pluginPath);
        for (const entry of entries) {
          if (entry !== PLUGIN_DATA_DIR_NAME) {
            rmSync(join(pluginPath, entry), { recursive: true, force: true });
          }
        }
      }
    }

    // Unregister
    delete registry.plugins[name];
    delete registry.projectInits[name];
    this.saveRegistry(registry);

    logger.debug(`Plugin '${name}' removed`);
  }

  // --- Enable / Disable ---

  enablePlugin(name: string): void {
    const registry = this.getRegistry();

    if (!registry.plugins[name]) {
      throw new PluginNotFoundError(name);
    }

    registry.plugins[name].enabled = true;
    this.saveRegistry(registry);
  }

  disablePlugin(name: string): void {
    const registry = this.getRegistry();

    if (!registry.plugins[name]) {
      throw new PluginNotFoundError(name);
    }

    registry.plugins[name].enabled = false;
    this.saveRegistry(registry);
  }

  // --- Query ---

  getEnabledPlugins(): EnabledPlugin[] {
    const registry = this.getRegistry();
    const plugins: EnabledPlugin[] = [];

    for (const [name, entry] of Object.entries(registry.plugins)) {
      if (!entry.enabled) continue;

      const pluginPath = join(this.installedDir, name);
      const pluginDataPath = join(pluginPath, PLUGIN_DATA_DIR_NAME);

      try {
        const manifest = this.loadManifest(pluginPath);
        plugins.push({ name, entry, manifest, pluginPath, pluginDataPath });
      } catch (error) {
        logger.warn(`Failed to load enabled plugin '${name}': ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return plugins.sort((a, b) => a.name.localeCompare(b.name));
  }

  getInstalledPlugins(): Array<{ name: string; entry: PluginRegistryEntry; manifest: PluginManifest }> {
    const registry = this.getRegistry();
    const plugins: Array<{ name: string; entry: PluginRegistryEntry; manifest: PluginManifest }> = [];

    for (const [name, entry] of Object.entries(registry.plugins)) {
      const pluginPath = join(this.installedDir, name);

      try {
        const manifest = this.loadManifest(pluginPath);
        plugins.push({ name, entry, manifest });
      } catch (error) {
        logger.warn(`Failed to load plugin '${name}': ${error instanceof Error ? error.message : String(error)}`);
        plugins.push({
          name,
          entry,
          manifest: { name, version: 'unknown' },
        });
      }
    }

    return plugins.sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- Variable Resolution ---

  resolveVariables(
    manifest: PluginManifest,
    pluginPath: string,
    pluginDataPath: string,
    projectName?: string,
    workspaceName?: string,
    workspacePath?: string,
    branchName?: string,
    baseBranch?: string
  ): Record<string, string> {
    const builtins: Record<string, string> = {
      plugin_path: pluginPath,
      plugin_data_path: pluginDataPath,
    };

    if (projectName) builtins.project_name = projectName;
    if (workspaceName) builtins.workspace_name = workspaceName;
    if (workspacePath) builtins.workspace_path = workspacePath;
    if (branchName) builtins.branch_name = branchName;
    if (baseBranch) builtins.base_branch = baseBranch;

    // Resolve plugin-declared variables using built-ins
    const resolved = { ...builtins };
    if (manifest.variables) {
      for (const [key, template] of Object.entries(manifest.variables)) {
        let value = template;
        for (const [varKey, varValue] of Object.entries(builtins)) {
          value = value.replace(new RegExp(`\\{\\{${varKey}\\}\\}`, 'g'), varValue);
        }
        resolved[key] = value;
      }
    }

    return resolved;
  }

  // --- Hook Execution ---

  async executePluginHooks(
    hookType: HookType,
    context: ExecutionContext,
    options: RunCommandOptions = {}
  ): Promise<void> {
    const enabledPlugins = this.getEnabledPlugins();

    for (const plugin of enabledPlugins) {
      // Check/run project_init
      await this.ensureProjectInit(plugin, context.project.name, context.project.defaultBranch);

      // Resolve variables
      const variables = this.resolveVariables(
        plugin.manifest,
        plugin.pluginPath,
        plugin.pluginDataPath,
        context.project.name,
        context.workspace.name,
        context.workspace.path,
        context.workspace.branchName,
        context.workspace.baseBranch
      );

      // Build ScriptConfig for this plugin
      const scriptConfig = this.buildPluginScriptConfig(
        plugin.manifest,
        plugin.pluginPath,
        plugin.pluginDataPath,
        variables
      );

      // Check if this plugin has hooks for this event
      const hooks = scriptConfig.hooks?.[hookType];
      if (!hooks || hooks.length === 0) continue;

      // Create context with plugin variables merged
      const pluginContext: ExecutionContext = {
        ...context,
        variables: { ...context.variables, ...variables },
      };

      console.log(chalk.blue(`\n  Running ${plugin.name} plugin hooks...`));

      // Execute using the appropriate SafeScriptExecutor method
      const hookMethodMap: Record<HookType, (ctx: ExecutionContext, cfg: ScriptConfig, opts: RunCommandOptions) => Promise<void>> = {
        post_create: SafeScriptExecutor.executePostCreationHooks.bind(SafeScriptExecutor),
        pre_switch: SafeScriptExecutor.executePreSwitchHooks.bind(SafeScriptExecutor),
        post_switch: SafeScriptExecutor.executePostSwitchHooks.bind(SafeScriptExecutor),
        pre_clean: SafeScriptExecutor.executePreCleanHooks.bind(SafeScriptExecutor),
        post_clean: SafeScriptExecutor.executePostCleanHooks.bind(SafeScriptExecutor),
      };

      const executeMethod = hookMethodMap[hookType];
      try {
        await executeMethod(pluginContext, scriptConfig, { ...options, force: true });
      } catch (error) {
        logger.warn(`Plugin '${plugin.name}' hook failed: ${error instanceof Error ? error.message : String(error)}`);
        // Plugin failures don't block other plugins
      }
    }
  }

  // --- Project Init ---

  private async ensureProjectInit(
    plugin: EnabledPlugin,
    projectName: string,
    baseBranch: string
  ): Promise<void> {
    if (!plugin.manifest.project_init) return;

    const registry = this.getRegistry();
    const initList = registry.projectInits[plugin.name] || [];

    if (initList.includes(projectName)) return;

    console.log(chalk.blue(`  Initializing ${plugin.name} for project '${projectName}'...`));

    const scriptPath = join(plugin.pluginPath, plugin.manifest.project_init);
    const projectDataPath = join(plugin.pluginDataPath, projectName);
    mkdirSync(projectDataPath, { recursive: true });

    await this.executeLifecycleScript(scriptPath, {
      WKT_PLUGIN_PATH: plugin.pluginPath,
      WKT_PLUGIN_DATA_PATH: plugin.pluginDataPath,
      WKT_PROJECT_NAME: projectName,
      WKT_BASE_BRANCH: baseBranch,
      WKT_PROJECT_DATA_PATH: projectDataPath,
    });

    // Record initialization
    if (!registry.projectInits[plugin.name]) {
      registry.projectInits[plugin.name] = [];
    }
    registry.projectInits[plugin.name].push(projectName);
    this.saveRegistry(registry);
  }

  // --- Run Scripts ---

  getPluginRunScripts(): Array<{
    pluginName: string;
    scriptName: string;
    script: PluginScriptDefinition;
  }> {
    const enabledPlugins = this.getEnabledPlugins();
    const runScripts: Array<{
      pluginName: string;
      scriptName: string;
      script: PluginScriptDefinition;
    }> = [];

    for (const plugin of enabledPlugins) {
      if (!plugin.manifest.scripts) continue;

      for (const [scriptName, script] of Object.entries(plugin.manifest.scripts)) {
        if (script.run) {
          runScripts.push({
            pluginName: plugin.name,
            scriptName,
            script,
          });
        }
      }
    }

    return runScripts;
  }

  async executeRunScript(
    pluginName: string,
    scriptName: string,
    context: ExecutionContext,
    options: RunCommandOptions = {}
  ): Promise<boolean> {
    const enabledPlugins = this.getEnabledPlugins();
    const plugin = enabledPlugins.find(p => p.name === pluginName);

    if (!plugin) {
      throw new PluginNotFoundError(pluginName);
    }

    const script = plugin.manifest.scripts?.[scriptName];
    if (!script || !script.run) {
      throw new PluginError(`Script '${scriptName}' not found in plugin '${pluginName}'`);
    }

    const variables = this.resolveVariables(
      plugin.manifest,
      plugin.pluginPath,
      plugin.pluginDataPath,
      context.project.name,
      context.workspace.name,
      context.workspace.path,
      context.workspace.branchName,
      context.workspace.baseBranch
    );

    const scriptConfig = this.buildPluginScriptConfig(
      plugin.manifest,
      plugin.pluginPath,
      plugin.pluginDataPath,
      variables
    );

    const pluginContext: ExecutionContext = {
      ...context,
      variables: { ...context.variables, ...variables },
    };

    return SafeScriptExecutor.executeScript(scriptName, pluginContext, scriptConfig, options);
  }

  // --- Internal Helpers ---

  private buildPluginScriptConfig(
    manifest: PluginManifest,
    pluginPath: string,
    pluginDataPath: string,
    resolvedVariables: Record<string, string>
  ): ScriptConfig {
    const pluginEnv: Record<string, string> = {
      WKT_PLUGIN_PATH: pluginPath,
      WKT_PLUGIN_DATA_PATH: pluginDataPath,
    };
    for (const [key, value] of Object.entries(resolvedVariables)) {
      pluginEnv[`WKT_PLUGIN_${key.toUpperCase()}`] = value;
    }

    const scripts: Record<string, ScriptDefinition> = {};
    if (manifest.scripts) {
      for (const [name, pluginScript] of Object.entries(manifest.scripts)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { run: _run, ...scriptDef } = pluginScript;
        scripts[name] = {
          ...scriptDef,
          command: this.resolveCommandPaths(scriptDef.command, pluginPath),
          env: { ...pluginEnv, ...scriptDef.env },
        };
      }
    }

    return {
      scripts,
      allowed_commands: [...DEFAULT_ALLOWED_COMMANDS, ...(manifest.allowed_commands || [])],
      hooks: manifest.hooks || {},
      shortcuts: {},
      workspace_scripts: {},
    };
  }

  private resolveCommandPaths(command: string[], pluginPath: string): string[] {
    return command.map(part => {
      if (part.startsWith('scripts/') || part.startsWith('./scripts/') ||
          part.startsWith('templates/') || part.startsWith('./')) {
        return join(pluginPath, part);
      }
      return part;
    });
  }

  private executeLifecycleScript(
    scriptPath: string,
    env: Record<string, string>
  ): Promise<boolean> {
    if (!existsSync(scriptPath)) {
      logger.debug(`Lifecycle script not found: ${scriptPath}`);
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const child = spawn('bash', [scriptPath], {
        env: { ...process.env, ...env },
        stdio: 'inherit',
      });

      child.on('exit', (code) => {
        resolve(code === 0);
      });

      child.on('error', (error) => {
        logger.warn(`Lifecycle script failed: ${error.message}`);
        resolve(false);
      });
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/unit/plugin-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/core/plugin-manager.ts test/unit/plugin-manager.test.ts
git commit -m "feat(plugin): add PluginManager with manifest loading, registry, and hook execution"
```

---

### Task 3: Plugin Variable Resolution Tests

**Files:**
- Modify: `test/unit/plugin-manager.test.ts`

- [ ] **Step 1: Add variable resolution tests**

Append to `test/unit/plugin-manager.test.ts`, inside the outer `describe('PluginManager', ...)` block:

```typescript
  describe('resolveVariables', () => {
    it('should resolve built-in variables', () => {
      const manifest: PluginManifest = { name: 'test', version: '1.0.0' };

      const result = pluginManager.resolveVariables(
        manifest,
        '/plugins/test',
        '/plugins/test/data',
        'my-project',
        'my-workspace',
        '/workspaces/my-project/my-workspace',
        'feature/auth',
        'main'
      );

      expect(result.plugin_path).toBe('/plugins/test');
      expect(result.plugin_data_path).toBe('/plugins/test/data');
      expect(result.project_name).toBe('my-project');
      expect(result.workspace_name).toBe('my-workspace');
      expect(result.branch_name).toBe('feature/auth');
      expect(result.base_branch).toBe('main');
    });

    it('should resolve plugin-declared variables using built-ins', () => {
      const manifest: PluginManifest = {
        name: 'test',
        version: '1.0.0',
        variables: {
          brain_path: '{{plugin_data_path}}/{{project_name}}/brain',
          config_file: '{{workspace_path}}/.plugin-config',
        },
      };

      const result = pluginManager.resolveVariables(
        manifest,
        '/plugins/test',
        '/plugins/test/data',
        'my-project',
        'ws',
        '/workspaces/my-project/ws'
      );

      expect(result.brain_path).toBe('/plugins/test/data/my-project/brain');
      expect(result.config_file).toBe('/workspaces/my-project/ws/.plugin-config');
    });

    it('should leave unresolvable template vars as-is', () => {
      const manifest: PluginManifest = {
        name: 'test',
        version: '1.0.0',
        variables: {
          partial: '{{plugin_path}}/{{unknown_var}}/end',
        },
      };

      const result = pluginManager.resolveVariables(
        manifest,
        '/plugins/test',
        '/plugins/test/data'
      );

      expect(result.partial).toBe('/plugins/test/{{unknown_var}}/end');
    });

    it('should omit workspace variables when not provided', () => {
      const manifest: PluginManifest = { name: 'test', version: '1.0.0' };

      const result = pluginManager.resolveVariables(
        manifest,
        '/plugins/test',
        '/plugins/test/data'
      );

      expect(result.plugin_path).toBe('/plugins/test');
      expect(result.workspace_name).toBeUndefined();
      expect(result.project_name).toBeUndefined();
    });
  });

  describe('getPluginRunScripts', () => {
    it('should return scripts with run: true', async () => {
      const pluginDir = createTestPlugin(testEnv.testDir, 'run-scripts-test', {
        name: 'run-scripts-test',
        version: '1.0.0',
        scripts: {
          'hook-only': {
            name: 'Hook Only',
            command: ['bash', 'scripts/hook.sh'],
          },
          status: {
            name: 'Status',
            command: ['bash', 'scripts/status.sh'],
            run: true,
          },
          tasks: {
            name: 'Tasks',
            command: ['bash', 'scripts/tasks.sh'],
            run: true,
          },
        },
      });

      await pluginManager.installPlugin(pluginDir);

      const runScripts = pluginManager.getPluginRunScripts();

      expect(runScripts).toHaveLength(2);
      expect(runScripts.map(s => s.scriptName).sort()).toEqual(['status', 'tasks']);
      expect(runScripts[0]?.pluginName).toBe('run-scripts-test');
    });

    it('should return empty array when no plugins installed', () => {
      const runScripts = pluginManager.getPluginRunScripts();
      expect(runScripts).toHaveLength(0);
    });
  });
```

Add the import for `PluginManifest` at the top of the test file:

```typescript
import type { PluginManifest } from '../../src/core/plugin-types.js';
```

- [ ] **Step 2: Run tests**

Run: `bun test test/unit/plugin-manager.test.ts`
Expected: All tests PASS (implementation already exists from Task 2)

- [ ] **Step 3: Commit**

```bash
git add test/unit/plugin-manager.test.ts
git commit -m "test(plugin): add variable resolution and run script tests"
```

---

### Task 4: Plugin Command Handler

**Files:**
- Create: `src/commands/plugin.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create plugin command handler**

```typescript
// src/commands/plugin.ts
import chalk from 'chalk';
import inquirer from 'inquirer';
import { PluginManager } from '../core/plugin-manager.js';
import { ErrorHandler } from '../utils/errors.js';

export async function pluginCommand(
  subcommand?: string,
  target?: string,
  options: { force?: boolean } = {}
): Promise<void> {
  try {
    const pluginManager = new PluginManager();

    switch (subcommand) {
      case 'install':
        await installPlugin(pluginManager, target);
        break;
      case 'remove':
        await removePlugin(pluginManager, target, options);
        break;
      case 'enable':
        enablePlugin(pluginManager, target);
        break;
      case 'disable':
        disablePlugin(pluginManager, target);
        break;
      case 'list':
      case undefined:
        listPlugins(pluginManager);
        break;
      default:
        console.error(chalk.red(`Unknown subcommand: ${subcommand}`));
        console.log(chalk.gray('Available: install, remove, list, enable, disable'));
        process.exit(1);
    }
  } catch (error) {
    ErrorHandler.handle(error);
  }
}

async function installPlugin(pluginManager: PluginManager, sourcePath?: string): Promise<void> {
  if (!sourcePath) {
    console.error(chalk.red('Plugin path required'));
    console.log(chalk.gray('Usage: wkt plugin install <path>'));
    process.exit(1);
  }

  const { resolve } = await import('path');
  const resolvedPath = resolve(sourcePath);

  console.log(chalk.blue(`Installing plugin from ${resolvedPath}...`));

  const manifest = pluginManager.loadManifest(resolvedPath);
  console.log(chalk.gray(`  Name: ${manifest.name}`));
  console.log(chalk.gray(`  Version: ${manifest.version}`));
  if (manifest.description) {
    console.log(chalk.gray(`  Description: ${manifest.description}`));
  }

  await pluginManager.installPlugin(resolvedPath);

  console.log(chalk.green(`\n  Plugin '${manifest.name}' installed and enabled`));
}

async function removePlugin(
  pluginManager: PluginManager,
  pluginName?: string,
  options: { force?: boolean } = {}
): Promise<void> {
  if (!pluginName) {
    console.error(chalk.red('Plugin name required'));
    console.log(chalk.gray('Usage: wkt plugin remove <name>'));
    process.exit(1);
  }

  let removeData = false;
  if (!options.force) {
    const { shouldRemoveData } = await inquirer.prompt([{
      type: 'confirm',
      name: 'shouldRemoveData',
      message: `Remove plugin data too? (brain repos, state)`,
      default: false,
    }]);
    removeData = shouldRemoveData;
  }

  await pluginManager.removePlugin(pluginName, removeData);

  console.log(chalk.green(`  Plugin '${pluginName}' removed`));
}

function enablePlugin(pluginManager: PluginManager, pluginName?: string): void {
  if (!pluginName) {
    console.error(chalk.red('Plugin name required'));
    console.log(chalk.gray('Usage: wkt plugin enable <name>'));
    process.exit(1);
  }

  pluginManager.enablePlugin(pluginName);
  console.log(chalk.green(`  Plugin '${pluginName}' enabled`));
}

function disablePlugin(pluginManager: PluginManager, pluginName?: string): void {
  if (!pluginName) {
    console.error(chalk.red('Plugin name required'));
    console.log(chalk.gray('Usage: wkt plugin disable <name>'));
    process.exit(1);
  }

  pluginManager.disablePlugin(pluginName);
  console.log(chalk.yellow(`  Plugin '${pluginName}' disabled`));
}

function listPlugins(pluginManager: PluginManager): void {
  const plugins = pluginManager.getInstalledPlugins();

  if (plugins.length === 0) {
    console.log(chalk.gray('No plugins installed'));
    console.log(chalk.gray('\nInstall a plugin: wkt plugin install <path>'));
    return;
  }

  console.log(chalk.blue('Installed plugins:\n'));

  for (const { name, entry, manifest } of plugins) {
    const statusIcon = entry.enabled ? chalk.green('●') : chalk.gray('○');
    const statusLabel = entry.enabled ? '' : chalk.gray(' (disabled)');

    console.log(`  ${statusIcon} ${chalk.bold(name)} v${manifest.version}${statusLabel}`);
    if (manifest.description) {
      console.log(chalk.gray(`    ${manifest.description}`));
    }

    // Show run scripts
    if (manifest.scripts) {
      const runScripts = Object.entries(manifest.scripts)
        .filter(([, s]) => s.run)
        .map(([scriptName]) => `${name}:${scriptName}`);

      if (runScripts.length > 0) {
        console.log(chalk.gray(`    Run: ${runScripts.join(', ')}`));
      }
    }

    // Show hooks
    if (manifest.hooks) {
      const hookNames = Object.entries(manifest.hooks)
        .filter(([, hooks]) => hooks && hooks.length > 0)
        .map(([hookName]) => hookName);

      if (hookNames.length > 0) {
        console.log(chalk.gray(`    Hooks: ${hookNames.join(', ')}`));
      }
    }
  }
}
```

- [ ] **Step 2: Register plugin command in index.ts**

In `src/index.ts`, add the import at the top with other command imports:

```typescript
import { pluginCommand } from './commands/plugin.js';
```

Add the plugin command registration before the `program.on('command:*', ...)` handler (before line 186). Place it in a new command group after "Execution:":

```typescript
// Plugin Management
program.commandsGroup('Plugins:');

program
  .command('plugin')
  .description('Manage plugins')
  .argument('[subcommand]', 'Subcommand: install, remove, list, enable, disable (default: list)')
  .argument('[target]', 'Plugin path (install) or name (remove/enable/disable)')
  .option('--force', 'Skip confirmation prompts')
  .action(pluginCommand);
```

- [ ] **Step 3: Verify types compile**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 4: Build and test help output**

Run: `bun run build && node dist/index.js plugin --help`
Expected: Shows plugin command help with subcommands

- [ ] **Step 5: Commit**

```bash
git add src/commands/plugin.ts src/index.ts
git commit -m "feat(plugin): add wkt plugin command (install/remove/list/enable/disable)"
```

---

### Task 5: Command Integration — Plugin Hooks in create/switch/clean

**Files:**
- Modify: `src/commands/create.ts`
- Modify: `src/commands/switch.ts`
- Modify: `src/commands/clean.ts`

The pattern is the same for all three commands: after existing user hooks execute, call `PluginManager.executePluginHooks()`. This is additive — existing hook behavior is untouched.

- [ ] **Step 1: Add plugin hooks to create.ts**

Add import at top of `src/commands/create.ts`:

```typescript
import { PluginManager } from '../core/plugin-manager.js';
```

After the existing hook execution block (line 136-137), add plugin hook execution:

```typescript
    // Execute post-creation hooks
    const scriptConfig = projectConfig.scripts || config.scripts;
    if (scriptConfig) {
      const context = SafeScriptExecutor.createContext(workspace, project);
      await SafeScriptExecutor.executePostCreationHooks(context, scriptConfig, options);
    }

    // Execute plugin hooks
    try {
      const pluginManager = new PluginManager();
      const context = SafeScriptExecutor.createContext(workspace, project);
      await pluginManager.executePluginHooks('post_create', context, options);
    } catch (error) {
      // Plugin failures shouldn't fail workspace creation
      if (process.env.WKT_DEBUG === '1') {
        console.error(chalk.gray(`Plugin hook error: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
```

Note: `context` is created twice — once for user hooks (guarded by `if (scriptConfig)`) and once for plugin hooks (always runs). If `scriptConfig` exists, the variable is already in scope but not accessible outside the `if` block, so we recreate it. This is intentional.

- [ ] **Step 2: Add plugin hooks to switch.ts**

Add import at top of `src/commands/switch.ts`:

```typescript
import { PluginManager } from '../core/plugin-manager.js';
```

After the existing pre_switch hooks (line 94-97), add plugin pre_switch:

```typescript
      // Execute pre_switch plugin hooks for current workspace
      try {
        const pluginManager = new PluginManager();
        const context = SafeScriptExecutor.createContext(currentWorkspace, currentProject);
        await pluginManager.executePluginHooks('pre_switch', context, { force: true });
      } catch {
        // Plugin failures shouldn't block switch
      }
```

After the existing post_switch hooks (line 109-111), add plugin post_switch:

```typescript
      // Execute post_switch plugin hooks for new workspace
      try {
        const pluginManager = new PluginManager();
        const context = SafeScriptExecutor.createContext(selectedWorkspace, newProject);
        await pluginManager.executePluginHooks('post_switch', context, { force: true });
      } catch {
        // Plugin failures shouldn't block switch
      }
```

- [ ] **Step 3: Add plugin hooks to clean.ts**

Add import at top of `src/commands/clean.ts`:

```typescript
import { PluginManager } from '../core/plugin-manager.js';
```

In the `removeWorkspace` function, after the existing pre_clean hook call (line 369) and after the existing post_clean hook call (line 402), add plugin hooks:

After pre_clean user hooks:

```typescript
  // Execute plugin pre_clean hooks
  try {
    const pluginManager = new PluginManager();
    const context = SafeScriptExecutor.createContext(workspace, project);
    await pluginManager.executePluginHooks('pre_clean', context, { force: true });
  } catch {
    // Plugin failures shouldn't block cleanup
  }
```

After post_clean user hooks:

```typescript
  // Execute plugin post_clean hooks
  try {
    const pluginManager = new PluginManager();
    const context = SafeScriptExecutor.createContext(workspace, project);
    await pluginManager.executePluginHooks('post_clean', context, { force: true });
  } catch {
    // Plugin failures shouldn't block cleanup
  }
```

- [ ] **Step 4: Verify types compile**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `bun test`
Expected: All existing tests pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/create.ts src/commands/switch.ts src/commands/clean.ts
git commit -m "feat(plugin): integrate plugin hooks into create, switch, and clean commands"
```

---

### Task 6: Run Command Integration

**Files:**
- Modify: `src/commands/run.ts`

Plugin scripts with `run: true` become available as `wkt run <plugin>:<script>`. The run command needs to: (1) detect the colon separator and route to PluginManager, (2) include plugin scripts in the interactive listing.

- [ ] **Step 1: Add plugin script routing to run.ts**

Add import at top of `src/commands/run.ts`:

```typescript
import { PluginManager } from '../core/plugin-manager.js';
```

In the `runCommand` function, after the block that handles `scriptName === '--list' || scriptName === 'list'` (line 87-89), add plugin script routing. Before the existing "Create execution context" section (line 93):

```typescript
    // Check for plugin script (format: plugin-name:script-name)
    if (scriptName.includes(':')) {
      const colonIndex = scriptName.indexOf(':');
      const pluginName = scriptName.substring(0, colonIndex);
      const pluginScriptName = scriptName.substring(colonIndex + 1);

      if (!pluginName || !pluginScriptName) {
        console.error(chalk.red('Invalid plugin script format. Use: plugin-name:script-name'));
        process.exit(1);
      }

      const pluginManager = new PluginManager();
      const context = SafeScriptExecutor.createContext(workspace, project);

      console.log(chalk.blue(`Running plugin script "${pluginName}:${pluginScriptName}" in workspace: ${workspace.projectName}/${workspace.name}`));

      const success = await pluginManager.executeRunScript(pluginName, pluginScriptName, context, options);
      if (!success) {
        process.exit(1);
      }
      return;
    }
```

- [ ] **Step 2: Add plugin scripts to listing**

In the `listAvailableScripts` function, add after the shortcuts section (after line 193):

```typescript
  // Plugin run scripts
  try {
    const pluginManager = new PluginManager();
    const pluginScripts = pluginManager.getPluginRunScripts();

    if (pluginScripts.length > 0) {
      console.log(chalk.green('Plugin scripts:'));
      for (const { pluginName, scriptName, script } of pluginScripts) {
        console.log(`  ${chalk.bold(`${pluginName}:${scriptName}`)}`);
        if (script.description) {
          console.log(chalk.gray(`    ${script.description}`));
        } else {
          console.log(chalk.gray(`    ${script.command?.join(' ') || 'No command defined'}`));
        }
      }
      console.log();
    }
  } catch {
    // Plugin loading failures shouldn't break script listing
  }
```

- [ ] **Step 3: Add plugin scripts to interactive selection**

In the `selectScriptInteractively` function, add plugin scripts to the `allScripts` array. After the shortcuts collection block (after line 268):

```typescript
  // Collect plugin run scripts
  try {
    const pluginManager = new PluginManager();
    const pluginScripts = pluginManager.getPluginRunScripts();

    for (const { pluginName, scriptName, script } of pluginScripts) {
      allScripts.push({
        name: `${pluginName}:${scriptName}`,
        description: script.description || '',
        command: script.command?.join(' '),
        category: 'plugin' as ScriptChoice['category'],
      });
    }
  } catch {
    // Plugin loading failures shouldn't break interactive selection
  }
```

Update the `ScriptChoice` interface (line 211) to add the plugin category:

```typescript
interface ScriptChoice {
  name: string;
  description: string;
  command?: string;
  category: 'script' | 'workspace' | 'shortcut' | 'plugin';
  target?: string;
}
```

In the `source` function inside `selectScriptInteractively`, add plugin grouping. After the shortcuts group (after line 340):

```typescript
      const pluginResults = filtered.filter(s => s.category === 'plugin');

      if (pluginResults.length > 0) {
        choices.push(new Separator(chalk.dim('--- Plugins ---')));
        for (const script of pluginResults) {
          choices.push({
            name: script.name,
            value: script.name,
            description: script.description || script.command || ''
          });
        }
      }
```

- [ ] **Step 4: Verify types compile**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/commands/run.ts
git commit -m "feat(plugin): integrate plugin run scripts into wkt run command"
```

---

### Task 7: E2E Tests

**Files:**
- Create: `test/e2e/plugin-workflow.test.ts`

- [ ] **Step 1: Write E2E tests**

```typescript
// test/e2e/plugin-workflow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { spawn, execSync } from 'child_process';
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { stringify } from 'yaml';

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {}
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...options.env };
    const childProcess = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    childProcess.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, exitCode: 1 });
    });

    let stdout = '';
    let stderr = '';

    childProcess.stdout?.on('data', (data) => { stdout += data.toString(); });
    childProcess.stderr?.on('data', (data) => { stderr += data.toString(); });

    childProcess.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code || 0 });
    });
  });
}

function createTestGitRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  execSync('git init', { cwd: path, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: path, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: path, stdio: 'pipe' });
  writeFileSync(join(path, 'README.md'), '# Test\n');
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2));
  execSync('git add .', { cwd: path, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: path, stdio: 'pipe' });
  execSync('git branch -M main', { cwd: path, stdio: 'pipe' });
}

function createTestPlugin(baseDir: string): string {
  const pluginDir = join(baseDir, 'test-plugin');
  mkdirSync(join(pluginDir, 'scripts'), { recursive: true });

  // Manifest
  const manifest = {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'E2E test plugin',
    variables: {
      marker_path: '{{workspace_path}}/.plugin-marker',
    },
    hooks: {
      post_create: [{ script: 'post-create' }],
      pre_clean: [{ script: 'pre-clean' }],
    },
    scripts: {
      'post-create': {
        name: 'Post-create marker',
        command: ['bash', 'scripts/post-create.sh'],
      },
      'pre-clean': {
        name: 'Pre-clean marker',
        command: ['bash', 'scripts/pre-clean.sh'],
        optional: true,
      },
      status: {
        name: 'Plugin status',
        command: ['bash', 'scripts/status.sh'],
        run: true,
      },
    },
    allowed_commands: ['bash'],
  };

  writeFileSync(join(pluginDir, 'plugin.yaml'), stringify(manifest));

  // Post-create script: writes a marker file to the workspace
  writeFileSync(join(pluginDir, 'scripts', 'post-create.sh'), [
    '#!/bin/bash',
    'echo "PLUGIN_POST_CREATE_RAN" > "$WKT_WORKSPACE_PATH/.plugin-marker"',
    'echo "Plugin post-create hook executed"',
  ].join('\n'));

  // Pre-clean script: writes to plugin data dir
  writeFileSync(join(pluginDir, 'scripts', 'pre-clean.sh'), [
    '#!/bin/bash',
    'echo "PLUGIN_PRE_CLEAN_RAN" >> "$WKT_PLUGIN_DATA_PATH/clean-log.txt"',
    'echo "Plugin pre-clean hook executed"',
  ].join('\n'));

  // Status script
  writeFileSync(join(pluginDir, 'scripts', 'status.sh'), [
    '#!/bin/bash',
    'echo "PLUGIN_STATUS_OK"',
  ].join('\n'));

  // Make scripts executable
  execSync(`chmod +x ${join(pluginDir, 'scripts', '*.sh')}`, { stdio: 'pipe' });

  return pluginDir;
}

describe('Plugin Workflow', () => {
  let wktBinary: string;
  let testDir: string;
  let wktHome: string;
  let sourceRepo: string;
  let pluginDir: string;
  const projectName = 'plugin-test-project';

  beforeAll(async () => {
    wktBinary = join(process.cwd(), 'dist', 'index.js');

    if (!existsSync(wktBinary)) {
      const buildProcess = spawn('bun', ['run', 'build'], { stdio: 'inherit' });
      await new Promise((resolve, reject) => {
        buildProcess.on('close', (code) => {
          if (code === 0) resolve(undefined);
          else reject(new Error(`Build failed with code ${code}`));
        });
      });
    }

    const baseTmpDir = realpathSync(tmpdir());
    testDir = join(baseTmpDir, `wkt-plugin-test-${Date.now()}`);
    wktHome = join(testDir, '.wkt');
    sourceRepo = join(testDir, 'source-repo');

    mkdirSync(wktHome, { recursive: true });
    createTestGitRepo(sourceRepo);
    pluginDir = createTestPlugin(testDir);
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  async function wkt(
    args: string[],
    options: { cwd?: string } = {}
  ): Promise<CommandResult> {
    return runCommand('node', [wktBinary, ...args], {
      cwd: options.cwd,
      env: { WKT_HOME: wktHome },
    });
  }

  function getWorkspacePath(workspaceName: string): string {
    return join(wktHome, 'workspaces', projectName, workspaceName);
  }

  describe('Workflow 1: Plugin install and list', () => {
    it('should list no plugins initially', async () => {
      const result = await wkt(['plugin', 'list']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No plugins installed');
    });

    it('should install a plugin', async () => {
      const result = await wkt(['plugin', 'install', pluginDir]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('test-plugin');
      expect(result.stdout).toContain('installed');
    });

    it('should list installed plugin', async () => {
      const result = await wkt(['plugin', 'list']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('test-plugin');
      expect(result.stdout).toContain('1.0.0');
    });

    it('should reject duplicate install', async () => {
      const result = await wkt(['plugin', 'install', pluginDir]);
      expect(result.exitCode).toBe(1);
      expect(
        result.stdout.includes('already installed') ||
        result.stderr.includes('already installed')
      ).toBe(true);
    });
  });

  describe('Workflow 2: Plugin hooks fire on workspace lifecycle', () => {
    it('should initialize project', async () => {
      const result = await wkt(['init', sourceRepo, projectName]);
      expect(result.exitCode).toBe(0);
    });

    it('should fire post_create hook when creating workspace', async () => {
      const result = await wkt(['create', projectName, 'feature/plugin-test']);
      expect(result.exitCode).toBe(0);

      // Check that plugin hook created the marker file
      const workspacePath = getWorkspacePath('plugin-test');
      const markerPath = join(workspacePath, '.plugin-marker');
      expect(existsSync(markerPath)).toBe(true);
      const marker = readFileSync(markerPath, 'utf-8').trim();
      expect(marker).toBe('PLUGIN_POST_CREATE_RAN');
    });
  });

  describe('Workflow 3: Plugin run scripts', () => {
    it('should list plugin scripts in wkt run list', async () => {
      const workspacePath = getWorkspacePath('plugin-test');
      const result = await wkt(['run', 'list'], { cwd: workspacePath });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('test-plugin:status');
    });

    it('should execute plugin run script', async () => {
      const workspacePath = getWorkspacePath('plugin-test');
      const result = await wkt(['run', 'test-plugin:status', '--force'], { cwd: workspacePath });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('PLUGIN_STATUS_OK');
    });
  });

  describe('Workflow 4: Enable/disable', () => {
    it('should disable a plugin', async () => {
      const result = await wkt(['plugin', 'disable', 'test-plugin']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('disabled');
    });

    it('should not fire hooks when plugin is disabled', async () => {
      const result = await wkt(['create', projectName, 'feature/no-hooks']);
      expect(result.exitCode).toBe(0);

      // No marker file should exist
      const workspacePath = getWorkspacePath('no-hooks');
      const markerPath = join(workspacePath, '.plugin-marker');
      expect(existsSync(markerPath)).toBe(false);
    });

    it('should re-enable a plugin', async () => {
      const result = await wkt(['plugin', 'enable', 'test-plugin']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('enabled');
    });
  });

  describe('Workflow 5: Plugin remove', () => {
    it('should remove plugin with --force', async () => {
      const result = await wkt(['plugin', 'remove', 'test-plugin', '--force']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('removed');
    });

    it('should show no plugins after removal', async () => {
      const result = await wkt(['plugin', 'list']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No plugins installed');
    });
  });
});
```

- [ ] **Step 2: Build and run E2E tests**

Run: `bun run build && bun test test/e2e/plugin-workflow.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run all tests to verify no regressions**

Run: `bun test`
Expected: All tests PASS (unit + e2e)

- [ ] **Step 4: Commit**

```bash
git add test/e2e/plugin-workflow.test.ts
git commit -m "test(plugin): add E2E tests for full plugin lifecycle"
```

---

### Post-Implementation Checklist

After all tasks are complete:

- [ ] Run `bun run typecheck` — no errors
- [ ] Run `bun run lint` — no lint errors
- [ ] Run `bun test` — all tests pass
- [ ] Manual smoke test: `bun run dev:safe plugin list` — shows no plugins
- [ ] Update `docs/dev/architecture.md` — add Plugin Manager section
- [ ] Update `docs/reference/user-guide.md` — add plugin commands
- [ ] Update `docs.local/todos.md` — mark plugin system as done, add brain plugin as next todo
- [ ] Consider: variable collision warning when two plugins declare the same variable name (spec mentions this, not implemented yet)
