import { describe, it, expect } from 'bun:test';
import { BranchInference } from '../../src/utils/branch-inference.js';
import type { InferencePattern } from '../../src/core/types.js';

describe('BranchInference', () => {
  const defaultPatterns: InferencePattern[] = [
    { pattern: '^(\\d+)$', template: 'feature/eng-{}' },
    { pattern: '^eng-(\\d+)$', template: 'feature/{}' },
    { pattern: '^(feature/.+)$', template: '{}' },
    { pattern: '^(hotfix/.+)$', template: '{}' },
    { pattern: '^(bugfix/.+)$', template: '{}' },
  ];

  describe('inferBranchName', () => {
    it('should infer branch name from ticket number', () => {
      const result = BranchInference.inferBranchName('1234', defaultPatterns);
      expect(result).toBe('feature/eng-1234');
    });

    it('should infer branch name from eng- prefixed ticket', () => {
      const result = BranchInference.inferBranchName('eng-5678', defaultPatterns);
      expect(result).toBe('feature/5678');
    });

    it('should pass through feature branches unchanged', () => {
      const result = BranchInference.inferBranchName('feature/auth-system', defaultPatterns);
      expect(result).toBe('feature/auth-system');
    });

    it('should pass through hotfix branches unchanged', () => {
      const result = BranchInference.inferBranchName('hotfix/critical-bug', defaultPatterns);
      expect(result).toBe('hotfix/critical-bug');
    });

    it('should pass through bugfix branches unchanged', () => {
      const result = BranchInference.inferBranchName('bugfix/login-issue', defaultPatterns);
      expect(result).toBe('bugfix/login-issue');
    });

    it('should return input unchanged if no patterns match', () => {
      const result = BranchInference.inferBranchName('random-branch-name', defaultPatterns);
      expect(result).toBe('random-branch-name');
    });

    it('should handle empty patterns array', () => {
      const result = BranchInference.inferBranchName('1234', []);
      expect(result).toBe('1234');
    });

    it('should use first matching pattern', () => {
      const patterns: InferencePattern[] = [
        { pattern: '^(\\d+)$', template: 'first/{}' },
        { pattern: '^(\\d+)$', template: 'second/{}' },
      ];
      
      const result = BranchInference.inferBranchName('1234', patterns);
      expect(result).toBe('first/1234');
    });

    it('should handle custom patterns', () => {
      const customPatterns: InferencePattern[] = [
        { pattern: '^task-(\\d+)$', template: 'story/task-{}' },
        { pattern: '^bug-(\\d+)$', template: 'fix/bug-{}' },
      ];

      expect(BranchInference.inferBranchName('task-123', customPatterns)).toBe('story/task-123');
      expect(BranchInference.inferBranchName('bug-456', customPatterns)).toBe('fix/bug-456');
    });
  });

  describe('sanitizeWorkspaceName', () => {
    describe('sanitized strategy (default)', () => {
      it('should remove feature/ prefix', () => {
        const result = BranchInference.sanitizeWorkspaceName('feature/auth-system');
        expect(result).toBe('auth-system');
      });

      it('should remove bugfix/ prefix', () => {
        const result = BranchInference.sanitizeWorkspaceName('bugfix/login-issue');
        expect(result).toBe('login-issue');
      });

      it('should remove hotfix/ prefix', () => {
        const result = BranchInference.sanitizeWorkspaceName('hotfix/critical-bug');
        expect(result).toBe('critical-bug');
      });

      it('should replace invalid characters with dashes', () => {
        const result = BranchInference.sanitizeWorkspaceName('feature/auth@system!test');
        expect(result).toBe('auth-system-test');
      });

      it('should remove leading and trailing dashes', () => {
        const result = BranchInference.sanitizeWorkspaceName('---feature/test---');
        expect(result).toBe('feature-test');
      });

      it('should return "workspace" for empty or all-invalid input', () => {
        expect(BranchInference.sanitizeWorkspaceName('---')).toBe('workspace');
        expect(BranchInference.sanitizeWorkspaceName('')).toBe('workspace');
        expect(BranchInference.sanitizeWorkspaceName('feature/')).toBe('workspace');
      });
    });

    describe('kebab-case strategy', () => {
      it('should convert to lowercase kebab-case', () => {
        const result = BranchInference.sanitizeWorkspaceName('feature/AuthSystem_Test', 'kebab-case');
        expect(result).toBe('authsystem-test');
      });

      it('should handle mixed case and special characters', () => {
        const result = BranchInference.sanitizeWorkspaceName('feature/My_Auth@System!', 'kebab-case');
        expect(result).toBe('my-auth-system');
      });
    });

    describe('snake_case strategy', () => {
      it('should convert to lowercase snake_case', () => {
        const result = BranchInference.sanitizeWorkspaceName('feature/AuthSystem-Test', 'snake_case');
        expect(result).toBe('authsystem_test');
      });

      it('should handle mixed case and special characters', () => {
        const result = BranchInference.sanitizeWorkspaceName('feature/My-Auth@System!', 'snake_case');
        expect(result).toBe('my_auth_system');
      });
    });
  });

  describe('generateWorkspaceId', () => {
    it('should generate workspace ID with project and workspace name', () => {
      const id = BranchInference.generateWorkspaceId('my-project', 'auth-feature');
      expect(id).toBe('my-project/auth-feature');
    });

    it('should handle special characters in names', () => {
      const id = BranchInference.generateWorkspaceId('my_project', 'auth-feature');
      expect(id).toBe('my_project/auth-feature');
    });
  });
});