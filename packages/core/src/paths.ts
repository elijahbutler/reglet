import { homedir } from 'node:os';
import path from 'node:path';

export function regletHome(): string {
  return process.env.REGLET_HOME ?? path.join(homedir(), '.reglet');
}

export function providerHome(): string {
  return process.env.REGLET_PROVIDER_HOME ?? homedir();
}
