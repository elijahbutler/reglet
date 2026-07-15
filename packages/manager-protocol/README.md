# Reglet Manager Protocol

Browser-safe TypeScript contracts for the local Manager RPC bridge.

Protocol version 1 uses one request on stdin and one response on stdout:

```json
{ "protocolVersion": 1, "operation": "snapshot", "input": { "contractVersion": 2 } }
```

Responses are always envelopes. Successful responses include `result`; failures include a stable error code and a redacted message.

```json
{ "protocolVersion": 1, "operation": "snapshot", "ok": true, "result": {} }
```

The CLI command is `reglet manager rpc --json --protocol-version 1`.
