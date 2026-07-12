FROM oven/bun:1.3.13-alpine

WORKDIR /app

COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY packages ./packages

RUN bun install --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=3000
ENV REGLET_DB=/data/reglet.sqlite
EXPOSE 3000

RUN mkdir -p /data && chown -R bun:bun /app /data
USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:'+(process.env.PORT??'3000')+'/healthz');if(!r.ok)process.exit(1)"

CMD ["bun", "packages/server/src/index.ts"]
