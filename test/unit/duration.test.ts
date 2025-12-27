import { describe, it, expect } from 'bun:test';
import { parseDuration } from '../../src/utils/git/index.js';

describe('parseDuration', () => {
  it('should parse days correctly', () => {
    expect(parseDuration('30d')).toBe(30 * 24 * 60 * 60 * 1000);
    expect(parseDuration('1d')).toBe(24 * 60 * 60 * 1000);
  });

  it('should parse weeks correctly', () => {
    expect(parseDuration('2w')).toBe(2 * 7 * 24 * 60 * 60 * 1000);
    expect(parseDuration('1w')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('should parse months correctly', () => {
    expect(parseDuration('6m')).toBe(6 * 30 * 24 * 60 * 60 * 1000);
    expect(parseDuration('1m')).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('should parse years correctly', () => {
    expect(parseDuration('1y')).toBe(365 * 24 * 60 * 60 * 1000);
  });

  it('should throw error for invalid format', () => {
    expect(() => parseDuration('invalid')).toThrow('Invalid duration format');
    expect(() => parseDuration('30')).toThrow('Invalid duration format');
    expect(() => parseDuration('30x')).toThrow('Invalid duration format');
  });
});