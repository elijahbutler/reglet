FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY packages ./packages

RUN bun install --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "packages/server/src/index.ts"]
