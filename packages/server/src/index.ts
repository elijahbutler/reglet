import { closeApp, createApp } from './app.js';

const configuredToken = process.env.REGLET_TOKEN;
const dbPath = process.env.REGLET_DB ?? './reglet.sqlite';
console.log(`[reglet] Starting sync server on port ${process.env.PORT ?? '3000'} (db: ${dbPath})`);

const app = createApp({
  dbPath,
  singleUserToken: configuredToken === undefined || configuredToken.length === 0 ? undefined : configuredToken,
  allowRegistration: process.env.REGLET_ALLOW_REGISTRATION === '1',
  enableLegacyV1: process.env.REGLET_ENABLE_LEGACY_V1 === '1',
  rateLimit: { trustProxy: process.env.REGLET_TRUST_PROXY === '1' },
  publicUrl: process.env.REGLET_PUBLIC_URL,
  adminAssetsPath: process.env.REGLET_ADMIN_ASSETS,
  backupDirectory: process.env.REGLET_BACKUP_DIR,
  onOwnerClaimLink: (link) => {
    console.warn('[reglet] NOTICE: Database is fresh or has no registered owner.');
    console.error(`[reglet] Claim the owner dashboard once: ${link}`);
  },
});

const shutdown = () => {
  console.log('[reglet] Shutting down sync server gracefully...');
  closeApp(app);
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { createApp };
export default {
  port: Number(process.env.PORT ?? '3000'),
  fetch: app.fetch,
};
