import { describe, expect, test } from 'bun:test';
import {
  compareTextLines,
  mergeSelectedTextHunks,
} from '../src/projects/promotion.js';

describe('project promotion comparison', () => {
  test('merges selected non-contiguous line hunks without changing the rest', () => {
    const base = '# Rule\n\nKeep A.\n\nKeep B.\n';
    const incoming = '# Rule\n\nChange A.\n\nChange B.\n';
    const hunks = compareTextLines(base, incoming);

    expect(hunks).toHaveLength(2);
    expect(
      mergeSelectedTextHunks(base, incoming, [hunks[0]?.id ?? 'missing']),
    ).toBe('# Rule\n\nChange A.\n\nKeep B.\n');
    expect(mergeSelectedTextHunks(base, incoming)).toBe(incoming);
  });
});

