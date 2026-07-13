import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'smol-toml';
import { regletHome } from './paths.js';

export const providerNames = ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'] as const;

export type ProviderName = (typeof providerNames)[number];

export interface ProviderConfig {
  enabled: boolean;
  rules: boolean;
  skills: boolean;
  mcp: boolean;
}

export interface RegletConfig {
  providers: Record<ProviderName, ProviderConfig>;
}

type TomlValue = string | number | boolean | Date | TomlValue[] | { readonly [key: string]: TomlValue };

const defaultProviderConfig: ProviderConfig = {
  enabled: false,
  rules: true,
  skills: true,
  mcp: true,
};

export function defaultConfig(): RegletConfig {
  return {
    providers: Object.fromEntries(
      providerNames.map((name) => [name, { ...defaultProviderConfig }]),
    ) as Record<ProviderName, ProviderConfig>,
  };
}

export function configPath(home = regletHome()): string {
  return path.join(home, 'reglet.toml');
}

export async function loadConfig(home = regletHome()): Promise<RegletConfig> {
  try {
    const rawConfig = parse(await readFile(configPath(home), 'utf8'));
    return normalizeConfig(rawConfig);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return defaultConfig();
    }
    throw error;
  }
}

export async function saveConfig(config: RegletConfig, home = regletHome()): Promise<void> {
  const targetPath = configPath(home);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, stringify(config as unknown as { readonly [key: string]: TomlValue }));
}

export function serializeConfig(config: RegletConfig): string {
  return stringify(config as unknown as { readonly [key: string]: TomlValue });
}

function normalizeConfig(value: unknown): RegletConfig {
  const defaults = defaultConfig();
  if (!isRecord(value)) {
    return defaults;
  }

  const providers = isRecord(value.providers) ? value.providers : {};
  return {
    providers: Object.fromEntries(
      providerNames.map((name) => {
        const provider = isRecord(providers[name]) ? providers[name] : {};
        return [
          name,
          {
            enabled: readBoolean(provider.enabled, defaults.providers[name].enabled),
            rules: readBoolean(provider.rules, defaults.providers[name].rules),
            skills: readBoolean(provider.skills, defaults.providers[name].skills),
            mcp: readBoolean(provider.mcp, defaults.providers[name].mcp),
          },
        ];
      }),
    ) as Record<ProviderName, ProviderConfig>,
  };
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
