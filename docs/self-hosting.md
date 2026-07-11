# Self Hosting

Reglet includes a small Bun + Hono + SQLite sync server for self-hosted device sync.

## Single-User Token Mode

Single-user mode is the simplest self-host setup. Set `REGLET_TOKEN` to a long random secret and use that token from clients.

```bash
docker build -t reglet-sync .
docker run --rm -p 3000:3000 \
  -e REGLET_TOKEN="$(openssl rand -base64 32)" \
  -e REGLET_DB=/data/reglet.sqlite \
  -v reglet-data:/data \
  reglet-sync
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
