import { readFile } from 'node:fs/promises';
import { providerNames, type ProviderName, type RegletConfig } from './config.js';
import { sha256String } from './fsutil.js';
import type { ManagedContent } from './manifest.js';
import type { MasterDir, MasterSkill } from './master.js';
import { effectiveMcpEnvironmentDigest, filterMcpDefinitionsForProvider, redactMcpServers, resolveEffectiveMcpDefinitions } from './mcp.js';

export interface MasterRevisionSet {
  masterRevision: string;
  compositionRevisions: Record<ProviderName, Record<ManagedContent, string>>;
}

export function compositionRevisionKey(provider: ProviderName, content: ManagedContent): string {
  return `${provider}:${content}`;
}

export function flattenCompositionRevisions(
  revisions: MasterRevisionSet['compositionRevisions'],
  providers: readonly ProviderName[] = providerNames,
  contents: readonly ManagedContent[] = ['rules', 'skills', 'mcp'],
): Record<string, string> {
  const flattened: Record<string, string> = {};
  for (const provider of providers) {
    for (const content of contents) {
      flattened[compositionRevisionKey(provider, content)] = revisions[provider][content];
    }
  }
  return flattened;
}

export async function deriveMasterRevisions(
  master: MasterDir,
  config: RegletConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MasterRevisionSet> {
  const canonicalMaster = {
    version: 1,
    rules: {
      shared: master.rules.map((rule) => ({ relPath: rule.relPath, content: rule.content })),
      providers: Object.fromEntries(
        providerNames.map((provider) => [
          provider,
          master.providerRules[provider].map((rule) => ({ relPath: rule.relPath, content: rule.content })),
        ]),
      ),
    },
    skills: {
      shared: await canonicalSkills(master.skills),
      providers: Object.fromEntries(
        await Promise.all(
          providerNames.map(async (provider) => [provider, await canonicalSkills(master.providerSkills[provider])] as const),
        ),
      ),
    },
    mcp: {
      shared: canonicalMcpDefinitions(master.mcpDefinitions),
      providers: Object.fromEntries(
        providerNames.map((provider) => [provider, canonicalMcpDefinitions(master.providerMcpDefinitions[provider])]),
      ),
    },
    contentSync: config.contentSync,
    enrollment: canonicalEnrollment(config),
  };
  const masterRevision = digest(canonicalMaster);
  const sharedSkillsByProvider = Object.fromEntries(
    await Promise.all(providerNames.map(async (provider) => [
      provider,
      await canonicalSkills(master.skills.filter((skill) => {
        const syncProviders = config.contentSync.skills[skill.name];
        return syncProviders === undefined || syncProviders.includes(provider);
      })),
    ] as const)),
  ) as Record<ProviderName, unknown[]>;
  const compositionRevisions = Object.fromEntries(
    providerNames.map((provider) => [
      provider,
      {
        rules: digest({
          version: 1,
          provider,
          content: 'rules',
          enrollment: contentEnrollment(config, provider, 'rules'),
          sharedRules: canonicalMaster.rules.shared,
          providerRules: canonicalMaster.rules.providers[provider],
        }),
        skills: digest({
          version: 1,
          provider,
          content: 'skills',
          enrollment: contentEnrollment(config, provider, 'skills'),
          sharedSkills: sharedSkillsByProvider[provider],
          providerSkills: canonicalMaster.skills.providers[provider],
        }),
        mcp: digest({
          version: 1,
          provider,
          content: 'mcp',
          enrollment: contentEnrollment(config, provider, 'mcp'),
          servers: resolveEffectiveMcpDefinitions(
            filterMcpDefinitionsForProvider(master.mcpDefinitions, config, provider),
            master.providerMcpDefinitions[provider],
            provider,
          ).map((entry) => ({
            id: entry.id,
            displayName: entry.displayName,
            scope: entry.scope,
            overrideOf: entry.overrideOf,
            server: redactMcpServers({ [entry.id]: entry.server })[entry.id],
            conflictStatus: entry.conflictStatus,
          })),
          environmentFingerprint: effectiveMcpEnvironmentDigest(
            resolveEffectiveMcpDefinitions(
              filterMcpDefinitionsForProvider(master.mcpDefinitions, config, provider),
              master.providerMcpDefinitions[provider],
              provider,
            ),
            env,
          ),
        }),
      },
    ]),
  ) as MasterRevisionSet['compositionRevisions'];

  return { masterRevision, compositionRevisions };
}

function canonicalMcpDefinitions(definitions: MasterDir['mcpDefinitions']): unknown[] {
  return Object.values(definitions)
    .map((definition) => ({
      id: definition.id,
      displayName: definition.displayName,
      server: redactMcpServers({ [definition.id]: definition.server })[definition.id],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function contentEnrollment(
  config: RegletConfig,
  provider: ProviderName,
  content: ManagedContent,
): { enabled: boolean; enrolled: boolean } {
  return {
    enabled: config.providers[provider].enabled,
    enrolled: config.providers[provider][content],
  };
}

async function canonicalSkills(skills: readonly MasterSkill[]): Promise<unknown[]> {
  return Promise.all(
    skills.map(async (skill) => ({
      name: skill.name,
      files: await Promise.all(
        skill.files.map(async (file) => ({
          relPath: file.relPath,
          content: await readFile(file.absPath, 'utf8'),
        })),
      ),
    })),
  );
}

function canonicalEnrollment(config: RegletConfig): Record<ProviderName, unknown> {
  return Object.fromEntries(
    providerNames.map((provider) => [
      provider,
      {
        enabled: config.providers[provider].enabled,
        rules: config.providers[provider].rules,
        skills: config.providers[provider].skills,
        mcp: config.providers[provider].mcp,
      },
    ]),
  ) as Record<ProviderName, unknown>;
}

function digest(value: unknown): string {
  return sha256String(JSON.stringify(sortValue(value)));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
