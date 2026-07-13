import { readFile } from 'node:fs/promises';
import { parse, stringify } from 'smol-toml';
import { safeWriteFile } from '../engine/writer.js';
import type { ManagedContent } from '../manifest.js';
import { getOutput } from '../manifest.js';
import type { ResolvedMcpServerDef } from '../master.js';
import { isNodeError, isRecord } from './common.js';
import type { ApplyContext, ApplyResult } from './types.js';

type TomlPrimitive = string | number | boolean | Date;
type TomlValue = TomlPrimitive | TomlValue[] | TomlTable;
interface TomlTable {
  [key: string]: TomlValue | undefined;
}

interface CodexMcpServerTable extends TomlTable {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export async function applyCodexMcp(
  outputPath: string,
  servers: Record<string, ResolvedMcpServerDef>,
  ctx: ApplyContext,
): Promise<ApplyResult> {
  const previous = await getOutput(outputPath, ctx.home);
  const previousManagedKeys = previous?.managedKeys ?? [];
  const config = await readTomlObject(outputPath);
  const existingServers = readServerTable(config.mcp_servers);

  for (const key of previousManagedKeys) {
    delete existingServers[key];
  }

  for (const [name, server] of Object.entries(servers)) {
    existingServers[name] = toCodexServer(server);
  }

  const nextConfig: TomlTable = {
    ...config,
    mcp_servers: existingServers,
  };
  const managedKeys = Object.keys(servers).sort((left, right) => left.localeCompare(right));
  const content = stringify(nextConfig);

  const writeResult = await safeWriteFile({
    outputPath,
    content,
    provider: 'codex',
    managedContent: 'mcp' satisfies ManagedContent,
    dryRun: ctx.dryRun,
    managedKeys,
    home: ctx.home,
    operation: ctx.operation,
    masterRevision: ctx.masterRevision,
    compositionRevision: ctx.compositionRevision,
  });

  return {
    provider: 'codex',
    content: 'mcp',
    outputPath,
    status: writeResult.status,
    managedKeys,
  };
}

export async function readCodexMcpServerNames(outputPath: string | null): Promise<string[]> {
  if (outputPath === null) {
    return [];
  }

  return Object.keys(readServerTable((await readTomlObject(outputPath)).mcp_servers)).sort((left, right) =>
    left.localeCompare(right),
  );
}

async function readTomlObject(filePath: string): Promise<TomlTable> {
  try {
    const parsed = parse(await readFile(filePath, 'utf8')) as unknown;
    return isRecord(parsed) ? (parsed as TomlTable) : {};
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function readServerTable(value: TomlValue | undefined): Record<string, CodexMcpServerTable> {
  if (!isRecord(value)) {
    return {};
  }

  const servers: Record<string, CodexMcpServerTable> = {};
  for (const [name, server] of Object.entries(value)) {
    if (isRecord(server)) {
      servers[name] = { ...(server as TomlTable) } as CodexMcpServerTable;
    }
  }
  return servers;
}

function toCodexServer(server: ResolvedMcpServerDef): CodexMcpServerTable {
  return {
    ...(server.command === undefined ? {} : { command: server.command }),
    ...(server.url === undefined ? {} : { url: server.url }),
    ...(server.args === undefined ? {} : { args: server.args }),
    ...(server.env === undefined ? {} : { env: server.env }),
  };
}
