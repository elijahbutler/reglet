import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { McpServerDef } from './master.js';
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
  servers[name] = normalizeMcpServer(server);
  await writeMcpServersFile(serversPath, servers);
  return { path: serversPath, name };
}

export async function deleteMcpServer(name: string, home = regletHome()): Promise<McpMutationResult> {
  validateMcpName(name);
  const serversPath = mcpServersPath(home);
  const servers = await readMcpServersFile(serversPath);
  delete servers[name];
  await writeMcpServersFile(serversPath, servers);
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
  if (env !== undefined && (!isRecord(env) || Object.entries(env).some(([key, value]) => key.length === 0 || typeof value !== 'string'))) {
    issues.push('env must be an object of string values');
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
  const env: Record<string, string> = {};
  for (const key of Object.keys(server.env).sort((left, right) => left.localeCompare(right))) {
    env[key] = server.env[key] === '' ? '' : `<redacted:${key}>`;
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

function mcpServersPath(home: string): string {
  return path.join(home, 'mcp', 'servers.json');
}

async function readMcpServersFile(filePath: string): Promise<Record<string, McpServerDef>> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    if (!isRecord(parsed) || !isRecord((parsed as McpServersFile).mcpServers)) return {};
    const result: Record<string, McpServerDef> = {};
    for (const [name, server] of Object.entries((parsed as McpServersFile).mcpServers ?? {})) {
      result[name] = coerceMcpServerDef(server);
    }
    return result;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeMcpServersFile(filePath: string, servers: Record<string, McpServerDef>): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeMcpServers(servers));
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
  if (isRecord(value.env) && Object.values(value.env).every((item) => typeof item === 'string')) {
    server.env = value.env as Record<string, string>;
  }
  if (typeof value.url === 'string') server.url = value.url;
  return server;
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
