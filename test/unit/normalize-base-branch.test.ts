import { describe, it, expect } from 'bun:test';
import { normalizeBaseBranch } from '../../src/utils/git/index.js';

describe('normalizeBaseBranch', () => {
  it('strips a leading origin/ prefix', () => {
    expect(normalizeBaseBranch('origin/main')).toBe('main');
    expect(normalizeBaseBranch('origin/feat/aggregations')).toBe('feat/aggregations');
  });

  it('leaves local branch names untouched', () => {
    expect(normalizeBaseBranch('main')).toBe('main');
    expect(normalizeBaseBranch('feat/antihero')).toBe('feat/antihero');
  });

  it('only strips a leading prefix, not occurrences mid-name', () => {
    expect(normalizeBaseBranch('feature/origin/thing')).toBe('feature/origin/thing');
  });

  it('does not strip other remotes', () => {
    expect(normalizeBaseBranch('upstream/main')).toBe('upstream/main');
  });
});
