import { invoke } from '@tauri-apps/api/core';
import {
  managerProtocolVersion,
  managerRpcResponseValidator,
  managerSnapshotV2DtoValidator,
  type JsonObject,
  type JsonValue,
  type ManagerProtocolOperation,
  type ManagerRpcInputs,
  type ManagerRpcRequestFor,
  type ManagerRpcResponse,
  type ManagerSnapshotV2,
} from '@reglet/manager-protocol';

export interface ManagerBridge {
  rpc<Operation extends ManagerProtocolOperation>(
    operation: Operation,
    input?: ManagerRpcInputs[Operation],
  ): Promise<JsonValue>;
  snapshot(): Promise<ManagerSnapshotV2>;
  checkForUpdates(): Promise<UpdateCheckResult>;
  openRelease(): Promise<void>;
  openFileLocation(path: string): Promise<void>;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  releaseUrl: string;
}

export const tauriBridge: ManagerBridge = {
  async rpc(operation, input) {
    return managerRpc(operation, input);
  },
  async snapshot() {
    const result = await managerRpc('snapshot', { contractVersion: 2 });
    if (!managerSnapshotV2DtoValidator.validate(result)) {
      throw new Error('Reglet rejected an invalid Manager snapshot v2 response.');
    }
    return result;
  },
  async checkForUpdates() {
    const result = await invoke<unknown>('check_for_updates');
    if (!isUpdateCheckResult(result)) {
      throw new Error('Reglet returned an invalid update response.');
    }
    return result;
  },
  async openRelease() {
    await invoke('open_release');
  },
  async openFileLocation(path) {
    await invoke('open_file_location', { path });
  },
};

export async function managerRpc<Operation extends ManagerProtocolOperation>(
  operation: Operation,
  input?: ManagerRpcInputs[Operation],
): Promise<JsonValue> {
  const request: ManagerRpcRequestFor<Operation> = {
    protocolVersion: managerProtocolVersion,
    operation,
    ...(input === undefined ? {} : { input }),
  };
  let raw: unknown;
  try {
    raw = await invoke<unknown>('manager_rpc', { request });
  } catch (error) {
    throw new Error(formatInvokeRejection(error));
  }
  if (!managerRpcResponseValidator.validate(raw)) {
    throw new Error('Reglet sidecar returned an invalid RPC envelope.');
  }
  return unwrapRpcResponse(raw, operation);
}

export function unwrapRpcResponse(response: ManagerRpcResponse, expectedOperation: ManagerProtocolOperation): JsonValue {
  if (response.operation !== expectedOperation) {
    throw new Error(`Reglet sidecar returned ${response.operation} for ${expectedOperation}.`);
  }
  if (response.ok) {
    return response.result;
  }
  throw new Error(`${response.error.code}: ${response.error.message}`);
}

export function jsonObject(value: JsonValue): JsonObject {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value;
  }
  throw new Error('Expected RPC result object.');
}

function formatInvokeRejection(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const candidate = (error as { error?: unknown }).error;
    if (typeof candidate === 'object' && candidate !== null && 'message' in candidate) {
      return String((candidate as { message?: unknown }).message);
    }
  }
  return 'Reglet sidecar rejected the RPC request.';
}

function isUpdateCheckResult(value: unknown): value is UpdateCheckResult {
  return typeof value === 'object' && value !== null &&
    'currentVersion' in value && typeof value.currentVersion === 'string' &&
    'latestVersion' in value && typeof value.latestVersion === 'string' &&
    'available' in value && typeof value.available === 'boolean' &&
    'releaseUrl' in value && typeof value.releaseUrl === 'string' &&
    value.releaseUrl.startsWith('https://github.com/elijahbutler/reglet/releases/');
}
