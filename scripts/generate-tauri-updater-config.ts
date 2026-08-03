const UPDATE_ENDPOINT = 'https://github.com/elijahbutler/reglet/releases/latest/download/latest.json';

export interface TauriUpdaterBuildConfig {
  bundle: {
    createUpdaterArtifacts: true;
  };
  plugins: {
    updater: {
      endpoints: string[];
      pubkey: string;
    };
  };
}

export function createTauriUpdaterBuildConfig(publicKey: string): TauriUpdaterBuildConfig {
  const pubkey = publicKey.trim();
  if (pubkey.length === 0) throw new Error('REGLET_UPDATER_PUBLIC_KEY is required');
  return {
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        endpoints: [UPDATE_ENDPOINT],
        pubkey,
      },
    },
  };
}

if (import.meta.main) {
  process.stdout.write(JSON.stringify(createTauriUpdaterBuildConfig(process.env.REGLET_UPDATER_PUBLIC_KEY ?? '')));
}
