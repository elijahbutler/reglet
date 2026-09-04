import { confirm, isCancel, password, select } from '@clack/prompts';
import {
  deleteCredential,
  findMissingMcpSecrets,
  listCredentials,
  listMcpServers,
  loadConfig,
  readCredential,
  regletHome,
  saveCredential,
  sharedMcpScope,
  providerMcpScope,
  systemSecretStore,
  type SyncedCredential,
  type McpServerDef,
} from '@reglet/core';
import { InvalidArgumentError } from 'commander';
import { printAlignedTable } from './table.js';

export async function handleSecretSet(
  id: string,
  valueArg: string | undefined,
  options: { stdin?: boolean; localOnly?: boolean; json?: boolean },
  home = regletHome(),
): Promise<void> {
  let value = valueArg;
  if (value === undefined || value.length === 0) {
    if (options.stdin === true) {
      value = (await Bun.stdin.text()).replace(/[\r\n]+$/, '');
    } else if (process.stdin.isTTY) {
      const promptValue = await password({
        message: `Enter secret value for ${id}:`,
      });
      if (isCancel(promptValue)) {
        process.exit(1);
      }
      value = String(promptValue);
    } else {
      throw new InvalidArgumentError(
        'Secret value is required as an argument, via stdin, or via interactive prompt.',
      );
    }
  }

  if (value.length === 0) {
    throw new InvalidArgumentError('Secret value must not be empty.');
  }

  if (options.localOnly === true) {
    const store = systemSecretStore();
    await store.set(id, value);
    if (options.json === true) {
      console.log(JSON.stringify({ id, storage: 'keychain', bound: true }, null, 2));
    } else {
      console.log(`✓ Saved secret ${id} to OS keychain (local-only).`);
    }
    return;
  }

  const cred: SyncedCredential = {
    version: 1,
    provider: id,
    tokenType: 'bearer',
    token: value,
    updatedAt: new Date().toISOString(),
  };
  await saveCredential(cred, home);
  if (options.json === true) {
    console.log(JSON.stringify({ id, storage: 'vault+keychain', bound: true }, null, 2));
  } else {
    console.log(`✓ Saved secret ${id} (synced in encrypted vault & stored in OS keychain).`);
  }
}

export async function handleSecretDelete(
  id: string,
  options: { yes?: boolean; json?: boolean },
  home = regletHome(),
): Promise<void> {
  if (options.yes !== true && process.stdin.isTTY) {
    const confirmed = await confirm({
      message: `Are you sure you want to delete secret ${id}?`,
    });
    if (isCancel(confirmed) || confirmed !== true) {
      console.log('Cancelled.');
      return;
    }
  }

  const existedCred = await deleteCredential(id, home);
  const store = systemSecretStore();
  await store.delete(id).catch(() => {});
  await store.delete(id.toLowerCase()).catch(() => {});

  if (options.json === true) {
    console.log(JSON.stringify({ id, deleted: true, wasPresent: existedCred }, null, 2));
  } else {
    console.log(`✓ Deleted secret ${id}.`);
  }
}

export interface SecretItemInfo {
  id: string;
  storage: 'vault+keychain' | 'keychain' | 'missing';
  bound: boolean;
  referencedBy: string[];
}

export async function collectAllSecrets(home = regletHome()): Promise<SecretItemInfo[]> {
  const creds = await listCredentials(home);
  const store = systemSecretStore();

  const serverReferences = new Map<string, Set<string>>();
  const allServers: Record<string, McpServerDef> = {};

  try {
    const sharedResult = await listMcpServers(sharedMcpScope(), home);
    for (const entry of sharedResult.servers) {
      allServers[entry.displayName || entry.id] = entry.server;
    }
  } catch {}

  for (const provider of ['claude', 'codex', 'gemini', 'opencode'] as const) {
    try {
      const scopedResult = await listMcpServers(providerMcpScope(provider), home);
      for (const entry of scopedResult.servers) {
        allServers[`${provider}:${entry.displayName || entry.id}`] = entry.server;
      }
    } catch {}
  }

  for (const [serverName, server] of Object.entries(allServers)) {
    if (server.env === undefined) continue;
    for (const [, ref] of Object.entries(server.env)) {
      const key = ref.source === 'process-env' ? ref.name : ref.source === 'oauth' ? ref.provider : ref.id;
      if (!serverReferences.has(key)) {
        serverReferences.set(key, new Set());
      }
      serverReferences.get(key)!.add(serverName);
    }
  }

  const results = new Map<string, SecretItemInfo>();

  for (const cred of creds) {
    const directRefs = serverReferences.get(cred.provider) ?? serverReferences.get(cred.provider.toUpperCase()) ?? new Set<string>();
    const aliasRefs = cred.provider.toLowerCase() === 'github'
      ? new Set<string>([...(serverReferences.get('GITHUB_PERSONAL_ACCESS_TOKEN') ?? []), ...(serverReferences.get('GITHUB_TOKEN') ?? [])])
      : new Set<string>();
    const combinedRefs: string[] = Array.from(new Set<string>([...directRefs, ...aliasRefs]));
    results.set(cred.provider, {
      id: cred.provider,
      storage: 'vault+keychain',
      bound: true,
      referencedBy: combinedRefs,
    });
  }

  const missing = await findMissingMcpSecrets(allServers, process.env, store);
  for (const item of missing) {
    if (!results.has(item.secretId)) {
      const refs = Array.from(serverReferences.get(item.secretId) ?? [item.serverName]);
      results.set(item.secretId, {
        id: item.secretId,
        storage: 'missing',
        bound: false,
        referencedBy: refs,
      });
    }
  }

  return Array.from(results.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export async function handleSecretList(
  options: { json?: boolean },
  home = regletHome(),
): Promise<void> {
  const secrets = await collectAllSecrets(home);
  if (options.json === true) {
    console.log(JSON.stringify({ version: 1, secrets }, null, 2));
    return;
  }
  if (secrets.length === 0) {
    console.log('No secrets configured.');
    return;
  }
  const rows: string[][] = [
    ['NAME', 'STORAGE', 'STATUS', 'REFERENCED BY'],
  ];
  for (const item of secrets) {
    rows.push([
      item.id,
      item.storage === 'missing' ? '-' : item.storage,
      item.bound ? 'bound' : 'MISSING',
      item.referencedBy.length > 0 ? item.referencedBy.join(', ') : '-',
    ]);
  }
  printAlignedTable(rows);
}

export async function handleSecretStatus(
  id: string,
  options: { reveal?: boolean; json?: boolean },
  home = regletHome(),
): Promise<void> {
  const cred = await readCredential(id, home);
  const store = systemSecretStore();
  const storeVal = await store.resolve(id);
  const bound = cred !== null || storeVal !== undefined || process.env[id] !== undefined;
  const storage = cred !== null ? 'vault+keychain' : storeVal !== undefined ? 'keychain' : process.env[id] !== undefined ? 'process-env' : 'unbound';

  const rawValue: string | undefined = cred?.token ?? storeVal ?? process.env[id];

  if (options.json === true) {
    console.log(JSON.stringify({
      id,
      bound,
      storage,
      ...(options.reveal === true ? { value: rawValue } : {}),
    }, null, 2));
    return;
  }

  if (!bound) {
    console.log(`secret\tunbound\t${id}`);
    return;
  }

  console.log(`Secret:      ${id}`);
  console.log(`Status:      bound`);
  console.log(`Storage:     ${storage}`);

  if (options.reveal === true) {
    if (process.stdin.isTTY) {
      const ok = await confirm({ message: `Reveal secret value for ${id}?` });
      if (!ok || isCancel(ok)) {
        console.log('Aborted.');
        return;
      }
    }
    console.log(`Value:       ${rawValue ?? ''}`);
  } else if (rawValue !== undefined && rawValue.length > 0) {
    const masked = rawValue.length > 8
      ? `${rawValue.slice(0, 3)}••••••••${rawValue.slice(-3)}`
      : '••••••••';
    console.log(`Preview:     ${masked} (${rawValue.length} characters)`);
    console.log(`             Use --reveal to view the full secret value.`);
  }
}

export async function promptMissingMcpSecrets(home = regletHome()): Promise<void> {
  if (!process.stdin.isTTY) return;
  const config = await loadConfig(home);
  const store = systemSecretStore();

  const allServers: Record<string, McpServerDef> = {};
  try {
    const sharedResult = await listMcpServers(sharedMcpScope(), home);
    for (const entry of sharedResult.servers) {
      allServers[entry.displayName || entry.id] = entry.server;
    }
  } catch {}

  for (const provider of ['claude', 'codex', 'gemini', 'opencode'] as const) {
    if (!config.providers[provider]?.mcp) continue;
    try {
      const scopedResult = await listMcpServers(providerMcpScope(provider), home);
      for (const entry of scopedResult.servers) {
        allServers[`${provider}:${entry.displayName || entry.id}`] = entry.server;
      }
    } catch {}
  }

  const missing = await findMissingMcpSecrets(allServers, process.env, store);
  if (missing.length === 0) return;

  const seen = new Set<string>();
  for (const item of missing) {
    if (seen.has(item.secretId)) continue;
    seen.add(item.secretId);

    console.log(`\n🔑 MCP server "${item.serverName}" requires secret "${item.secretId}".`);
    const action = await select({
      message: `How would you like to handle ${item.secretId}?`,
      options: [
        { value: 'vault', label: 'Enter secret now (synced in encrypted vault & saved to OS keychain)' },
        { value: 'local', label: 'Enter secret locally only (saved to OS keychain only)' },
        { value: 'skip', label: 'Skip this server for now' },
      ],
    });

    if (isCancel(action) || action === 'skip') {
      console.log(`Skipped ${item.secretId}.`);
      continue;
    }

    const val = await password({ message: `Enter secret value for ${item.secretId}:` });
    if (isCancel(val) || String(val).length === 0) {
      console.log(`Skipped ${item.secretId}.`);
      continue;
    }

    if (action === 'local') {
      await store.set(item.secretId, String(val));
      console.log(`✓ Saved secret ${item.secretId} to OS keychain (local-only).`);
    } else {
      const cred: SyncedCredential = {
        version: 1,
        provider: item.secretId,
        tokenType: 'bearer',
        token: String(val),
        updatedAt: new Date().toISOString(),
      };
      await saveCredential(cred, home);
      console.log(`✓ Saved secret ${item.secretId} (synced in encrypted vault & saved to OS keychain).`);
    }
  }
}
