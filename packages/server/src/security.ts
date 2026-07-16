import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const minimumTokenLength = 20;
const minimumPasswordLength = 12;
export const maximumPasswordLength = 1024;
const maximumDeviceNameLength = 80;

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await deriveSecret(secret, salt)).toString('hex');
  return `v1$scrypt$${salt}$${hash}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const versioned = stored.split('$');
  const [salt, hash] = versioned.length === 4 && versioned[0] === 'v1' && versioned[1] === 'scrypt'
    ? [versioned[2], versioned[3]]
    : stored.split(':');
  if (salt === undefined || hash === undefined) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await deriveSecret(secret, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function deriveSecret(secret: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, 32, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export function hashToken(token: string): string {
  return sha256(Buffer.from(token));
}

export function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export function randomToken(): string {
  return randomBytes(24).toString('base64url');
}

export function randomCode(): string {
  return randomBytes(6).toString('base64url').replaceAll('-', 'A').replaceAll('_', 'B').slice(0, 8);
}

export function accountCredentials(
  emailValue: unknown,
  passwordValue: unknown,
): { ok: true; email: string; password: string } | { ok: false; message: string } {
  if (typeof emailValue !== 'string' || typeof passwordValue !== 'string') {
    return { ok: false, message: 'email and password are required' };
  }
  const email = normalizeEmail(emailValue);
  if (email === null) return { ok: false, message: 'email is invalid' };
  if (passwordValue.length < minimumPasswordLength || passwordValue.length > maximumPasswordLength) {
    return { ok: false, message: `password must be ${minimumPasswordLength}-${maximumPasswordLength} characters` };
  }
  return { ok: true, email, password: passwordValue };
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function normalizeDeviceName(value: string): string | null {
  const name = value.trim();
  return name.length > 0 && name.length <= maximumDeviceNameLength && !/[\0-\x1f\x7f]/.test(name) ? name : null;
}

export function bearerToken(header: string | undefined): string | null {
  return header?.startsWith('Bearer ') === true ? header.slice('Bearer '.length) : null;
}

export function isSqliteConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export function assertStrongToken(token: string): void {
  if (token.trim() !== token || token.length < minimumTokenLength || new Set(token).size < 8) {
    throw new Error(`REGLET_TOKEN must be at least ${minimumTokenLength} non-whitespace characters`);
  }
}

export function isValidRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isStrictBase64(value: string): boolean {
  if (value.length === 0) return true;
  if (value.length % 4 !== 0) return false;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}
