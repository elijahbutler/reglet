import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { McpEnvironmentValue, McpServerDef } from '../master.js';
import { isSecretRef } from '../security/secrets.js';
import { extractMcpMachineOverrides, type McpMachineOverride } from './mcp-overrides.js';

export interface ProjectMcpIssue {
  code: 'invalid-source' | 'credential-extracted' | 'unsupported-field';
  severity: 'warning' | 'error';
  message: string;
}

export interface ProjectMcpServerCandidate {
  name: string;
  definition: McpServerDef;
  machineOverrides: McpMachineOverride[];
  secretReferenceIds: string[];
  issues: ProjectMcpIssue[];
}

/** Normalizes project MCP formats without retaining literal environment values. */
export function parseProjectMcpServers(
  content: string,
  sourcePath: string,
  projectRoot: string,
): ProjectMcpServerCandidate[] {
  const root = parseProjectDocument(content, sourcePath);
  const rawServers = serverRecord(root);
  return Object.entries(rawServers).map(([name, value]) => normalizeServer(name, value, projectRoot));
}

function parseProjectDocument(content: string, sourcePath: string): Record<string, unknown> {
  try {
    const parsed = sourcePath.endsWith('.toml')
      ? parseToml(content) as unknown
      : JSON.parse(sourcePath.endsWith('.jsonc') ? stripJsonComments(content) : content) as unknown;
    if (!isRecord(parsed)) throw new Error('Project MCP root must be an object.');
    return parsed;
  } catch (error) {
    throw new Error(error instanceof Error ? `Invalid project MCP file: ${error.message}` : 'Invalid project MCP file.');
  }
}

function serverRecord(root: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(root.mcpServers)) return root.mcpServers;
  if (isRecord(root.mcp_servers)) return root.mcp_servers;
  if (isRecord(root.mcp)) return root.mcp;
  return {};
}

function normalizeServer(name: string, value: unknown, projectRoot: string): ProjectMcpServerCandidate {
  if (!isRecord(value)) {
    return {
      name,
      definition: {},
      machineOverrides: [],
      secretReferenceIds: [],
      issues: [{ code: 'invalid-source', severity: 'error', message: 'MCP server definition must be an object.' }],
    };
  }
  const source = isRecord(value.server) ? value.server : value;
  const commandArray = Array.isArray(source.command) && source.command.every((item) => typeof item === 'string')
    ? source.command
    : undefined;
  const command = typeof source.command === 'string' ? source.command : commandArray?.[0];
  const args = Array.isArray(source.args) && source.args.every((item) => typeof item === 'string')
    ? source.args
    : commandArray?.slice(1);
  const url = typeof source.url === 'string' ? source.url : undefined;
  const rawEnvironment = isRecord(source.env)
    ? source.env
    : isRecord(source.environment)
      ? source.environment
      : {};
  const env: Record<string, McpEnvironmentValue> = {};
  const issues: ProjectMcpIssue[] = [];
  const secretReferenceIds: string[] = [];
  for (const [key, raw] of Object.entries(rawEnvironment)) {
    if (isSecretRef(raw)) {
      env[key] = raw;
      secretReferenceIds.push(raw.source === 'keychain' ? raw.id : raw.source === 'oauth' ? raw.provider : raw.name);
      continue;
    }
    if (typeof raw !== 'string') {
      issues.push({ code: 'unsupported-field', severity: 'error', message: `Environment field ${key} is not a string or secret reference.` });
      continue;
    }
    const processName = environmentPlaceholder(raw);
    if (processName !== undefined) {
      env[key] = { source: 'process-env', name: processName, required: true };
      secretReferenceIds.push(processName);
      continue;
    }
    const id = `${normalizeId(name)}-${normalizeId(key)}`.slice(0, 128);
    env[key] = { source: 'keychain', id, required: true };
    secretReferenceIds.push(id);
    issues.push({
      code: 'credential-extracted',
      severity: 'warning',
      message: `Environment field ${key} was converted to an unbound keychain reference.`,
    });
  }
  if (isRecord(source.headers) && Object.keys(source.headers).length > 0) {
    issues.push({
      code: 'unsupported-field',
      severity: 'error',
      message: 'HTTP header bindings require a provider-safe header projection and were not imported.',
    });
  }
  const base: McpServerDef = {
    ...(command === undefined ? {} : { command }),
    ...(args === undefined ? {} : { args }),
    ...(url === undefined ? {} : { url }),
    ...(Object.keys(env).length === 0 ? {} : { env }),
  };
  if ((command === undefined) === (url === undefined)) {
    issues.push({ code: 'invalid-source', severity: 'error', message: 'MCP server must define exactly one command or URL transport.' });
  }
  const extracted = extractMcpMachineOverrides(base, path.resolve(projectRoot));
  return {
    name,
    definition: extracted.definition,
    machineOverrides: extracted.overrides,
    secretReferenceIds: [...new Set(secretReferenceIds)],
    issues,
  };
}

function environmentPlaceholder(value: string): string | undefined {
  const match = value.match(/^\$\{?([A-Z_][A-Z0-9_]*)\}?$/);
  return match?.[1];
}

function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'secret';
}

function stripJsonComments(value: string): string {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index] ?? '';
    const next = value[index + 1];
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }
    if (current === '/' && next === '/') {
      while (index < value.length && value[index] !== '\n') index += 1;
      output += '\n';
      continue;
    }
    if (current === '/' && next === '*') {
      index += 2;
      while (index < value.length && !(value[index] === '*' && value[index + 1] === '/')) index += 1;
      index += 1;
      continue;
    }
    output += current;
  }
  return output.replace(/,\s*([}\]])/g, '$1');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
