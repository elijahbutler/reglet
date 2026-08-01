import { describe, expect, test } from 'bun:test';
import { deriveProjectionStatus } from '../src/projections/state.js';

describe('projection state', () => {
  test('derives the three-hash state model', () => {
    expect(
      deriveProjectionStatus({
        targeted: true,
        supported: true,
        outputExists: true,
        desiredHash: 'same',
        appliedHash: 'same',
        observedHash: 'same',
      }),
    ).toBe('applied');
    expect(
      deriveProjectionStatus({
        targeted: true,
        supported: true,
        outputExists: true,
        desiredHash: 'next',
        appliedHash: 'old',
        observedHash: 'old',
      }),
    ).toBe('pending');
    expect(
      deriveProjectionStatus({
        targeted: true,
        supported: true,
        outputExists: true,
        desiredHash: 'next',
        appliedHash: 'old',
        observedHash: 'external',
      }),
    ).toBe('drifted');
    expect(
      deriveProjectionStatus({
        targeted: true,
        supported: true,
        outputExists: false,
        desiredHash: 'same',
        appliedHash: 'same',
      }),
    ).toBe('missing');
  });

  test('keeps targeting, support, blockers, and errors explicit', () => {
    expect(
      deriveProjectionStatus({
        targeted: false,
        supported: true,
        outputExists: false,
      }),
    ).toBe('not-targeted');
    expect(
      deriveProjectionStatus({
        targeted: true,
        supported: false,
        outputExists: false,
      }),
    ).toBe('unsupported');
    expect(
      deriveProjectionStatus({
        targeted: true,
        supported: true,
        outputExists: false,
        blocked: true,
      }),
    ).toBe('blocked');
    expect(
      deriveProjectionStatus({
        targeted: true,
        supported: true,
        outputExists: false,
        operationError: true,
      }),
    ).toBe('error');
  });
});

