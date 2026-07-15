export const managerProtocolVersion = 1 as const;

export * from './snapshot-v2.js';
import {
  isManagerSnapshotV2,
  type ManagerContentId,
  type ManagerProviderId,
  type ManagerSnapshotV2,
} from './snapshot-v2.js';

export const managerProtocolOperations = [
  'snapshot',
  'scan',
  'plan',
  'onboard',
  'enroll',
  'unenroll',
  'status',
  'import-drift',
  'rules.list',
  'rules.read',
  'rules.write',
  'rules.merge-runners',
  'rules.merge-draft',
  'skills.list',
  'skills.tree',
  'skills.read',
  'skills.inspect',
  'skills.write',
  'skills.create',
  'skills.delete',
  'skills.rename',
  'skills.delete-file',
  'skills.rename-file',
  'skills.adopt',
  'mcp.list',
  'mcp.upsert',
  'mcp.delete',
  'structured-preview.preview',
  'structured-preview.apply',
  'operation.restore',
  'legacy-state.clear',
] as const;

export const managerProtocolErrorCodes = [
  'MALFORMED_REQUEST',
  'UNKNOWN_PROTOCOL_VERSION',
  'UNKNOWN_OPERATION',
  'INVALID_INPUT',
  'STALE_PLAN',
  'OPERATION_FAILED',
  'INTERNAL_ERROR',
] as const;

export type ManagerProtocolVersion = typeof managerProtocolVersion;
export type ManagerProtocolOperation = (typeof managerProtocolOperations)[number];
export type ManagerProtocolErrorCode = (typeof managerProtocolErrorCodes)[number];
export type ManagerScopeKind = 'shared' | 'provider';
export type ManagerMergeRunnerId = 'codex' | 'claude' | 'gemini';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ProviderContentSelectionInput = JsonObject & {
  providers?: ManagerProviderId[];
  contents?: ManagerContentId[];
};

export type SnapshotInput = JsonObject & {
  contractVersion?: 1 | 2;
};

export type OnboardInput = ProviderContentSelectionInput & {
  stageOnly?: boolean;
};

export type ProviderTargetInput = JsonObject & {
  target?: string;
  provider?: ManagerProviderId;
  content?: ManagerContentId;
};

export type ImportDriftInput = JsonObject & {
  provider: ManagerProviderId;
  content: ManagerContentId;
  scope?: ManagerScopeKind;
};

export type PathInput = JsonObject & {
  path: string;
};

export type WriteTextInput = PathInput & {
  content: string;
};

export type RulesMergeDraftInput = JsonObject & {
  providers: ManagerProviderId[];
  runner?: ManagerMergeRunnerId;
};

export type ScopedInput = JsonObject & {
  scope?: ManagerScopeKind;
  provider?: ManagerProviderId;
};

export type SkillInput = ScopedInput & {
  name: string;
};

export type SkillPathInput = SkillInput & {
  path: string;
};

export type SkillWriteInput = SkillPathInput & {
  content: string;
};

export type SkillCreateInput = SkillInput & {
  content?: string;
};

export type SkillRenameInput = SkillInput & {
  newName: string;
};

export type SkillRenameFileInput = SkillPathInput & {
  newPath: string;
};

export type SkillInspectInput = JsonObject & {
  provider: ManagerProviderId;
  name: string;
  path?: string;
};

export type SkillAdoptInput = JsonObject & {
  provider: ManagerProviderId;
  name: string;
  scope: ManagerScopeKind;
  overwrite?: boolean;
};

export type McpListInput = ScopedInput & {
  effectiveProvider?: ManagerProviderId;
};

export type McpUpsertInput = ScopedInput & {
  id: string;
  displayName?: string;
  server: JsonObject;
};

export type McpDeleteInput = ScopedInput & {
  id: string;
};

export type StructuredPreviewApplyInput = ProviderContentSelectionInput & {
  digest: string;
};

export type IdInput = JsonObject & {
  id: string;
};

export interface ManagerRpcInputs {
  snapshot: SnapshotInput;
  scan: JsonObject;
  plan: ProviderContentSelectionInput;
  onboard: OnboardInput;
  enroll: ProviderTargetInput;
  unenroll: ProviderTargetInput;
  status: JsonObject;
  'import-drift': ImportDriftInput;
  'rules.list': JsonObject;
  'rules.read': PathInput;
  'rules.write': WriteTextInput;
  'rules.merge-runners': JsonObject;
  'rules.merge-draft': RulesMergeDraftInput;
  'skills.list': JsonObject;
  'skills.tree': SkillInput;
  'skills.read': SkillPathInput;
  'skills.inspect': SkillInspectInput;
  'skills.write': SkillWriteInput;
  'skills.create': SkillCreateInput;
  'skills.delete': SkillInput;
  'skills.rename': SkillRenameInput;
  'skills.delete-file': SkillPathInput;
  'skills.rename-file': SkillRenameFileInput;
  'skills.adopt': SkillAdoptInput;
  'mcp.list': McpListInput;
  'mcp.upsert': McpUpsertInput;
  'mcp.delete': McpDeleteInput;
  'structured-preview.preview': ProviderContentSelectionInput;
  'structured-preview.apply': StructuredPreviewApplyInput;
  'operation.restore': IdInput;
  'legacy-state.clear': JsonObject;
}

export type ManagerRpcRequestFor<Operation extends ManagerProtocolOperation> = {
  protocolVersion: ManagerProtocolVersion;
  operation: Operation;
  input?: ManagerRpcInputs[Operation];
};

export type ManagerRpcRequest = {
  [Operation in ManagerProtocolOperation]: ManagerRpcRequestFor<Operation>
}[ManagerProtocolOperation];

export interface ManagerRpcError {
  code: ManagerProtocolErrorCode;
  message: string;
  recoverable: boolean;
}

export interface ManagerRpcSuccessResponse {
  protocolVersion: ManagerProtocolVersion;
  operation: ManagerProtocolOperation;
  ok: true;
  result: JsonValue;
}

export interface ManagerRpcFailureResponse {
  protocolVersion: ManagerProtocolVersion;
  operation: ManagerProtocolOperation | 'unknown';
  ok: false;
  error: ManagerRpcError;
}

export type ManagerRpcResponse = ManagerRpcSuccessResponse | ManagerRpcFailureResponse;

export interface RuntimeValidator<T> {
  readonly schema: JsonObject;
  validate(value: unknown): value is T;
}

const providerIds: ManagerProviderId[] = ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'];
const contentIds: ManagerContentId[] = ['rules', 'skills', 'mcp'];

export const requestEnvelopeSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['protocolVersion', 'operation'],
  properties: {
    protocolVersion: { const: managerProtocolVersion },
    operation: { enum: [...managerProtocolOperations] },
    input: {},
  },
};

export const responseEnvelopeSchema: JsonObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['protocolVersion', 'operation', 'ok', 'result'],
      properties: {
        protocolVersion: { const: managerProtocolVersion },
        operation: { enum: [...managerProtocolOperations] },
        ok: { const: true },
        result: {},
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['protocolVersion', 'operation', 'ok', 'error'],
      properties: {
        protocolVersion: { const: managerProtocolVersion },
        operation: { anyOf: [{ enum: [...managerProtocolOperations] }, { const: 'unknown' }] },
        ok: { const: false },
        error: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'message', 'recoverable'],
          properties: {
            code: { enum: [...managerProtocolErrorCodes] },
            message: { type: 'string' },
            recoverable: { type: 'boolean' },
          },
        },
      },
    },
  ],
};

const providerSelectionProperties: JsonObject = {
  providers: { type: 'array', items: { enum: providerIds } },
  contents: { type: 'array', items: { enum: contentIds } },
};
const scopedProperties: JsonObject = {
  scope: { enum: ['shared', 'provider'] },
  provider: { enum: providerIds },
};

export const operationInputSchemas: Record<ManagerProtocolOperation, JsonObject> = {
  snapshot: objectSchema({ contractVersion: { enum: [1, 2] } }),
  scan: objectSchema({}),
  plan: objectSchema(providerSelectionProperties),
  onboard: objectSchema({ ...providerSelectionProperties, stageOnly: { type: 'boolean' } }),
  enroll: objectSchema({ target: { type: 'string' }, provider: { enum: providerIds }, content: { enum: contentIds } }),
  unenroll: objectSchema({ target: { type: 'string' }, provider: { enum: providerIds }, content: { enum: contentIds } }),
  status: objectSchema({}),
  'import-drift': objectSchema({ provider: { enum: providerIds }, content: { enum: contentIds }, scope: { enum: ['shared', 'provider'] } }, ['provider', 'content']),
  'rules.list': objectSchema({}),
  'rules.read': objectSchema({ path: { type: 'string' } }, ['path']),
  'rules.write': objectSchema({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  'rules.merge-runners': objectSchema({}),
  'rules.merge-draft': objectSchema({ providers: { type: 'array', items: { enum: providerIds } }, runner: { enum: ['codex', 'claude', 'gemini'] } }, ['providers']),
  'skills.list': objectSchema({}),
  'skills.tree': objectSchema({ ...scopedProperties, name: { type: 'string' } }, ['name']),
  'skills.read': objectSchema({ ...scopedProperties, name: { type: 'string' }, path: { type: 'string' } }, ['name', 'path']),
  'skills.inspect': objectSchema({ provider: { enum: providerIds }, name: { type: 'string' }, path: { type: 'string' } }, ['provider', 'name']),
  'skills.write': objectSchema({ ...scopedProperties, name: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' } }, ['name', 'path', 'content']),
  'skills.create': objectSchema({ ...scopedProperties, name: { type: 'string' }, content: { type: 'string' } }, ['name']),
  'skills.delete': objectSchema({ ...scopedProperties, name: { type: 'string' } }, ['name']),
  'skills.rename': objectSchema({ ...scopedProperties, name: { type: 'string' }, newName: { type: 'string' } }, ['name', 'newName']),
  'skills.delete-file': objectSchema({ ...scopedProperties, name: { type: 'string' }, path: { type: 'string' } }, ['name', 'path']),
  'skills.rename-file': objectSchema({ ...scopedProperties, name: { type: 'string' }, path: { type: 'string' }, newPath: { type: 'string' } }, ['name', 'path', 'newPath']),
  'skills.adopt': objectSchema({ provider: { enum: providerIds }, name: { type: 'string' }, scope: { enum: ['shared', 'provider'] }, overwrite: { type: 'boolean' } }, ['provider', 'name', 'scope']),
  'mcp.list': objectSchema({ ...scopedProperties, effectiveProvider: { enum: providerIds } }),
  'mcp.upsert': objectSchema({ ...scopedProperties, id: { type: 'string' }, displayName: { type: 'string' }, server: { type: 'object' } }, ['id', 'server']),
  'mcp.delete': objectSchema({ ...scopedProperties, id: { type: 'string' } }, ['id']),
  'structured-preview.preview': objectSchema(providerSelectionProperties),
  'structured-preview.apply': objectSchema({ ...providerSelectionProperties, digest: { type: 'string' } }, ['digest']),
  'operation.restore': objectSchema({ id: { type: 'string' } }, ['id']),
  'legacy-state.clear': objectSchema({}),
};

export const managerRpcRequestValidator: RuntimeValidator<ManagerRpcRequest> = {
  schema: requestEnvelopeSchema,
  validate: isManagerRpcRequest,
};

export const managerRpcResponseValidator: RuntimeValidator<ManagerRpcResponse> = {
  schema: responseEnvelopeSchema,
  validate: isManagerRpcResponse,
};

export const managerSnapshotV2DtoValidator: RuntimeValidator<ManagerSnapshotV2> = {
  schema: {
    type: 'object',
    required: [
      'version',
      'contract',
      'regletHome',
      'safety',
      'providerDiscovery',
      'sourceInventory',
      'enrollmentMatrix',
      'master',
      'state',
      'problems',
      'effectiveProviders',
      'structuredPlan',
      'driftInbox',
      'receipts',
      'legacyNetworkState',
    ],
    properties: {
      version: { const: 2 },
      contract: { const: 'manager-snapshot' },
    },
  },
  validate: isManagerSnapshotV2,
};

export function isManagerProtocolOperation(value: unknown): value is ManagerProtocolOperation {
  return typeof value === 'string' && managerProtocolOperations.includes(value as ManagerProtocolOperation);
}

export function isManagerProtocolErrorCode(value: unknown): value is ManagerProtocolErrorCode {
  return typeof value === 'string' && managerProtocolErrorCodes.includes(value as ManagerProtocolErrorCode);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return type !== 'number' || Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function isManagerRpcRequest(value: unknown): value is ManagerRpcRequest {
  if (!isManagerRpcEnvelope(value)) return false;
  const input = value.input ?? {};
  return isOperationInput(value.operation, input);
}

export function isManagerRpcEnvelope(value: unknown): value is {
  protocolVersion: ManagerProtocolVersion;
  operation: ManagerProtocolOperation;
  input?: JsonObject;
} {
  if (!isRecord(value)) return false;
  return value.protocolVersion === managerProtocolVersion &&
    isManagerProtocolOperation(value.operation) &&
    hasOnlyKeys(value, ['protocolVersion', 'operation', 'input']) &&
    (value.input === undefined || isJsonObject(value.input));
}

export function isManagerRpcResponse(value: unknown): value is ManagerRpcResponse {
  if (!isRecord(value)) return false;
  if (value.protocolVersion !== managerProtocolVersion) return false;
  if (value.ok === true) {
    return hasOnlyKeys(value, ['protocolVersion', 'operation', 'ok', 'result']) &&
      isManagerProtocolOperation(value.operation) && isJsonValue(value.result);
  }
  if (value.ok !== false) return false;
  if (!hasOnlyKeys(value, ['protocolVersion', 'operation', 'ok', 'error'])) return false;
  if (!(isManagerProtocolOperation(value.operation) || value.operation === 'unknown')) return false;
  if (!isRecord(value.error)) return false;
  return hasOnlyKeys(value.error, ['code', 'message', 'recoverable']) &&
    isManagerProtocolErrorCode(value.error.code) &&
    typeof value.error.message === 'string' &&
    typeof value.error.recoverable === 'boolean';
}

export function successResponse(
  operation: ManagerProtocolOperation,
  result: JsonValue,
): ManagerRpcSuccessResponse {
  return {
    protocolVersion: managerProtocolVersion,
    operation,
    ok: true,
    result,
  };
}

export function failureResponse(
  operation: ManagerProtocolOperation | 'unknown',
  code: ManagerProtocolErrorCode,
  message: string,
  recoverable: boolean,
): ManagerRpcFailureResponse {
  return {
    protocolVersion: managerProtocolVersion,
    operation,
    ok: false,
    error: { code, message, recoverable },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectSchema(properties: JsonObject, required: string[] = []): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length === 0 ? {} : { required }),
  };
}

function isOperationInput(operation: ManagerProtocolOperation, input: JsonObject): boolean {
  switch (operation) {
    case 'snapshot':
      return exact(input, ['contractVersion']) && (input.contractVersion === undefined || input.contractVersion === 1 || input.contractVersion === 2);
    case 'scan':
    case 'status':
    case 'rules.list':
    case 'rules.merge-runners':
    case 'skills.list':
    case 'legacy-state.clear':
      return exact(input, []);
    case 'plan':
    case 'structured-preview.preview':
      return isProviderSelection(input);
    case 'onboard':
      return isProviderSelection(input, ['stageOnly']) && optionalBoolean(input.stageOnly);
    case 'enroll':
    case 'unenroll':
      return exact(input, ['target', 'provider', 'content']) &&
        ((typeof input.target === 'string' && input.provider === undefined && input.content === undefined) ||
          (isProvider(input.provider) && optionalContent(input.content) && input.target === undefined));
    case 'import-drift':
      return exact(input, ['provider', 'content', 'scope']) && isProvider(input.provider) && isContent(input.content) && optionalScope(input.scope);
    case 'rules.read':
      return exact(input, ['path']) && typeof input.path === 'string';
    case 'rules.write':
      return exact(input, ['path', 'content']) && typeof input.path === 'string' && typeof input.content === 'string';
    case 'rules.merge-draft':
      return exact(input, ['providers', 'runner']) && isProviderArray(input.providers) &&
        (input.runner === undefined || input.runner === 'codex' || input.runner === 'claude' || input.runner === 'gemini');
    case 'skills.tree':
    case 'skills.delete':
      return isSkillBase(input, []);
    case 'skills.read':
    case 'skills.delete-file':
      return isSkillBase(input, ['path']) && typeof input.path === 'string';
    case 'skills.write':
      return isSkillBase(input, ['path', 'content']) && typeof input.path === 'string' && typeof input.content === 'string';
    case 'skills.create':
      return isSkillBase(input, ['content']) && optionalString(input.content);
    case 'skills.rename':
      return isSkillBase(input, ['newName']) && typeof input.newName === 'string';
    case 'skills.rename-file':
      return isSkillBase(input, ['path', 'newPath']) && typeof input.path === 'string' && typeof input.newPath === 'string';
    case 'skills.inspect':
      return exact(input, ['provider', 'name', 'path']) && isProvider(input.provider) && typeof input.name === 'string' && optionalString(input.path);
    case 'skills.adopt':
      return exact(input, ['provider', 'name', 'scope', 'overwrite']) && isProvider(input.provider) &&
        typeof input.name === 'string' && (input.scope === 'shared' || input.scope === 'provider') && optionalBoolean(input.overwrite);
    case 'mcp.list':
      return exact(input, ['scope', 'provider', 'effectiveProvider']) && isValidScope(input) && optionalProvider(input.effectiveProvider);
    case 'mcp.upsert':
      return exact(input, ['scope', 'provider', 'id', 'displayName', 'server']) && isValidScope(input) &&
        typeof input.id === 'string' && optionalString(input.displayName) && isJsonObject(input.server);
    case 'mcp.delete':
      return exact(input, ['scope', 'provider', 'id']) && isValidScope(input) && typeof input.id === 'string';
    case 'structured-preview.apply':
      return isProviderSelection(input, ['digest']) && typeof input.digest === 'string';
    case 'operation.restore':
      return exact(input, ['id']) && typeof input.id === 'string';
  }
}

function isProviderSelection(input: JsonObject, extraKeys: string[] = []): boolean {
  return exact(input, ['providers', 'contents', ...extraKeys]) && optionalProviderArray(input.providers) && optionalContentArray(input.contents);
}

function isSkillBase(input: JsonObject, extraKeys: string[]): boolean {
  return exact(input, ['scope', 'provider', 'name', ...extraKeys]) && isValidScope(input) && typeof input.name === 'string';
}

function isValidScope(input: JsonObject): boolean {
  return (input.scope === undefined || input.scope === 'shared')
    ? input.provider === undefined
    : input.scope === 'provider' && isProvider(input.provider);
}

function exact(input: JsonObject, keys: string[]): boolean {
  return hasOnlyKeys(input, keys);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isProvider(value: unknown): value is ManagerProviderId {
  return typeof value === 'string' && providerIds.includes(value as ManagerProviderId);
}

function isContent(value: unknown): value is ManagerContentId {
  return typeof value === 'string' && contentIds.includes(value as ManagerContentId);
}

function isProviderArray(value: unknown): value is ManagerProviderId[] {
  return Array.isArray(value) && value.every(isProvider);
}

function optionalProviderArray(value: unknown): boolean {
  return value === undefined || isProviderArray(value);
}

function optionalContentArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(isContent));
}

function optionalProvider(value: unknown): boolean {
  return value === undefined || isProvider(value);
}

function optionalContent(value: unknown): boolean {
  return value === undefined || isContent(value);
}

function optionalScope(value: unknown): boolean {
  return value === undefined || value === 'shared' || value === 'provider';
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}
