import { confirm, isCancel, password } from '@clack/prompts';
import { hostname } from 'node:os';
import type { Command } from 'commander';
import {
  approveSyncV2Pairing,
  bootstrapSyncV2,
  completeSyncV2Pairing,
  completeSyncV2BootstrapConnection,
  listManagedSyncV2Devices,
  loadSyncV2State,
  logoutSyncV2,
  pendingSyncV2PairingStatus,
  pendingSyncV2ConnectionStatus,
  renameManagedSyncV2Device,
  requestSyncV2Pairing,
  revokeManagedSyncV2Device,
  syncOnceV2,
  startSyncV2BootstrapConnection,
} from '@reglet/core';

export function registerSyncV2PreviewCommands(program: Command): void {
  const sync = program
    .command('sync')
    .description('Connect devices and manually exchange end-to-end encrypted library content (preview)');

  sync
    .command('connect')
    .description('Connect this machine with an invitation from a Reglet server or trusted device')
    .requiredOption('--invite <url>', 'short-lived Reglet Connect invitation URL')
    .option('--device-name <name>', 'name for this device (defaults to hostname)')
    .action(async (options: { invite: string; deviceName?: string }) => {
      const deviceName = options.deviceName?.trim() || hostname() || 'device';
      if (connectionKind(options.invite) === 'pair') {
        const request = await requestSyncV2Pairing({ connectUrl: options.invite, deviceName });
        console.log(`sync\tconnection-pending\tmethod=pair\tcode=${request.code}\texpires=${request.expiresAt}`);
        console.log('Approve this request on a connected Reglet device, then run: reglet sync connection-complete');
        return;
      }
      const request = await startSyncV2BootstrapConnection({ connectUrl: options.invite, deviceName });
      console.log(`sync\tconnection-pending\tmethod=bootstrap\tfingerprint=${request.fingerprint}\texpires=${request.expiresAt}`);
      console.log('Approve this device in the owner dashboard, compare the fingerprint, then run: reglet sync connection-complete');
    });

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
      console.log('Enter this code on an already authorized device with: reglet sync approve <code>');
    });

  sync
    .command('approve')
    .description('Authorize a pending device and show the fingerprint to compare')
    .argument('<code>')
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

  sync
    .command('run')
    .description('Manually pull and push encrypted Master changes without applying providers')
    .option('--json', 'print machine-readable result')
    .action(async (options: { json?: boolean }) => {
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
      for (const conflict of result.conflicts) console.log(`conflict\t${conflict}`);
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
      if (state === null) console.log('sync\tnot-configured');
      else if (state.phase === 'pending') {
        const deviceName = state.method === 'pair' ? state.request.deviceName : state.deviceName;
        console.log(`sync\tpending\tdevice=${deviceName}`);
      }
      else console.log(`sync\tactive\tdevice=${state.deviceName}\tcursor=${state.cursor}\tepoch=${state.keyEpoch}`);
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

function connectionKind(value: string): 'bootstrap' | 'pair' {
  try {
    return new URLSearchParams(new URL(value.trim()).hash.slice(1)).get('kind') === 'pair' ? 'pair' : 'bootstrap';
  } catch {
    return 'bootstrap';
  }
}
