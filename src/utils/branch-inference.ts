import type { InferencePattern } from '../core/types.js';

export class BranchInference {
  static inferBranchName(input: string, patterns: InferencePattern[]): string {
    for (const { pattern, template } of patterns) {
      const regex = new RegExp(pattern);
      const match = input.match(regex);
      
      if (match) {
        let result = template;
        
        if (match[1]) {
          result = result.replace('{}', match[1]);
        } else {
          result = result.replace('{}', input);
        }
        
        return result;
      }
    }
    
    return input;
  }

  static sanitizeWorkspaceName(branchName: string, strategy: 'sanitized' | 'kebab-case' | 'snake_case' = 'sanitized'): string {
    let result = branchName;
    
    result = result.replace(/^(feature|bugfix|hotfix)\//, '');
    
    switch (strategy) {
      case 'kebab-case':
        result = result.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        break;
      case 'snake_case':
        result = result.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        break;
      case 'sanitized':
      default:
        result = result.replace(/[^a-zA-Z0-9\-_]/g, '-').replace(/^-+|-+$/g, '');
        break;
    }
    
    return result || 'workspace';
  }

  static generateWorkspaceId(projectName: string, workspaceName: string): string {
    return `${projectName}/${workspaceName}`;
  }
}