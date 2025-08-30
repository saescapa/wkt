import { existsSync, symlinkSync, copyFileSync, readFileSync, writeFileSync, lstatSync, mkdirSync, readdirSync, statSync, unlinkSync, readlinkSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import chalk from 'chalk';
import type { Project, ProjectConfig, TemplateConfig, GlobalConfig } from '../core/types.js';
import { DatabaseManager } from '../core/database.js';

export class LocalFilesManager {
  private dbManager: DatabaseManager;

  constructor() {
    this.dbManager = new DatabaseManager();
  }

  async setupLocalFiles(project: Project, workspacePath: string, projectConfig: ProjectConfig, globalConfig: GlobalConfig, workspace?: { name: string; branchName: string }): Promise<void> {
    const mainWorktreePath = this.findMainWorktree(project);
    if (!mainWorktreePath) {
      console.log(chalk.yellow('⚠️  No main worktree found, skipping local files setup'));
      return;
    }

    const localFilesConfig = {
      shared: projectConfig.local_files?.shared || globalConfig.local_files?.shared || [],
      copied: projectConfig.local_files?.copied || globalConfig.local_files?.copied || [],
      templates: this.resolveTemplates(projectConfig, globalConfig, workspace)
    };

    if (localFilesConfig.shared.length === 0 && localFilesConfig.copied.length === 0) {
      return; // No local files configuration
    }

    console.log(chalk.blue('Setting up local files...'));

    // Handle shared files (symlinks)
    for (const filePath of localFilesConfig.shared) {
      await this.createSymlink(mainWorktreePath, workspacePath, filePath);
    }

    // Handle copied files (templates)
    for (const filePath of localFilesConfig.copied) {
      const templateConfig = localFilesConfig.templates[filePath];
      await this.copyFile(mainWorktreePath, workspacePath, filePath, templateConfig, workspace);
    }

    if (localFilesConfig.shared.length > 0) {
      console.log(chalk.gray(`  Shared files (symlinked): ${localFilesConfig.shared.join(', ')}`));
    }
    if (localFilesConfig.copied.length > 0) {
      console.log(chalk.gray(`  Copied files: ${localFilesConfig.copied.join(', ')}`));
    }
  }

  private findMainWorktree(project: Project): string | null {
    // Look for a workspace that matches the default branch
    const workspaces = this.dbManager.getProjectWorkspaces(project.name);
    
    // First, try to find a workspace with branch name matching default branch
    for (const workspace of workspaces) {
      if (workspace.branchName === project.defaultBranch || workspace.name === project.defaultBranch) {
        if (existsSync(workspace.path)) {
          return workspace.path;
        }
      }
    }

    // Second, try to find any workspace named "main" or "master"
    for (const workspace of workspaces) {
      if (workspace.name === 'main' || workspace.name === 'master') {
        if (existsSync(workspace.path)) {
          return workspace.path;
        }
      }
    }

    // Finally, find the oldest workspace (likely the first one created)
    const sortedWorkspaces = workspaces
      .filter(w => existsSync(w.path))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    
    if (sortedWorkspaces.length > 0) {
      const firstWorkspace = sortedWorkspaces[0];
      return firstWorkspace ? firstWorkspace.path : null;
    }
    return null;
  }

  private async createSymlink(mainWorktreePath: string, workspacePath: string, filePath: string): Promise<void> {
    const sourceFile = join(mainWorktreePath, filePath);
    const targetFile = join(workspacePath, filePath);

    if (!existsSync(sourceFile)) {
      console.log(chalk.yellow(`⚠️  Source file not found, skipping: ${filePath}`));
      return;
    }

    // Ensure target directory exists
    const targetDir = dirname(targetFile);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // Remove existing file/symlink
    if (existsSync(targetFile)) {
      const stats = lstatSync(targetFile);
      if (stats.isSymbolicLink()) {
        // Already a symlink, check if it points to the right place
        try {
          const linkTarget = readlinkSync(targetFile);
          const currentTarget = resolve(dirname(targetFile), linkTarget);
          if (currentTarget === resolve(sourceFile)) {
            return; // Already correctly symlinked
          }
        } catch {
          // Error reading symlink, will recreate it
        }
      }
      // Remove existing file/symlink
      try {
        unlinkSync(targetFile);
      } catch (error) {
        console.log(chalk.yellow(`Warning: Could not remove existing file ${filePath}: ${error}`));
        return;
      }
    }

    try {
      // Create relative symlink
      const relativePath = relative(dirname(targetFile), sourceFile);
      symlinkSync(relativePath, targetFile);
      console.log(chalk.green(`✓ Symlinked: ${filePath} -> main`));
    } catch (error) {
      console.log(chalk.red(`✗ Failed to symlink ${filePath}: ${error}`));
    }
  }

  private resolveTemplates(projectConfig: ProjectConfig, globalConfig: GlobalConfig, workspace?: { name: string; branchName: string }): Record<string, TemplateConfig | string> {
    // Start with global templates
    const templates = { ...globalConfig.local_files?.templates || {} };
    
    // Override with project templates
    Object.assign(templates, projectConfig.local_files?.templates || {});
    
    // Apply workspace-specific overrides
    if (workspace) {
      // Check project-level workspace templates
      const projectWorkspaceTemplates = projectConfig.local_files?.workspace_templates || {};
      const globalWorkspaceTemplates = globalConfig.local_files?.workspace_templates || {};
      
      // Apply workspace-specific templates based on branch name and workspace name
      for (const [pattern, templateOverrides] of Object.entries({...globalWorkspaceTemplates, ...projectWorkspaceTemplates})) {
        if (this.matchesWorkspacePattern(pattern, workspace.name, workspace.branchName)) {
          Object.assign(templates, templateOverrides);
        }
      }
    }
    
    return templates;
  }

  private matchesWorkspacePattern(pattern: string, workspaceName: string, branchName: string): boolean {
    // Support patterns like:
    // "staging" - exact workspace name match
    // "feature/*" - branch pattern
    // "*staging*" - workspace name contains
    
    if (pattern === workspaceName) {
      return true;
    }
    
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(workspaceName) || regex.test(branchName);
    }
    
    return false;
  }

  private async copyFile(mainWorktreePath: string, workspacePath: string, filePath: string, templateConfig?: TemplateConfig | string, workspace?: { name: string; branchName: string }): Promise<void> {
    const targetPath = join(workspacePath, filePath);

    // Skip if file/directory already exists in workspace
    if (existsSync(targetPath)) {
      return;
    }

    let sourcePath: string;
    let templateName: string = filePath;
    
    if (templateConfig) {
      if (typeof templateConfig === 'string') {
        // Simple string template path
        sourcePath = join(mainWorktreePath, templateConfig);
        templateName = templateConfig;
      } else {
        // TemplateConfig object
        if (workspace && !this.matchesTemplateConditions(templateConfig, workspace)) {
          console.log(chalk.gray(`⚠️  Template conditions not met for ${filePath}, skipping`));
          return;
        }
        sourcePath = join(mainWorktreePath, templateConfig.source);
        templateName = templateConfig.source;
      }
    } else {
      // Use the file/directory from main worktree
      sourcePath = join(mainWorktreePath, filePath);
    }

    if (!existsSync(sourcePath)) {
      console.log(chalk.yellow(`⚠️  Template source not found, skipping: ${templateName}`));
      return;
    }

    // Check if source is a directory
    const sourceStats = statSync(sourcePath);
    if (sourceStats.isDirectory()) {
      await this.copyDirectory(sourcePath, targetPath, templateConfig, workspace);
      console.log(chalk.green(`✓ Copied directory: ${filePath}${templateName !== filePath ? ` (from ${templateName})` : ''}`));
    } else {
      // Handle file copying
      await this.copyFileContent(sourcePath, targetPath, templateConfig, workspace);
      console.log(chalk.green(`✓ Copied: ${filePath}${templateName !== filePath ? ` (from ${templateName})` : ''}`));
    }
  }

  private async copyDirectory(sourcePath: string, targetPath: string, templateConfig?: TemplateConfig | string, workspace?: { name: string; branchName: string }): Promise<void> {
    try {
      // Create target directory
      mkdirSync(targetPath, { recursive: true });

      // Copy all contents recursively
      const items = readdirSync(sourcePath);
      
      for (const item of items) {
        const sourceItemPath = join(sourcePath, item);
        const targetItemPath = join(targetPath, item);
        
        const itemStats = statSync(sourceItemPath);
        
        if (itemStats.isDirectory()) {
          await this.copyDirectory(sourceItemPath, targetItemPath, templateConfig, workspace);
        } else {
          await this.copyFileContent(sourceItemPath, targetItemPath, templateConfig, workspace);
        }
      }
    } catch (error) {
      console.log(chalk.red(`✗ Failed to copy directory ${sourcePath}: ${error}`));
    }
  }

  private async copyFileContent(sourcePath: string, targetPath: string, templateConfig?: TemplateConfig | string, workspace?: { name: string; branchName: string }): Promise<void> {
    try {
      // Ensure target directory exists
      const targetDir = dirname(targetPath);
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      let content = readFileSync(sourcePath, 'utf-8');
      
      // Apply template variable substitution if configured (only for text files with template config)
      if (typeof templateConfig === 'object' && templateConfig.variables) {
        for (const [key, value] of Object.entries(templateConfig.variables)) {
          const placeholder = `{{${key}}}`;
          content = content.replace(new RegExp(placeholder, 'g'), value);
        }
        
        // Also substitute workspace info
        if (workspace) {
          content = content.replace(/{{workspace_name}}/g, workspace.name);
          content = content.replace(/{{branch_name}}/g, workspace.branchName);
        }
      }
      
      writeFileSync(targetPath, content);
    } catch (error) {
      // If it's a binary file or encoding issue, copy as-is
      try {
        copyFileSync(sourcePath, targetPath);
      } catch (copyError) {
        console.log(chalk.red(`✗ Failed to copy file ${sourcePath}: ${copyError}`));
        throw copyError;
      }
    }
  }

  private matchesTemplateConditions(config: TemplateConfig, workspace: { name: string; branchName: string }): boolean {
    if (!config.conditions) {
      return true;
    }

    const { branch_pattern, workspace_pattern, environment } = config.conditions;

    if (branch_pattern) {
      const branchRegex = new RegExp(branch_pattern);
      if (!branchRegex.test(workspace.branchName)) {
        return false;
      }
    }

    if (workspace_pattern) {
      const workspaceRegex = new RegExp(workspace_pattern);
      if (!workspaceRegex.test(workspace.name)) {
        return false;
      }
    }

    if (environment) {
      // Check if workspace name or branch contains the environment
      const envCheck = workspace.name.includes(environment) || workspace.branchName.includes(environment);
      if (!envCheck) {
        return false;
      }
    }

    return true;
  }
}