/**
 * reglet update — in-place CLI self-updater.
 *
 * Queries the GitHub releases API for the latest version, verifies the SHA-256
 * checksum, and atomically replaces the running binary.
 *
 * Platform binary names:
 *   darwin-arm64  → reglet-darwin-arm64
 *   darwin-x64    → reglet-darwin-x64
 *   linux-arm64   → reglet-linux-arm64
 *   linux-x64     → reglet-linux-x64
 */
import { createHash } from 'node:crypto';
import { chmod, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spinner } from '@clack/prompts';

const RELEASES_API = 'https://api.github.com/repos/elijahbutler/reglet/releases/latest';
const DOWNLOAD_BASE = 'https://github.com/elijahbutler/reglet/releases/download';

// ─── Platform detection ───────────────────────────────────────────────────────

export type SupportedPlatform = 'darwin-arm64' | 'darwin-x64' | 'linux-arm64' | 'linux-x64';

export function detectPlatform(): SupportedPlatform | null {
  const { platform, arch } = process;
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  return null;
}

export function binaryName(platform: SupportedPlatform): string {
  return `reglet-${platform}`;
}

// ─── GitHub releases API ──────────────────────────────────────────────────────

interface GitHubRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const res = await fetch(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'reglet-cli' },
  });
  if (!res.ok) throw new Error(`GitHub releases API returned ${res.status}: ${await res.text()}`);
  return res.json() as Promise<GitHubRelease>;
}

async function fetchSha256Sums(tag: string): Promise<Map<string, string>> {
  const url = `${DOWNLOAD_BASE}/${tag}/SHA256SUMS.txt`;
  const res = await fetch(url, { headers: { 'User-Agent': 'reglet-cli' } });
  if (!res.ok) throw new Error(`Could not fetch SHA256SUMS.txt: ${res.status}`);
  const text = await res.text();
  const map = new Map<string, string>();
  for (const line of text.trim().split('\n')) {
    const [hash, name] = line.trim().split(/\s+/);
    if (hash && name) map.set(name.replace(/^\.\//, ''), hash);
  }
  return map;
}

async function downloadBinary(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': 'reglet-cli' } });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

function sha256hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

// ─── Self-replacement ─────────────────────────────────────────────────────────

/**
 * Returns the path to the running binary. Works for both compiled Bun
 * executables (process.execPath is the binary itself) and for dev runs via
 * `bun run` (process.execPath is the bun runtime, argv[1] is the entry file).
 */
export function resolveCurrentBinaryPath(): string {
  // Compiled bun binary: process.execPath ends with 'reglet' (or 'reglet-*')
  const exec = process.execPath;
  const basename = path.basename(exec);
  if (basename.startsWith('reglet')) return exec;
  // Dev / bun runtime: fall back to argv[1]
  return process.argv[1] ?? exec;
}

async function atomicReplace(targetPath: string, newContent: Buffer): Promise<void> {
  const tmpPath = `${targetPath}.update-${process.pid}`;
  try {
    await writeFile(tmpPath, newContent, { mode: 0o755 });
    await rename(tmpPath, targetPath);
  } catch {
    await rm(tmpPath, { force: true });
    throw new Error(
      `Could not replace ${targetPath}. Try running with sudo, or update manually:\n` +
        `  curl -fsSL ${DOWNLOAD_BASE}/latest/download/${path.basename(targetPath)} -o ${targetPath} && chmod +x ${targetPath}`,
    );
  }
}

// ─── Main update command ──────────────────────────────────────────────────────

export interface UpdateOptions {
  currentVersion: string;
  /** Override the path to replace (defaults to the running binary). */
  targetPath?: string;
  /** Print machine-readable JSON instead of interactive output. */
  json?: boolean;
  /** Skip the "already up-to-date" early-exit and force re-download. */
  force?: boolean;
}

export async function runUpdate(opts: UpdateOptions): Promise<void> {
  const platform = detectPlatform();
  if (platform === null) {
    const msg = `Unsupported platform: ${process.platform}/${process.arch}. Update manually from https://github.com/elijahbutler/reglet/releases`;
    if (opts.json === true) {
      console.log(JSON.stringify({ ok: false, error: msg }));
    } else {
      console.error(`✗ ${msg}`);
    }
    process.exitCode = 1;
    return;
  }

  const targetPath = opts.targetPath ?? resolveCurrentBinaryPath();
  const asset = binaryName(platform);

  if (opts.json !== true) {
    console.log(`reglet update — current: v${opts.currentVersion} · platform: ${platform}\n`);
  }

  const s = opts.json !== true ? spinner() : null;
  s?.start('Checking latest release…');

  let release: GitHubRelease;
  try {
    release = await fetchLatestRelease();
  } catch (err) {
    s?.stop('Failed to reach GitHub.');
    throw err;
  }

  const latestTag = release.tag_name;
  const latestVersion = latestTag.replace(/^v/, '');

  if (!opts.force && latestVersion === opts.currentVersion) {
    s?.stop(`Already up to date (v${opts.currentVersion}).`);
    if (opts.json === true) {
      console.log(JSON.stringify({ ok: true, updated: false, version: latestVersion }));
    }
    return;
  }

  s?.message(`Downloading v${latestVersion} (${asset})…`);

  // Verify the asset exists in this release
  const downloadUrl = `${DOWNLOAD_BASE}/${latestTag}/${asset}`;
  const assetExists = release.assets.some((a) => a.name === asset);
  if (!assetExists) {
    s?.stop(`Asset "${asset}" not found in release ${latestTag}.`);
    process.exitCode = 1;
    return;
  }

  let sums: Map<string, string>;
  let binary: Buffer;
  try {
    [sums, binary] = await Promise.all([fetchSha256Sums(latestTag), downloadBinary(downloadUrl)]);
  } catch (err) {
    s?.stop('Download failed.');
    throw err;
  }

  s?.message('Verifying checksum…');
  const expectedHash = sums.get(asset);
  if (expectedHash === undefined) {
    s?.stop(`No checksum entry for "${asset}" in SHA256SUMS.txt.`);
    process.exitCode = 1;
    return;
  }

  const actualHash = sha256hex(binary);
  if (actualHash !== expectedHash) {
    s?.stop('Checksum mismatch — download may be corrupted. Aborting.');
    if (opts.json !== true) {
      console.error(`  expected: ${expectedHash}`);
      console.error(`  actual:   ${actualHash}`);
    }
    process.exitCode = 1;
    return;
  }

  s?.message(`Installing to ${targetPath}…`);
  try {
    // Preserve execute permission on the target if it exists
    const mode = await stat(targetPath)
      .then((st) => st.mode & 0o777)
      .catch(() => 0o755);
    await atomicReplace(targetPath, binary);
    await chmod(targetPath, mode | 0o111);
  } catch (err) {
    s?.stop('Installation failed.');
    throw err;
  }

  s?.stop(`✓ Updated to v${latestVersion}`);

  if (opts.json === true) {
    console.log(
      JSON.stringify({
        ok: true,
        updated: true,
        previousVersion: opts.currentVersion,
        version: latestVersion,
        path: targetPath,
        platform,
        checksum: actualHash,
      }),
    );
  } else {
    console.log(`\n  Path:     ${targetPath}`);
    console.log(`  Platform: ${platform}`);
    console.log(`  Checksum: ${actualHash.slice(0, 16)}…  ✓ verified\n`);
    if (process.platform === 'darwin') {
      console.log('  If installed via Homebrew, prefer: brew upgrade reglet\n');
    }
  }
}
