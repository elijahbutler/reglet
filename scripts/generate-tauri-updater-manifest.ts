import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

interface UpdaterPlatform {
  signature: string;
  url: string;
}

export interface UpdaterManifest {
  version: string;
  platforms: Record<string, UpdaterPlatform>;
}

const artifacts = [
  { platform: 'darwin-aarch64', file: 'reglet-desktop-macos-arm64.app.tar.gz' },
  { platform: 'darwin-x86_64', file: 'reglet-desktop-macos-x86_64.app.tar.gz' },
  { platform: 'windows-x86_64', file: 'reglet-desktop-windows-x64-setup.exe' },
] as const;

export async function createUpdaterManifest({ directory, repository, version }: {
  directory: string;
  repository: string;
  version: string;
}): Promise<UpdaterManifest> {
  if (!SEMVER.test(version)) throw new Error(`Invalid updater version: ${version}`);
  if (!REPOSITORY.test(repository)) throw new Error(`Invalid GitHub repository: ${repository}`);
  const tag = `v${version}`;
  const platforms: Record<string, UpdaterPlatform> = {};
  for (const artifact of artifacts) {
    const artifactPath = `${directory}/${artifact.file}`;
    const signaturePath = `${directory}/${artifact.file}.sig`;
    if (!await Bun.file(artifactPath).exists()) throw new Error(`Missing updater artifact: ${artifactPath}`);
    const signatureFile = Bun.file(signaturePath);
    if (!await signatureFile.exists()) throw new Error(`Missing updater signature: ${signaturePath}`);
    const signature = (await signatureFile.text()).trim();
    if (signature.length === 0) throw new Error(`Empty updater signature: ${signaturePath}`);
    platforms[artifact.platform] = {
      signature,
      url: `https://github.com/${repository}/releases/download/${tag}/${artifact.file}`,
    };
  }
  return { version, platforms };
}

async function main(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = `${root}/dist/desktop`;
  const version = (process.env.REGLET_VERSION ?? process.env.GITHUB_REF_NAME ?? '').replace(/^v/, '');
  const repository = process.env.GITHUB_REPOSITORY ?? 'elijahbutler/reglet';
  const manifest = await createUpdaterManifest({ directory, repository, version });
  await Bun.write(`${directory}/latest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Generated signed updater manifest for Reglet ${version}.`);
}

if (import.meta.main) await main();
