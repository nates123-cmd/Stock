import { describe, it, expect } from 'vitest';
import { cacheKey } from '@/lib/api/claude';

describe('cacheKey', () => {
  it('is deterministic for the same task + input', () => {
    expect(cacheKey('recipe-parse', '1 stick butter')).toBe(
      cacheKey('recipe-parse', '1 stick butter'),
    );
  });

  it('prefixes with the task name', () => {
    expect(cacheKey('recipe-parse', 'x')).toMatch(/^recipe-parse:/);
  });

  it('varies with input', () => {
    expect(cacheKey('t', 'a')).not.toBe(cacheKey('t', 'b'));
  });

  it('varies with task', () => {
    expect(cacheKey('t1', 'a')).not.toBe(cacheKey('t2', 'a'));
  });

  it('produces a url/db-safe base36 suffix', () => {
    expect(cacheKey('t', 'some input')).toMatch(/^t:[0-9a-z]+$/);
  });
});
