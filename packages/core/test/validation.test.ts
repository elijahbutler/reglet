import { describe, expect, test } from 'bun:test';
import {
  validateInstruction,
  validateMcpServer,
  validateSkill,
} from '../src/validation/artifacts.js';

describe('artifact validation', () => {
  test('keeps portable validity separate from provider support', () => {
    const result = validateInstruction({
      content: '# Shared guidance\n',
      targets: ['cursor'],
    });

    expect(result.valid).toBe(true);
    expect(result.compatibility).toEqual([
      {
        provider: 'cursor',
        supported: false,
        canProject: false,
        issues: [],
      },
    ]);
  });

  test('validates skill frontmatter and provider lossiness', () => {
    const result = validateSkill({
      slug: 'review-code',
      files: [
        {
          relPath: 'SKILL.md',
          content:
            '---\nname: review-code\ndescription: Review code\nlicense: MIT\n---\n# Review\n',
        },
      ],
      targets: ['claude', 'opencode'],
    });

    expect(result.valid).toBe(true);
    expect(result.compatibility[0]?.issues).toContainEqual({
      code: 'lossy-conversion',
      severity: 'warning',
      message: 'Claude Code ignores skill field "license".',
      field: 'license',
    });
    expect(result.compatibility[1]?.issues).toEqual([]);
  });

  test('blocks only MCP projections with missing required secrets', () => {
    const result = validateMcpServer({
      name: 'api',
      definition: {
        transport: 'http',
        url: 'https://example.test/mcp',
        headers: {},
        secretHeaders: {
          Authorization: { id: 'api-token' },
        },
      },
      targets: ['claude', 'cursor'],
      secretBindings: [],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.compatibility.every((item) => item.canProject === false)).toBe(true);
    expect(result.compatibility[0]?.issues[0]?.code).toBe('missing-secret');
  });
});
