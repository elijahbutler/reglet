import { confirm, isCancel, password, select, spinner, text } from '@clack/prompts';
import { hostname } from 'node:os';
import path from 'node:path';
import type { Command } from 'commander';
import {
  approveSyncV2Pairing,
  autoCompleteSyncV2Connection,
  bootstrapSyncV2,
  completeSyncV2Pairing,
  completeSyncV2BootstrapConnection,
  inspectSyncV2Conflict,
  listManagedSyncV2Devices,
  listSyncV2Conflicts,
  loadSyncV2State,
  logoutSyncV2,
  pendingSyncV2PairingStatus,
  pendingSyncV2ConnectionStatus,
  renameManagedSyncV2Device,
  requestSyncV2Pairing,
  resolveSyncV2Conflict,
  revokeManagedSyncV2Device,
  syncOnceV2,
  startSyncV2BootstrapConnection,
  waitForSyncV2ConnectionApproval,
} from '@reglet/core';

export function registerSyncV2PreviewCommands(
  program: Command,
  opts: {
    onConnected?: (result: { providerReviewRequired: boolean; forcePrompt?: boolean }) => Promise<void>;
  } = {},
): void {
  // Top-level streamlined commands
  program
    .command('connect')
    .description('Connect this device to an encrypted sync server or invitation URL')
    .argument('[target]', 'server URL or invitation link')
    .option('--invite <url>', 'short-lived Reglet Connect invitation URL')
    .option('--server <url>', 'HTTPS sync server URL')
    .option('--device-name <name>', 'name for this device (defaults to hostname)')
    .option('--no-wait', 'submit connection request without waiting for approval')
    .option('-f, --force', 'replace existing or broken sync connection')
    .action(async (target?: string, options?: { invite?: string; server?: string; deviceName?: string; wait?: boolean; force?: boolean }) => {
      await handleConnect(target, { ...(options ?? {}), onConnected: opts.onConnected });
    });

  program
    .command('approve')
    .description('Authorize a new device pairing request')
    .argument('<code>', '8-character pairing code from the new device')
    .option('-y, --yes', 'skip confirmation prompt')
    .action(async (code: string, options: { yes?: boolean }) => {
      await requireConfirmation(
        options.yes === true,
        `Approve device pairing request for code "${code}"?`,
      );
      const approval = await approveSyncV2Pairing({ code });
      console.log(`sync\tpairing-approved\tdevice=${approval.request.deviceName}`);
      console.log(`Fingerprint (SAS): ${approval.sas}`);
      console.log(`\n✓ Device "${approval.request.deviceName}" has been approved!`);
    });

  program
    .command('conflicts')
    .description('List and interactively resolve sync conflicts')
    .option('--json', 'print machine-readable list of conflicts')
    .action(async (options: { json?: boolean }) => {
      await handleConflictsCommand(options);
    });

  // Sync command group
  const sync = program
    .command('sync')
    .description('Exchange encrypted library content with your sync server')
    .action(async () => {
      const state = await loadSyncV2State();
      if (!state || state.phase !== 'active') {
        console.log('Encrypted sync is not configured on this machine.');
        console.log('To connect this device, run: reglet connect <server-url-or-invite>');
        return;
      }
      try {
        const result = await syncOnceV2();
        console.log(
          `sync\tcomplete\tpulled=${result.pulled.length}\tpushed=${result.pushed.length}` +
            `\tmerged=${result.merged.length}\tconflicts=${result.conflicts.length}\tdeleted=${result.deleted.length}`,
        );
        if (result.providerReviewRequired) {
          console.log('Pulled Master changes require local review. Run "reglet apply" to update provider files.');
        }
        printSyncConflicts(result.conflicts);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('401') || msg.includes('unauthorized')) {
          console.error('\n⚠ Sync authentication failed: 401 Unauthorized.');
          console.error('The sync server was reset or this device token was revoked.');
          console.error('To reconnect this device, run: reglet connect <new-invite> --force\n');
          process.exit(1);
        }
        throw error;
      }
    });

  sync
    .command('conflicts')
    .description('List and interactively resolve sync conflicts')
    .option('--json', 'print machine-readable list of conflicts')
    .action(async (options: { json?: boolean }) => {
      await handleConflictsCommand(options);
    });

  sync
    .command('resolve')
    .description('Resolve a sync conflict by keeping either the local or remote copy')
    .argument('<file>', 'canonical path or conflict file path')
    .option('--ours', 'keep local file')
    .option('--theirs', 'accept incoming vault file')
    .action(async (file: string, options: { ours?: boolean; theirs?: boolean }) => {
      let choice: 'ours' | 'theirs' | undefined;
      if (options.ours && options.theirs) {
        throw new Error('Cannot specify both --ours and --theirs');
      }
      if (options.ours) choice = 'ours';
      if (options.theirs) choice = 'theirs';
      if (!choice) {
        if (!process.stdin.isTTY) {
          throw new Error('Specify either --ours or --theirs for non-interactive resolution');
        }
        const selected = await select({
          message: `How would you like to resolve conflict for ${file}?`,
          options: [
            { value: 'ours', label: 'Keep local version (ours)' },
            { value: 'theirs', label: 'Accept incoming vault version (theirs)' },
          ],
        });
        if (isCancel(selected)) {
          console.log('Resolution cancelled.');
          return;
        }
        choice = selected as 'ours' | 'theirs';
      }
      const result = await resolveSyncV2Conflict(file, choice);
      console.log(`sync\tconflict-resolved\tpath=${result.path}\tchoice=${result.choice}`);
      console.log(`✓ Resolved ${result.path} (kept ${result.choice}). Run "reglet sync" to push changes.`);
    });

  sync
    .command('connect')
    .description('Connect this machine with an invitation from a Reglet server or trusted device')
    .argument('[target]', 'server URL or invitation link')
    .option('--invite <url>', 'short-lived Reglet Connect invitation URL')
    .option('--server <url>', 'HTTPS sync server URL')
    .option('--device-name <name>', 'name for this device (defaults to hostname)')
    .option('--no-wait', 'submit connection request without waiting for approval')
    .option('-f, --force', 'replace existing or broken sync connection')
    .action(async (target?: string, options?: { invite?: string; server?: string; deviceName?: string; wait?: boolean; force?: boolean }) => {
      await handleConnect(target, options ?? {});
    });

  sync
    .command('approve')
    .description('Authorize a pending device and show the fingerprint to compare')
    .argument('<code>', '8-character pairing code from the new device')
    .option('-y, --yes', 'confirm that you initiated or recognize this pairing request')
    .action(async (code: string, options: { yes?: boolean }) => {
      await requireConfirmation(
        options.yes === true,
        'Approve this device request? Only continue if you recognize the device and will compare fingerprints.',
      );
      const approval = await approveSyncV2Pairing({ code });
      console.log(`sync\tpairing-approved\tdevice=${approval.request.deviceName}`);
      console.log(`Fingerprint: ${approval.sas}`);
      console.log('Compare this exact fingerprint on the joining device before it completes pairing.');
    });

  sync
    .command('run')
    .description('Manually pull and push encrypted Master changes without applying providers')
    .option('--json', 'print machine-readable result')
    .action(async (options: { json?: boolean }) => {
      try {
        const result = await syncOnceV2();
        if (options.json === true) {
          console.log(JSON.stringify({ version: 2, ...result }, null, 2));
          return;
        }
        console.log(
          `sync\tcomplete\tpulled=${result.pulled.length}\tpushed=${result.pushed.length}` +
            `\tmerged=${result.merged.length}\tconflicts=${result.conflicts.length}\tdeleted=${result.deleted.length}`,
        );
        if (result.providerReviewRequired) {
          console.log('Pulled Master changes require local Review & Apply before provider files change.');
        }
        printSyncConflicts(result.conflicts);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('401') || msg.includes('unauthorized')) {
          console.error('\n⚠ Sync authentication failed: 401 Unauthorized.');
          console.error('The sync server was reset or this device token was revoked.');
          console.error('To reconnect this device, run: reglet connect <new-invite> --force\n');
          process.exit(1);
        }
        throw error;
      }
    });

  sync
    .command('status')
    .description('Show non-secret local encrypted sync state')
    .option('--json', 'print machine-readable status')
    .action(async (options: { json?: boolean }) => {
      const state = await loadSyncV2State();
      if (options.json === true) {
        console.log(JSON.stringify({ version: 2, configured: state !== null, state }, null, 2));
        return;
      }
      if (state === null) {
        console.log('sync\tnot-configured');
        console.log('To connect to a server, run: reglet connect <server-url-or-invite>');
      } else if (state.phase === 'pending') {
        const deviceName = state.method === 'pair' ? state.request.deviceName : state.deviceName;
        console.log(`sync\tpending\tdevice=${deviceName}\tserver=${state.serverUrl}`);
        if (state.method === 'pair') console.log(`Pairing code: ${state.request.code}`);
      } else {
        console.log(`sync\tactive\tdevice=${state.deviceName}\tserver=${state.serverUrl}\tcursor=${state.cursor}\tepoch=${state.keyEpoch}`);
        if (state.lastSync) {
          console.log(`Last sync: ${state.lastSync.completedAt} (pulled: ${state.lastSync.pulled}, pushed: ${state.lastSync.pushed})`);
        }
        if (state.lastError) {
          console.log(`Last error: ${state.lastError.occurredAt} - ${state.lastError.message}`);
        }
      }
    });

  sync
    .command('devices')
    .description('List devices from any authorized device')
    .option('--json', 'print machine-readable devices')
    .action(async (options: { json?: boolean }) => {
      const response = await listManagedSyncV2Devices();
      if (options.json === true) {
        console.log(JSON.stringify({ version: 2, ...response }, null, 2));
        return;
      }
      for (const device of response.devices) {
        const current = device.deviceId === response.currentDeviceId ? 'current' : '';
        console.log(
          `${device.deviceId}\t${device.deviceName}\t${current}\tlast-seen=${device.lastSeenAt ?? 'never'}` +
            `\trevoked=${device.revokedAt ?? 'no'}`,
        );
      }
    });

  sync
    .command('rename-device')
    .description('Rename any active device from this authorized device')
    .argument('<device-id>')
    .argument('<name>')
    .action(async (deviceId: string, name: string) => {
      await renameManagedSyncV2Device({ deviceId, name });
      console.log(`sync\tdevice-renamed\t${deviceId}\t${name.trim()}`);
    });

  sync
    .command('revoke-device')
    .description('Block a device token; epoch rotation is still required for post-compromise secrecy')
    .argument('<device-id>')
    .option('-y, --yes', 'confirm device revocation')
    .action(async (deviceId: string, options: { yes?: boolean }) => {
      await requireConfirmation(
        options.yes === true,
        'Revoke this device? It will lose server access, but preview epoch rotation is not implemented yet.',
      );
      await revokeManagedSyncV2Device({ deviceId });
      console.log(`sync\tdevice-revoked\t${deviceId}\tkey-rotation-required`);
    });

  sync
    .command('logout')
    .description('Remove local sync credentials and state without revoking the server device')
    .option('-y, --yes', 'confirm local credential removal')
    .action(async (options: { yes?: boolean }) => {
      await requireConfirmation(options.yes === true, 'Remove this device’s local encrypted sync credentials?');
      await logoutSyncV2();
      console.log('sync\tlogged-out');
    });

  // Low-level subcommands kept for backwards compatibility and detailed inspection
  sync
    .command('connection-status')
    .description('Check the pending invitation approval for this machine')
    .option('--json', 'print machine-readable status')
    .action(async (options: { json?: boolean }) => {
      const status = await pendingSyncV2ConnectionStatus();
      if (options.json === true) {
        console.log(JSON.stringify({ version: 2, ...status }, null, 2));
        return;
      }
      console.log(`sync\tconnection-${status.status}\tmethod=${status.method}\tdevice=${status.deviceName}\texpires=${status.expiresAt}`);
      if (status.method === 'pair') console.log(`Request code: ${status.code}`);
      if (status.fingerprint !== null) console.log(`Fingerprint: ${status.fingerprint}`);
    });

  sync
    .command('connection-complete')
    .description('Finish a pending connection only after comparing its fingerprint')
    .option('--fingerprint <value>', 'confirmed fingerprint for non-interactive completion')
    .action(async (options: { fingerprint?: string }) => {
      const status = await pendingSyncV2ConnectionStatus();
      if (status.fingerprint === null) throw new Error('Connection approval and fingerprint are not available yet');
      console.log(`Fingerprint: ${status.fingerprint}`);
      let confirmed = options.fingerprint;
      if (confirmed === undefined) {
        if (!process.stdin.isTTY) throw new Error('--fingerprint is required for non-interactive connection completion');
        const accepted = await confirm({ message: 'Does this exactly match the fingerprint on the approving Reglet surface?' });
        if (isCancel(accepted) || accepted !== true) throw new Error('Connection fingerprint was not confirmed');
        confirmed = status.fingerprint;
      }
      if (status.method === 'bootstrap') {
        await completeSyncV2BootstrapConnection({ confirmedFingerprint: confirmed });
      } else {
        await completeSyncV2Pairing({ confirmedSas: confirmed });
      }
      console.log('sync\tconnected\tinitial-sync=required\tprovider-apply=required');
    });

  sync
    .command('bootstrap')
    .description('Create the first encrypted vault from the homeserver bootstrap token')
    .requiredOption('--server <url>', 'HTTPS sync server URL')
    .option('--device-name <name>', 'name for this device (defaults to hostname)')
    .action(async (options: { server: string; deviceName?: string }) => {
      const deviceName = options.deviceName?.trim() || hostname() || 'device';
      await bootstrapSyncV2({
        serverUrl: options.server,
        bootstrapToken: await bootstrapToken(),
        deviceName,
      });
      console.log('sync\tbootstrapped\tprovider-apply=required');
    });

  sync
    .command('pair')
    .description('Request authorization for this new device')
    .requiredOption('--server <url>', 'HTTPS sync server URL')
    .option('--device-name <name>', 'name for this device (defaults to hostname)')
    .action(async (options: { server: string; deviceName?: string }) => {
      const deviceName = options.deviceName?.trim() || hostname() || 'device';
      const request = await requestSyncV2Pairing({ serverUrl: options.server, deviceName });
      console.log(`sync\tpairing-requested\tcode=${request.code}\texpires=${request.expiresAt}`);
      console.log('Enter this code on an already authorized device with: reglet approve <code>');
    });

  sync
    .command('pair-status')
    .description('Check this joining device pairing request')
    .option('--json', 'print machine-readable status')
    .action(async (options: { json?: boolean }) => {
      const status = await pendingSyncV2PairingStatus();
      if (options.json === true) {
        console.log(JSON.stringify({ version: 2, ...status }, null, 2));
        return;
      }
      console.log(`sync\tpairing-${status.status}\tdevice=${status.deviceName}\texpires=${status.expiresAt}`);
      if (status.sas !== null) console.log(`Fingerprint: ${status.sas}`);
    });

  sync
    .command('pair-complete')
    .description('Accept vault keys only after comparing the fingerprint with the authorized device')
    .option('--sas <fingerprint>', 'confirmed fingerprint for non-interactive completion')
    .action(async (options: { sas?: string }) => {
      const status = await pendingSyncV2PairingStatus();
      if (status.sas === null) throw new Error('Pairing has not been approved yet');
      console.log(`Fingerprint: ${status.sas}`);
      let confirmedSas = options.sas;
      if (confirmedSas === undefined) {
        if (!process.stdin.isTTY) throw new Error('--sas is required for non-interactive pairing completion');
        const accepted = await confirm({ message: 'Does this exactly match the fingerprint on the authorized device?' });
        if (isCancel(accepted) || accepted !== true) throw new Error('Pairing fingerprint was not confirmed');
        confirmedSas = status.sas;
      }
      await completeSyncV2Pairing({ confirmedSas });
      console.log('sync\tpaired\tprovider-apply=required');
    });
}

export async function handleConnect(
  targetInput?: string,
  options: {
    deviceName?: string;
    wait?: boolean;
    force?: boolean;
    invite?: string;
    server?: string;
    onConnected?: (result: { providerReviewRequired: boolean; forcePrompt?: boolean }) => Promise<void>;
  } = {},
): Promise<void> {
  let target = targetInput ?? options.invite ?? options.server;
  if (!target || target.trim().length === 0) {
    if (!process.stdin.isTTY) {
      throw new Error('A server URL or invitation link is required. Example: reglet connect https://reglet.cloudview.cc');
    }
    const input = await text({
      message: 'Enter your Reglet server URL or invitation link:',
      placeholder: 'https://reglet.cloudview.cc/connect#grant=... or https://reglet.cloudview.cc',
      validate(value) {
        if (!value || !value.trim()) return 'Server URL or invitation link is required';
        if (!value.startsWith('http://') && !value.startsWith('https://')) {
          return 'URL must start with https:// (or http:// for local development)';
        }
      },
    });
    if (isCancel(input) || !input) {
      console.log('Connect cancelled.');
      return;
    }
    target = input.trim();
  }

  const deviceName = options.deviceName?.trim() || hostname() || 'device';
  const shouldWait = options.wait !== false && process.stdin.isTTY;
  const isForce = options.force === true;
  const kind = connectionKind(target);

  if (kind === 'bootstrap') {
    const request = await startSyncV2BootstrapConnection({
      connectUrl: target,
      deviceName,
      force: isForce,
    });
    console.log(`sync\tconnection-pending\tmethod=bootstrap\tdevice=${deviceName}`);
    console.log(`Fingerprint: ${request.fingerprint}`);
    console.log(`Expires: ${request.expiresAt}\n`);

    if (!shouldWait) {
      console.log('Approve this device in the owner dashboard, compare the fingerprint, then run: reglet sync connection-complete');
      return;
    }

    const s = spinner();
    s.start('Waiting for approval in the owner dashboard... (Ctrl+C to run in background)');

    let status;
    try {
      status = await waitForSyncV2ConnectionApproval({
        timeoutMs: 300_000,
        pollIntervalMs: 1500,
      });
      s.stop('Connection approved by owner dashboard!');
    } catch (err) {
      s.stop('Waiting cancelled or timed out.');
      console.log('You can check status or complete connection later using: reglet sync connection-status');
      throw err;
    }

    await completeInteractiveConnection(status, deviceName, 'bootstrap', options);
    return;
  }

  // Pairing flow (second or later device)
  let request;
  if (target.includes('#grant=')) {
    request = await requestSyncV2Pairing({ connectUrl: target, deviceName, force: isForce });
  } else {
    request = await requestSyncV2Pairing({ serverUrl: target, deviceName, force: isForce });
  }

  console.log(`sync\tpairing-requested\tdevice=${deviceName}\tcode=${request.code}`);
  console.log(`Expires: ${request.expiresAt}\n`);
  console.log('To approve, run this command on any already-connected device:');
  console.log(`  reglet approve ${request.code}\n`);

  if (!shouldWait) {
    console.log('Once approved, run: reglet sync connection-complete');
    return;
  }

  const s = spinner();
  s.start(`Waiting for approval on another device for code: ${request.code}... (Ctrl+C to run in background)`);

  let status;
  try {
    status = await waitForSyncV2ConnectionApproval({
      timeoutMs: 300_000,
      pollIntervalMs: 1500,
    });
    s.stop(`Approved by trusted device! (Fingerprint: ${status.fingerprint})`);
  } catch (err) {
    s.stop('Waiting cancelled or timed out.');
    console.log('You can check status or complete pairing later using: reglet sync connection-status');
    throw err;
  }

  await completeInteractiveConnection(status, deviceName, 'pair', options);
}

async function completeInteractiveConnection(
  status: Awaited<ReturnType<typeof waitForSyncV2ConnectionApproval>>,
  deviceName: string,
  kind: 'bootstrap' | 'pair',
  options: {
    onConnected?: (result: { providerReviewRequired: boolean; forcePrompt?: boolean }) => Promise<void>;
  },
): Promise<void> {
  console.log(`Completing ${kind === 'bootstrap' ? 'connection' : 'pairing'}...`);
  await autoCompleteSyncV2Connection({ status });
  console.log(`\n✓ Device "${deviceName}" is paired with your encrypted vault!`);

  if (process.stdin.isTTY) {
    const nextStep = await select({
      message: 'How would you like to proceed with this device?',
      options: [
        { value: 'setup', label: 'Configure providers & sync (recommended — choose AI tools to manage)' },
        { value: 'sync', label: 'Sync everything now (pull vault content and push local configs)' },
        { value: 'later', label: 'Skip initial sync (pair only — sync later with "reglet sync")' },
      ],
    });

    if (isCancel(nextStep) || nextStep === 'later') {
      console.log('\nDevice is paired. Run "reglet sync" anytime to synchronize, or "reglet setup" to configure providers.\n');
      return;
    }

    if (nextStep === 'setup') {
      if (options.onConnected) {
        await options.onConnected({ providerReviewRequired: false, forcePrompt: true });
      }
      console.log('\nRunning sync with vault...');
      try {
        const syncResult = await syncOnceV2();
        console.log(
          `sync\t${kind === 'bootstrap' ? 'connected' : 'paired'}\tinitial-sync=complete\tpushed=${syncResult.pushed.length}\tpulled=${syncResult.pulled.length}`,
        );
        console.log(`\n✓ Device "${deviceName}" is synchronized!`);
        if (syncResult.providerReviewRequired && options.onConnected) {
          await options.onConnected({ providerReviewRequired: true });
        }
      } catch (syncErr) {
        console.warn(`\n⚠ Sync encountered an issue: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`);
        console.log('Your device remains paired. Run "reglet sync" anytime to retry.\n');
      }
      return;
    }
  }

  // Non-interactive or user chose 'sync'
  console.log('Running initial sync...');
  try {
    const syncResult = await syncOnceV2();
    console.log(
      `sync\t${kind === 'bootstrap' ? 'connected' : 'paired'}\tinitial-sync=complete\tpushed=${syncResult.pushed.length}\tpulled=${syncResult.pulled.length}`,
    );
    console.log(`\n✓ Device "${deviceName}" is synchronized!`);
    await options.onConnected?.({ providerReviewRequired: syncResult.providerReviewRequired });
  } catch (syncErr) {
    console.warn(`\n⚠ Device paired successfully, but initial sync encountered an issue:`);
    console.warn(`  ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`);
    console.log('Your device remains paired. Run "reglet sync" anytime to retry.\n');
  }
}

async function bootstrapToken(): Promise<string> {
  const environmentToken = process.env.REGLET_BOOTSTRAP_TOKEN;
  if (environmentToken !== undefined && environmentToken.length > 0) return environmentToken;
  if (!process.stdin.isTTY) throw new Error('Set REGLET_BOOTSTRAP_TOKEN for non-interactive bootstrap');
  const value = await password({ message: 'Homeserver bootstrap token' });
  if (isCancel(value) || value.length === 0) throw new Error('Bootstrap cancelled');
  return value;
}

async function requireConfirmation(alreadyConfirmed: boolean, message: string): Promise<void> {
  if (alreadyConfirmed) return;
  if (!process.stdin.isTTY) throw new Error('Use --yes for non-interactive confirmation');
  const accepted = await confirm({ message });
  if (isCancel(accepted) || accepted !== true) throw new Error('Cancelled');
}

export function connectionKind(value: string): 'bootstrap' | 'pair' {
  try {
    const url = new URL(value.trim());
    if (!url.hash.includes('grant=')) {
      return 'pair';
    }
    const params = new URLSearchParams(url.hash.slice(1));
    return params.get('kind') === 'bootstrap' ? 'bootstrap' : 'pair';
  } catch {
    return 'pair';
  }
}

function printSyncConflicts(conflicts: string[]): void {
  if (conflicts.length === 0) return;
  for (const conflict of conflicts) console.log(`conflict\t${conflict}`);
  console.log(`\n⚠ ${conflicts.length} conflict(s) detected between local files and remote vault.`);
  console.log('  Local files were preserved in ~/.reglet/<file>.');
  console.log('  Vault copies were saved as ~/.reglet/<file>.conflict-<device>.<ext>.\n');
  console.log('To resolve conflicts:');
  console.log('  • Interactive resolution:');
  console.log('      reglet sync conflicts');
  console.log('  • Keep your local version ("ours"):');
  console.log('      reglet sync resolve <file> --ours');
  console.log('  • Accept the vault version ("theirs"):');
  console.log('      reglet sync resolve <file> --theirs');
  console.log('  • Manual resolution:');
  console.log('      Edit ~/.reglet/<file> to combine changes, then delete the .conflict-* file.');
  console.log('  After resolving, run "reglet sync" to push your changes.\n');
}

async function handleConflictsCommand(options: { json?: boolean }): Promise<void> {
  const conflicts = await listSyncV2Conflicts();
  if (options.json === true) {
    console.log(JSON.stringify({ version: 2, conflicts }, null, 2));
    return;
  }
  if (conflicts.length === 0) {
    console.log('No sync conflicts detected.');
    return;
  }
  console.log(`\nFound ${conflicts.length} sync conflict(s):\n`);
  for (const item of conflicts) {
    console.log(`  • ${item.canonicalPath}`);
    console.log(`    Local:    ~/.reglet/${item.canonicalPath}`);
    console.log(`    Incoming: ~/.reglet/${path.basename(item.conflictPath)}`);
  }
  console.log('');

  if (!process.stdin.isTTY) {
    console.log('To resolve a conflict non-interactively:');
    console.log('  reglet sync resolve <file> --ours   (keep local)');
    console.log('  reglet sync resolve <file> --theirs (keep remote)');
    return;
  }

  for (const item of conflicts) {
    console.log(`\nResolving conflict for: ${item.canonicalPath}`);
    const choice = await select({
      message: `How would you like to resolve ${item.canonicalPath}?`,
      options: [
        { value: 'ours', label: 'Keep local version (ours)' },
        { value: 'theirs', label: 'Accept incoming vault version (theirs)' },
        { value: 'inspect', label: 'Inspect diff / preview versions' },
        { value: 'skip', label: 'Skip for now' },
      ],
    });
    if (isCancel(choice) || choice === 'skip') {
      console.log(`Skipped ${item.canonicalPath}.`);
      continue;
    }
    if (choice === 'inspect') {
      try {
        const preview = await inspectSyncV2Conflict(item.canonicalPath);
        console.log('\n--- Local Content ---');
        console.log(preview.local.state === 'text' ? preview.local.content : `[${preview.local.state}]`);
        console.log('--- Incoming Vault Content ---');
        console.log(preview.remote.state === 'text' ? preview.remote.content : `[${preview.remote.state}]`);
        console.log('------------------------------\n');
      } catch (err) {
        console.warn(`Could not preview: ${err instanceof Error ? err.message : String(err)}`);
      }
      const secondChoice = await select({
        message: `Choice for ${item.canonicalPath}:`,
        options: [
          { value: 'ours', label: 'Keep local version (ours)' },
          { value: 'theirs', label: 'Accept incoming vault version (theirs)' },
          { value: 'skip', label: 'Skip for now' },
        ],
      });
      if (isCancel(secondChoice) || secondChoice === 'skip') {
        console.log(`Skipped ${item.canonicalPath}.`);
        continue;
      }
      await resolveSyncV2Conflict(item.canonicalPath, secondChoice as 'ours' | 'theirs');
      console.log(`✓ Resolved ${item.canonicalPath} -> kept ${secondChoice}`);
      continue;
    }
    await resolveSyncV2Conflict(item.canonicalPath, choice as 'ours' | 'theirs');
    console.log(`✓ Resolved ${item.canonicalPath} -> kept ${choice}`);
  }

  const remaining = await listSyncV2Conflicts();
  if (remaining.length === 0) {
    console.log('\n✓ All conflicts resolved! Run "reglet sync" to push your changes to the vault.\n');
  } else {
    console.log(`\n${remaining.length} conflict(s) remaining. Run "reglet sync conflicts" anytime to continue.\n`);
  }
}
