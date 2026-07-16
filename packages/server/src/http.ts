import { isAllowedSyncPath } from '@reglet/core';

export interface JsonResponse {
  [key: string]: unknown;
}

export interface ErrorBody extends JsonResponse {
  error: { code: string; message: string };
}

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  key?: (request: Request) => string;
  trustProxy?: boolean;
}

export interface RateLimiter {
  check: (request: Request, bucket: 'auth' | 'pair' | 'admin') => { ok: true } | { ok: false };
}

const defaultRateLimitWindowMs = 60 * 1000;
const defaultRateLimitMax = 60;

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; code: string; message: string };

export async function readJsonBody(request: Request, limitBytes: number): Promise<JsonParseResult> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > limitBytes) {
      return { ok: false, status: 413, code: 'body_too_large', message: 'request body is too large' };
    }
  }

  const body = await readLimitedText(request, limitBytes);
  if (!body.ok) {
    return { ok: false, status: 413, code: 'body_too_large', message: 'request body is too large' };
  }

  try {
    return { ok: true, value: JSON.parse(body.text) as unknown };
  } catch {
    return { ok: false, status: 400, code: 'invalid_json', message: 'request body must be valid JSON' };
  }
}

async function readLimitedText(
  request: Request,
  limitBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  if (request.body === null) return { ok: true, text: '' };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > limitBytes) {
      await reader.cancel();
      return { ok: false };
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return { ok: true, text: text + decoder.decode() };
}

export function syncFilePath(request: Request): string | null {
  const rawPath = new URL(request.url).pathname;
  const prefix = '/v1/files/';
  if (!rawPath.startsWith(prefix)) return null;
  const rawFilePath = rawPath.slice(prefix.length);
  if (rawFilePath.length === 0 || containsEncodedSlash(rawFilePath)) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawFilePath);
  } catch {
    return null;
  }
  if (
    decoded !== rawFilePath &&
    (containsEncodedTraversal(rawFilePath) || containsEncodedTraversal(decoded) || containsEncodedSlash(decoded))
  ) {
    return null;
  }
  return isAllowedSyncPath(decoded) ? decoded : null;
}

function containsEncodedSlash(rawPath: string): boolean {
  return /%2f|%5c/i.test(rawPath);
}

function containsEncodedTraversal(rawPath: string): boolean {
  return /%2e/i.test(rawPath) && decodedSegments(rawPath).includes('..');
}

function decodedSegments(rawPath: string): string[] {
  try {
    return decodeURIComponent(rawPath).split('/');
  } catch {
    return [];
  }
}

export function createRateLimiter(
  options: RateLimitOptions | false | undefined,
  now: () => Date,
): RateLimiter {
  if (options === false) return { check: () => ({ ok: true }) };
  const windowMs = options?.windowMs ?? defaultRateLimitWindowMs;
  const max = options?.max ?? defaultRateLimitMax;
  const keyFor = options?.key ?? ((request: Request) => defaultRateLimitKey(request, options?.trustProxy === true));
  const buckets = new Map<string, { resetAt: number; count: number }>();

  return {
    check(request, bucket) {
      const key = `${bucket}:${keyFor(request)}`;
      const timestamp = now().getTime();
      const current = buckets.get(key);
      if (current === undefined || current.resetAt <= timestamp) {
        buckets.set(key, { resetAt: timestamp + windowMs, count: 1 });
        return { ok: true };
      }
      current.count += 1;
      return current.count > max ? { ok: false } : { ok: true };
    },
  };
}

function defaultRateLimitKey(request: Request, trustProxy: boolean): string {
  if (!trustProxy) return 'global';
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'global';
}
