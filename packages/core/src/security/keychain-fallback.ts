import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { writePrivateFile } from "../fsutil.js";
import { regletHome } from "../paths.js";

const execFileAsync = promisify(execFile);

function credentialFilePath(service: string, account: string, home?: string): string {
  const safeService = service.replace(/[^a-zA-Z0-9.-]/g, "_");
  const safeAccount = account.replace(/[^a-zA-Z0-9.-]/g, "_");
  return path.join(home ?? regletHome(), ".credentials", `${safeService}-${safeAccount}.cred`);
}

export async function resilientSecretGet(
  service: string,
  account: string,
  home?: string,
): Promise<string | null> {
  // 1. Try native @napi-rs/keyring
  try {
    const { AsyncEntry } = await import("@napi-rs/keyring");
    const entry = new AsyncEntry(service, account);
    const value = await entry.getSecret();
    if (value !== undefined && value !== null) {
      return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(value));
    }
  } catch {
    // Native keyring module unavailable or failed (e.g. cross-compiled Bun standalone binary)
  }

  // 2. On macOS, use /usr/bin/security to access native Keychain directly
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("/usr/bin/security", [
        "find-generic-password",
        "-s", service,
        "-a", account,
        "-w",
      ]);
      const secret = stdout.trimEnd();
      if (secret.length > 0) {
        return secret;
      }
    } catch {
      // Not found or error in security CLI
    }
  }

  // 3. Fallback to private file store with 0600 permissions
  try {
    const credPath = credentialFilePath(service, account, home);
    const content = await readFile(credPath, "utf8");
    return content;
  } catch {
    return null;
  }
}

export async function resilientSecretSet(
  service: string,
  account: string,
  secret: string,
  home?: string,
): Promise<void> {
  let saved = false;

  // 1. Try native @napi-rs/keyring
  try {
    const { AsyncEntry } = await import("@napi-rs/keyring");
    const entry = new AsyncEntry(service, account);
    await entry.setSecret(new TextEncoder().encode(secret));
    saved = true;
  } catch {
    // Native keyring module unavailable or failed
  }

  // 2. On macOS, use /usr/bin/security to access native Keychain directly
  if (!saved && process.platform === "darwin") {
    try {
      await execFileAsync("/usr/bin/security", [
        "add-generic-password",
        "-U",
        "-s", service,
        "-a", account,
        "-w", secret,
      ]);
      saved = true;
    } catch {
      // Keychain command failed
    }
  }

  // 3. Fallback to private file store with 0600 permissions
  if (!saved) {
    try {
      const credPath = credentialFilePath(service, account, home);
      await writePrivateFile(credPath, secret);
      saved = true;
    } catch (err) {
      throw new Error(`The operating system credential store rejected the Reglet credential update: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export async function resilientSecretDelete(
  service: string,
  account: string,
  home?: string,
): Promise<void> {
  // Clean up native keyring if present
  try {
    const { AsyncEntry } = await import("@napi-rs/keyring");
    const entry = new AsyncEntry(service, account);
    await entry.deleteCredential();
  } catch {}

  // Clean up macOS Keychain if on darwin
  if (process.platform === "darwin") {
    try {
      await execFileAsync("/usr/bin/security", [
        "delete-generic-password",
        "-s", service,
        "-a", account,
      ]);
    } catch {}
  }

  // Clean up fallback file store if present
  try {
    const credPath = credentialFilePath(service, account, home);
    await rm(credPath, { force: true });
  } catch {}
}
