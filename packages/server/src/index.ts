import { createApp } from './app.js';

const app = createApp({
  dbPath: process.env.REGLET_DB ?? './reglet.sqlite',
  singleUserToken: process.env.REGLET_TOKEN,
  allowRegistration: process.env.REGLET_ALLOW_REGISTRATION === '1',
  rateLimit: { trustProxy: process.env.REGLET_TRUST_PROXY === '1' },
});

export { createApp };
export default {
  port: Number(process.env.PORT ?? '3000'),
  fetch: app.fetch,
};
