# Self Hosting

Reglet includes a standalone Bun + Hono + SQLite sync server for self-hosted device sync. The Reglet app and CLI do not install or run this server; local-only Reglet works without an account, network access, or sync service.

## Recommended Docker Compose install

Download `compose.yaml`, generate a strong token, and start the independently versioned server image:

```bash
export REGLET_TOKEN="$(openssl rand -base64 32)"
docker compose up -d
docker compose ps
```

Images are published for `linux/amd64` and `linux/arm64` at `ghcr.io/elijahbutler/reglet-sync`. Pin `REGLET_SYNC_VERSION` before upgrades instead of using a floating tag.

## Single-User Token Mode

Single-user mode is the simplest self-host setup. Set `REGLET_TOKEN` to a long random secret and use that token from clients.

```bash
docker run --rm -p 3000:3000 \
  -e REGLET_TOKEN="$(openssl rand -base64 32)" \
  -e REGLET_DB=/data/reglet.sqlite \
  -v reglet-data:/data \
  ghcr.io/elijahbutler/reglet-sync:0.1.0
```

Health check:

```bash
curl http://localhost:3000/healthz
```

## Account Mode

If `REGLET_TOKEN` is not set, clients use the register/login and device pairing API:

```bash
docker run --rm -p 3000:3000 \
  -e REGLET_DB=/data/reglet.sqlite \
  -v reglet-data:/data \
  reglet-sync
```

## Environment Variables

| Variable | Default | Description |
|---|---:|---|
| `PORT` | `3000` | HTTP listen port. |
| `REGLET_DB` | `./reglet.sqlite` | SQLite database path. Use a mounted volume for persistent data. |
| `REGLET_TOKEN` | unset | Enables single-user token mode when set. |

`REGLET_TOKEN` must contain at least 20 non-whitespace characters. Single-user token mode is the recommended self-host configuration.

## Backup and restore

Stop writes before copying the SQLite database:

```bash
docker compose stop reglet-sync
docker run --rm -v reglet-sync-data:/data -v "$PWD":/backup alpine \
  cp /data/reglet.sqlite /backup/reglet.sqlite
docker compose start reglet-sync
```

To restore, stop the service, replace `/data/reglet.sqlite` from a known-good copy, and restart. Always retain the previous database until `/healthz` and a client sync both succeed.

## Upgrades and rollback

1. Back up the database.
2. Set `REGLET_SYNC_VERSION` to the desired release and run `docker compose pull && docker compose up -d`.
3. Confirm `/healthz` reports a protocol version supported by the client.
4. To roll back, restore the prior image version and its matching database backup.

The versioned API contract is documented in [`docs/specs/reglet-sync-v1.openapi.yaml`](specs/reglet-sync-v1.openapi.yaml).

## API Summary

- `GET /healthz`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/pair/start`
- `POST /v1/pair/claim`
- `GET /v1/changes?since=<seq>`
- `GET /v1/files/<path>`
- `PUT /v1/files/<path>`
- `DELETE /v1/files/<path>`

All file and changes endpoints require `Authorization: Bearer <device token>` or the configured `REGLET_TOKEN` in single-user mode.
