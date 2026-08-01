import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(packageRoot, '..', '..');
const binaryName = process.platform === 'win32' ? 'reglet.exe' : 'reglet';
const binaryDirectory = path.join(packageRoot, 'resources', 'bin');
const updateBaseUrl = process.env.REGLET_UPDATE_ASSET_BASE_URL?.replace(
  /\/$/,
  '',
);
const windowsCertificateFile = process.env.REGLET_WINDOWS_CERTIFICATE_FILE;
const windowsCertificatePassword =
  process.env.REGLET_WINDOWS_CERTIFICATE_PASSWORD;
const appleKeychainProfile = process.env.REGLET_APPLE_KEYCHAIN_PROFILE;

export default {
  packagerConfig: {
    asar: true,
    executableName: 'reglet',
    appBundleId: 'dev.reglet.manager',
    appCategoryType: 'public.app-category.developer-tools',
    ...(process.platform === 'darwin'
      ? {
          osxSign: {},
          ...(appleKeychainProfile === undefined
            ? {}
            : {
                osxNotarize: {
                  keychainProfile: appleKeychainProfile,
                },
              }),
        }
      : {}),
    extraResource: [
      {
        from: path.join(packageRoot, 'resources', 'bin'),
        to: 'bin',
      },
      {
        from: path.join(repositoryRoot, 'packages', 'manager'),
        to: 'manager',
        filter: (source) =>
          !source.includes(`${path.sep}test${path.sep}`) &&
          !source.endsWith('tsconfig.json') &&
          !source.endsWith('package.json'),
      },
    ],
  },
  hooks: {
    prePackage: async () => {
      mkdirSync(binaryDirectory, { recursive: true });
      const result = spawnSync(
        'bun',
        [
          'build',
          '--compile',
          path.join(repositoryRoot, 'packages', 'cli', 'src', 'index.ts'),
          '--outfile',
          path.join(binaryDirectory, binaryName),
        ],
        { cwd: repositoryRoot, stdio: 'inherit' },
      );
      if (result.status !== 0) {
        throw new Error('Could not compile the embedded Reglet runtime.');
      }
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
      config: (arch) => ({
        ...(updateBaseUrl === undefined
          ? {}
          : {
              macUpdateManifestBaseUrl: `${updateBaseUrl}/darwin/${arch}`,
            }),
      }),
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
      },
    },
    {
      name: '@electron-forge/maker-squirrel',
      config: (arch) => ({
        name: 'reglet',
        authors: 'Reglet',
        description:
          'Local-first manager for agent instructions, skills, and MCP servers',
        ...(updateBaseUrl === undefined
          ? {}
          : {
              remoteReleases: `${updateBaseUrl}/win32/${arch}`,
            }),
        ...(windowsCertificateFile === undefined ||
        windowsCertificatePassword === undefined
          ? {}
          : {
              certificateFile: windowsCertificateFile,
              certificatePassword: windowsCertificatePassword,
            }),
      }),
    },
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
