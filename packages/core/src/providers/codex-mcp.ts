import { readFile } from 'node:fs/promises';
import { safeWriteFile } from '../engine/writer.js';
import { getOutput } from '../manifest.js';
import type { McpServerDef } from '../master.js';
import { isNodeError } from './common.js';
import type { ApplyContext, ApplyResult } from './types.js';

export async function applyCodexMcp(
  outputPath: string,
  servers: Record<string, McpServerDef>,
  ctx: ApplyContext,
): Promise<ApplyResult> {
  const previous = await getOutput(outputPath, ctx.home);
  const original = await readTextIfPresent(outputPath);
  const preserved = removeManagedTables(original, previous?.managedKeys ?? []);
  const rendered = Object.entries(servers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, server]) => renderCodexServer(name, server))
    .join('\n\n');
  const content = [preserved.trimEnd(), rendered]
    .filter((part) => part.length > 0)
    .join('\n\n')
    .concat('\n');
  const managedKeys = Object.keys(servers).sort((left, right) =>
    left.localeCompare(right),
  );
  const write = await safeWriteFile({
    outputPath,
    content,
    provider: 'codex',
    managedContent: 'mcp',
    dryRun: ctx.dryRun,
    managedKeys,
    home: ctx.home,
  });
  return {
    provider: 'codex',
    content: 'mcp',
    outputPath,
    status: write.status,
    managedKeys,
    ...(ctx.dryRun
      ? {
          desiredHash: write.hash,
          appliedHash: write.appliedHash,
          observedHash: write.observedHash,
          appliedAt: write.appliedAt,
        }
      : {}),
  };
}

export async function readCodexMcpServerNames(
  outputPath: string | null,
): Promise<string[]> {
  if (outputPath === null) {
    return [];
  }
  const content = await readTextIfPresent(outputPath);
  const names = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const header = line.trim().match(/^\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))(?:\.|\])?/);
    const name = header?.[1] ?? header?.[2];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function renderCodexServer(name: string, server: McpServerDef): string {
  const table = `mcp_servers.${tomlKey(name)}`;
  const lines = [`[${table}]`];
  if (server.transport === 'http' || (server.url !== undefined && server.command === undefined)) {
    lines.push(`url = ${tomlString(server.url ?? '')}`);
    if (server.headers !== undefined && Object.keys(server.headers).length > 0) {
      lines.push(`http_headers = ${tomlInlineTable(server.headers)}`);
    }
    return lines.join('\n');
  }
  lines.push(`command = ${tomlString(server.command ?? '')}`);
  if ((server.args ?? []).length > 0) {
    lines.push(`args = ${tomlStringArray(server.args ?? [])}`);
  }
  if (server.cwd !== undefined) {
    lines.push(`cwd = ${tomlString(server.cwd)}`);
  }
  if (server.env !== undefined && Object.keys(server.env).length > 0) {
    lines.push('', `[${table}.env]`);
    for (const [key, value] of Object.entries(server.env).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      lines.push(`${tomlKey(key)} = ${tomlString(value)}`);
    }
  }
  return lines.join('\n');
}

function removeManagedTables(content: string, managedKeys: string[]): string {
  if (managedKeys.length === 0 || content.length === 0) {
    return content;
  }
  const managed = new Set(managedKeys);
  const output: string[] = [];
  let skip = false;
  for (const line of content.split(/\r?\n/)) {
    const header = parseTableHeader(line);
    if (header !== undefined) {
      const serverName = serverNameFromTable(header);
      skip = serverName !== undefined && managed.has(serverName);
    }
    if (!skip) {
      output.push(line);
    }
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n');
}

function parseTableHeader(line: string): string | undefined {
  const match = line.trim().match(/^\[([^\]]+)\](?:\s*#.*)?$/);
  return match?.[1];
}

function serverNameFromTable(table: string): string | undefined {
  const match = table.match(
    /^mcp_servers\.(?:"((?:[^"\\]|\\.)+)"|([A-Za-z0-9_-]+))(?:\.|$)/,
  );
  if (match?.[1] !== undefined) {
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return match[1];
    }
  }
  return match?.[2];
}

function tomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(', ')}]`;
}

function tomlInlineTable(values: Record<string, string>): string {
  return `{ ${Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${tomlKey(key)} = ${tomlString(value)}`)
    .join(', ')} }`;
}

async function readTextIfPresent(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}
