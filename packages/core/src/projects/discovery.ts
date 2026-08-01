import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { allAdapters } from '../providers/registry.js';
import type {
  DiscoveryArtifactKind,
  ProviderDiscoveryDeclaration,
  ProviderId,
} from '../providers/types.js';
import { inspectSkill, type SkillRisk } from '../security/skills.js';

export type ProjectDiscoveryState =
  | 'new'
  | 'changed'
  | 'promoted'
  | 'conflict'
  | 'ignored';

export type InstructionPromotionMode =
  | 'global-instruction'
  | 'convert-to-skill'
  | 'disabled-library-draft';

export interface SourceScopeSummary {
  rootLevel: boolean;
  hierarchical: boolean;
  alwaysActive: boolean;
  globs: string[];
  manual: boolean;
  agentRequested: boolean;
  lossyFields: string[];
}

export interface ProjectDiscovery {
  id: string;
  kind: DiscoveryArtifactKind;
  absolutePath: string;
  relativePath: string;
  sourceHash: string;
  size: number;
  recognizedBy: ProviderId[];
  formatsByProvider: Partial<Record<ProviderId, string>>;
  scope: SourceScopeSummary;
  state: ProjectDiscoveryState;
  skillRisks: SkillRisk[];
}

export interface IgnoredDiscoveryRule {
  relativePath: string;
  sourceHash: string;
}

export interface ProjectScanOptions {
  ignored?: IgnoredDiscoveryRule[];
  reappearChangedIgnored?: boolean;
  maxFileBytes?: number;
  maxConcurrency?: number;
  excludedDirectoryNames?: string[];
}

export interface PromotionRecommendation {
  defaultMode: InstructionPromotionMode;
  availableModes: InstructionPromotionMode[];
  warnings: string[];
  preservedProvenanceFields: string[];
}

interface Candidate {
  kind: DiscoveryArtifactKind;
  absolutePath: string;
  relativePath: string;
  declaration: ProviderDiscoveryDeclaration;
  provider: ProviderId;
}

const defaultExcludedDirectories = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
]);

/**
 * Scans a configured development root without following symlinks. Provider
 * recognition is accumulated onto a single path-keyed discovery.
 */
export async function scanProjectRoot(
  root: string,
  options: ProjectScanOptions = {},
): Promise<ProjectDiscovery[]> {
  const resolvedRoot = await realpath(root);
  const excluded = new Set([
    ...defaultExcludedDirectories,
    ...(options.excludedDirectoryNames ?? []),
  ]);
  const filePaths = await collectProjectFiles(
    resolvedRoot,
    excluded,
    options.maxConcurrency ?? 8,
  );
  const candidates = await collectCandidates(resolvedRoot, filePaths);
  const grouped = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const existing = grouped.get(candidate.absolutePath) ?? [];
    existing.push(candidate);
    grouped.set(candidate.absolutePath, existing);
  }

  const discoveries = (
    await mapWithConcurrency(
      [...grouped.entries()],
      options.maxConcurrency ?? 8,
      async ([absolutePath, group]): Promise<ProjectDiscovery | undefined> => {
        const first = group[0];
        if (first === undefined) {
          return undefined;
        }
        const stats = await lstat(absolutePath);
        if (
          stats.isFile() &&
          stats.size > (options.maxFileBytes ?? 25 * 1024 * 1024)
        ) {
          return undefined;
        }
        const sourceHash = await hashDiscoveryPath(absolutePath);
        const relativePath = normalizeRelPath(
          path.relative(resolvedRoot, absolutePath),
        );
        const ignoredRule = options.ignored?.find(
          (rule) => rule.relativePath === relativePath,
        );
        const ignoredUnchanged = ignoredRule?.sourceHash === sourceHash;
        const ignoredChanged =
          ignoredRule !== undefined && ignoredRule.sourceHash !== sourceHash;

        const recognizedBy = [
          ...new Set(group.map((candidate) => candidate.provider)),
        ].sort();
        const formatsByProvider: Partial<Record<ProviderId, string>> = {};
        for (const candidate of group) {
          formatsByProvider[candidate.provider] =
            candidate.declaration.format;
        }
        const scope = await sourceScopeFor(first, resolvedRoot);
        const skillInspection =
          first.kind === 'skill'
            ? await inspectSkill(absolutePath)
            : undefined;
        return {
          id: createHash('sha256')
            .update(`${resolvedRoot}\0${relativePath}`)
            .digest('hex')
            .slice(0, 32),
          kind: first.kind,
          absolutePath,
          relativePath,
          sourceHash,
          size: skillInspection?.totalBytes ?? stats.size,
          recognizedBy,
          formatsByProvider,
          scope,
          state:
            ignoredUnchanged ||
            (ignoredChanged && options.reappearChangedIgnored !== true)
              ? 'ignored'
              : ignoredChanged
                ? 'changed'
                : 'new',
          skillRisks: skillInspection?.risks ?? [],
        };
      },
    )
  ).filter(
    (discovery): discovery is ProjectDiscovery => discovery !== undefined,
  );

  return discoveries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function recommendInstructionPromotion(
  discovery: ProjectDiscovery,
): PromotionRecommendation {
  if (discovery.kind !== 'instruction') {
    throw new Error('Promotion recommendation requires an instruction discovery.');
  }
  const scoped =
    !discovery.scope.rootLevel ||
    discovery.scope.globs.length > 0 ||
    discovery.scope.manual ||
    discovery.scope.agentRequested;
  const warnings: string[] = [];
  if (!discovery.scope.rootLevel) {
    warnings.push('Nested-directory scope cannot survive global promotion.');
  }
  if (discovery.scope.globs.length > 0) {
    warnings.push(`Path globs will not be preserved: ${discovery.scope.globs.join(', ')}`);
  }
  if (discovery.scope.manual) {
    warnings.push('Manual activation cannot be represented by a global instruction.');
  }
  if (discovery.scope.agentRequested) {
    warnings.push('Agent-requested activation cannot be represented by a global instruction.');
  }
  for (const field of discovery.scope.lossyFields) {
    warnings.push(`Provider metadata will remain only in local provenance: ${field}`);
  }
  return {
    defaultMode: scoped ? 'convert-to-skill' : 'global-instruction',
    availableModes: [
      'global-instruction',
      'convert-to-skill',
      'disabled-library-draft',
    ],
    warnings,
    preservedProvenanceFields: [
      'repositoryLabel',
      'localPath',
      'originalProviderFormat',
      'sourceHash',
      ...discovery.scope.lossyFields,
    ],
  };
}

async function collectCandidates(root: string, files: string[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const adapter of allAdapters()) {
    const configured = (await adapter.configuredDiscoveries?.()) ?? [];
    for (const declaration of [...adapter.discoveries, ...configured].filter(
      (item) => item.scope === 'project',
    )) {
      for (const filePath of files) {
        const relPath = normalizeRelPath(path.relative(root, filePath));
        const matchedPath = matchDeclaration(root, relPath, declaration);
        if (matchedPath === undefined) {
          continue;
        }
        candidates.push({
          kind: declaration.kind,
          absolutePath: matchedPath,
          relativePath: normalizeRelPath(path.relative(root, matchedPath)),
          declaration,
          provider: adapter.id,
        });
      }
    }
  }
  return candidates;
}

function matchDeclaration(
  root: string,
  relPath: string,
  declaration: ProviderDiscoveryDeclaration,
): string | undefined {
  const basename = path.posix.basename(relPath);
  const rootLevel = !relPath.includes('/');
  if (declaration.rootOnly === true && !rootLevel && !relPath.startsWith('.')) {
    return undefined;
  }
  if (declaration.matcher === 'basename') {
    if (basename !== declaration.pattern) {
      return undefined;
    }
    return path.join(root, ...relPath.split('/'));
  }
  if (declaration.matcher === 'exact') {
    const exact =
      relPath === declaration.pattern ||
      (declaration.hierarchical === true &&
        relPath.endsWith(`/${declaration.pattern}`));
    return exact ? path.join(root, ...relPath.split('/')) : undefined;
  }
  if (declaration.matcher === 'extension') {
    const marker = declaration.pattern.includes('.cursor/rules/')
      ? '.cursor/rules/'
      : '.windsurf/rules/';
    const extension = path.posix.extname(declaration.pattern);
    if (!relPath.includes(marker) || path.posix.extname(relPath) !== extension) {
      return undefined;
    }
    return path.join(root, ...relPath.split('/'));
  }

  if (basename !== 'SKILL.md') {
    return undefined;
  }
  const segments = relPath.split('/');
  const patternSegments = declaration.pattern.split('/');
  const start = findSubsequence(segments, patternSegments);
  if (start === -1 || segments.length <= start + patternSegments.length) {
    return undefined;
  }
  const skillRootSegments = segments.slice(0, -1);
  return path.join(root, ...skillRootSegments);
}

async function sourceScopeFor(
  candidate: Candidate,
  root: string,
): Promise<SourceScopeSummary> {
  const rootLevel = path.dirname(candidate.absolutePath) === root;
  const summary: SourceScopeSummary = {
    rootLevel,
    hierarchical: candidate.declaration.hierarchical === true,
    alwaysActive: rootLevel,
    globs: [],
    manual: false,
    agentRequested: false,
    lossyFields: [],
  };
  if (
    candidate.declaration.format !== 'cursor-mdc' &&
    candidate.declaration.format !== 'windsurf-rule'
  ) {
    return summary;
  }
  const content = await readFile(candidate.absolutePath, 'utf8');
  const metadata = parseFrontmatter(content);
  const globs = metadata.globs;
  if (globs !== undefined && globs.trim().length > 0) {
    summary.globs = globs
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const alwaysApply = metadata.alwaysApply === 'true';
  const activation = metadata.trigger ?? metadata.activation ?? metadata.mode;
  summary.alwaysActive = alwaysApply || activation === 'always_on';
  summary.manual = activation === 'manual';
  summary.agentRequested =
    activation === 'model_decision' ||
    (metadata.description !== undefined && !summary.alwaysActive && summary.globs.length === 0);
  summary.lossyFields = Object.keys(metadata).filter(
    (key) => key !== 'description' && key !== 'name',
  );
  return summary;
}

function parseFrontmatter(content: string): Record<string, string> {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return {};
  }
  const end = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (end === -1) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const line of lines.slice(1, end + 1)) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return result;
}

async function hashDiscoveryPath(targetPath: string): Promise<string> {
  const stats = await lstat(targetPath);
  const hash = createHash('sha256');
  if (stats.isFile()) {
    hash.update(await readFile(targetPath));
    return hash.digest('hex');
  }
  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(current, entry.name);
      const entryStats = await lstat(entryPath);
      const relPath = normalizeRelPath(path.relative(targetPath, entryPath));
      if (entryStats.isSymbolicLink()) {
        hash.update(`${relPath}\0symlink\0`);
      } else if (entryStats.isDirectory()) {
        hash.update(`${relPath}\0directory\0`);
        await visit(entryPath);
      } else if (entryStats.isFile()) {
        hash.update(`${relPath}\0file\0`);
        hash.update(await readFile(entryPath));
      }
    }
  }
  await visit(targetPath);
  return hash.digest('hex');
}

function findSubsequence(values: string[], pattern: string[]): number {
  for (let start = 0; start <= values.length - pattern.length; start += 1) {
    if (pattern.every((value, index) => values[start + index] === value)) {
      return start;
    }
  }
  return -1;
}

function normalizeRelPath(value: string): string {
  return value.replaceAll(path.sep, '/');
}

async function mapWithConcurrency<Input, Output>(
  values: Input[],
  requestedConcurrency: number,
  transform: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(values.length);
  const concurrency = Math.min(
    boundedConcurrency(requestedConcurrency),
    values.length || 1,
  );
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        const value = values[index];
        if (value !== undefined) {
          results[index] = await transform(value);
        }
      }
    }),
  );
  return results;
}

async function collectProjectFiles(
  root: string,
  excluded: Set<string>,
  requestedConcurrency: number,
): Promise<string[]> {
  const concurrency = boundedConcurrency(requestedConcurrency);
  const directories = [root];
  const files: string[] = [];
  while (directories.length > 0) {
    const batch = directories.splice(0, concurrency);
    const inspected = await Promise.all(
      batch.map(async (directory) => {
        const childDirectories: string[] = [];
        const childFiles: string[] = [];
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries.sort((left, right) =>
          left.name.localeCompare(right.name),
        )) {
          if (entry.isDirectory() && excluded.has(entry.name)) {
            continue;
          }
          const entryPath = path.join(directory, entry.name);
          const stats = await lstat(entryPath);
          if (stats.isSymbolicLink()) {
            continue;
          }
          if (stats.isDirectory()) {
            childDirectories.push(entryPath);
          } else if (stats.isFile()) {
            childFiles.push(entryPath);
          }
        }
        return { childDirectories, childFiles };
      }),
    );
    for (const result of inspected) {
      directories.push(...result.childDirectories);
      files.push(...result.childFiles);
    }
  }
  return files;
}

function boundedConcurrency(value: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(64, Math.floor(value)))
    : 8;
}
