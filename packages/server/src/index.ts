import { createApp } from './app.js';

const app = createApp({
  dbPath: process.env.REGLET_DB ?? './reglet.sqlite',
  singleUserToken: process.env.REGLET_TOKEN,
});

export { createApp };
export default {
  port: Number(process.env.PORT ?? '3000'),
  fetch: app.fetch,
};
