import { createHash } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';

export type SkillRiskCode =
  | 'executable'
  | 'binary'
  | 'symlink'
  | 'escaping-symlink'
  | 'unexpected-path'
  | 'large-asset';

export interface SkillRisk {
  code: SkillRiskCode;
  severity: 'info' | 'warning' | 'error';
  relPath: string;
  message: string;
}

export interface SkillFileInventoryItem {
  relPath: string;
  kind: 'file' | 'directory' | 'symlink';
  size: number;
  executable: boolean;
  binary: boolean;
  linkTarget?: string;
  contentHash?: string;
}

export interface SkillInspection {
  root: string;
  revision: string;
  totalBytes: number;
  files: SkillFileInventoryItem[];
  risks: SkillRisk[];
  promotionBlocked: boolean;
  requiresExecutableConfirmation: boolean;
}

export interface SkillTrustDecision {
  artifactId: string;
  revision: string;
  trustedAt: string;
  executableFiles: string[];
}

const defaultLargeAssetBytes = 25 * 1024 * 1024;
const executableExtensions = new Set([
  '.appimage', '.bat', '.cmd', '.com', '.exe', '.fish', '.msi', '.ps1', '.run', '.sh', '.zsh',
]);

/**
 * Inventories a skill without importing modules, executing scripts, or
 * following symlinks.
 */
export async function inspectSkill(
  skillRoot: string,
  options: { largeAssetBytes?: number } = {},
): Promise<SkillInspection> {
  const resolvedRoot = path.resolve(skillRoot);
  const files: SkillFileInventoryItem[] = [];
  const risks: SkillRisk[] = [];
  const hash = createHash('sha256');
  let totalBytes = 0;

  async function visit(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(currentPath, entry.name);
      const relPath = path.relative(resolvedRoot, entryPath);
      const stats = await lstat(entryPath);
      if (stats.isSymbolicLink()) {
        const linkTarget = await readlink(entryPath);
        const resolvedTarget = path.resolve(path.dirname(entryPath), linkTarget);
        const escapes =
          resolvedTarget !== resolvedRoot &&
          !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
        files.push({
          relPath,
          kind: 'symlink',
          size: stats.size,
          executable: false,
          binary: false,
          linkTarget,
          contentHash: createHash('sha256').update(linkTarget).digest('hex'),
        });
        risks.push({
          code: escapes ? 'escaping-symlink' : 'symlink',
          severity: escapes ? 'error' : 'warning',
          relPath,
          message: escapes
            ? `Symlink escapes the skill root: ${linkTarget}`
            : `Skill contains a symlink: ${linkTarget}`,
        });
        hash.update(`${relPath}\0symlink\0${linkTarget}\0`);
        continue;
      }
      if (stats.isDirectory()) {
        files.push({
          relPath,
          kind: 'directory',
          size: 0,
          executable: false,
          binary: false,
        });
        hash.update(`${relPath}\0directory\0`);
        await visit(entryPath);
        continue;
      }
      if (!stats.isFile()) {
        risks.push({
          code: 'unexpected-path',
          severity: 'error',
          relPath,
          message: 'Skill contains an unsupported filesystem item.',
        });
        continue;
      }

      const content = await readFile(entryPath);
      const executable = isExecutableContent(relPath, stats.mode, content);
      const binary = isBinary(content);
      totalBytes += stats.size;
      files.push({
        relPath,
        kind: 'file',
        size: stats.size,
        executable,
        binary,
        contentHash: createHash('sha256').update(content).digest('hex'),
      });
      hash.update(`${relPath}\0file\0${stats.mode & 0o777}\0`);
      hash.update(content);
      hash.update('\0');
      if (executable) {
        risks.push({
          code: 'executable',
          severity: 'warning',
          relPath,
          message: 'Executable content requires explicit trust before promotion.',
        });
      }
      if (binary) {
        risks.push({
          code: 'binary',
          severity: 'warning',
          relPath,
          message: 'Binary asset cannot be reviewed as text.',
        });
      }
      if (stats.size > (options.largeAssetBytes ?? defaultLargeAssetBytes)) {
        risks.push({
          code: 'large-asset',
          severity: 'warning',
          relPath,
          message: `Asset exceeds ${options.largeAssetBytes ?? defaultLargeAssetBytes} bytes.`,
        });
      }
    }
  }

  await visit(resolvedRoot);
  const largeAssetBytes = options.largeAssetBytes ?? defaultLargeAssetBytes;
  if (
    totalBytes > largeAssetBytes &&
    !risks.some((risk) => risk.code === 'large-asset')
  ) {
    risks.push({
      code: 'large-asset',
      severity: 'warning',
      relPath: '.',
      message: `Skill contents exceed ${largeAssetBytes} bytes in total.`,
    });
  }
  return {
    root: resolvedRoot,
    revision: hash.digest('hex'),
    totalBytes,
    files,
    risks,
    promotionBlocked: risks.some((risk) => risk.severity === 'error'),
    requiresExecutableConfirmation: risks.some((risk) => risk.code === 'executable'),
  };
}

function isExecutableContent(relPath: string, mode: number, content: Buffer): boolean {
  return (mode & 0o111) !== 0 ||
    content.subarray(0, 2).toString('utf8') === '#!' ||
    executableExtensions.has(path.extname(relPath).toLocaleLowerCase());
}

export function isTrustDecisionCurrent(
  decision: SkillTrustDecision,
  inspection: SkillInspection,
): boolean {
  return decision.revision === inspection.revision;
}

/**
 * Copies a reviewed skill tree without following symlinks. A symlink whose
 * resolved target leaves the source root is refused before any destination
 * entry for that link is created.
 */
export async function copySkillSafely(
  sourceRoot: string,
  destinationRoot: string,
): Promise<void> {
  const inspection = await inspectSkill(sourceRoot);
  const escaping = inspection.risks.find((risk) => risk.code === 'escaping-symlink');
  if (escaping !== undefined) {
    throw new Error(escaping.message);
  }
  const resolvedSource = path.resolve(sourceRoot);

  async function copyDirectory(source: string, destination: string): Promise<void> {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      const stats = await lstat(sourcePath);
      if (stats.isSymbolicLink()) {
        const linkTarget = await readlink(sourcePath);
        const resolvedTarget = path.resolve(path.dirname(sourcePath), linkTarget);
        if (
          resolvedTarget !== resolvedSource &&
          !resolvedTarget.startsWith(`${resolvedSource}${path.sep}`)
        ) {
          throw new Error(`Symlink escapes the skill root: ${linkTarget}`);
        }
        await symlink(linkTarget, destinationPath, process.platform === 'win32' ? 'junction' : undefined);
      } else if (stats.isDirectory()) {
        await copyDirectory(sourcePath, destinationPath);
      } else if (stats.isFile()) {
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await copyFile(sourcePath, destinationPath);
      } else {
        throw new Error(`Unsupported skill filesystem item: ${sourcePath}`);
      }
    }
  }

  await copyDirectory(resolvedSource, path.resolve(destinationRoot));
}

/**
 * Atomically overlays selected reviewed entries onto an existing canonical
 * skill. Both trees are inspected first and escaping symlinks are refused.
 */
export async function mergeSkillFilesSafely(
  sourceRoot: string,
  destinationRoot: string,
  selectedFiles: string[],
): Promise<SkillInspection> {
  const sourceInspection = await inspectSkill(sourceRoot);
  const destinationInspection = await inspectSkill(destinationRoot);
  const blockingRisk = [...sourceInspection.risks, ...destinationInspection.risks].find(
    (risk) => risk.severity === 'error',
  );
  if (blockingRisk !== undefined) throw new Error(blockingRisk.message);

  const sourceEntries = new Map(
    sourceInspection.files
      .filter((file) => file.kind !== 'directory')
      .map((file) => [normalizeSelectedPath(file.relPath), file]),
  );
  const selected = [...new Set(selectedFiles.map(normalizeSelectedPath))];
  for (const relPath of selected) {
    if (!sourceEntries.has(relPath)) {
      throw new Error(`Selected skill file is unavailable: ${relPath}`);
    }
  }

  const resolvedSource = path.resolve(sourceRoot);
  const resolvedDestination = path.resolve(destinationRoot);
  const tempParent = await mkdtemp(
    path.join(path.dirname(resolvedDestination), '.reglet-skill-merge-'),
  );
  const candidate = path.join(tempParent, 'candidate');
  const previous = path.join(tempParent, 'previous');
  let destinationMoved = false;
  try {
    await copySkillSafely(resolvedDestination, candidate);
    for (const relPath of selected) {
      const sourcePath = path.join(resolvedSource, relPath);
      const destinationPath = path.join(candidate, relPath);
      await rm(destinationPath, { recursive: true, force: true });
      await copyReviewedEntry(sourcePath, destinationPath, resolvedSource);
    }
    const candidateInspection = await inspectSkill(candidate);
    const candidateBlock = candidateInspection.risks.find(
      (risk) => risk.severity === 'error',
    );
    if (candidateBlock !== undefined) throw new Error(candidateBlock.message);

    await rename(resolvedDestination, previous);
    destinationMoved = true;
    await rename(candidate, resolvedDestination);
    destinationMoved = false;
    await rm(previous, { recursive: true, force: true });
    return inspectSkill(resolvedDestination);
  } catch (error) {
    if (destinationMoved) {
      await rm(resolvedDestination, { recursive: true, force: true });
      await rename(previous, resolvedDestination);
    }
    throw error;
  } finally {
    await rm(tempParent, { recursive: true, force: true });
  }
}

async function copyReviewedEntry(
  sourcePath: string,
  destinationPath: string,
  sourceRoot: string,
): Promise<void> {
  const stats = await lstat(sourcePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  if (stats.isSymbolicLink()) {
    const linkTarget = await readlink(sourcePath);
    const resolvedTarget = path.resolve(path.dirname(sourcePath), linkTarget);
    if (
      resolvedTarget !== sourceRoot &&
      !resolvedTarget.startsWith(`${sourceRoot}${path.sep}`)
    ) {
      throw new Error(`Symlink escapes the skill root: ${linkTarget}`);
    }
    await symlink(
      linkTarget,
      destinationPath,
      process.platform === 'win32' ? 'junction' : undefined,
    );
    return;
  }
  if (!stats.isFile()) {
    throw new Error(`Selected skill path is not a file: ${sourcePath}`);
  }
  await copyFile(sourcePath, destinationPath);
}

function normalizeSelectedPath(value: string): string {
  const normalized = path.normalize(value);
  if (
    normalized.length === 0 ||
    normalized === '.' ||
    path.isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Selected skill path escapes the skill root: ${value}`);
  }
  return normalized;
}

function isBinary(content: Uint8Array): boolean {
  const sample = content.subarray(0, Math.min(content.length, 8_192));
  return sample.includes(0);
}
