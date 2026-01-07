import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { spawn, execSync } from 'child_process';
import { rmSync, existsSync, mkdirSync, writeFileSync, realpathSync } from 'fs';
import { tmpdir } from 'os';

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
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
      });
    });

    let stdout = '';
    let stderr = '';

    childProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code || 0,
      });
    });
  });
}

function createTestGitRepo(path: string): void {
  mkdirSync(path, { recursive: true });

  execSync('git init', { cwd: path, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: path, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: path, stdio: 'pipe' });

  writeFileSync(join(path, 'README.md'), '# Test Repository\n');
  writeFileSync(
    join(path, 'package.json'),
    JSON.stringify({ name: 'test-project', version: '1.0.0' }, null, 2)
  );

  execSync('git add .', { cwd: path, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: path, stdio: 'pipe' });
  execSync('git branch -M main', { cwd: path, stdio: 'pipe' });
}

/*
 * Config Command E2E Tests
 * ========================
 *
 * These tests verify the config command workflows:
 *
 * Workflow 1: Show config (default)
 * - wkt config             -> shows current config in JSON format
 * - wkt config show        -> same as above
 *
 * Workflow 2: Config path
 * - wkt config path        -> outputs path to config file
 *
 * Workflow 3: Debug info
 * - wkt config debug       -> shows debug information (paths, config status, etc.)
 *
 * Workflow 4: Project-specific config
 * - wkt init <repo> <project>
 * - wkt config --project <project>  -> shows project-specific config section
 *
 * Workflow 5: Error handling
 * - wkt config invalid-subcommand   -> error message with help
 */
describe('Config Workflow', () => {
  let wktBinary: string;
  let testDir: string;
  let wktHome: string;
  let sourceRepo: string;
  const projectName = 'config-test-project';

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

    // Use realpathSync to get canonical path (resolves /var -> /private/var on macOS)
    const baseTmpDir = realpathSync(tmpdir());
    testDir = join(baseTmpDir, `wkt-config-test-${Date.now()}`);
    wktHome = join(testDir, '.wkt');
    sourceRepo = join(testDir, 'source-repo');

    mkdirSync(wktHome, { recursive: true });
    createTestGitRepo(sourceRepo);
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

  describe('Workflow 1: Show config (default)', () => {
    it('should show config with "wkt config" (no subcommand)', async () => {
      const result = await wkt(['config']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Global WKT Configuration');
      // Config is displayed as JSON
      expect(result.stdout).toContain('{');
      expect(result.stdout).toContain('}');
    });

    it('should show config with "wkt config show"', async () => {
      const result = await wkt(['config', 'show']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Global WKT Configuration');
      expect(result.stdout).toContain('{');
      expect(result.stdout).toContain('}');
    });

    it('should display wkt settings in config output', async () => {
      const result = await wkt(['config', 'show']);

      expect(result.exitCode).toBe(0);
      // The config should include wkt settings
      expect(result.stdout).toContain('wkt');
      expect(result.stdout).toContain('projects');
    });
  });

  describe('Workflow 2: Config path', () => {
    it('should output the config file path', async () => {
      const result = await wkt(['config', 'path']);

      expect(result.exitCode).toBe(0);
      // Should output the path to config.yaml
      expect(result.stdout).toContain('.wkt');
      expect(result.stdout).toContain('config.yaml');
    });

    it('should output a valid file path', async () => {
      const result = await wkt(['config', 'path']);

      expect(result.exitCode).toBe(0);
      // Path should be absolute and end with config.yaml
      const configPath = result.stdout.trim();
      expect(configPath.endsWith('config.yaml')).toBe(true);
    });
  });

  describe('Workflow 3: Debug info', () => {
    it('should show debug information', async () => {
      const result = await wkt(['config', 'debug']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('WKT Configuration Debug Info');
    });

    it('should display global configuration section', async () => {
      const result = await wkt(['config', 'debug']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Global Configuration');
      expect(result.stdout).toContain('Path:');
      expect(result.stdout).toContain('Exists:');
    });

    it('should display directory structure info', async () => {
      const result = await wkt(['config', 'debug']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Directory Structure');
      expect(result.stdout).toContain('Workspaces');
    });

    it('should display database info', async () => {
      const result = await wkt(['config', 'debug']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Database');
      expect(result.stdout).toContain('database.json');
    });

    it('should display environment info', async () => {
      const result = await wkt(['config', 'debug']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Environment');
      expect(result.stdout).toContain('HOME:');
      expect(result.stdout).toContain('CWD:');
    });
  });

  describe('Workflow 4: Project-specific config', () => {
    it('should initialize project for config testing', async () => {
      const result = await wkt(['init', sourceRepo, projectName]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Successfully initialized');
      expect(result.stdout).toContain(projectName);
    });

    it('should show project-specific config with --project flag', async () => {
      const result = await wkt(['config', 'show', '--project', projectName]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Project config for "${projectName}"`);
      // Should display project config as JSON
      expect(result.stdout).toContain('{');
      expect(result.stdout).toContain('}');
    });

    it('should show project config without "show" subcommand', async () => {
      const result = await wkt(['config', '--project', projectName]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Project config for "${projectName}"`);
    });

    it('should show project config as valid JSON object', async () => {
      const result = await wkt(['config', '--project', projectName]);

      expect(result.exitCode).toBe(0);
      // Project config from global config is initially empty (project data is in database)
      // It displays as an empty object or with any configured overrides
      expect(result.stdout).toContain('{');
      expect(result.stdout).toContain('}');
    });
  });

  describe('Workflow 5: Error handling', () => {
    it('should error on invalid subcommand', async () => {
      const result = await wkt(['config', 'invalid-subcommand']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Unknown config subcommand');
      expect(result.stderr).toContain('invalid-subcommand');
    });

    it('should show help after invalid subcommand error', async () => {
      const result = await wkt(['config', 'nonexistent']);

      expect(result.exitCode).toBe(1);
      // Should display help with available commands
      expect(result.stdout).toContain('WKT Config Commands');
      expect(result.stdout).toContain('wkt config');
    });

    it('should handle non-existent project gracefully', async () => {
      const result = await wkt(['config', '--project', 'nonexistent-project']);

      expect(result.exitCode).toBe(0);
      // Should show empty or null project config
      expect(result.stdout).toContain('Project config for');
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple flags together', async () => {
      const result = await wkt(['config', 'show', '--project', projectName]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`Project config for "${projectName}"`);
    });

    it('should handle config path with --project flag', async () => {
      const result = await wkt(['config', 'path', '--project', projectName]);

      expect(result.exitCode).toBe(0);
      // With --project, should show project config path (.wkt.yaml)
      expect(result.stdout).toContain('.wkt.yaml');
    });
  });
});
