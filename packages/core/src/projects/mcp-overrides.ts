import path from 'node:path';
import type { McpServerDef } from '../master.js';

export interface McpMachineOverride {
  fieldPath: string;
  value: string;
}

export interface ExtractedMcpMachineOverrides {
  definition: McpServerDef;
  overrides: McpMachineOverride[];
}

const placeholderPrefix = 'reglet://machine-override/';

export function extractMcpMachineOverrides(
  definition: McpServerDef,
  projectRoot: string,
): ExtractedMcpMachineOverrides {
  const root = path.resolve(projectRoot);
  const overrides: McpMachineOverride[] = [];
  const replace = (fieldPath: string, value: string): string => {
    if (!isProjectAbsolutePath(value, root)) return value;
    overrides.push({ fieldPath, value });
    return machineOverridePlaceholder(fieldPath);
  };
  return {
    definition: {
      ...definition,
      ...(definition.command === undefined ? {} : { command: replace('command', definition.command) }),
      ...(definition.args === undefined ? {} : {
        args: definition.args.map((value, index) => replace(`args.${index}`, value)),
      }),
    },
    overrides,
  };
}

export function resolveMcpMachineOverrides(
  definition: McpServerDef,
  values: ReadonlyMap<string, string>,
): { definition: McpServerDef; missing: string[] } {
  const missing = new Set<string>();
  const resolve = (value: string): string => {
    const fieldPath = machineOverrideField(value);
    if (fieldPath === undefined) return value;
    const replacement = values.get(fieldPath);
    if (replacement === undefined) {
      missing.add(fieldPath);
      return value;
    }
    return replacement;
  };
  return {
    definition: {
      ...definition,
      ...(definition.command === undefined ? {} : { command: resolve(definition.command) }),
      ...(definition.args === undefined ? {} : { args: definition.args.map(resolve) }),
    },
    missing: [...missing],
  };
}

export function machineOverridePlaceholder(fieldPath: string): string {
  return `${placeholderPrefix}${encodeURIComponent(fieldPath)}`;
}

function machineOverrideField(value: string): string | undefined {
  if (!value.startsWith(placeholderPrefix)) return undefined;
  try { return decodeURIComponent(value.slice(placeholderPrefix.length)); } catch { return undefined; }
}

function isProjectAbsolutePath(value: string, projectRoot: string): boolean {
  if (!path.isAbsolute(value)) return false;
  const resolved = path.resolve(value);
  return resolved === projectRoot || resolved.startsWith(`${projectRoot}${path.sep}`);
}
