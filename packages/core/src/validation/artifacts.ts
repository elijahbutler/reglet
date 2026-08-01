import path from 'node:path';
import type { LibraryArtifactMetadata } from '../artifacts/types.js';
import type { ProviderId } from '../providers/types.js';
import { getAdapter } from '../providers/registry.js';
import type {
  ArtifactValidationResult,
  McpServerDefinition,
  ProviderCompatibilityResult,
  SecretBindingStatus,
  ValidationIssue,
} from './types.js';

const providerInstructionSoftLimits: Partial<Record<ProviderId, number>> = {
  codex: 28 * 1024,
  windsurf: 5_000,
};

const providerInstructionHardLimits: Partial<Record<ProviderId, number>> = {
  codex: 32 * 1024,
  windsurf: 6_000,
};

const environmentNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function validateInstruction(input: {
  content: string;
  targets: ProviderId[];
  combinedOutputBytes?: Partial<Record<ProviderId, number>>;
}): ArtifactValidationResult {
  const issues: ValidationIssue[] = [];
  const stripped = stripMarkdownMetadata(input.content);
  if (stripped.trim().length === 0) {
    issues.push({
      code: 'instruction-empty',
      severity: 'error',
      message: 'Instruction content must not be empty after metadata is removed.',
    });
  }
  if (input.content.includes('\uFFFD')) {
    issues.push({
      code: 'invalid-utf8',
      severity: 'error',
      message: 'Instruction content contains invalid UTF-8 replacement characters.',
    });
  }

  const compatibility = input.targets.map((provider) => {
    const providerIssues: ValidationIssue[] = [];
    const outputBytes =
      input.combinedOutputBytes?.[provider] ?? Buffer.byteLength(input.content, 'utf8');
    const hardLimit = providerInstructionHardLimits[provider];
    const softLimit = providerInstructionSoftLimits[provider];
    if (hardLimit !== undefined && outputBytes > hardLimit) {
      providerIssues.push({
        code: 'provider-limit',
        severity: 'error',
        message: `${getAdapter(provider).displayName} output exceeds its ${hardLimit}-byte limit.`,
      });
    } else if (softLimit !== undefined && outputBytes >= softLimit) {
      providerIssues.push({
        code: 'provider-limit',
        severity: 'warning',
        message: `${getAdapter(provider).displayName} output is approaching its size limit.`,
      });
    }
    return compatibilityFor(provider, providerIssues, getAdapter(provider).rulesPath() !== null);
  });

  return validationResult(issues, compatibility);
}

export interface SkillValidationFile {
  relPath: string;
  content?: string;
}

export function validateSkill(input: {
  slug: string;
  files: SkillValidationFile[];
  targets: ProviderId[];
  canonicalArtifacts?: LibraryArtifactMetadata[];
}): ArtifactValidationResult {
  const issues: ValidationIssue[] = [];
  const skillFile = input.files.find(
    (file) => normalizeRelPath(file.relPath).toUpperCase() === 'SKILL.MD',
  );
  if (skillFile === undefined) {
    issues.push({
      code: 'skill-file-missing',
      severity: 'error',
      message: 'A skill must contain SKILL.md.',
      path: 'SKILL.md',
    });
  }

  const frontmatter =
    skillFile?.content === undefined ? undefined : parseSimpleFrontmatter(skillFile.content);
  if (frontmatter === undefined) {
    issues.push({
      code: 'frontmatter-invalid',
      severity: 'error',
      message: 'SKILL.md must begin with valid YAML frontmatter.',
      path: 'SKILL.md',
    });
  } else {
    if (frontmatter.name === undefined || frontmatter.name.trim().length === 0) {
      issues.push({
        code: 'skill-name-missing',
        severity: 'error',
        message: 'Skill frontmatter requires a name.',
        path: 'SKILL.md',
        field: 'name',
      });
    } else if (frontmatter.name !== input.slug) {
      issues.push({
        code: 'skill-name-mismatch',
        severity: 'error',
        message: `Skill name "${frontmatter.name}" must match directory "${input.slug}".`,
        path: 'SKILL.md',
        field: 'name',
      });
    }
    if (frontmatter.description === undefined || frontmatter.description.trim().length === 0) {
      issues.push({
        code: 'skill-description-missing',
        severity: 'error',
        message: 'Skill frontmatter requires a description.',
        path: 'SKILL.md',
        field: 'description',
      });
    }
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
    issues.push({
      code: 'skill-slug-invalid',
      severity: 'error',
      message: 'Skill slug must use lowercase letters, numbers, and single hyphens.',
    });
  }

  const duplicate = input.canonicalArtifacts?.find(
    (artifact) => artifact.kind === 'skill' && artifact.slug === input.slug,
  );
  if (duplicate !== undefined) {
    issues.push({
      code: 'skill-name-duplicate',
      severity: 'error',
      message: `Another canonical skill already uses "${input.slug}".`,
    });
  }

  for (const reference of findRelativeReferences(skillFile?.content ?? '')) {
    if (reference.escapesRoot) {
      issues.push({
        code: 'skill-reference-escapes-root',
        severity: 'error',
        message: `Reference escapes the skill directory: ${reference.value}`,
        path: 'SKILL.md',
      });
    }
  }

  const compatibility = input.targets.map((provider) => {
    const providerIssues: ValidationIssue[] = [];
    if (frontmatter !== undefined) {
      const supportedFields = providerSkillFields(provider);
      for (const field of Object.keys(frontmatter)) {
        if (!supportedFields.has(field)) {
          providerIssues.push({
            code: 'lossy-conversion',
            severity: 'warning',
            message: `${getAdapter(provider).displayName} ignores skill field "${field}".`,
            field,
          });
        }
      }
    }
    return compatibilityFor(provider, providerIssues, getAdapter(provider).skillsDir() !== null);
  });
  return validationResult(issues, compatibility);
}

export function validateMcpServer(input: {
  name: string;
  definition: McpServerDefinition;
  targets: ProviderId[];
  existingNames?: string[];
  secretBindings?: SecretBindingStatus[];
}): ArtifactValidationResult {
  const issues: ValidationIssue[] = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.name)) {
    issues.push({
      code: 'mcp-name-invalid',
      severity: 'error',
      message: 'MCP server name contains unsupported characters.',
      field: 'name',
    });
  }
  if (input.existingNames?.includes(input.name) === true) {
    issues.push({
      code: 'mcp-name-duplicate',
      severity: 'error',
      message: `Another MCP server already uses "${input.name}".`,
      field: 'name',
    });
  }

  if (input.definition.transport === 'stdio') {
    if (input.definition.command.trim().length === 0) {
      issues.push({
        code: 'mcp-command-missing',
        severity: 'error',
        message: 'A stdio MCP server requires a command.',
        field: 'command',
      });
    }
    for (const name of [
      ...Object.keys(input.definition.env),
      ...Object.keys(input.definition.secretEnv),
    ]) {
      if (!environmentNamePattern.test(name)) {
        issues.push({
          code: 'mcp-env-name-invalid',
          severity: 'error',
          message: `Invalid environment variable name: ${name}`,
          field: name,
        });
      }
    }
  } else {
    if (!isAbsoluteHttpUrl(input.definition.url)) {
      issues.push({
        code: 'mcp-url-invalid',
        severity: 'error',
        message: 'HTTP MCP URL must be an absolute HTTP or HTTPS URL.',
        field: 'url',
      });
    }
    for (const name of [
      ...Object.keys(input.definition.headers),
      ...Object.keys(input.definition.secretHeaders),
    ]) {
      if (!headerNamePattern.test(name)) {
        issues.push({
          code: 'mcp-header-name-invalid',
          severity: 'error',
          message: `Invalid HTTP header name: ${name}`,
          field: name,
        });
      }
    }
  }

  const bindingMap = new Map(
    (input.secretBindings ?? []).map((binding) => [binding.reference.id, binding.bound]),
  );
  const missingSecretIssues: ValidationIssue[] = [];
  for (const [field, reference] of Object.entries(secretReferences(input.definition))) {
    if (reference.required !== false && bindingMap.get(reference.id) !== true) {
      missingSecretIssues.push({
        code: 'missing-secret',
        severity: 'error',
        message: `Required secret is not bound for ${field}.`,
        field,
      });
    }
  }

  const compatibility = input.targets.map((provider) => {
    const supported = getAdapter(provider).mcpPath() !== null;
    const providerIssues: ValidationIssue[] = [...missingSecretIssues];
    if (Object.keys(secretReferences(input.definition)).length > 0) {
      providerIssues.push({
        code: 'materialized-secret',
        severity: 'warning',
        message:
          `${getAdapter(provider).displayName} requires bound secret values in its local MCP file. Reglet uses restrictive permissions where supported.`,
      });
    }
    if (provider === 'codex' && input.definition.transport === 'http') {
      providerIssues.push({
        code: 'lossy-conversion',
        severity: 'warning',
        message: 'Verify HTTP header support against the installed Codex schema before apply.',
      });
    }
    return compatibilityFor(provider, providerIssues, supported);
  });
  return validationResult(issues, compatibility);
}

function validationResult(
  issues: ValidationIssue[],
  compatibility: ProviderCompatibilityResult[],
): ArtifactValidationResult {
  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    compatibility,
  };
}

function compatibilityFor(
  provider: ProviderId,
  issues: ValidationIssue[],
  supported: boolean,
): ProviderCompatibilityResult {
  return {
    provider,
    supported,
    canProject: supported && !issues.some((issue) => issue.severity === 'error'),
    issues,
  };
}

function stripMarkdownMetadata(content: string): string {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return content;
  }
  const closingIndex = lines.slice(1).findIndex((line) => line.trim() === '---');
  return closingIndex === -1 ? content : lines.slice(closingIndex + 2).join('\n');
}

function parseSimpleFrontmatter(content: string): Record<string, string> | undefined {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return undefined;
  }
  const closingIndex = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (closingIndex === -1) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const line of lines.slice(1, closingIndex + 1)) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }
    const separator = line.indexOf(':');
    if (separator <= 0) {
      return undefined;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (key.length === 0) {
      return undefined;
    }
    result[key] = unquote(rawValue);
  }
  return result;
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function providerSkillFields(provider: ProviderId): Set<string> {
  if (provider === 'opencode') {
    return new Set(['name', 'description', 'license', 'compatibility', 'metadata']);
  }
  return new Set(['name', 'description']);
}

function findRelativeReferences(
  content: string,
): Array<{ value: string; escapesRoot: boolean }> {
  const references: Array<{ value: string; escapesRoot: boolean }> = [];
  const expression = /(?:^|[\s(])@?(\.\.?\/[^\s)]+)/gm;
  for (const match of content.matchAll(expression)) {
    const value = match[1];
    if (value === undefined) {
      continue;
    }
    const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
    references.push({
      value,
      escapesRoot: normalized === '..' || normalized.startsWith('../'),
    });
  }
  return references;
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host.length > 0;
  } catch {
    return false;
  }
}

function secretReferences(
  definition: McpServerDefinition,
): Record<string, { id: string; required?: boolean }> {
  return definition.transport === 'stdio'
    ? definition.secretEnv
    : definition.secretHeaders;
}

function normalizeRelPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}
