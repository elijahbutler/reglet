import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { LibraryArtifactMetadata } from '../artifacts/types.js';
import { renderRulesFile } from '../header.js';
import { loadMasterDir, type McpServerDef } from '../master.js';
import type { ProjectionIssue } from './state.js';
import { getAdapter } from '../providers/registry.js';
import type { ProviderId } from '../providers/types.js';
import { isNodeError, isRecord } from '../providers/common.js';

export interface ProjectionPreview {
  provider: ProviderId;
  artifactId: string;
  kind: LibraryArtifactMetadata['kind'];
  destinationPath: string | null;
  format: 'text' | 'tree' | 'structural';
  desired: string;
  observed: string;
  exact: boolean;
  redacted: boolean;
  issues: ProjectionIssue[];
}

/**
 * Builds a read-only comparison without executing skills or MCP servers.
 * MCP previews expose only the selected normalized entry and redact values
 * bound through secret references.
 */
export async function previewArtifactProjection(
  artifact: LibraryArtifactMetadata,
  provider: ProviderId,
  home: string,
): Promise<ProjectionPreview> {
  const adapter = getAdapter(provider);
  const master = await loadMasterDir(home);
  if (artifact.kind === 'instruction') {
    const destinationPath = adapter.rulesPath();
    const desired =
      destinationPath === null
        ? ''
        : renderRulesFile(
            provider,
            master.rules.filter(
              (rule) =>
                rule.targets === undefined || rule.targets.includes(provider),
            ),
          );
    return {
      provider,
      artifactId: artifact.id,
      kind: artifact.kind,
      destinationPath,
      format: 'text',
      desired,
      observed:
        destinationPath === null ? '' : await readTextIfPresent(destinationPath),
      exact: true,
      redacted: false,
      issues:
        destinationPath === null
          ? [unsupportedPreviewIssue(provider, 'instructions')]
          : [],
    };
  }

  if (artifact.kind === 'skill') {
    const skillsDir = adapter.skillsDir();
    const destinationPath =
      skillsDir === null ? null : path.join(skillsDir, artifact.slug);
    const canonicalPath =
      artifact.locator.type === 'directory'
        ? path.join(home, artifact.locator.path)
        : undefined;
    return {
      provider,
      artifactId: artifact.id,
      kind: artifact.kind,
      destinationPath,
      format: 'tree',
      desired:
        canonicalPath === undefined ? '' : await renderDirectoryTree(canonicalPath),
      observed:
        destinationPath === null ? '' : await renderDirectoryTree(destinationPath),
      exact: true,
      redacted: false,
      issues:
        destinationPath === null
          ? [unsupportedPreviewIssue(provider, 'skills')]
          : [],
    };
  }

  const destinationPath = adapter.mcpPath();
  const definition = master.mcpServers[artifact.slug];
  const desiredValue =
    definition === undefined
      ? {}
      : {
          [artifact.slug]: normalizedDesiredMcp(definition),
        };
  const secretFields = mcpSecretFields(definition);
  const observedResult =
    destinationPath === null
      ? { value: {}, redacted: false, issue: undefined }
      : await observedMcpEntry(
          provider,
          destinationPath,
          artifact.slug,
          secretFields,
        );
  const normalizedIssue: ProjectionIssue = {
    code: 'lossy-conversion',
    severity: 'info',
    message:
      'MCP comparison is normalized to the selected server. Secret-bound values are never returned.',
  };
  return {
    provider,
    artifactId: artifact.id,
    kind: artifact.kind,
    destinationPath,
    format: 'structural',
    desired: stableJson(desiredValue),
    observed: stableJson(observedResult.value),
    exact: false,
    redacted: secretFields.env.size > 0 ||
      secretFields.headers.size > 0 ||
      observedResult.redacted,
    issues: [
      normalizedIssue,
      ...(destinationPath === null
        ? [unsupportedPreviewIssue(provider, 'MCP')]
        : []),
      ...(observedResult.issue === undefined ? [] : [observedResult.issue]),
    ],
  };
}

async function renderDirectoryTree(root: string): Promise<string> {
  const entries: string[] = [];
  async function visit(current: string): Promise<void> {
    let children;
    try {
      children = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return;
      throw error;
    }
    for (const child of children.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const childPath = path.join(current, child.name);
      const relPath = path.relative(root, childPath).split(path.sep).join('/');
      const stats = await lstat(childPath);
      if (stats.isSymbolicLink()) {
        entries.push(`link ${relPath} -> ${await readlink(childPath)}`);
      } else if (stats.isDirectory()) {
        entries.push(`dir  ${relPath}/`);
        await visit(childPath);
      } else if (stats.isFile()) {
        const bytes = await readFile(childPath);
        const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
        entries.push(`file ${relPath} ${stats.size}b sha256:${hash}`);
      }
    }
  }
  await visit(root);
  return entries.length === 0 ? '[not present]' : `${entries.join('\n')}\n`;
}

function normalizedDesiredMcp(definition: McpServerDef): Record<string, unknown> {
  if (
    definition.transport === 'http' ||
    (definition.url !== undefined && definition.command === undefined)
  ) {
    return {
      transport: 'http',
      url: definition.url ?? '',
      headers: definition.headers ?? {},
      secretHeaders: secretReferenceRecord(definition.secretHeaders ?? {}),
    };
  }
  return {
    transport: 'stdio',
    command: definition.command ?? '',
    args: definition.args ?? [],
    ...(definition.cwd === undefined ? {} : { cwd: definition.cwd }),
    env: definition.env ?? {},
    secretEnv: secretReferenceRecord(definition.secretEnv ?? {}),
  };
}

function secretReferenceRecord(
  references: Record<string, { id: string; required?: boolean }>,
): Record<string, { reference: string; required: boolean }> {
  return Object.fromEntries(
    Object.entries(references).map(([name, reference]) => [
      name,
      {
        reference: reference.id,
        required: reference.required !== false,
      },
    ]),
  );
}

function mcpSecretFields(definition: McpServerDef | undefined): {
  env: Set<string>;
  headers: Set<string>;
} {
  return {
    env: new Set(Object.keys(definition?.secretEnv ?? {})),
    headers: new Set(Object.keys(definition?.secretHeaders ?? {})),
  };
}

async function observedMcpEntry(
  provider: ProviderId,
  filePath: string,
  name: string,
  secretFields: { env: Set<string>; headers: Set<string> },
): Promise<{
  value: Record<string, unknown>;
  redacted: boolean;
  issue?: ProjectionIssue;
}> {
  const content = await readTextIfPresent(filePath);
  if (content.length === 0) {
    return { value: {}, redacted: false };
  }
  try {
    const parsed =
      provider === 'codex'
        ? parseToml(content)
        : (JSON.parse(content) as unknown);
    const entry = providerMcpEntry(provider, parsed, name);
    const redacted = redactObservedMcp(entry, secretFields);
    return {
      value: entry === undefined ? {} : { [name]: redacted.value },
      redacted: redacted.redacted,
    };
  } catch {
    return {
      value: {},
      redacted: false,
      issue: {
        code: 'invalid-source',
        severity: 'error',
        message:
          'The provider MCP file could not be parsed. Reglet did not expose its raw contents.',
      },
    };
  }
}

function providerMcpEntry(
  provider: ProviderId,
  parsed: unknown,
  name: string,
): unknown {
  if (!isRecord(parsed)) return undefined;
  const container =
    provider === 'opencode'
      ? parsed.mcp
      : provider === 'codex'
        ? parsed.mcp_servers
        : parsed.mcpServers;
  return isRecord(container) ? container[name] : undefined;
}

function redactObservedMcp(
  value: unknown,
  secretFields: { env: Set<string>; headers: Set<string> },
  parentKey = '',
): { value: unknown; redacted: boolean } {
  if (Array.isArray(value)) {
    const items = value.map((item) =>
      redactObservedMcp(item, secretFields, parentKey),
    );
    return {
      value: items.map((item) => item.value),
      redacted: items.some((item) => item.redacted),
    };
  }
  if (!isRecord(value)) {
    return { value, redacted: false };
  }
  let redacted = false;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const secretByBinding =
      (parentKey === 'env' || parentKey === 'environment') &&
      secretFields.env.has(key) ||
      (parentKey === 'headers' || parentKey === 'http_headers') &&
      secretFields.headers.has(key);
    const secretByShape = /(?:secret|token|password|credential|api[-_]?key)/i.test(
      key,
    );
    if (secretByBinding || secretByShape) {
      result[key] = { bound: child !== undefined && child !== null && child !== '' };
      redacted = true;
      continue;
    }
    const nested = redactObservedMcp(child, secretFields, key);
    result[key] = nested.value;
    redacted ||= nested.redacted;
  }
  return { value: result, redacted };
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

async function readTextIfPresent(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return '';
    throw error;
  }
}

function unsupportedPreviewIssue(
  provider: ProviderId,
  capability: string,
): ProjectionIssue {
  const adapter = getAdapter(provider);
  return {
    code: 'unsupported-field',
    severity: 'error',
    message: `${adapter.displayName} does not expose a supported global ${capability} destination.`,
    documentationUrl: adapter.documentationUrl,
  };
}
