#!/usr/bin/env bun

import path from 'node:path';
import {
  ApplicationPermissionError,
  RegletApplication,
  RevisionConflictError,
  allAdapters,
  getAdapter,
  regletHome,
  type ApplicationCommand,
  type ApplicationCommandResult,
  type ArtifactKind,
  type ProviderId,
} from '@reglet/core';
import { serveRuntime, serveSync } from '@reglet/server';

const EXIT_SUCCESS = 0;
const EXIT_OPERATION_ERROR = 1;
const EXIT_DRIFT_OR_CONFLICT = 2;
const EXIT_VALIDATION_OR_BLOCKED = 3;
const EXIT_AUTH_OR_PERMISSION = 4;

interface CliContext {
  json: boolean;
  application: RegletApplication;
}

async function main(argv: string[]): Promise<number> {
  const json = takeFlag(argv, '--json');
  const context: CliContext = {
    json,
    application: new RegletApplication(),
  };
  const command = argv.shift();
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return EXIT_SUCCESS;
  }

  try {
    switch (command) {
      case 'init':
        return outputResult(await context.application.execute({ type: 'initialize' }), context);
      case 'list':
        return await listArtifacts(argv, context);
      case 'show':
        return await showArtifact(argv, context);
      case 'create':
        return await createArtifact(argv, context);
      case 'archive':
        return await lifecycleCommand('library.archive', argv, context);
      case 'restore':
        return await restoreCommand(argv, context);
      case 'unarchive':
        return await lifecycleCommand('library.restore', argv, context);
      case 'revert':
        return await restoreCommand(argv, context);
      case 'delete':
        return await deleteArtifact(argv, context);
      case 'rename':
        return await renameArtifact(argv, context);
      case 'targets':
        return await setTargets(argv, context);
      case 'enroll':
        return await enrollmentCommand(argv, context, true);
      case 'unenroll':
        return await enrollmentCommand(argv, context, false);
      case 'apply':
        return await applyProviders(argv, context);
      case 'status':
        return await status(context);
      case 'diff':
        argv.push('--dry-run');
        return await applyProviders(argv, context);
      case 'scan':
        return await providerScan(context);
      case 'project':
        return await projectCommand(argv, context);
      case 'promote':
        return await promote(argv, context);
      case 'history':
        return await history(argv, context);
      case 'activity':
        return outputResult(
          await context.application.execute({
            type: 'activity.list',
            limit: readNumberOption(argv, '--limit'),
          }),
          context,
        );
      case 'search':
        return await search(argv, context);
      case 'diagnostics':
        return outputResult(
          await context.application.execute({ type: 'diagnostics' }),
          context,
        );
      case 'open':
        return await openExternal(argv, context);
      case 'providers':
        return await providersCommand(argv, context);
      case 'serve':
        return await serveCommand(argv, context);
      case 'secret':
        return await secretCommand(argv, context);
      case 'remote':
        return await remoteCommand(argv, context);
      case 'session':
        return await sessionCommand(argv, context);
      case 'sync':
        return await syncCommand(argv, context);
      case 'undo':
        return await undo(argv, context);
      case 'trust':
        return await trustSkill(argv, context);
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    return reportError(error, context);
  }
}

async function listArtifacts(argv: string[], context: CliContext): Promise<number> {
  const kind = parseKind(argv.shift());
  const archived = takeFlag(argv, '--archived');
  const result = await context.application.execute({
    type: 'library.list',
    kind,
    lifecycle: archived ? 'archived' : undefined,
  });
  return outputResult(result, context);
}

async function showArtifact(argv: string[], context: CliContext): Promise<number> {
  const artifact = requireArgument(argv.shift(), 'artifact');
  return outputResult(
    await context.application.execute({ type: 'library.show', artifact }),
    context,
  );
}

async function createArtifact(argv: string[], context: CliContext): Promise<number> {
  const kind = parseKind(requireArgument(argv.shift(), 'artifact kind'));
  if (kind === undefined) {
    throw new Error('Artifact kind must be instructions, skills, or mcp.');
  }
  const slug = requireArgument(readOption(argv, '--slug'), '--slug');
  const title = readOption(argv, '--title') ?? titleFromSlug(slug);
  const contentPath = readOption(argv, '--from');
  const content =
    contentPath === undefined
      ? defaultArtifactContent(kind, slug)
      : await Bun.file(path.resolve(contentPath)).text();
  const targets = parseProviders(readOption(argv, '--targets'));
  return outputResult(
    await context.application.execute({
      type: 'library.create',
      kind,
      slug,
      title,
      content,
      targets,
    }),
    context,
  );
}

async function lifecycleCommand(
  type: 'library.archive' | 'library.restore',
  argv: string[],
  context: CliContext,
): Promise<number> {
  const artifact = requireArgument(argv.shift(), 'artifact');
  const command: ApplicationCommand =
    type === 'library.archive'
      ? { type, artifact }
      : { type, artifact };
  return outputResult(await context.application.execute(command), context);
}

async function deleteArtifact(argv: string[], context: CliContext): Promise<number> {
  const artifact = requireArgument(argv.shift(), 'artifact');
  const confirmed = takeFlag(argv, '--yes');
  if (!confirmed) {
    throw new Error('Permanent deletion requires --yes in non-interactive mode.');
  }
  return outputResult(
    await context.application.execute({
      type: 'library.delete',
      artifact,
      confirmed,
    }),
    context,
  );
}

async function restoreCommand(argv: string[], context: CliContext): Promise<number> {
  const reference = argv.shift();
  const provider = reference === undefined ? undefined : parseProvider(reference);
  if (reference !== undefined && provider === undefined) {
    return lifecycleCommand('library.restore', [reference, ...argv], context);
  }
  const confirmed = takeFlag(argv, '--yes');
  if (!confirmed) {
    throw new Error('Provider restore requires --yes in non-interactive mode.');
  }
  return outputResult(
    await context.application.execute({
      type: 'providers.restore',
      provider,
      confirmed,
    }),
    context,
  );
}

async function renameArtifact(argv: string[], context: CliContext): Promise<number> {
  const artifact = requireArgument(argv.shift(), 'artifact');
  const slug = requireArgument(argv.shift(), 'new slug');
  return outputResult(
    await context.application.execute({ type: 'library.rename', artifact, slug }),
    context,
  );
}

async function setTargets(argv: string[], context: CliContext): Promise<number> {
  const artifact = requireArgument(argv.shift(), 'artifact');
  const targets = parseProviders(requireArgument(argv.shift(), 'provider list'));
  return outputResult(
    await context.application.execute({
      type: 'library.targets',
      artifact,
      targets,
    }),
    context,
  );
}

async function enrollmentCommand(
  argv: string[],
  context: CliContext,
  enrolled: boolean,
): Promise<number> {
  const reference = requireArgument(argv.shift(), 'provider');
  const [providerValue, contentValue] = reference.split(':');
  const provider = parseProvider(providerValue ?? '');
  if (provider === undefined) {
    throw new Error(`Unknown provider: ${providerValue ?? ''}`);
  }
  const content =
    contentValue === undefined
      ? undefined
      : contentValue === 'rules' ||
          contentValue === 'skills' ||
          contentValue === 'mcp'
        ? contentValue
        : undefined;
  if (contentValue !== undefined && content === undefined) {
    throw new Error(`Unknown provider content: ${contentValue}`);
  }
  return outputResult(
    await context.application.execute({
      type: 'providers.enrollment',
      provider,
      content,
      enrolled,
    }),
    context,
  );
}

async function applyProviders(argv: string[], context: CliContext): Promise<number> {
  const provider = readOption(argv, '--provider');
  const content = readOption(argv, '--content');
  const result = await context.application.execute({
    type: 'providers.apply',
    providers: provider === undefined ? undefined : parseProviders(provider),
    contents:
      content === undefined
        ? undefined
        : content
            .split(',')
            .map((item) => item.trim())
            .filter(
              (item): item is 'rules' | 'skills' | 'mcp' =>
                item === 'rules' || item === 'skills' || item === 'mcp',
            ),
    dryRun: takeFlag(argv, '--dry-run'),
    allowOverwriteDrift: takeFlag(argv, '--reapply-over-drift'),
  });
  outputResult(result, context);
  const results =
    typeof result.data === 'object' &&
    result.data !== null &&
    'results' in result.data &&
    Array.isArray(result.data.results)
      ? result.data.results
      : [];
  if (results.some(hasApplyError)) {
    return EXIT_OPERATION_ERROR;
  }
  if (results.some(hasApplyBlocked)) {
    return EXIT_VALIDATION_OR_BLOCKED;
  }
  return EXIT_SUCCESS;
}

async function status(context: CliContext): Promise<number> {
  const [library, providers, diagnostics, drift] = await Promise.all([
    context.application.execute({ type: 'library.list' }),
    inventoryProviders(),
    context.application.execute({ type: 'diagnostics' }),
    context.application.execute({ type: 'providers.status' }),
  ]);
  outputValue(
    {
      revision: library.revision,
      library: library.data,
      providers,
      drift: drift.data,
      diagnostics: diagnostics.data,
    },
    context,
  );
  return Array.isArray(drift.data) &&
    drift.data.some(
      (record) =>
        typeof record === 'object' &&
        record !== null &&
        'state' in record &&
        (record.state === 'drifted' || record.state === 'missing'),
    )
    ? EXIT_DRIFT_OR_CONFLICT
    : EXIT_SUCCESS;
}

async function providerScan(context: CliContext): Promise<number> {
  return outputValue(await inventoryProviders(), context);
}

async function providersCommand(
  argv: string[],
  context: CliContext,
): Promise<number> {
  const operation = argv.shift();
  if (operation === undefined || operation === 'list') {
    return providerScan(context);
  }
  if (operation === 'purge-backups') {
    const providerName = requireArgument(argv.shift(), 'provider');
    const provider = parseProvider(providerName);
    if (provider === undefined) {
      throw new Error(`Unknown provider: ${providerName}`);
    }
    if (!takeFlag(argv, '--yes')) {
      throw new Error('Backup purge requires --yes in non-interactive mode.');
    }
    return outputResult(
      await context.application.execute({
        type: 'providers.purge-backups',
        provider,
        confirmed: true,
      }),
      context,
    );
  }
  throw new Error(
    'Usage: reglet providers [list|purge-backups <provider> --yes]',
  );
}

async function inventoryProviders(): Promise<
  Array<{
    id: ProviderId;
    displayName: string;
    detected: boolean;
    inventory: Awaited<ReturnType<ReturnType<typeof getAdapter>['inventory']>>;
    documentationUrl: string;
    lastVerifiedAt: string;
  }>
> {
  return Promise.all(
    allAdapters().map(async (adapter) => ({
      id: adapter.id,
      displayName: adapter.displayName,
      detected: await adapter.detect(),
      inventory: await adapter.inventory(),
      documentationUrl: adapter.documentationUrl,
      lastVerifiedAt: adapter.lastVerifiedAt,
    })),
  );
}

async function projectCommand(argv: string[], context: CliContext): Promise<number> {
  const subcommand = argv.shift();
  if (subcommand === 'root') {
    return projectRootCommand(argv, context);
  }
  if (subcommand === 'scan') {
    return outputResult(
      await context.application.execute({
        type: 'project.scan',
        rootId: readOption(argv, '--root'),
        reappearChangedIgnored: takeFlag(argv, '--reappear-changed-ignored'),
      }),
      context,
    );
  }
  if (subcommand === 'discoveries') {
    return outputResult(
      await context.application.execute({
        type: 'project.discoveries',
        rootId: readOption(argv, '--root'),
      }),
      context,
    );
  }
  if (subcommand === 'ignore') {
    const discoveryId = requireArgument(argv.shift(), 'discovery');
    return outputResult(
      await context.application.execute({
        type: 'project.ignore',
        discoveryId,
      }),
      context,
    );
  }
  throw new Error('Usage: reglet project root|scan|discoveries|ignore');
}

async function projectRootCommand(argv: string[], context: CliContext): Promise<number> {
  const operation = argv.shift();
  if (operation === 'add') {
    const rootPath = requireArgument(argv.shift(), 'path');
    return outputResult(
      await context.application.execute({
        type: 'project.root.add',
        path: rootPath,
        label: readOption(argv, '--label'),
      }),
      context,
    );
  }
  if (operation === 'remove') {
    const rootId = requireArgument(argv.shift(), 'root ID');
    const confirmed = takeFlag(argv, '--yes');
    if (!confirmed) {
      throw new Error('Root removal requires --yes in non-interactive mode.');
    }
    return outputResult(
      await context.application.execute({
        type: 'project.root.remove',
        rootId,
        confirmed,
      }),
      context,
    );
  }
  if (operation === 'list') {
    return outputResult(
      await context.application.execute({ type: 'project.root.list' }),
      context,
    );
  }
  throw new Error('Usage: reglet project root add|remove|list');
}

async function promote(argv: string[], context: CliContext): Promise<number> {
  const discoveryId = requireArgument(argv.shift(), 'discovery');
  const rawMode = readOption(argv, '--mode');
  const mode =
    rawMode === 'global-instruction' ||
    rawMode === 'convert-to-skill' ||
    rawMode === 'disabled-library-draft'
      ? rawMode
      : undefined;
  if (rawMode !== undefined && mode === undefined) {
    throw new Error(
      '--mode must be global-instruction, convert-to-skill, or disabled-library-draft.',
    );
  }
  if (takeFlag(argv, '--preview')) {
    return outputResult(
      await context.application.execute({
        type: 'project.promotion-preview',
        discoveryId,
        mode,
      }),
      context,
    );
  }
  const rawTargets = readOption(argv, '--targets');
  return outputResult(
    await context.application.execute({
      type: 'project.promote',
      discoveryId,
      mode,
      targets: rawTargets === undefined ? undefined : parseProviders(rawTargets),
      confirmExecutables: takeFlag(argv, '--confirm-executables'),
      destinationArtifact: readOption(argv, '--into'),
      selectedHunks: parseCommaList(readOption(argv, '--hunks')),
      selectedFiles: parseCommaList(readOption(argv, '--files')),
      serverName: readOption(argv, '--server'),
    }),
    context,
  );
}

async function history(argv: string[], context: CliContext): Promise<number> {
  const artifact = requireArgument(argv.shift(), 'artifact');
  return outputResult(
    await context.application.execute({ type: 'history.list', artifact }),
    context,
  );
}

async function undo(argv: string[], context: CliContext): Promise<number> {
  const artifact = requireArgument(argv.shift(), 'artifact');
  const revision = readOption(argv, '--revision');
  if (!takeFlag(argv, '--yes')) {
    throw new Error('History restore requires --yes in non-interactive mode.');
  }
  return outputResult(
    await context.application.execute({
      type: 'history.undo',
      artifact,
      revision,
      confirmed: true,
    }),
    context,
  );
}

async function trustSkill(
  argv: string[],
  context: CliContext,
): Promise<number> {
  const artifact = requireArgument(argv.shift(), 'skill artifact');
  if (!takeFlag(argv, '--yes')) {
    const inspection = await context.application.execute({
      type: 'library.inspect-skill',
      artifact,
    });
    outputResult(inspection, context);
    throw new Error(
      'Review the skill inventory above, then rerun with --yes to trust this revision.',
    );
  }
  return outputResult(
    await context.application.execute({
      type: 'library.trust-skill',
      artifact,
      confirmed: true,
    }),
    context,
  );
}

async function search(argv: string[], context: CliContext): Promise<number> {
  const query = requireArgument(argv.join(' ').trim(), 'query');
  return outputResult(
    await context.application.execute({ type: 'search', query }),
    context,
  );
}

async function secretCommand(argv: string[], context: CliContext): Promise<number> {
  const operation = argv.shift();
  const id = requireArgument(argv.shift(), 'secret reference ID');
  if (operation === 'status') {
    return outputResult(
      await context.application.execute({ type: 'secret.status', id }),
      context,
    );
  }
  if (operation === 'delete') {
    if (!takeFlag(argv, '--yes')) {
      throw new Error('Secret deletion requires --yes in non-interactive mode.');
    }
    return outputResult(
      await context.application.execute({ type: 'secret.delete', id }),
      context,
    );
  }
  if (operation === 'set') {
    const envName = readOption(argv, '--value-env');
    const fromStdin = takeFlag(argv, '--stdin');
    if (envName === undefined && !fromStdin) {
      throw new Error('Use --stdin or --value-env <name> in non-interactive mode.');
    }
    const value =
      envName === undefined
        ? (await Bun.stdin.text()).replace(/\r?\n$/, '')
        : process.env[envName];
    if (value === undefined || value.length === 0) {
      throw new Error('Secret value is empty or the requested environment variable is unset.');
    }
    return outputResult(
      await context.application.execute({ type: 'secret.set', id, value }),
      context,
    );
  }
  throw new Error('Usage: reglet secret set|delete|status <reference>');
}

async function remoteCommand(argv: string[], context: CliContext): Promise<number> {
  const operation = argv.shift();
  if (operation === 'enable') {
    const endpoint = requireArgument(readOption(argv, '--endpoint'), '--endpoint');
    return outputResult(
      await context.application.execute({
        type: 'remote.enable',
        endpoint,
      }),
      context,
    );
  }
  if (operation === 'disable') {
    return outputResult(
      await context.application.execute({ type: 'remote.disable' }),
      context,
    );
  }
  if (operation === 'status') {
    return outputResult(
      await context.application.execute({ type: 'remote.status' }),
      context,
    );
  }
  throw new Error('Usage: reglet remote enable|disable|status');
}

async function sessionCommand(argv: string[], context: CliContext): Promise<number> {
  const operation = argv.shift();
  if (operation === 'list') {
    return outputResult(
      await context.application.execute({ type: 'session.list' }),
      context,
    );
  }
  if (operation === 'revoke') {
    const sessionId = requireArgument(argv.shift(), 'session ID');
    if (!takeFlag(argv, '--yes')) {
      throw new Error('Session revocation requires --yes in non-interactive mode.');
    }
    return outputResult(
      await context.application.execute({
        type: 'session.revoke',
        sessionId,
      }),
      context,
    );
  }
  if (operation === 'pair') {
    const scope = readOption(argv, '--scope') ?? 'read';
    if (scope !== 'read' && scope !== 'write' && scope !== 'admin') {
      throw new Error('Pairing scope must be read, write, or admin.');
    }
    return outputResult(
      await context.application.execute({ type: 'pair.start', scope }),
      context,
    );
  }
  throw new Error('Usage: reglet session list|revoke|pair');
}

async function syncCommand(
  argv: string[],
  context: CliContext,
): Promise<number> {
  const operation = argv.shift();
  if (operation === 'status') {
    return outputResult(
      await context.application.execute({ type: 'sync.status' }),
      context,
    );
  }
  if (operation === 'configure') {
    const serverUrl = requireArgument(
      readOption(argv, '--server') ?? argv.shift(),
      'sync server URL',
    );
    return outputResult(
      await context.application.execute({
        type: 'sync.configure',
        serverUrl,
      }),
      context,
    );
  }
  if (operation === 'disable') {
    return outputResult(
      await context.application.execute({ type: 'sync.disable' }),
      context,
    );
  }
  if (operation === 'now') {
    const result = await context.application.execute({ type: 'sync.now' });
    outputResult(result, context);
    const state =
      typeof result.data === 'object' &&
      result.data !== null &&
      'state' in result.data &&
      typeof result.data.state === 'string'
        ? result.data.state
        : undefined;
    if (state === 'conflict') return EXIT_DRIFT_OR_CONFLICT;
    if (state === 'blocked') return EXIT_VALIDATION_OR_BLOCKED;
    if (state === 'error') return EXIT_OPERATION_ERROR;
    return EXIT_SUCCESS;
  }
  if (operation === 'resolve') {
    const conflictPath = requireArgument(argv.shift(), 'conflict path');
    const ours = takeFlag(argv, '--ours');
    const theirs = takeFlag(argv, '--theirs');
    if (ours === theirs) {
      throw new Error('Choose exactly one of --ours or --theirs.');
    }
    return outputResult(
      await context.application.execute({
        type: 'sync.resolve',
        path: conflictPath,
        choice: ours ? 'ours' : 'theirs',
      }),
      context,
    );
  }
  if (operation === 'serve') {
    const dataDirectory = path.resolve(
      requireArgument(readOption(argv, '--data-dir'), '--data-dir'),
    );
    const tokenEnvironment =
      readOption(argv, '--token-env') ?? 'REGLET_SYNC_SERVER_TOKEN';
    const token = process.env[tokenEnvironment];
    if (token === undefined || token.length === 0) {
      throw new Error(
        `Sync server token environment variable is unset: ${tokenEnvironment}`,
      );
    }
    const hostname = readOption(argv, '--hostname') ?? '127.0.0.1';
    const port = readPortOption(argv, '--port') ?? 4766;
    const allowPublicWildcard = takeFlag(argv, '--allow-public-wildcard');
    const allowInsecureHttp = takeFlag(argv, '--allow-insecure-http');
    const tlsCertificatePath = readOption(argv, '--tls-cert');
    const tlsPrivateKeyPath = readOption(argv, '--tls-key');
    if (
      (tlsCertificatePath === undefined) !==
      (tlsPrivateKeyPath === undefined)
    ) {
      throw new Error('--tls-cert and --tls-key must be provided together.');
    }
    if (
      !isLoopbackHost(hostname) &&
      tlsCertificatePath === undefined &&
      !allowInsecureHttp
    ) {
      throw new Error(
        'Non-loopback sync HTTP requires --allow-insecure-http. Prefer --tls-cert and --tls-key.',
      );
    }
    const tlsCertificate =
      tlsCertificatePath === undefined
        ? undefined
        : await Bun.file(path.resolve(tlsCertificatePath)).text();
    const tlsPrivateKey =
      tlsPrivateKeyPath === undefined
        ? undefined
        : await Bun.file(path.resolve(tlsPrivateKeyPath)).text();
    const server = serveSync({
      dataDirectory,
      token,
      hostname,
      port,
      allowPublicWildcard,
      tlsCertificate,
      tlsPrivateKey,
    });
    const protocol = tlsCertificate === undefined ? 'http' : 'https';
    outputValue(
      {
        listening: true,
        url: `${protocol}://${hostname}:${server.port}`,
        plaintextStorage: true,
      },
      context,
    );
    await waitForShutdownSignal();
    server.stop(true);
    return EXIT_SUCCESS;
  }
  throw new Error(
    'Usage: reglet sync configure|disable|status|now|resolve|serve',
  );
}

async function openExternal(argv: string[], context: CliContext): Promise<number> {
  const requestedPath = argv.shift() ?? regletHome();
  const targetPath = path.resolve(requestedPath);
  const configuredEditor =
    process.env.REGLET_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR;
  let command: string[];
  if (configuredEditor !== undefined && configuredEditor.trim().length > 0) {
    command = [...configuredEditor.trim().split(/\s+/), targetPath];
  } else if (process.platform === 'darwin') {
    command = ['open', targetPath];
  } else if (process.platform === 'win32') {
    command = ['cmd', '/c', 'start', '', targetPath];
  } else {
    command = ['xdg-open', targetPath];
  }
  const processHandle = Bun.spawn(command, {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const exitCode = await processHandle.exited;
  if (exitCode !== 0) {
    throw new Error(await new Response(processHandle.stderr).text());
  }
  return outputValue({ opened: targetPath }, context);
}

async function serveCommand(argv: string[], context: CliContext): Promise<number> {
  const hostname = readOption(argv, '--hostname') ?? '127.0.0.1';
  const port = readPortOption(argv, '--port') ?? 4765;
  const allowPublicWildcard = takeFlag(argv, '--allow-public-wildcard');
  const allowInsecureHttp = takeFlag(argv, '--allow-insecure-http');
  const noPair = takeFlag(argv, '--no-pair');
  const tlsCertificatePath = readOption(argv, '--tls-cert');
  const tlsPrivateKeyPath = readOption(argv, '--tls-key');
  if (
    (tlsCertificatePath === undefined) !==
    (tlsPrivateKeyPath === undefined)
  ) {
    throw new Error('--tls-cert and --tls-key must be provided together.');
  }
  if (!isLoopbackHost(hostname)) {
    const remote = await context.application.execute({ type: 'remote.status' });
    const enabled =
      typeof remote.data === 'object' &&
      remote.data !== null &&
      'enabled' in remote.data &&
      remote.data.enabled === true;
    if (!enabled) {
      throw new Error('Remote access must be explicitly enabled before non-loopback binding.');
    }
    if (tlsCertificatePath === undefined && !allowInsecureHttp) {
      throw new Error(
        'Non-loopback HTTP requires --allow-insecure-http. Prefer --tls-cert and --tls-key.',
      );
    }
  }
  const tlsCertificate =
    tlsCertificatePath === undefined
      ? undefined
      : await Bun.file(path.resolve(tlsCertificatePath)).text();
  const tlsPrivateKey =
    tlsPrivateKeyPath === undefined
      ? undefined
      : await Bun.file(path.resolve(tlsPrivateKeyPath)).text();
  await context.application.execute({ type: 'initialize' });
  const pairing = noPair
    ? undefined
    : await context.application.execute({
        type: 'pair.start',
        scope: 'admin',
      });
  const server = serveRuntime({
    hostname,
    port,
    allowPublicWildcard,
    tlsCertificate,
    tlsPrivateKey,
  });
  const protocol = tlsCertificate === undefined ? 'http' : 'https';
  const baseUrl = `${protocol}://${hostname}:${server.port}`;
  const pairingCode =
    pairing !== undefined &&
    typeof pairing.data === 'object' &&
    pairing.data !== null &&
    'code' in pairing.data &&
    typeof pairing.data.code === 'string'
      ? pairing.data.code
      : undefined;
  const pairingExpiresAt =
    pairing !== undefined &&
    typeof pairing.data === 'object' &&
    pairing.data !== null &&
    'expiresAt' in pairing.data &&
    typeof pairing.data.expiresAt === 'string'
      ? pairing.data.expiresAt
      : undefined;
  outputValue(
    {
      listening: true,
      url: baseUrl,
      managerUrl:
        pairingCode === undefined
          ? `${baseUrl}/manager/`
          : `${baseUrl}/manager/#pair=${encodeURIComponent(pairingCode)}`,
      pairingExpiresAt,
      remote: !isLoopbackHost(hostname),
    },
    context,
  );
  await waitForShutdownSignal();
  server.stop(true);
  return EXIT_SUCCESS;
}

function outputResult(result: ApplicationCommandResult, context: CliContext): number {
  return outputValue(result, context);
}

function outputValue(value: unknown, context: CliContext): number {
  if (context.json) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    printHuman(value);
  }
  return EXIT_SUCCESS;
}

function printHuman(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      printHuman(item);
    }
    if (value.length === 0) {
      console.log('No results.');
    }
    return;
  }
  if (typeof value === 'object' && value !== null) {
    if ('artifact' in value && typeof value.artifact === 'object' && value.artifact !== null) {
      console.log(JSON.stringify(value, null, 2));
      return;
    }
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(String(value));
}

function reportError(error: unknown, context: CliContext): number {
  const message = error instanceof Error ? error.message : 'Unknown operation error';
  const code =
    error instanceof ApplicationPermissionError
      ? EXIT_AUTH_OR_PERMISSION
      : error instanceof RevisionConflictError
        ? EXIT_DRIFT_OR_CONFLICT
        : isValidationError(message)
          ? EXIT_VALIDATION_OR_BLOCKED
          : EXIT_OPERATION_ERROR;
  if (context.json) {
    console.error(
      JSON.stringify({
        error: {
          code,
          name: error instanceof Error ? error.name : 'Error',
          message,
        },
      }),
    );
  } else {
    console.error(`Error: ${message}`);
  }
  return code;
}

function isValidationError(message: string): boolean {
  return /(?:invalid|requires|blocked|must|exceeds|missing)/i.test(message);
}

function hasApplyError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'error'
  );
}

function hasApplyBlocked(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'blocked'
  );
}

function parseKind(value: string | undefined): ArtifactKind | undefined {
  if (value === 'instruction' || value === 'instructions' || value === 'rules') {
    return 'instruction';
  }
  if (value === 'skill' || value === 'skills') {
    return 'skill';
  }
  if (value === 'mcp') {
    return 'mcp';
  }
  if (value === undefined || value === 'all') {
    return undefined;
  }
  throw new Error(`Unknown artifact kind: ${value}`);
}

function parseProviders(value: string | undefined): ProviderId[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }
  return value.split(',').map((item) => {
    const provider = item.trim();
    if (
      provider !== 'claude' &&
      provider !== 'codex' &&
      provider !== 'cursor' &&
      provider !== 'gemini' &&
      provider !== 'windsurf' &&
      provider !== 'opencode'
    ) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    return provider;
  });
}

function parseCommaList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseProvider(value: string): ProviderId | undefined {
  return value === 'claude' ||
    value === 'codex' ||
    value === 'cursor' ||
    value === 'gemini' ||
    value === 'windsurf' ||
    value === 'opencode'
    ? value
    : undefined;
}

function readOption(argv: string[], name: string): string | undefined {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline !== undefined) {
    argv.splice(argv.indexOf(inline), 1);
    return inline.slice(name.length + 1);
  }
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  argv.splice(index, value === undefined ? 1 : 2);
  return value;
}

function readNumberOption(argv: string[], name: string): number | undefined {
  const value = readOption(argv, name);
  if (value === undefined) {
    return undefined;
  }
  const result = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return result;
}

function readPortOption(argv: string[], name: string): number | undefined {
  const value = readOption(argv, name);
  if (value === undefined) {
    return undefined;
  }
  const result = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(result) || result < 0 || result > 65_535) {
    throw new Error(`${name} must be an integer from 0 to 65535.`);
  }
  return result;
}

function takeFlag(argv: string[], name: string): boolean {
  const index = argv.indexOf(name);
  if (index === -1) {
    return false;
  }
  argv.splice(index, 1);
  return true;
}

function requireArgument(value: string | undefined, label: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function defaultArtifactContent(kind: ArtifactKind, slug: string): string {
  if (kind === 'instruction') {
    return `# ${titleFromSlug(slug)}\n`;
  }
  if (kind === 'skill') {
    return `---\nname: ${slug}\ndescription: Describe when this skill should be used.\n---\n\n# ${titleFromSlug(slug)}\n`;
  }
  return `${JSON.stringify(
    {
      transport: 'stdio',
      command: 'command',
      args: [],
      env: {},
      secretEnv: {},
    },
    null,
    2,
  )}\n`;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      resolve();
    };
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

function printHelp(): void {
  console.log(`Reglet — local-first agent configuration manager

Usage:
  reglet init [--json]
  reglet list [instructions|skills|mcp] [--archived] [--json]
  reglet show <artifact> [--json]
  reglet create <instruction|skill|mcp> --slug <slug> [--from <file>] [--targets <providers>]
  reglet rename <artifact> <new-slug>
  reglet archive <artifact>
  reglet restore [provider] --yes
  reglet unarchive <artifact>
  reglet revert [provider] --yes
  reglet delete <artifact> --yes
  reglet targets <artifact> <provider,provider>
  reglet enroll <provider>[:rules|skills|mcp]
  reglet unenroll <provider>[:rules|skills|mcp]
  reglet apply [--provider <provider>] [--content <rules,skills,mcp>] [--dry-run] [--reapply-over-drift]
  reglet status [--json]
  reglet scan [--json]
  reglet providers [list]
  reglet providers purge-backups <provider> --yes
  reglet project root add|remove|list
  reglet project scan|discoveries|ignore
  reglet promote <discovery> [--preview] [--mode <mode>] [--targets <providers>]
    [--into <artifact>] [--hunks <ids>] [--files <paths>] [--server <name>]
    [--confirm-executables]
  reglet history <artifact>
  reglet undo <artifact> [--revision <hash>] --yes
  reglet trust <skill> --yes
  reglet secret set <reference> --stdin|--value-env <name>
  reglet secret delete <reference> --yes
  reglet secret status <reference>
  reglet remote enable --endpoint <url>
  reglet remote disable|status
  reglet session pair [--scope read|write|admin]
  reglet session list
  reglet session revoke <session-id> --yes
  reglet sync configure --server <https-url>
  reglet sync disable|status|now
  reglet sync resolve <canonical-path> --ours|--theirs
  reglet sync serve --data-dir <path> [--token-env <name>] [--hostname <host>] [--port <port>]
    [--tls-cert <pem>] [--tls-key <pem>] [--allow-insecure-http]
  reglet search <query>
  reglet activity
  reglet diagnostics
  reglet open [path]
  reglet serve [--hostname <host>] [--port <port>] [--no-pair]
    [--tls-cert <pem>] [--tls-key <pem>] [--allow-insecure-http]
    [--allow-public-wildcard]`);
}

const exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
