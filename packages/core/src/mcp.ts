import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256String } from './fsutil.js';
import type { McpEnvironmentValue, McpServerDef, ResolvedMcpServerDef } from './master.js';
import { regletHome } from './paths.js';

export interface McpServerEntry {
  name: string;
  server: McpServerDef;
  issues: string[];
}

export interface McpListResult {
  path: string;
  servers: McpServerEntry[];
}

export interface McpMutationResult {
  path: string;
  name: string;
}

interface McpServersFile {
  mcpServers?: Record<string, unknown>;
}

export async function listMcpServers(home = regletHome()): Promise<McpListResult> {
  const serversPath = mcpServersPath(home);
  const raw = await readMcpServersFile(serversPath);
  return {
    path: serversPath,
    servers: Object.entries(raw)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, server]) => {
        const validation = validateMcpServer(name, server);
        return { name, server: coerceMcpServerDef(server), issues: validation.issues };
      }),
  };
}

export async function readMcpServer(name: string, home = regletHome()): Promise<McpServerEntry> {
  validateMcpName(name);
  const servers = await readMcpServersFile(mcpServersPath(home));
  if (!(name in servers)) throw new Error(`MCP server does not exist: ${name}`);
  const server = servers[name];
  const validation = validateMcpServer(name, server);
  return { name, server: coerceMcpServerDef(server), issues: validation.issues };
}

export async function upsertMcpServer(name: string, server: McpServerDef, home = regletHome()): Promise<McpMutationResult> {
  const validation = validateMcpServer(name, server);
  if (!validation.ok) throw new Error(`Invalid MCP server: ${validation.issues.join('; ')}`);
  const serversPath = mcpServersPath(home);
  const servers = await readMcpServersFile(serversPath);
  if (name in servers && !isCanonicalMcpServerDef(name, servers[name])) {
    throw new Error(
      `Cannot overwrite invalid legacy MCP server ${name}; delete it explicitly, then recreate it using process environment references`,
    );
  }
  servers[name] = normalizeMcpServer(server);
  await writeMcpServersFile(serversPath, canonicalMcpServersOrThrow(servers));
  return { path: serversPath, name };
}

export async function deleteMcpServer(name: string, home = regletHome()): Promise<McpMutationResult> {
  validateMcpName(name);
  const serversPath = mcpServersPath(home);
  const servers = await readMcpServersFile(serversPath);
  delete servers[name];
  await writeMcpServersFile(serversPath, canonicalMcpServersOrThrow(servers));
  return { path: serversPath, name };
}

export function validateMcpServer(name: string, server: unknown): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  try {
    validateMcpName(name);
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
  if (hasCommand && path.isAbsolute(command)) issues.push('command must be a command name, not an absolute path');
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

export function hasMcpEnv(server: ResolvedMcpServerDef): boolean {
  return server.env !== undefined && Object.keys(server.env).length > 0;
}

export function isCanonicalMcpServerDef(name: string, server: unknown): server is McpServerDef {
  return validateMcpServer(name, server).ok;
}

function mcpServersPath(home: string): string {
  return path.join(home, 'mcp', 'servers.json');
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

async function writeMcpServersFile(filePath: string, servers: Record<string, McpServerDef>): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeMcpServers(servers));
}

function canonicalMcpServersOrThrow(servers: Record<string, unknown>): Record<string, McpServerDef> {
  const canonical: Record<string, McpServerDef> = {};
  for (const [name, server] of Object.entries(servers)) {
    if (!isCanonicalMcpServerDef(name, server)) {
      const validation = validateMcpServer(name, server);
      throw new Error(`Invalid MCP server ${name}: ${validation.issues.join('; ')}`);
    }
    canonical[name] = normalizeMcpServer(server);
  }
  return canonical;
}

function validateMcpName(name: string): void {
  if (name.length === 0 || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`Invalid MCP server name: ${name}`);
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
