import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, providerNames, saveConfig, setSyncProviders, syncProvidersFor, type ProviderName, type RegletConfig } from './config.js';
import { sha256String } from './fsutil.js';
import type { McpEnvironmentValue, McpServerDef, ResolvedMcpServerDef } from './master.js';
import { regletHome } from './paths.js';
import { isSecretRef, systemSecretStore, type SecretStore } from './security/secrets.js';
import { hasLibraryManifest, loadLibraryManifest } from './artifacts/library.js';
import { resolveMcpMachineOverrides } from './projects/mcp-overrides.js';
import { LocalState } from './state/database.js';

export type McpScope = { kind: 'shared' } | { kind: 'provider'; provider: ProviderName };

export interface McpServerDefinition {
  id: string;
  displayName: string;
  server: McpServerDef;
}

export interface McpServerEntry {
  id: string;
  name: string;
  displayName: string;
  scope: McpScope;
  server: McpServerDef;
  issues: string[];
  overrideOf: string | null;
  affectedProviders: ProviderName[];
  conflictStatus: McpConflictStatus;
  syncProviders: ProviderName[];
}

export interface McpListResult {
  path: string;
  scope: McpScope;
  servers: McpServerEntry[];
}

export interface McpMutationResult {
  path: string;
  id: string;
  name: string;
  displayName: string;
  scope: McpScope;
}

export interface RedactedMcpArguments {
  args: string[];
  redacted: boolean;
}

const redactedArgument = '<redacted:argument>';
const credentialArgumentName = '(?:access[-_]?token|api[-_]?key|auth(?:orization)?|auth[-_]?token|bearer[-_]?token|client[-_]?secret|credential|password|passwd|secret|token)';
const credentialArgumentFlag = new RegExp(`^--?${credentialArgumentName}$`, 'i');
const inlineCredentialArgument = new RegExp(`^(--?${credentialArgumentName}\\s*[=:]\\s*)(.+)$`, 'i');
const labeledCredentialValue = new RegExp(`(\\b${credentialArgumentName}\\b\\s*[=:]\\s*)(?:Bearer\\s+)?[^\\s,;&]+`, 'gi');
const urlCredentials = /(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi;

/** Hides credential-like CLI values while preserving enough structure to audit an MCP command. */
export function redactMcpCredentialArguments(args: readonly string[]): RedactedMcpArguments {
  let redactNext = false;
  let redacted = false;
  const safeArgs = args.map((argument) => {
    if (redactNext) {
      redactNext = false;
      redacted = true;
      return redactedArgument;
    }
    if (credentialArgumentFlag.test(argument)) {
      redactNext = true;
      return argument;
    }
    const inline = argument.replace(inlineCredentialArgument, `$1${redactedArgument}`);
    const labeled = inline.replace(labeledCredentialValue, `$1${redactedArgument}`);
    const safe = labeled.replace(urlCredentials, `$1${redactedArgument}@`);
    if (safe !== argument) redacted = true;
    return safe;
  });
  return { args: safeArgs, redacted };
}

/** Scrubs JSON and TOML argument arrays before provider previews cross the manager boundary. */
export function redactMcpCredentialArgumentsInText(content: string): string {
  const field = /(?:"args"|args)\s*[:=]\s*\[/g;
  let cursor = 0;
  let output = '';
  for (let match = field.exec(content); match !== null; match = field.exec(content)) {
    const arrayStart = field.lastIndex - 1;
    const arrayEnd = findArgumentArrayEnd(content, arrayStart + 1);
    if (arrayEnd === -1) break;
    output += content.slice(cursor, arrayStart + 1);
    output += redactArgumentArrayBody(content.slice(arrayStart + 1, arrayEnd));
    output += ']';
    cursor = arrayEnd + 1;
    field.lastIndex = cursor;
  }
  return cursor === 0 ? content : output + content.slice(cursor);
}

function findArgumentArrayEnd(content: string, start: number): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let depth = 0;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (quote !== null) {
      if (quote === '"' && escaped) {
        escaped = false;
      } else if (quote === '"' && character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    if (character === '[') depth += 1;
    if (character === ']') {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

function redactArgumentArrayBody(body: string): string {
  const quotedArgument = /"((?:\\.|[^"\\])*)"|'([^']*)'/g;
  const values: string[] = [];
  for (let match = quotedArgument.exec(body); match !== null; match = quotedArgument.exec(body)) {
    values.push(match[1] ?? match[2] ?? '');
  }
  const redacted = redactMcpCredentialArguments(values).args;
  let index = 0;
  return body.replace(quotedArgument, (quoted, doubleQuoted: string | undefined, singleQuoted: string | undefined) => {
    const original = doubleQuoted ?? singleQuoted ?? '';
    const safe = redacted[index] ?? original;
    index += 1;
    if (safe === original) return quoted;
    return doubleQuoted === undefined ? `'${safe}'` : `"${safe}"`;
  });
}

export interface EffectiveMcpServerEntry extends McpServerDefinition {
  scope: McpScope;
  overrideOf: string | null;
  issues: string[];
  conflictStatus: McpConflictStatus;
}

export type McpConflictStatus =
  | { state: 'none' }
  | { state: 'conflict'; displayName: string; conflictingIds: string[] };

interface McpServerEnvelope {
  displayName?: string;
  server: McpServerDef;
}

type McpFileEntry = McpServerDef | McpServerEnvelope;

interface McpServersFile {
  mcpServers?: Record<string, unknown>;
}

export function sharedMcpScope(): McpScope {
  return { kind: 'shared' };
}

export function providerMcpScope(provider: ProviderName): McpScope {
  return { kind: 'provider', provider };
}

export async function listMcpServers(scopeOrHome: McpScope | string = sharedMcpScope(), maybeHome?: string): Promise<McpListResult> {
  const { scope, home } = normalizeScopeArgs(scopeOrHome, maybeHome);
  const [config, raw] = await Promise.all([loadConfig(home), readMcpServersFile(mcpServersPath(home, scope))]);
  const serversPath = mcpServersPath(home, scope);
  const definitions = await filterMcpDefinitionsByLibrary(definitionsFromRaw(raw), scope, home);
  const sharedDefinitions = scope.kind === 'shared'
    ? definitions
    : definitionsFromRaw(await readMcpServersFile(mcpServersPath(home, sharedMcpScope())));
  const providerDefinitions = scope.kind === 'provider'
    ? { [scope.provider]: definitions }
    : Object.fromEntries(
      await Promise.all(providerNames.map(async (provider) => [
        provider,
        definitionsFromRaw(await readMcpServersFile(mcpServersPath(home, providerMcpScope(provider)))),
      ] as const)),
    ) as Record<ProviderName, Record<string, McpServerDefinition>>;
  return {
    path: serversPath,
    scope,
    servers: Object.entries(definitions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, definition]) => {
        const issues = validateMcpDefinition(id, definition);
        const syncProviders = scope.kind === 'shared'
          ? syncProvidersFor(config, 'mcp', id)
          : [scope.provider];
        return {
          id,
          name: definition.displayName,
          displayName: definition.displayName,
          scope,
          server: coerceMcpServerDef(definition.server),
          issues,
          overrideOf: scope.kind === 'provider' && sharedDefinitions[id] !== undefined ? id : null,
          affectedProviders: scope.kind === 'shared'
            ? syncProviders.filter((provider) => providerDefinitions[provider]?.[id] === undefined)
            : [scope.provider],
          conflictStatus: { state: 'none' },
          syncProviders,
        };
      }),
  };
}

export async function readMcpServer(id: string, scopeOrHome: McpScope | string = sharedMcpScope(), maybeHome?: string): Promise<McpServerEntry> {
  const { scope, home } = normalizeScopeArgs(scopeOrHome, maybeHome);
  const config = await loadConfig(home);
  validateMcpId(id);
  const servers = definitionsFromRaw(await readMcpServersFile(mcpServersPath(home, scope)));
  const definition = servers[id];
  if (definition === undefined) throw new Error(`MCP server does not exist: ${id}`);
  const issues = validateMcpDefinition(id, definition);
  const sharedDefinitions = scope.kind === 'provider'
    ? definitionsFromRaw(await readMcpServersFile(mcpServersPath(home, sharedMcpScope())))
    : servers;
  const affectedProviders = scope.kind === 'shared'
    ? (await Promise.all(providerNames.map(async (provider) => ({
      provider,
      definitions: definitionsFromRaw(await readMcpServersFile(mcpServersPath(home, providerMcpScope(provider)))),
    }))))
      .filter((entry) => entry.definitions[id] === undefined)
      .map((entry) => entry.provider)
    : [scope.provider];
  return {
    id,
    name: definition.displayName,
    displayName: definition.displayName,
    scope,
    server: coerceMcpServerDef(definition.server),
    issues,
    overrideOf: scope.kind === 'provider' && sharedDefinitions[id] !== undefined ? id : null,
    affectedProviders: scope.kind === 'shared'
      ? affectedProviders.filter((provider) => syncProvidersFor(config, 'mcp', id).includes(provider))
      : affectedProviders,
    conflictStatus: { state: 'none' },
    syncProviders: scope.kind === 'shared' ? syncProvidersFor(config, 'mcp', id) : [scope.provider],
  };
}

export async function updateMcpSyncProviders(
  id: string,
  providers: readonly ProviderName[],
  home = regletHome(),
): Promise<ProviderName[]> {
  const config = await loadConfig(home);
  setSyncProviders(config, 'mcp', id, providers);
  await saveConfig(config, home);
  return syncProvidersFor(config, 'mcp', id);
}

export async function upsertMcpServer(
  id: string,
  server: McpServerDef,
  scopeOrHome: McpScope | string = sharedMcpScope(),
  maybeHome?: string,
  displayName?: string,
): Promise<McpMutationResult> {
  const { scope, home } = normalizeScopeArgs(scopeOrHome, maybeHome);
  const validation = validateMcpServer(id, server);
  if (!validation.ok) throw new Error(`Invalid MCP server: ${validation.issues.join('; ')}`);
  const serversPath = mcpServersPath(home, scope);
  const servers = await readMcpServersFile(serversPath);
  if (id in servers && !isCanonicalMcpServerFileEntry(id, servers[id])) {
    throw new Error(
      `Cannot overwrite invalid legacy MCP server ${id}; delete it explicitly, then recreate it using process environment references`,
    );
  }
  const current = definitionsFromRaw(servers)[id];
  const finalDisplayName = displayName ?? current?.displayName ?? id;
  validateMcpDisplayName(finalDisplayName);
  servers[id] = serializeMcpServerDefinition(id, { displayName: finalDisplayName, server: normalizeMcpServer(server) });
  await writeMcpServersFile(serversPath, canonicalMcpServersOrThrow(servers));
  return { path: serversPath, id, name: finalDisplayName, displayName: finalDisplayName, scope };
}

export async function renameMcpServerDisplayName(
  id: string,
  displayName: string,
  scopeOrHome: McpScope | string = sharedMcpScope(),
  maybeHome?: string,
): Promise<McpMutationResult> {
  const { scope, home } = normalizeScopeArgs(scopeOrHome, maybeHome);
  validateMcpId(id);
  validateMcpDisplayName(displayName);
  const serversPath = mcpServersPath(home, scope);
  const servers = await readMcpServersFile(serversPath);
  const definitions = definitionsFromRaw(servers);
  const definition = definitions[id];
  if (definition === undefined) throw new Error(`MCP server does not exist: ${id}`);
  servers[id] = serializeMcpServerDefinition(id, { ...definition, displayName });
  await writeMcpServersFile(serversPath, canonicalMcpServersOrThrow(servers));
  return { path: serversPath, id, name: displayName, displayName, scope };
}

export async function deleteMcpServer(id: string, scopeOrHome: McpScope | string = sharedMcpScope(), maybeHome?: string): Promise<McpMutationResult> {
  const { scope, home } = normalizeScopeArgs(scopeOrHome, maybeHome);
  validateMcpId(id);
  const serversPath = mcpServersPath(home, scope);
  const servers = await readMcpServersFile(serversPath);
  const definitions = definitionsFromRaw(servers);
  const displayName = definitions[id]?.displayName ?? id;
  delete servers[id];
  await writeMcpServersFile(serversPath, canonicalMcpServersOrThrow(servers));
  return { path: serversPath, id, name: displayName, displayName, scope };
}

export async function listEffectiveMcpServers(provider: ProviderName, home = regletHome()): Promise<EffectiveMcpServerEntry[]> {
  const config = await loadConfig(home);
  const shared = filterMcpDefinitionsForProvider(
    definitionsFromRaw(await readMcpServersFile(mcpServersPath(home, sharedMcpScope()))),
    config,
    provider,
  );
  const scoped = definitionsFromRaw(await readMcpServersFile(mcpServersPath(home, providerMcpScope(provider))));
  return effectiveMcpDefinitions(shared, scoped, provider);
}

export async function resolveEffectiveMcpServersEnv(
  provider: ProviderName,
  home = regletHome(),
  env: NodeJS.ProcessEnv = process.env,
  secretStore: SecretStore = systemSecretStore(),
): Promise<Record<string, ResolvedMcpServerDef>> {
  return resolveEffectiveMcpServerSelection(provider, home, env, secretStore);
}

export async function resolveSelectedEffectiveMcpServersEnv(
  provider: ProviderName,
  displayNames: readonly string[],
  home = regletHome(),
  env: NodeJS.ProcessEnv = process.env,
  secretStore: SecretStore = systemSecretStore(),
): Promise<Record<string, ResolvedMcpServerDef>> {
  return resolveEffectiveMcpServerSelection(provider, home, env, secretStore, new Set(displayNames));
}

async function resolveEffectiveMcpServerSelection(
  provider: ProviderName,
  home: string,
  env: NodeJS.ProcessEnv,
  secretStore: SecretStore,
  displayNames?: ReadonlySet<string>,
): Promise<Record<string, ResolvedMcpServerDef>> {
  const effective = (await listEffectiveMcpServers(provider, home))
    .filter((entry) => displayNames === undefined || displayNames.has(entry.displayName));
  const conflict = effective.find((entry) => entry.conflictStatus.state === 'conflict');
  if (conflict !== undefined && conflict.conflictStatus.state === 'conflict') {
    throw new Error(
      `MCP display-name conflict for ${provider}: ${conflict.conflictStatus.displayName} is used by ${conflict.conflictStatus.conflictingIds.join(', ')}`,
    );
  }
  const servers: Record<string, McpServerDef> = {};
  const manifest = await loadLibraryManifest(home);
  const state = await LocalState.open(home);
  try {
    for (const entry of effective) {
      if (entry.issues.length > 0) throw new Error(`Invalid MCP server ${entry.id}: ${entry.issues.join('; ')}`);
      const artifact = manifest.artifacts.find((candidate) =>
        candidate.kind === 'mcp' && candidate.locator.type === 'mcp-server' &&
        candidate.locator.serverName === entry.id &&
        (entry.scope.kind === 'shared'
          ? candidate.scope.kind === 'global'
          : candidate.scope.kind === 'provider-overlay' && candidate.scope.provider === entry.scope.provider));
      const overrides = artifact === undefined
        ? []
        : state.mcpMachineOverrides(artifact.id);
      const resolved = resolveMcpMachineOverrides(
        entry.server,
        new Map(overrides.map((override) => [override.fieldPath, override.value])),
      );
      if (resolved.missing.length > 0) {
        throw new Error(`Missing machine-local MCP overrides for ${entry.id}: ${resolved.missing.join(', ')}`);
      }
      servers[entry.displayName] = resolved.definition;
    }
  } finally {
    state.close();
  }
  return resolveMcpServersSecrets(servers, env, secretStore);
}

export async function loadMcpDefinitions(home = regletHome()): Promise<{
  shared: Record<string, McpServerDefinition>;
  providers: Record<ProviderName, Record<string, McpServerDefinition>>;
}> {
  const providers = Object.fromEntries(
    await Promise.all(
      providerNames.map(async (provider) => [
        provider,
        await filterMcpDefinitionsByLibrary(
          definitionsFromRaw(await readMcpServersFile(mcpServersPath(home, providerMcpScope(provider))), false),
          providerMcpScope(provider),
          home,
        ),
      ] as const),
    ),
  ) as Record<ProviderName, Record<string, McpServerDefinition>>;
  return {
    shared: await filterMcpDefinitionsByLibrary(
      definitionsFromRaw(await readMcpServersFile(mcpServersPath(home, sharedMcpScope())), false),
      sharedMcpScope(),
      home,
    ),
    providers,
  };
}

async function filterMcpDefinitionsByLibrary(
  definitions: Record<string, McpServerDefinition>,
  scope: McpScope,
  home: string,
): Promise<Record<string, McpServerDefinition>> {
  if (!(await hasLibraryManifest(home))) return definitions;
  const manifest = await loadLibraryManifest(home);
  const activeIds = new Set(
    manifest.artifacts
      .filter((artifact) =>
        artifact.kind === 'mcp' &&
        artifact.lifecycle === 'active' &&
        artifact.locator.type === 'mcp-server' &&
        (scope.kind === 'shared'
          ? artifact.scope.kind === 'global'
          : artifact.scope.kind === 'provider-overlay' && artifact.scope.provider === scope.provider))
      .map((artifact) => artifact.locator.type === 'mcp-server' ? artifact.locator.serverName : ''),
  );
  return Object.fromEntries(Object.entries(definitions).filter(([id]) => activeIds.has(id)));
}

export function filterMcpDefinitionsForProvider(
  definitions: Record<string, McpServerDefinition>,
  config: RegletConfig,
  provider: ProviderName,
): Record<string, McpServerDefinition> {
  return Object.fromEntries(
    Object.entries(definitions).filter(([id]) => syncProvidersFor(config, 'mcp', id).includes(provider)),
  );
}

export function resolveEffectiveMcpDefinitions(
  shared: Record<string, McpServerDefinition>,
  providerDefinitions: Record<string, McpServerDefinition>,
  provider: ProviderName,
): EffectiveMcpServerEntry[] {
  return effectiveMcpDefinitions(shared, providerDefinitions, provider);
}

export function validateMcpServer(name: string, server: unknown): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  try {
    validateMcpId(name);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  if (!isRecord(server)) {
    return { ok: false, issues: [...issues, 'server must be an object'] };
  }

  const supportedFields = new Set(['command', 'args', 'env', 'url', 'enabled', 'disabled']);
  for (const field of Object.keys(server)) {
    if (!supportedFields.has(field)) {
      issues.push(`unsupported field ${field} may alter security or provider behavior`);
    }
  }

  if (server.enabled !== undefined && typeof server.enabled !== 'boolean') {
    issues.push('enabled must be a boolean');
  }
  if (server.disabled !== undefined && typeof server.disabled !== 'boolean') {
    issues.push('disabled must be a boolean');
  }

  const command = server.command;
  const args = server.args;
  const env = server.env;
  const url = server.url;
  const hasCommand = typeof command === 'string' && command.trim().length > 0;
  const hasUrl = typeof url === 'string' && url.trim().length > 0;

  if ((hasCommand ? 1 : 0) + (hasUrl ? 1 : 0) !== 1) {
    issues.push('exactly one transport is required: command or url');
  }
  if (command !== undefined && typeof command !== 'string') issues.push('command must be a string');
  if (args !== undefined && (!Array.isArray(args) || args.some((item) => typeof item !== 'string'))) {
    issues.push('args must be a string array');
  }
  if (env !== undefined) {
    if (!isRecord(env)) {
      issues.push('env must be an object of process-env or keychain references');
    } else {
      for (const [key, value] of Object.entries(env)) {
        if (!isMcpEnvName(key)) {
          issues.push(`env key must be a valid environment variable name: ${key}`);
        } else if (typeof value === 'string') {
          issues.push(`env.${key} must be a process-env reference, not a raw string`);
        } else if (!isMcpEnvironmentValue(value)) {
          issues.push(`env.${key} must be a process-env or keychain reference`);
        } else if (value.source === 'process-env' && !isMcpEnvName(value.name)) {
          issues.push(`env.${key}.name must be a valid environment variable name`);
        }
      }
    }
  }
  if (url !== undefined && typeof url !== 'string') issues.push('url must be a string');
  if (hasUrl && !isHttpUrl(url)) issues.push('url must be a valid http/https URL');

  return { ok: issues.length === 0, issues };
}

export function serializeMcpServers(servers: Record<string, McpServerDef>): string {
  const sorted: Record<string, McpServerDef> = {};
  for (const name of Object.keys(servers).sort((left, right) => left.localeCompare(right))) {
    sorted[name] = normalizeMcpServer(servers[name] ?? {});
  }
  return `${JSON.stringify({ mcpServers: sorted }, null, 2)}\n`;
}

export function serializeMcpDefinitions(servers: Record<string, McpServerDefinition>): string {
  const sorted: Record<string, unknown> = {};
  for (const id of Object.keys(servers).sort((left, right) => left.localeCompare(right))) {
    const definition = servers[id];
    if (definition !== undefined) sorted[id] = serializeMcpServerDefinition(id, definition);
  }
  return `${JSON.stringify({ mcpServers: sorted }, null, 2)}\n`;
}

export function redactMcpServer(server: McpServerDef): McpServerDef {
  if (server.env === undefined) return server;
  const env: Record<string, McpEnvironmentValue> = {};
  for (const key of Object.keys(server.env).sort((left, right) => left.localeCompare(right))) {
    const reference = server.env[key];
    if (reference !== undefined) {
      // The variable name is configuration, not credential material. Keeping it visible
      // lets people configure the required local process environment without revealing
      // the resolved value.
      env[key] = reference.source === 'process-env'
        ? { source: 'process-env', name: reference.name, ...(reference.required === undefined ? {} : { required: reference.required }) }
        : reference.source === 'oauth'
          ? { source: 'oauth', provider: reference.provider, ...(reference.required === undefined ? {} : { required: reference.required }) }
          : { source: 'keychain', id: reference.id, ...(reference.required === undefined ? {} : { required: reference.required }) };
    }
  }
  return { ...server, env };
}

export function redactMcpServers(servers: Record<string, McpServerDef>): Record<string, McpServerDef> {
  return Object.fromEntries(
    Object.entries(servers)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, server]) => [name, redactMcpServer(server)]),
  );
}

export function resolveMcpServersEnv(
  servers: Record<string, McpServerDef>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, ResolvedMcpServerDef> {
  const resolved: Record<string, ResolvedMcpServerDef> = {};
  for (const [name, server] of Object.entries(servers)) {
    const validation = validateMcpServer(name, server);
    if (!validation.ok) {
      throw new Error(`Invalid MCP server ${name}: ${validation.issues.join('; ')}`);
    }
    resolved[name] = resolveMcpServerEnv(name, server, env);
  }
  return resolved;
}

export async function resolveMcpServersSecrets(
  servers: Record<string, McpServerDef>,
  env: NodeJS.ProcessEnv = process.env,
  secretStore: SecretStore = systemSecretStore(),
): Promise<Record<string, ResolvedMcpServerDef>> {
  const resolved: Record<string, ResolvedMcpServerDef> = {};
  for (const [name, server] of Object.entries(servers)) {
    const validation = validateMcpServer(name, server);
    if (!validation.ok) {
      throw new Error(`Invalid MCP server ${name}: ${validation.issues.join('; ')}`);
    }
    resolved[name] = await resolveMcpServerSecrets(name, server, env, secretStore);
  }
  return resolved;
}

export function mcpEnvironmentDigest(
  servers: Record<string, McpServerDef>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, Record<string, string>> {
  const digestInput: Record<string, Record<string, string>> = {};
  for (const [serverName, server] of Object.entries(servers).sort(([left], [right]) => left.localeCompare(right))) {
    if (server.env === undefined) continue;
    const serverEnv: Record<string, string> = {};
    for (const [outputKey, ref] of Object.entries(server.env).sort(([left], [right]) => left.localeCompare(right))) {
      const identity = ref.source === 'process-env' ? ref.name : ref.source === 'oauth' ? ref.provider : ref.id;
      const value = ref.source === 'process-env' ? env[ref.name] : '<credential-store>';
      serverEnv[outputKey] = sha256String(
        `reglet:mcp-env:v2\u0000${serverName}\u0000${outputKey}\u0000${ref.source}\u0000${identity}\u0000${value === undefined ? '<missing>' : value}`,
      );
    }
    digestInput[serverName] = serverEnv;
  }
  return digestInput;
}

export function effectiveMcpEnvironmentDigest(
  entries: readonly EffectiveMcpServerEntry[],
  env: NodeJS.ProcessEnv = process.env,
): Record<string, Record<string, string>> {
  const servers = Object.fromEntries(entries.map((entry) => [entry.id, entry.server]));
  return mcpEnvironmentDigest(servers, env);
}

export function hasMcpEnv(server: ResolvedMcpServerDef): boolean {
  return server.env !== undefined && Object.keys(server.env).length > 0;
}

export function isCanonicalMcpServerDef(name: string, server: unknown): server is McpServerDef {
  return validateMcpServer(name, server).ok;
}

export function mcpServersPathForScope(home: string, scope: McpScope): string {
  return mcpServersPath(home, scope);
}

function mcpServersPath(home: string, scope: McpScope): string {
  return scope.kind === 'shared'
    ? path.join(home, 'mcp', 'servers.json')
    : path.join(home, 'mcp', 'providers', scope.provider, 'servers.json');
}

async function readMcpServersFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    if (!isRecord(parsed) || !isRecord((parsed as McpServersFile).mcpServers)) return {};
    return { ...(parsed as McpServersFile).mcpServers };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeMcpServersFile(filePath: string, servers: Record<string, McpFileEntry>): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeMcpDefinitions(definitionsFromRaw(servers)));
}

function canonicalMcpServersOrThrow(servers: Record<string, unknown>): Record<string, McpFileEntry> {
  const canonical: Record<string, McpFileEntry> = {};
  for (const [id, entry] of Object.entries(servers)) {
    if (!isCanonicalMcpServerFileEntry(id, entry)) {
      const definition = parseMcpServerFileEntry(id, entry);
      const validation = validateMcpServer(id, definition?.server);
      throw new Error(`Invalid MCP server ${id}: ${validation.issues.join('; ')}`);
    }
    const definition = parseMcpServerFileEntry(id, entry);
    if (definition !== null) canonical[id] = { displayName: definition.displayName, server: normalizeMcpServer(definition.server) };
  }
  return canonical;
}

function validateMcpId(name: string): void {
  if (name.length === 0 || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`Invalid MCP server id: ${name}`);
  }
}

function validateMcpDisplayName(displayName: string): void {
  if (displayName.trim().length === 0 || displayName.includes('/') || displayName.includes('\\')) {
    throw new Error(`Invalid MCP server display name: ${displayName}`);
  }
}

function normalizeMcpServer(server: McpServerDef): McpServerDef {
  if (typeof server.url === 'string' && server.url.trim().length > 0) {
    return { url: server.url.trim() };
  }
  const normalized: McpServerDef = { command: server.command?.trim() ?? '' };
  if (server.args !== undefined) normalized.args = [...server.args];
  if (server.env !== undefined) {
    normalized.env = Object.fromEntries(Object.entries(server.env).sort(([left], [right]) => left.localeCompare(right)));
  }
  return normalized;
}

function coerceMcpServerDef(value: unknown): McpServerDef {
  if (!isRecord(value)) return {};
  const server: McpServerDef = {};
  if (typeof value.command === 'string') server.command = value.command;
  if (Array.isArray(value.args) && value.args.every((item) => typeof item === 'string')) server.args = value.args;
  if (isRecord(value.env)) {
    const env = Object.fromEntries(
      Object.entries(value.env).filter(([, item]) => isMcpEnvironmentValue(item)),
    ) as Record<string, McpEnvironmentValue>;
    if (Object.keys(env).length > 0) server.env = env;
  }
  if (typeof value.url === 'string') server.url = value.url;
  return server;
}

function resolveMcpServerEnv(
  serverName: string,
  server: McpServerDef,
  env: NodeJS.ProcessEnv,
): ResolvedMcpServerDef {
  if (server.env === undefined) {
    return {
      ...(server.command === undefined ? {} : { command: server.command }),
      ...(server.args === undefined ? {} : { args: server.args }),
      ...(server.url === undefined ? {} : { url: server.url }),
    };
  }
  const resolvedEnv: Record<string, string> = {};
  const missingProcessEnvironment: string[] = [];
  const missingKeychainBindings: string[] = [];
  for (const [key, ref] of Object.entries(server.env)) {
    if (ref.source === 'keychain') {
      if (ref.required !== false) missingKeychainBindings.push(`${key}:${ref.id}`);
      continue;
    }
    if (ref.source === 'oauth') {
      if (ref.required !== false) missingKeychainBindings.push(`${key}:oauth:${ref.provider}`);
      continue;
    }
    const value = env[ref.name];
    if (value === undefined && ref.required !== false) {
      missingProcessEnvironment.push(`${key}:${ref.name}`);
    } else {
      if (value !== undefined) resolvedEnv[key] = value;
    }
  }
  if (missingKeychainBindings.length > 0) {
    throw new Error(
      `Missing secret bindings for MCP server ${serverName}: ${[
        ...missingProcessEnvironment.map((item) => `process-env:${item}`),
        ...missingKeychainBindings.map((item) => `keychain:${item}`),
      ].join(', ')}`,
    );
  }
  if (missingProcessEnvironment.length > 0) {
    throw new Error(`Missing process environment for MCP server ${serverName}: ${missingProcessEnvironment.join(', ')}`);
  }
  return { ...server, env: resolvedEnv };
}

async function resolveMcpServerSecrets(
  serverName: string,
  server: McpServerDef,
  env: NodeJS.ProcessEnv,
  secretStore: SecretStore,
): Promise<ResolvedMcpServerDef> {
  if (server.env === undefined) return resolveMcpServerEnv(serverName, server, env);
  const resolvedEnv: Record<string, string> = {};
  const missingProcessEnvironment: string[] = [];
  const missingKeychainBindings: string[] = [];
  for (const [key, reference] of Object.entries(server.env)) {
    let value: string | undefined;
    if (reference.source === 'process-env') {
      value = env[reference.name];
    } else if (reference.source === 'oauth') {
      const provider = reference.provider.toLowerCase();
      value = (await secretStore.resolve(`oauth-${provider}`)) ?? (await secretStore.resolve(`${provider}-token`));
    } else {
      value = await secretStore.resolve(reference.id);
    }
    if (value === undefined) {
      if (reference.required !== false) {
        if (reference.source === 'process-env') {
          missingProcessEnvironment.push(`${key}:${reference.name}`);
        } else if (reference.source === 'oauth') {
          missingKeychainBindings.push(`${key}:oauth:${reference.provider}`);
        } else {
          missingKeychainBindings.push(`${key}:${reference.id}`);
        }
      }
    } else {
      resolvedEnv[key] = value;
    }
  }
  if (missingProcessEnvironment.length > 0 && missingKeychainBindings.length === 0) {
    throw new Error(`Missing process environment for MCP server ${serverName}: ${missingProcessEnvironment.join(', ')}`);
  }
  if (missingProcessEnvironment.length > 0 || missingKeychainBindings.length > 0) {
    throw new Error(
      `Missing secret bindings for MCP server ${serverName}: ${[
        ...missingProcessEnvironment.map((item) => `process-env:${item}`),
        ...missingKeychainBindings.map((item) => `keychain:${item}`),
      ].join(', ')}`,
    );
  }
  return {
    ...(server.command === undefined ? {} : { command: server.command }),
    ...(server.args === undefined ? {} : { args: server.args }),
    ...(server.url === undefined ? {} : { url: server.url }),
    ...(Object.keys(resolvedEnv).length === 0 ? {} : { env: resolvedEnv }),
  };
}

function isMcpEnvironmentValue(value: unknown): value is McpEnvironmentValue {
  return isSecretRef(value);
}

function definitionsFromRaw(raw: Record<string, unknown>, includeInvalid = true): Record<string, McpServerDefinition> {
  const definitions: Record<string, McpServerDefinition> = {};
  for (const [id, entry] of Object.entries(raw)) {
    const definition = parseMcpServerFileEntry(id, entry);
    if (definition !== null && (includeInvalid || validateMcpDefinition(id, definition).length === 0)) definitions[id] = definition;
  }
  return definitions;
}

function parseMcpServerFileEntry(id: string, entry: unknown): McpServerDefinition | null {
  if (
    isRecord(entry) &&
    Object.keys(entry).every((key) => key === 'displayName' || key === 'server') &&
    typeof entry.displayName === 'string' &&
    isRecord(entry.server)
  ) {
    return { id, displayName: entry.displayName, server: entry.server as McpServerDef };
  }
  if (isRecord(entry)) {
    return { id, displayName: id, server: entry as McpServerDef };
  }
  return null;
}

function serializeMcpServerDefinition(id: string, definition: Pick<McpServerDefinition, 'displayName' | 'server'>): McpServerDef | McpFileEntry {
  const normalized = normalizeMcpServer(definition.server);
  return definition.displayName === id ? normalized : { displayName: definition.displayName, server: normalized };
}

function isCanonicalMcpServerFileEntry(id: string, entry: unknown): boolean {
  const definition = parseMcpServerFileEntry(id, entry);
  return definition !== null && validateMcpDefinition(id, definition).length === 0;
}

function effectiveMcpDefinitions(
  shared: Record<string, McpServerDefinition>,
  scoped: Record<string, McpServerDefinition>,
  provider: ProviderName,
): EffectiveMcpServerEntry[] {
  const entries: EffectiveMcpServerEntry[] = [];
  const seen = new Set<string>();
  for (const id of Object.keys(shared).sort((left, right) => left.localeCompare(right))) {
    const definition = scoped[id] ?? shared[id];
    if (definition === undefined) continue;
    seen.add(id);
    entries.push(toEffectiveEntry(id, definition, scoped[id] === undefined ? sharedMcpScope() : providerMcpScope(provider), scoped[id] === undefined ? null : id));
  }
  for (const id of Object.keys(scoped).sort((left, right) => left.localeCompare(right))) {
    if (seen.has(id)) continue;
    const definition = scoped[id];
    if (definition !== undefined) entries.push(toEffectiveEntry(id, definition, providerMcpScope(provider), null));
  }
  return withConflictStatus(entries);
}

function toEffectiveEntry(
  id: string,
  definition: McpServerDefinition,
  scope: McpScope,
  overrideOf: string | null,
): EffectiveMcpServerEntry {
  return {
    id,
    displayName: definition.displayName,
    server: definition.server,
    scope,
    overrideOf,
    issues: validateMcpDefinition(id, definition),
    conflictStatus: { state: 'none' },
  };
}

function validateMcpDefinition(id: string, definition: Pick<McpServerDefinition, 'displayName' | 'server'>): string[] {
  const issues = [...validateMcpServer(id, definition.server).issues];
  try {
    validateMcpDisplayName(definition.displayName);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return issues;
}

function withConflictStatus(entries: EffectiveMcpServerEntry[]): EffectiveMcpServerEntry[] {
  const byName = new Map<string, string[]>();
  for (const entry of entries) {
    byName.set(entry.displayName, [...(byName.get(entry.displayName) ?? []), entry.id]);
  }
  return entries.map((entry) => {
    const conflictingIds = byName.get(entry.displayName) ?? [];
    return {
      ...entry,
      conflictStatus: conflictingIds.length <= 1
        ? { state: 'none' }
        : { state: 'conflict', displayName: entry.displayName, conflictingIds: [...conflictingIds].sort((left, right) => left.localeCompare(right)) },
    };
  });
}

function isMcpEnvName(value: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeScopeArgs(scopeOrHome: McpScope | string, maybeHome?: string): { scope: McpScope; home: string } {
  if (typeof scopeOrHome === 'string') return { scope: sharedMcpScope(), home: scopeOrHome };
  return { scope: scopeOrHome, home: maybeHome ?? regletHome() };
}
