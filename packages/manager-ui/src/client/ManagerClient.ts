import type {
  JsonObject,
  JsonValue,
  ManagerProtocolOperation,
  ManagerRpcInputs,
  ManagerSnapshotV3,
} from '@reglet/manager-protocol';

export interface ManagerCommandOptions {
  expectedRevision?: number;
  timeoutMs?: number;
}

export interface ManagerCommandResult<Result extends JsonValue = JsonValue> {
  revision: number;
  changed: boolean;
  data: Result;
}

export interface ManagerInvalidation {
  revision: number;
  reason: 'command' | 'filesystem' | 'sync' | 'runtime';
}

export interface ManagerClient {
  snapshot(): Promise<ManagerSnapshotV3>;
  command<Operation extends ManagerProtocolOperation>(
    operation: Operation,
    input?: ManagerRpcInputs[Operation],
    options?: ManagerCommandOptions,
  ): Promise<ManagerCommandResult>;
  subscribe(listener: (invalidation: ManagerInvalidation) => void): () => void;
}

export function jsonInput(value: JsonObject): JsonObject {
  return value;
}
