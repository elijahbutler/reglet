import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  recommendInstructionPromotion,
  scanProjectRoot,
} from '../src/projects/discovery.js';
import {
  inspectSkill,
  isTrustDecisionCurrent,
} from '../src/security/skills.js';

let currentRoot: string | undefined;
let externalRoot: string | undefined;

afterEach(async () => {
  for (const target of [currentRoot, externalRoot]) {
    if (target !== undefined) {
      await rm(target, { recursive: true, force: true });
    }
  }
  currentRoot = undefined;
  externalRoot = undefined;
  delete process.env.REGLET_PROVIDER_HOME;
});

describe('project discovery', () => {
  test('deduplicates one AGENTS.md across providers', async () => {
    currentRoot = await mkdtemp(path.join(tmpdir(), 'reglet-discovery-'));
    await writeFile(path.join(currentRoot, 'AGENTS.md'), '# Project guidance\n');

    const discoveries = await scanProjectRoot(currentRoot);

    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]?.recognizedBy).toEqual([
      'codex',
      'cursor',
      'opencode',
      'windsurf',
    ]);
    expect(recommendInstructionPromotion(discoveries[0]!)).toMatchObject({
      defaultMode: 'global-instruction',
    });
  });

  test('recommends a scoped cursor rule as a skill', async () => {
    currentRoot = await mkdtemp(path.join(tmpdir(), 'reglet-discovery-'));
    await mkdir(path.join(currentRoot, '.cursor', 'rules'), { recursive: true });
    await writeFile(
      path.join(currentRoot, '.cursor', 'rules', 'api.mdc'),
      '---\ndescription: API changes\nglobs: src/api/**\nalwaysApply: false\n---\nUse the API workflow.\n',
    );

    const discoveries = await scanProjectRoot(currentRoot);
    const recommendation = recommendInstructionPromotion(discoveries[0]!);

    expect(recommendation.defaultMode).toBe('convert-to-skill');
    expect(recommendation.warnings.some((warning) => warning.includes('globs'))).toBe(
      true,
    );
  });

  test('discovers Codex fallback instruction filenames from adapter configuration', async () => {
    currentRoot = await mkdtemp(path.join(tmpdir(), 'reglet-discovery-'));
    externalRoot = await mkdtemp(path.join(tmpdir(), 'reglet-provider-home-'));
    process.env.REGLET_PROVIDER_HOME = externalRoot;
    await mkdir(path.join(externalRoot, '.codex'), { recursive: true });
    await writeFile(
      path.join(externalRoot, '.codex', 'config.toml'),
      'project_doc_fallback_filenames = ["TEAM_GUIDE.md"]\n',
    );
    await mkdir(path.join(currentRoot, 'packages', 'api'), { recursive: true });
    await writeFile(
      path.join(currentRoot, 'packages', 'api', 'TEAM_GUIDE.md'),
      '# Team guidance\n',
    );

    const discovery = (await scanProjectRoot(currentRoot)).find(
      (item) => item.relativePath === 'packages/api/TEAM_GUIDE.md',
    );

    expect(discovery?.recognizedBy).toEqual(['codex']);
    expect(discovery?.formatsByProvider.codex).toBe('codex-fallback-markdown');
  });

  test('keeps ignored discoveries filterable and reopens changed revisions by preference', async () => {
    currentRoot = await mkdtemp(path.join(tmpdir(), 'reglet-discovery-'));
    const root = currentRoot;
    const sourcePath = path.join(root, 'AGENTS.md');
    await writeFile(sourcePath, '# Original\n');
    const [original] = await scanProjectRoot(root);
    if (original === undefined) {
      throw new Error('Expected AGENTS.md discovery');
    }
    const ignored = [
      {
        relativePath: original.relativePath,
        sourceHash: original.sourceHash,
      },
    ];

    expect((await scanProjectRoot(root, { ignored }))[0]?.state).toBe(
      'ignored',
    );
    await writeFile(sourcePath, '# Changed\n');
    expect((await scanProjectRoot(root, { ignored }))[0]?.state).toBe(
      'ignored',
    );
    expect(
      (
        await scanProjectRoot(root, {
          ignored,
          reappearChangedIgnored: true,
        })
      )[0]?.state,
    ).toBe('changed');
  });
});

describe('skill trust inspection', () => {
  test('blocks a symlink escaping the skill root', async () => {
    currentRoot = await mkdtemp(path.join(tmpdir(), 'reglet-skill-'));
    externalRoot = await mkdtemp(path.join(tmpdir(), 'reglet-external-'));
    await writeFile(path.join(currentRoot, 'SKILL.md'), '# Skill\n');
    await writeFile(path.join(externalRoot, 'secret.txt'), 'outside');
    await symlink(path.join(externalRoot, 'secret.txt'), path.join(currentRoot, 'outside'));

    const inspection = await inspectSkill(currentRoot);

    expect(inspection.promotionBlocked).toBe(true);
    expect(inspection.risks.some((risk) => risk.code === 'escaping-symlink')).toBe(
      true,
    );
  });

  test('invalidates trust when executable content changes', async () => {
    currentRoot = await mkdtemp(path.join(tmpdir(), 'reglet-skill-'));
    const scriptPath = path.join(currentRoot, 'run.sh');
    await writeFile(path.join(currentRoot, 'SKILL.md'), '# Skill\n');
    await writeFile(scriptPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const first = await inspectSkill(currentRoot);
    const decision = {
      artifactId: 'skill-1',
      revision: first.revision,
      trustedAt: new Date().toISOString(),
      executableFiles: ['run.sh'],
    };
    await writeFile(scriptPath, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const changed = await inspectSkill(currentRoot);

    expect(first.requiresExecutableConfirmation).toBe(true);
    expect(isTrustDecisionCurrent(decision, changed)).toBe(false);
  });
});

