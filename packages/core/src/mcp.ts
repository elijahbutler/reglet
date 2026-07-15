import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { providerNames, type ProviderName } from './config.js';
import { sha256String } from './fsutil.js';
import type { McpEnvironmentValue, McpServerDef, ResolvedMcpServerDef } from './master.js';
import { regletHome } from './paths.js';

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
  const serversPath = mcpServersPath(home, scope);
  const raw = await readMcpServersFile(serversPath);
  const definitions = definitionsFromRaw(raw);
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
        return {
          id,
          name: definition.displayName,
          displayName: definition.displayName,
          scope,
          server: coerceMcpServerDef(definition.server),
          issues,
          overrideOf: scope.kind === 'provider' && sharedDefinitions[id] !== undefined ? id : null,
          affectedProviders: scope.kind === 'shared'
            ? providerNames.filter((provider) => providerDefinitions[provider]?.[id] === undefined)
            : [scope.provider],
          conflictStatus: { state: 'none' },
        };
      }),
  };
}

export async function readMcpServer(id: string, scopeOrHome: McpScope | string = sharedMcpScope(), maybeHome?: string): Promise<McpServerEntry> {
  const { scope, home } = normalizeScopeArgs(scopeOrHome, maybeHome);
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
    affectedProviders,
    conflictStatus: { state: 'none' },
  };
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
  const shared = definitionsFromRaw(await readMcpServersFile(mcpServersPath(home, sharedMcpScope())));
  const scoped = definitionsFromRaw(await readMcpServersFile(mcpServersPath(home, providerMcpScope(provider))));
  return effectiveMcpDefinitions(shared, scoped, provider);
}

export async function resolveEffectiveMcpServersEnv(
  provider: ProviderName,
  home = regletHome(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, ResolvedMcpServerDef>> {
  const effective = await listEffectiveMcpServers(provider, home);
  const conflict = effective.find((entry) => entry.conflictStatus.state === 'conflict');
  if (conflict !== undefined && conflict.conflictStatus.state === 'conflict') {
    throw new Error(
      `MCP display-name conflict for ${provider}: ${conflict.conflictStatus.displayName} is used by ${conflict.conflictStatus.conflictingIds.join(', ')}`,
    );
  }
  const servers: Record<string, McpServerDef> = {};
  for (const entry of effective) {
    if (entry.issues.length > 0) throw new Error(`Invalid MCP server ${entry.id}: ${entry.issues.join('; ')}`);
    servers[entry.displayName] = entry.server;
  }
  return resolveMcpServersEnv(servers, env);
}

export async function loadMcpDefinitions(home = regletHome()): Promise<{
  shared: Record<string, McpServerDefinition>;
  providers: Record<ProviderName, Record<string, McpServerDefinition>>;
}> {
  const providers = Object.fromEntries(
    await Promise.all(
      providerNames.map(async (provider) => [
        provider,
        definitionsFromRaw(await readMcpServersFile(mcpServersPath(home, providerMcpScope(provider))), false),
      ] as const),
    ),
  ) as Record<ProviderName, Record<string, McpServerDefinition>>;
  return { shared: definitionsFromRaw(await readMcpServersFile(mcpServersPath(home, sharedMcpScope())), false), providers };
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
      issues.push('env must be an object of process environment references');
    } else {
      for (const [key, value] of Object.entries(env)) {
        if (!isMcpEnvName(key)) {
          issues.push(`env key must be a valid environment variable name: ${key}`);
        } else if (typeof value === 'string') {
          issues.push(`env.${key} must be a process-env reference, not a raw string`);
        } else if (!isMcpEnvironmentValue(value)) {
          issues.push(`env.${key} must be { source: "process-env", name: "LOCAL_VARIABLE" }`);
        } else if (!isMcpEnvName(value.name)) {
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
      env[key] = { source: reference.source, name: reference.name };
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

export function mcpEnvironmentDigest(
  servers: Record<string, McpServerDef>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, Record<string, string>> {
  const digestInput: Record<string, Record<string, string>> = {};
  for (const [serverName, server] of Object.entries(servers).sort(([left], [right]) => left.localeCompare(right))) {
    if (server.env === undefined) continue;
    const serverEnv: Record<string, string> = {};
    for (const [outputKey, ref] of Object.entries(server.env).sort(([left], [right]) => left.localeCompare(right))) {
      const value = env[ref.name];
      serverEnv[outputKey] = sha256String(
        `reglet:mcp-env:v1\u0000${serverName}\u0000${outputKey}\u0000${ref.source}\u0000${ref.name}\u0000${value === undefined ? '<missing>' : value}`,
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
  const missing: string[] = [];
  for (const [key, ref] of Object.entries(server.env)) {
    const value = env[ref.name];
    if (value === undefined) {
      missing.push(`${key}:${ref.name}`);
    } else {
      resolvedEnv[key] = value;
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing process environment for MCP server ${serverName}: ${missing.join(', ')}`);
  }
  return { ...server, env: resolvedEnv };
}

function isMcpEnvironmentValue(value: unknown): value is McpEnvironmentValue {
  return isRecord(value) && value.source === 'process-env' && typeof value.name === 'string';
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
