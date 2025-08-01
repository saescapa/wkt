import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import { spawn } from 'child_process';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';

describe('Basic WKT Workflow E2E', () => {
  let testDir: string;
  let wktBinary: string;

  beforeAll(async () => {
    // Create isolated test directory
    testDir = join(tmpdir(), `wkt-e2e-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    // Build the CLI
    wktBinary = join(process.cwd(), 'dist', 'index.js');
    
    // Ensure we have a built version
    if (!existsSync(wktBinary)) {
      const buildProcess = spawn('bun', ['run', 'build'], { stdio: 'inherit' });
      await new Promise((resolve, reject) => {
        buildProcess.on('close', (code) => {
          if (code === 0) resolve(undefined);
          else reject(new Error(`Build failed with code ${code}`));
        });
      });
    }
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  async function runWktCommand(args: string[], env: Record<string, string> = {}): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve) => {
      const childProcess = spawn('node', [wktBinary, ...args], {
        env: { ...process.env, HOME: testDir, ...env },
        stdio: ['pipe', 'pipe', 'pipe']
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
          exitCode: code || 0
        });
      });
    });
  }

  it('should show help when no arguments provided', async () => {
    const result = await runWktCommand([]);
    
    // CLI shows help and exits with 1 when no args provided
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Usage: wkt');
    expect(result.stdout).toContain('Commands:');
  });

  it('should handle version flag', async () => {
    const result = await runWktCommand(['--version']);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('1.0.0');
  });

  it('should show no projects when listing initially', async () => {
    const result = await runWktCommand(['init', '--list']);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No projects initialized yet');
  });

  it('should show error for non-existent project operations', async () => {
    const result = await runWktCommand(['create', 'non-existent', 'feature/test']);
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Project \'non-existent\' not found');
  });

  it('should show error for non-existent workspace operations', async () => {
    const result = await runWktCommand(['switch', 'non-existent-workspace']);
    
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No workspaces found');
  });

  it('should show empty workspace list initially', async () => {
    const result = await runWktCommand(['list']);
    
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No workspaces found');
  });

  // Note: We can't easily test actual git operations in E2E without real repositories
  // The manual testing we did earlier covers that functionality
});

describe('WKT Command Structure', () => {
  let wktBinary: string;

  beforeAll(() => {
    wktBinary = join(process.cwd(), 'dist', 'index.js');
  });

  async function getCommandHelp(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const childProcess = spawn('node', [wktBinary, command, '--help'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      
      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Command failed with code ${code}`));
        }
      });
    });
  }

  it('should have proper help for init command', async () => {
    const help = await getCommandHelp('init');
    
    expect(help).toContain('Initialize WKT with a repository');
    expect(help).toContain('[repository-url]');
    expect(help).toContain('[project-name]');
    expect(help).toContain('--list');
  });

  it('should have proper help for create command', async () => {
    const help = await getCommandHelp('create');
    
    expect(help).toContain('Create a new workspace');
    expect(help).toContain('<project>');
    expect(help).toContain('<branch-name>');
    expect(help).toContain('--from');
    expect(help).toContain('--name');
    expect(help).toContain('--force');
  });

  it('should have proper help for switch command', async () => {
    const help = await getCommandHelp('switch');
    
    expect(help).toContain('Switch to an existing workspace');
    expect(help).toContain('[workspace]');
    expect(help).toContain('--search');
    expect(help).toContain('--project');
  });

  it('should have proper help for list command', async () => {
    const help = await getCommandHelp('list');
    
    expect(help).toContain('List all workspaces');
    expect(help).toContain('--project');
    expect(help).toContain('--details');
    expect(help).toContain('--filter');
  });
});