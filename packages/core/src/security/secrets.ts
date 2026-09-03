export type SecretRef =
  | { source: 'keychain'; id: string; required?: boolean }
  | { source: 'process-env'; name: string; required?: boolean }
  | { source: 'oauth'; provider: string; required?: boolean };

import {
  resilientSecretDelete,
  resilientSecretGet,
  resilientSecretSet,
} from './keychain-fallback.js';

export interface SecretBinding {
  id: string;
  bound: boolean;
}

export interface SecretStore {
  set(id: string, value: string): Promise<SecretBinding>;
  delete(id: string): Promise<SecretBinding>;
  status(id: string): Promise<SecretBinding>;
  /** Projection-only access. Never expose the returned value through APIs or logs. */
  resolve(id: string): Promise<string | undefined>;
}

const service = 'build.reglet.mcp';
const secretIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const maximumSecretBytes = 64 * 1024;

export function systemSecretStore(platform = process.platform): SecretStore {
  if (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') {
    throw new Error(`Operating-system credential storage is unavailable on ${platform}.`);
  }
  return new NativeSecretStore();
}

class NativeSecretStore implements SecretStore {
  async set(id: string, value: string): Promise<SecretBinding> {
    validateSecretInput(id, value);
    try {
      await resilientSecretSet(service, id, value);
      return { id, bound: true };
    } catch {
      throw new Error('The operating-system credential store rejected the Reglet secret update.');
    }
  }

  async delete(id: string): Promise<SecretBinding> {
    validateSecretId(id);
    try {
      await resilientSecretDelete(service, id);
    } catch {
      if ((await this.status(id)).bound) {
        throw new Error('The operating-system credential store rejected the Reglet secret deletion.');
      }
    }
    return { id, bound: false };
  }

  async status(id: string): Promise<SecretBinding> {
    return { id, bound: (await this.resolve(id)) !== undefined };
  }

  async resolve(id: string): Promise<string | undefined> {
    validateSecretId(id);
    try {
      const secret = await resilientSecretGet(service, id);
      if (secret === null) return undefined;
      requireBoundedSecret(secret);
      return secret;
    } catch {
      throw new Error('The operating-system credential store is unavailable.');
    }
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly bindings = new Map<string, string>();

  async set(id: string, value: string): Promise<SecretBinding> {
    validateSecretInput(id, value);
    this.bindings.set(id, value);
    return { id, bound: true };
  }

  async delete(id: string): Promise<SecretBinding> {
    validateSecretId(id);
    this.bindings.delete(id);
    return { id, bound: false };
  }

  async status(id: string): Promise<SecretBinding> {
    validateSecretId(id);
    return { id, bound: this.bindings.has(id) };
  }

  async resolve(id: string): Promise<string | undefined> {
    validateSecretId(id);
    return this.bindings.get(id);
  }
}

export async function secretReferenceStatus(
  reference: SecretRef,
  store: SecretStore = systemSecretStore(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ reference: SecretRef; bound: boolean }> {
  if (reference.source === 'process-env') {
    return { reference, bound: env[reference.name] !== undefined };
  }
  if (reference.source === 'oauth') {
    const provider = reference.provider.toLowerCase();
    const bound = (await store.status(`oauth-${provider}`)).bound || (await store.status(`${provider}-token`)).bound;
    return { reference, bound };
  }
  return { reference, bound: (await store.status(reference.id)).bound };
}

export function isSecretRef(value: unknown): value is SecretRef {
  if (!isRecord(value) || (value.required !== undefined && typeof value.required !== 'boolean')) {
    return false;
  }
  if (value.source === 'process-env') {
    return typeof value.name === 'string' && secretIdPattern.test(value.name);
  }
  if (value.source === 'keychain') {
    return typeof value.id === 'string' && secretIdPattern.test(value.id);
  }
  if (value.source === 'oauth') {
    return typeof value.provider === 'string' && secretIdPattern.test(value.provider);
  }
  return false;
}

function validateSecretInput(id: string, value: string): void {
  validateSecretId(id);
  if (value.length === 0) throw new Error('Secret value must not be empty.');
  requireBoundedSecret(value);
}

function validateSecretId(id: string): void {
  if (!secretIdPattern.test(id)) {
    throw new Error('Secret reference ID contains unsupported characters.');
  }
}

function requireBoundedSecret(value: string): void {
  if (Buffer.byteLength(value, 'utf8') > maximumSecretBytes) {
    throw new Error('Secret value is too large.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
