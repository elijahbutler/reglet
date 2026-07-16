import { createApp } from './app.js';

const configuredToken = process.env.REGLET_TOKEN;
const app = createApp({
  dbPath: process.env.REGLET_DB ?? './reglet.sqlite',
  singleUserToken: configuredToken === undefined || configuredToken.length === 0 ? undefined : configuredToken,
  allowRegistration: process.env.REGLET_ALLOW_REGISTRATION === '1',
  enableLegacyV1: process.env.REGLET_ENABLE_LEGACY_V1 === '1',
  rateLimit: { trustProxy: process.env.REGLET_TRUST_PROXY === '1' },
});

export { createApp };
export default {
  port: Number(process.env.PORT ?? '3000'),
  fetch: app.fetch,
};
