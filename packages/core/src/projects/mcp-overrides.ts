import path from 'node:path';
import type { McpServerDefinition } from '../validation/types.js';

export interface McpMachineOverride {
  fieldPath: string;
  value: string;
}

export interface ExtractedMcpMachineOverrides {
  definition: McpServerDefinition;
  overrides: McpMachineOverride[];
}

const placeholderPrefix = 'reglet://machine-override/';

export function extractMcpMachineOverrides(
  definition: McpServerDefinition,
  projectRoot: string,
): ExtractedMcpMachineOverrides {
  const resolvedRoot = path.resolve(projectRoot);
  const overrides: McpMachineOverride[] = [];
  const replace = (fieldPath: string, value: string): string => {
    if (!isProjectAbsolutePath(value, resolvedRoot)) {
      return value;
    }
    overrides.push({ fieldPath, value });
    return machineOverridePlaceholder(fieldPath);
  };

  if (definition.transport === 'stdio') {
    return {
      definition: {
        ...definition,
        command: replace('command', definition.command),
        args: definition.args.map((value, index) => replace(`args.${index}`, value)),
        cwd:
          definition.cwd === undefined ? undefined : replace('cwd', definition.cwd),
        env: Object.fromEntries(
          Object.entries(definition.env).map(([key, value]) => [
            key,
            replace(`env.${key}`, value),
          ]),
        ),
      },
      overrides,
    };
  }
  return {
    definition: {
      ...definition,
      url: replace('url', definition.url),
      headers: Object.fromEntries(
        Object.entries(definition.headers).map(([key, value]) => [
          key,
          replace(`headers.${key}`, value),
        ]),
      ),
    },
    overrides,
  };
}

export function resolveMcpMachineOverrides(
  definition: McpServerDefinition,
  values: Map<string, string>,
): { definition: McpServerDefinition; missing: string[] } {
  const missing = new Set<string>();
  const resolve = (value: string): string => {
    const fieldPath = machineOverrideField(value);
    if (fieldPath === undefined) {
      return value;
    }
    const resolved = values.get(fieldPath);
    if (resolved === undefined) {
      missing.add(fieldPath);
      return value;
    }
    return resolved;
  };
  if (definition.transport === 'stdio') {
    return {
      definition: {
        ...definition,
        command: resolve(definition.command),
        args: definition.args.map(resolve),
        cwd: definition.cwd === undefined ? undefined : resolve(definition.cwd),
        env: Object.fromEntries(
          Object.entries(definition.env).map(([key, value]) => [key, resolve(value)]),
        ),
      },
      missing: [...missing],
    };
  }
  return {
    definition: {
      ...definition,
      url: resolve(definition.url),
      headers: Object.fromEntries(
        Object.entries(definition.headers).map(([key, value]) => [
          key,
          resolve(value),
        ]),
      ),
    },
    missing: [...missing],
  };
}

export function machineOverridePlaceholder(fieldPath: string): string {
  return `${placeholderPrefix}${encodeURIComponent(fieldPath)}`;
}

function machineOverrideField(value: string): string | undefined {
  if (!value.startsWith(placeholderPrefix)) {
    return undefined;
  }
  try {
    return decodeURIComponent(value.slice(placeholderPrefix.length));
  } catch {
    return undefined;
  }
}

function isProjectAbsolutePath(value: string, projectRoot: string): boolean {
  if (!path.isAbsolute(value)) {
    return false;
  }
  const resolved = path.resolve(value);
  return resolved === projectRoot || resolved.startsWith(`${projectRoot}${path.sep}`);
}

