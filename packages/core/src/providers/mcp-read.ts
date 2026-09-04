import { readFile } from 'node:fs/promises';
import { parse as parseToml } from 'smol-toml';
import type { McpServerDef, ResolvedMcpServerDef } from '../master.js';
import { isNodeError, isRecord } from './common.js';
import type { ProviderId } from './types.js';

/** Reads a provider's current MCP servers in master `McpServerDef` form. */
export async function readProviderMcpServers(
  provider: ProviderId,
  mcpPath: string,
): Promise<Record<string, McpServerDef | ResolvedMcpServerDef>> {
  if (provider === 'codex') {
    return readCodexMcpServers(mcpPath);
  }

  if (provider === 'opencode') {
    return readOpenCodeMcpServers(mcpPath);
  }

  return readJsonMcpServers(mcpPath);
}

async function readJsonMcpServers(mcpPath: string): Promise<Record<string, McpServerDef | ResolvedMcpServerDef>> {
  const config = await readJsonObject(mcpPath);
  if (!isRecord(config.mcpServers)) {
    return {};
  }
  return normalizeMcpServers(config.mcpServers);
}

async function readCodexMcpServers(mcpPath: string): Promise<Record<string, McpServerDef | ResolvedMcpServerDef>> {
  try {
    const parsed = parseToml(await readFile(mcpPath, 'utf8')) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.mcp_servers)) {
      return {};
    }
    return normalizeMcpServers(parsed.mcp_servers);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function readOpenCodeMcpServers(mcpPath: string): Promise<Record<string, McpServerDef | ResolvedMcpServerDef>> {
  const config = await readJsonObject(mcpPath);
  if (!isRecord(config.mcp)) {
    return {};
  }

  const servers: Record<string, McpServerDef | ResolvedMcpServerDef> = {};
  for (const [name, server] of Object.entries(config.mcp)) {
    const normalized = normalizeOpenCodeServer(server);
    if (normalized !== null) {
      servers[name] = normalized;
    }
  }
  return servers;
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function normalizeMcpServers(value: Record<string, unknown>): Record<string, McpServerDef | ResolvedMcpServerDef> {
  const servers: Record<string, McpServerDef | ResolvedMcpServerDef> = {};
  for (const [name, server] of Object.entries(value)) {
    if (isMcpServerDef(server)) {
      const canonical: Record<string, unknown> = {};
      if (typeof server.command === 'string') canonical.command = server.command;
      if (typeof server.url === 'string') canonical.url = server.url;
      if (Array.isArray(server.args)) canonical.args = [...server.args];
      if (isRecord(server.env)) canonical.env = { ...server.env };
      servers[name] = canonical as McpServerDef | ResolvedMcpServerDef;
    }
  }
  return servers;
}

function normalizeOpenCodeServer(value: unknown): McpServerDef | ResolvedMcpServerDef | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  if (value.type === 'remote' && typeof value.url === 'string') {
    return { url: value.url };
  }

  if (
    value.type !== 'local' ||
    !Array.isArray(value.command) ||
    !value.command.every((item) => typeof item === 'string')
  ) {
    return null;
  }

  const [command, ...args] = value.command;
  if (command === undefined) {
    return null;
  }

  return {
    command,
    ...(args.length === 0 ? {} : { args }),
    ...(isStringRecord(value.environment) ? { env: value.environment } : {}),
  };
}

function isMcpServerDef(value: unknown): value is McpServerDef | ResolvedMcpServerDef {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isOptionalString(value.command) &&
    isOptionalStringArray(value.args) &&
    isOptionalStringRecord(value.env) &&
    isOptionalString(value.url)
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function isOptionalStringRecord(value: unknown): boolean {
  return value === undefined || isStringRecord(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}
