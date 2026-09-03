#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { isCancel, multiselect, outro, select } from '@clack/prompts';
import { Command, InvalidArgumentError } from 'commander';
import {
  failureResponse,
  isJsonObject,
  isManagerRpcEnvelope,
  isManagerProtocolOperation,
  isManagerProtocolVersion,
  legacyManagerProtocolVersion,
  managerProtocolVersion,
  managerRpcRequestValidator,
  successResponse,
  type JsonObject,
  type JsonValue,
  type ManagerArtifactKind,
  type ManagerProtocolErrorCode,
  type ManagerProtocolOperation,
  type ManagerProtocolVersion,
  type ManagerRpcInputs,
  type ManagerRpcRequest,
  type ManagerRpcResponse,
  type SyncRunResult,
  type SyncSnapshot,
} from '@reglet/manager-protocol';
import {
  type ApplicationCommand,
  ApplicationPermissionError,
  RegletApplication,
  RevisionConflictError,
} from '@reglet/manager-application';
import {
  applyAll,
  applyLibraryMigration,
  applyStructuredPreview,
  adoptSkill,
  createSkill,
  detachManagedContent,
  deleteMcpServer,
  deleteSkill,
  deleteSkillFile,
  detectDrift,
  describeUnmanagedSkill,
  getAdapter,
  effectiveMcpServerSummary,
  importDriftedMcp,
  importDriftedRules,
  importDriftedSkills,
  initMasterDir,
  loadConfig,
  loadManifest,
  loadMasterDir,
  listMcpServers,
  listEffectiveMcpServers,
  listOperationReceipts,
  listManagedSkillTrees,
  libraryMigrationStatus,
  listSkills,
  listUnmanagedSkills,
  type McpServerDef,
  previewApplyStructured,
  previewLibraryMigration,
  PROVIDER_RULES_MARKER,
  readProviderMcpServers,
  readSkillFile,
  readUnmanagedSkillFile,
  regletHome,
  isCanonicalMcpServerDef,
  validateMcpServer,
  inventoryItems,
  managerErrorFromUnknown,
  managerIssue,
  managerIssueMessage,
  mcpServerSummary,
  needsAttentionCapability,
  publicReleaseCapabilities,
  providerMcpScope,
  receiptDetail,
  receiptListItem,
  redactManagerValue,
  deriveMasterRevisions,
  sha256String,
  supportedCapability,
  inspectLegacySyncState,
  unsupportedCapability,
  validateManagerSnapshotV2,
  clearLegacySyncState,
  getOperationReceipt,
  restoreOperationReceipt,
  recoverPendingOperations,
  restore,
  revert,
  renameSkill,
  renameSkillFile,
  renameMcpServerDisplayName,
  readMcpServer,
  saveConfig,
  serializeMcpServers,
  type ApplyContent,
  type ApplyResult,
  type DriftRecord,
  type ProviderId,
  type ProviderInventory,
  type SkillAdoptionScope,
  type SkillScope,
  type CapabilityState,
  type ManagerContractVersion,
  type ManagerDriftInboxItemV2,
  type ManagerDerivedStateV2,
  type ManagerEffectiveProviderCompositionV2,
  type ManagerEnrollmentProviderV2,
  type ManagerIssueCodeV2,
  type ManagerIssueV2,
  type ManagerMasterSummaryV2,
  type ManagerProviderDiscoveryV2,
  type ManagerSnapshotV2,
  type ManagerSourceInventoryItemV2,
  type ManagerStructuredPlanEntryV2,
  type McpScope,
  resolveEffectiveMcpServersEnv,
  sharedMcpScope,
  upsertMcpServer,
  updateMcpSyncProviders,
  updateSkillSyncProviders,
  writeSkillFile,
  approveSyncV2Pairing,
  cancelPendingSyncV2Connection,
  completeSyncV2BootstrapConnection,
  completeSyncV2Pairing,
  createManagedSyncV2Invitation,
  disconnectSyncV2,
  listManagedSyncV2Devices,
  loadSyncV2State,
  pendingSyncV2ConnectionStatus,
  renameManagedSyncV2Device,
  requestSyncV2Pairing,
  revokeManagedSyncV2Device,
  saveSyncV2State,
  startSyncV2BootstrapConnection,
  syncOnceV2,
  listCredentials,
} from '@reglet/core';
import { allAdapters } from '@reglet/core';
import {
  daemonServiceSpec,
  daemonStatus,
  daemonUninstallSpec,
  installDaemon,
  runDaemon,
  startDaemon,
  stopDaemon,
  uninstallDaemon,
} from './daemon.js';
import { handleConnect, registerSyncV2PreviewCommands } from './sync-preview.js';
import { registerAuthCommands } from './auth.js';
import { serveManagerRuntime } from '@reglet/manager-runtime';

const providerIds = ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'] as const;
const contentIds = ['rules', 'skills', 'mcp'] as const;
const rulesPreviewLimit = 800;
const rulesSteeringPromptLimit = 4_000;

type ContentId = (typeof contentIds)[number];

const program = new Command();
const version = process.env.REGLET_VERSION ?? '0.5.1';
const managerApplication = new RegletApplication();

program
  .name('reglet')
  .description('Manage global AI agent rules, skills, and MCP configs')
  .version(version);

program
  .command('setup')
  .alias('init')
  .description('Interactive onboarding: detect providers, configure sync, and connect')
  .option('-y, --yes', 'run non-interactively and enroll detected providers')
  .option('-p, --provider <provider...>', 'provider(s) to enroll/import', parseProviderList)
  .option('-c, --content <content...>', 'content type(s) to import/apply', parseContentList)
  .option('--no-apply', 'stage enrollment and imported master content without provider writes')
  .action(async (options: { yes?: boolean; provider?: ProviderId[]; content?: ApplyContent[]; apply?: boolean }) => {
    await initMasterDir();
    if (options.yes === true || options.provider !== undefined || options.content !== undefined) {
      const providers = options.provider ?? (await detectedProviderIds());
      const contents = options.content ?? [...contentIds];
      await runOnboarding(providers, contents, options.apply !== false);
      console.log(`Initialized ${regletHome()}`);
    } else if (process.stdin.isTTY) {
      await runInteractiveOnboarding();
    } else {
      console.log(`Initialized master directory at ${regletHome()}`);
    }
  });

program
  .command('status')
  .description('Show full system status: providers, sync connection, and credentials')
  .option('--check', 'exit with 2 when drift is found')
  .option('--json', 'print machine-readable JSON')
  .action(async (options: { check?: boolean; json?: boolean }) => {
    if (options.json === true) {
      const status = await buildStatusJson();
      printJson(status);
      if (options.check === true && status.driftedCount > 0) {
        process.exitCode = 2;
      }
      return;
    }

    const config = await loadConfig();
    const syncState = await loadSyncV2State().catch(() => null);
    const creds = await listCredentials().catch(() => []);

    const providerSummaries = [];
    for (const adapter of allAdapters()) {
      const detected = await adapter.detect().catch(() => false);
      const enrolled = config.providers[adapter.id]?.enabled ?? false;
      const rules = config.providers[adapter.id]?.rules ?? false;
      const skills = config.providers[adapter.id]?.skills ?? false;
      const mcp = config.providers[adapter.id]?.mcp ?? false;
      if (detected || enrolled) {
        providerSummaries.push({
          id: adapter.id,
          name: adapter.displayName,
          installed: detected,
          enrolled,
          content: [rules ? 'rules' : null, skills ? 'skills' : null, mcp ? 'mcp' : null].filter(Boolean) as string[],
        });
      }
    }

    console.log(`\nReglet v${version} · System Status\n`);

    console.log('AI Providers:');
    if (providerSummaries.length === 0) {
      console.log('  No AI coding assistants detected yet. Run "reglet setup" to configure providers.\n');
    } else {
      for (const p of providerSummaries) {
        const dot = p.enrolled ? '●' : '○';
        const status = p.enrolled ? `enrolled (${p.content.join(', ') || 'all'})` : 'available (not enrolled)';
        console.log(`  ${dot} ${p.name.padEnd(16)} ${status}`);
      }
      console.log('');
    }

    console.log('Encrypted Sync:');
    if (!syncState) {
      console.log('  ○ Not connected (Local-only mode)');
      console.log('  To connect across devices, run: reglet connect <server-url-or-invite>\n');
    } else if (syncState.phase === 'pending') {
      const pendingDevice = syncState.method === 'pair' ? syncState.request.deviceName : syncState.deviceName;
      console.log(`  ⏳ Pending approval for device: ${pendingDevice}`);
      console.log(`  Server: ${syncState.serverUrl}`);
      if (syncState.method === 'pair') {
        console.log(`  Pairing code: ${syncState.request.code} (run "reglet approve ${syncState.request.code}" on an authorized device)`);
      } else {
        console.log(`  Fingerprint: ${syncState.fingerprint} (waiting for owner approval in dashboard)`);
      }
      console.log('');
    } else {
      console.log(`  ● Connected to ${syncState.serverUrl}`);
      console.log(`  Device: ${syncState.deviceName} (vault: ${syncState.vaultId.slice(0, 8)}..., epoch: ${syncState.keyEpoch})`);
      if (syncState.lastSync) {
        console.log(`  Last sync: ${syncState.lastSync.completedAt} (${syncState.lastSync.pulled} pulled, ${syncState.lastSync.pushed} pushed)`);
      }
      if (syncState.lastError) {
        console.log(`  ⚠ Last sync warning: ${syncState.lastError.message}`);
        if (syncState.lastError.message.includes('401') || syncState.lastError.message.includes('unauthorized')) {
          console.log('    Run "reglet connect <invite> --force" to re-authenticate.');
        }
      }
      console.log('');
    }

    console.log('Credentials:');
    const githubCred = creds.find((c) => c.provider === 'github');
    if (githubCred && githubCred.user?.login) {
      console.log(`  ● GitHub: authenticated as @${githubCred.user.login}`);
    } else {
      console.log('  ○ GitHub: not connected (run "reglet auth login" to connect for MCP tools)');
    }
    const drift = await detectDrift().catch(() => []);
    const drifted = drift.filter((record) => record.status !== 'clean');
    if (drifted.length > 0) {
      console.log('Detected Drift:');
      for (const record of drifted) {
        console.log(`  ⚠ ${record.provider}:${record.content} drifted (${record.status})`);
      }
      console.log('  Run "reglet apply" to re-synchronize.\n');
    }

    if (options.check === true && drifted.length > 0) {
      process.exitCode = 2;
    }
  });

program
  .command('providers')
  .alias('provider')
  .description('List supported AI coding assistants and manage which ones are synced')
  .option('--json', 'print machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    const config = await loadConfig();
    const rows = [];
    for (const adapter of allAdapters()) {
      const detected = await adapter.detect();
      const pConfig = config.providers[adapter.id];
      const enrolled = pConfig?.enabled ?? false;
      const rules = pConfig?.rules ?? false;
      const skills = pConfig?.skills ?? false;
      const mcp = pConfig?.mcp ?? false;
      rows.push({
        id: adapter.id,
        name: adapter.displayName,
        installed: detected,
        enrolled,
        rules,
        skills,
        mcp,
      });
    }
    if (options.json === true) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    console.log('\nAI Coding Assistants:');
    console.log('Provider       Installed   Enrolled   Rules   Skills   MCP');
    console.log('─────────────  ──────────  ─────────  ──────  ───────  ───');
    for (const r of rows) {
      const idCol = r.id.padEnd(14);
      const instCol = (r.installed ? 'yes' : 'no').padEnd(11);
      const enrCol = (r.enrolled ? 'yes' : 'no').padEnd(10);
      const rulesCol = (r.rules ? '✓' : '-').padEnd(7);
      const skillsCol = (r.skills ? '✓' : '-').padEnd(8);
      const mcpCol = r.mcp ? '✓' : '-';
      console.log(`${idCol} ${instCol} ${enrCol} ${rulesCol} ${skillsCol} ${mcpCol}`);
    }
    console.log('\nTo enable an assistant:   reglet enable <provider>');
    console.log('To disable an assistant:  reglet disable <provider>');
    console.log('To sync changes now:      reglet apply\n');
  });

program
  .command('enable')
  .description('Enable rules and configuration sync for an AI provider')
  .argument('<target>', 'provider or provider:rules|skills|mcp (e.g. claude, cursor:rules)', parseProviderTarget)
  .action(async (target: ProviderTarget) => {
    await setEnrollment(target, true);
    console.log(`✓ Enabled ${formatTarget(target)}. Run "reglet apply" to sync rules to this provider.`);
  });

program
  .command('disable')
  .description('Disable rules and configuration sync for an AI provider')
  .argument('<target>', 'provider or provider:rules|skills|mcp (e.g. claude)', parseProviderTarget)
  .action(async (target: ProviderTarget) => {
    await setEnrollment(target, false);
    console.log(`✓ Disabled ${formatTarget(target)}.`);
  });

program
  .command('apply')
  .description('Apply master rules, skills, and MCP config to enrolled providers')
  .option('-p, --provider <provider>', 'provider to apply', parseProvider)
  .option('-c, --content <content>', 'content type to apply', parseContent)
  .option('-n, --dry-run', 'report planned writes without changing files')
  .option('--reviewed-replacement', 'confirm replacement of detected provider drift')
  .action(async (options: { provider?: ProviderId; content?: ApplyContent; dryRun?: boolean; reviewedReplacement?: boolean }) => {
    const report = await applyAll({
      providers: options.provider === undefined ? undefined : [options.provider],
      contents: options.content === undefined ? undefined : [options.content],
      dryRun: options.dryRun === true,
      reviewedReplacement: options.reviewedReplacement,
    });
    printApplyResults(report.results);
  });

const migrate = program.command('migrate', { hidden: true }).description('Run explicit, reversible metadata migrations');

migrate
  .command('library-v2')
  .description('Index legacy canonical content in schema-version-2 library.json without moving files')
  .option('--preview', 'preview the artifact inventory and locator mapping')
  .option('--apply', 'write library.json and a reversible migration receipt')
  .option('-y, --yes', 'confirm the reviewed migration non-interactively')
  .option('--preview-digest <digest>', 'require an exact previously reviewed preview digest')
  .option('--json', 'print machine-readable JSON')
  .action(async (options: {
    preview?: boolean;
    apply?: boolean;
    yes?: boolean;
    previewDigest?: string;
    json?: boolean;
  }) => {
    if (options.preview === options.apply) {
      throw new InvalidArgumentError('Choose exactly one of --preview or --apply.');
    }
    if (options.preview === true) {
      const preview = await applicationData('migration.preview', {}) as Awaited<ReturnType<typeof previewLibraryMigration>>;
      if (options.json === true) printJson(preview);
      else printLibraryMigrationPreview(preview);
      return;
    }
    if (options.yes !== true) {
      throw new InvalidArgumentError('Applying library-v2 requires --yes after reviewing --preview.');
    }
    const preview = await applicationData('migration.preview', {}) as Awaited<ReturnType<typeof previewLibraryMigration>>;
    const digest = options.previewDigest ?? preview.digest;
    const receipt = await applicationData('migration.apply', { previewDigest: digest, yes: true });
    if (options.json === true) printJson(receipt);
    else console.log(`library-v2\tapplied\tartifacts=${numberField(receipt, 'artifactCount')}\treceipt=${stringField(receipt, 'id')}`);
  });

migrate
  .command('status')
  .description('Report canonical library migration state')
  .option('--json', 'print machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    const status = await applicationData('migration.status', {});
    if (options.json === true) printJson(status);
    else console.log(`library-v2\t${stringField(status, 'state')}\tartifacts=${numberField(status, 'artifactCount')}`);
  });

program
  .command('scan', { hidden: true })
  .description('Print detected providers and existing inventory')
  .option('--json', 'print machine-readable JSON for setup apps')
  .action(async (options: { json?: boolean }) => {
    if (options.json === true) {
      printJson(await buildScanJson());
      return;
    }

    for (const adapter of allAdapters()) {
      const detected = await adapter.detect();
      const inventory = await adapter.inventory();
      console.log(`${adapter.id}\t${detected ? 'detected' : 'missing'}\trules=${inventory.rulesExists ? 'yes' : 'no'}\tskills=${inventory.skills.length}\tmcp=${inventory.mcpServers.length}`);
    }
  });

program
  .command('open', { hidden: true })
  .description('Open a local Reglet or project path in the system file browser')
  .argument('[path]', 'path to open', regletHome())
  .action(async (targetPath: string) => {
    await openSystemPath(path.resolve(targetPath));
  });

program
  .command('list', { hidden: true })
  .description('List canonical library artifacts')
  .argument('[kind]', 'instructions, skills, or mcp', parseLibraryKind)
  .option('--archived', 'list archived artifacts instead of active artifacts')
  .option('--all', 'include active and archived artifacts')
  .option('--json', 'print machine-readable JSON')
  .action(async (kind: ManagerArtifactKind | undefined, options: { archived?: boolean; all?: boolean; json?: boolean }) => {
    const artifacts = await applicationData('library.list', {
      ...(kind === undefined ? {} : { kind }),
      ...(options.all === true ? {} : { lifecycle: options.archived === true ? 'archived' : 'active' }),
    });
    if (options.json === true) printJson(artifacts);
    else for (const artifact of asArtifactList(artifacts)) console.log(`${artifact.id}\t${artifact.kind}\t${artifact.lifecycle}\t${artifact.slug}\t${artifact.title}`);
  });

program
  .command('show', { hidden: true })
  .description('Show a canonical library artifact')
  .argument('<artifact>', 'artifact ID or unambiguous slug')
  .option('--json', 'print machine-readable JSON')
  .action(async (artifact: string, options: { json?: boolean }) => {
    const result = await applicationData('library.show', { artifact });
    if (options.json === true) printJson(result);
    else {
      const content = readResultContent(result);
      process.stdout.write(`${content}${content.endsWith('\n') ? '' : '\n'}`);
    }
  });

program
  .command('create', { hidden: true })
  .description('Create a canonical instruction, skill, or MCP artifact from stdin')
  .argument('<kind>', 'instruction, skill, or mcp', parseLibraryKind)
  .requiredOption('--slug <slug>', 'stable artifact slug')
  .option('--title <title>', 'display title')
  .option('-p, --provider <provider...>', 'target provider(s)', parseProviderList)
  .option('--overlay <provider>', 'create a provider-overlay artifact', parseProvider)
  .option('--json', 'print machine-readable JSON')
  .action(async (kind: ManagerArtifactKind, options: {
    slug: string;
    title?: string;
    provider?: ProviderId[];
    overlay?: ProviderId;
    json?: boolean;
  }) => {
    const content = await Bun.stdin.text();
    if (content.length === 0) throw new InvalidArgumentError('Artifact content is required on stdin.');
    const result = await applicationData('library.create', {
      kind,
      slug: options.slug,
      title: options.title ?? titleFromCliSlug(options.slug),
      content,
      ...(options.provider === undefined ? {} : { targets: options.provider }),
      ...(options.overlay === undefined ? {} : { scope: { kind: 'provider-overlay', provider: options.overlay } }),
    });
    printApplicationResult(result, options.json, 'created');
  });

program
  .command('duplicate', { hidden: true })
  .description('Duplicate an artifact with a stable new ID and cleared targets')
  .argument('<artifact>')
  .option('--json')
  .action(async (artifact: string, options: { json?: boolean }) => {
    printApplicationResult(await applicationData('library.duplicate', { artifact }), options.json, 'duplicated');
  });

program
  .command('rename', { hidden: true })
  .description('Rename an artifact without changing its ID')
  .argument('<artifact>')
  .argument('<slug>')
  .option('--json')
  .action(async (artifact: string, slug: string, options: { json?: boolean }) => {
    printApplicationResult(await applicationData('library.rename', { artifact, slug }), options.json, 'renamed');
  });

program
  .command('archive', { hidden: true })
  .description('Archive an artifact so it remains canonical but stops projecting')
  .argument('<artifact>')
  .option('--json')
  .action(async (artifact: string, options: { json?: boolean }) => {
    printApplicationResult(await applicationData('library.archive', { artifact }), options.json, 'archived');
  });

program
  .command('delete', { hidden: true })
  .description('Permanently delete an artifact and retain recoverable history')
  .argument('<artifact>')
  .requiredOption('-y, --yes', 'confirm permanent deletion')
  .option('--json')
  .action(async (artifact: string, options: { yes: boolean; json?: boolean }) => {
    printApplicationResult(await applicationData('library.delete', { artifact, confirmed: options.yes }), options.json, 'deleted');
  });

const project = program.command('project', { hidden: true }).description('Manage read-only project discovery roots');
const projectRoot = project.command('root').description('Manage configured development roots');

projectRoot
  .command('add')
  .argument('<path>')
  .option('--label <label>')
  .option('--json')
  .action(async (rootPath: string, options: { label?: string; json?: boolean }) => {
    printApplicationResult(await applicationData('project.root.add', {
      path: path.resolve(rootPath),
      ...(options.label === undefined ? {} : { label: options.label }),
    }), options.json, 'root-added');
  });

projectRoot
  .command('remove')
  .argument('<root-id>')
  .requiredOption('-y, --yes', 'confirm root removal')
  .option('--json')
  .action(async (rootId: string, options: { yes: boolean; json?: boolean }) => {
    printApplicationResult(await applicationData('project.root.remove', { rootId, confirmed: options.yes }), options.json, 'root-removed');
  });

projectRoot
  .command('list')
  .option('--json')
  .action(async (options: { json?: boolean }) => {
    const roots = await applicationData('project.root.list', {});
    if (options.json === true) printJson(roots);
    else for (const root of asRecordList(roots)) console.log(`${stringField(root, 'id')}\t${stringField(root, 'label')}\t${stringField(root, 'path')}`);
  });

project
  .command('scan')
  .option('--root <root-id>')
  .option('--reappear-changed-ignored')
  .option('--json')
  .action(async (options: { root?: string; reappearChangedIgnored?: boolean; json?: boolean }) => {
    const result = await applicationData('project.scan', {
      ...(options.root === undefined ? {} : { rootId: options.root }),
      ...(options.reappearChangedIgnored === undefined ? {} : { reappearChangedIgnored: options.reappearChangedIgnored }),
    });
    printApplicationResult(result, options.json, 'scanned');
  });

project
  .command('discoveries')
  .option('--root <root-id>')
  .option('--state <state>', 'new, changed, promoted, conflict, or ignored', parseDiscoveryState)
  .option('--json')
  .action(async (options: { root?: string; state?: DiscoveryState; json?: boolean }) => {
    const discoveries = await applicationData('project.discoveries', {
      ...(options.root === undefined ? {} : { rootId: options.root }),
      ...(options.state === undefined ? {} : { state: options.state }),
    });
    if (options.json === true) printJson(discoveries);
    else for (const discovery of asRecordList(discoveries)) console.log(`${stringField(discovery, 'id')}\t${stringField(discovery, 'state')}\t${stringField(discovery, 'kind')}\t${stringField(discovery, 'relativePath')}`);
  });

project
  .command('preview')
  .description('Inspect a project promotion without changing canonical content')
  .argument('<discovery>')
  .option('--mode <mode>', 'global-instruction, convert-to-skill, or disabled-draft', parsePromotionMode)
  .option('--json')
  .action(async (discoveryId: string, options: { mode?: PromotionMode; json?: boolean }) => {
    const preview = await applicationData('project.promotion-preview', {
      discoveryId,
      ...(options.mode === undefined ? {} : { mode: options.mode }),
    });
    if (options.json === true) {
      printJson(preview);
      return;
    }
    console.log(`kind\t${stringField(preview, 'kind')}`);
    const inspection = isRecordValue(preview) && isRecordValue(preview.inspection)
      ? preview.inspection
      : undefined;
    if (inspection !== undefined && booleanField(inspection, 'requiresExecutableConfirmation')) {
      console.log(`executable-revision\t${stringField(inspection, 'revision')}`);
    }
  });

program
  .command('promote', { hidden: true })
  .description('Promote a reviewed project discovery into the canonical library')
  .argument('<discovery>')
  .option('--mode <mode>', 'global-instruction, convert-to-skill, or disabled-draft', parsePromotionMode)
  .option('-p, --provider <provider...>', 'target provider(s)', parseProviderList)
  .option('--destination <artifact>', 'merge into an existing artifact')
  .option('--server <name>', 'MCP server name when a source contains multiple servers')
  .option('--confirm-executable-revision <revision>', 'confirm the exact executable skill revision returned by project preview')
  .option('--json')
  .action(async (discoveryId: string, options: {
    mode?: PromotionMode;
    provider?: ProviderId[];
    destination?: string;
    server?: string;
    confirmExecutableRevision?: string;
    json?: boolean;
  }) => {
    const result = await applicationData('project.promote', {
      discoveryId,
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      ...(options.provider === undefined ? {} : { targets: options.provider }),
      ...(options.destination === undefined ? {} : { destinationArtifact: options.destination }),
      ...(options.server === undefined ? {} : { serverName: options.server }),
      ...(options.confirmExecutableRevision === undefined
        ? {}
        : { confirmedExecutableRevision: options.confirmExecutableRevision }),
    });
    printApplicationResult(result, options.json, 'promoted');
  });

const secret = program.command('secret', { hidden: true }).description('Bind local-only secret references');
secret
  .command('set')
  .argument('<id>')
  .requiredOption('--stdin', 'read the secret value from stdin')
  .option('--json')
  .action(async (id: string, options: { stdin: boolean; json?: boolean }) => {
    const value = (await Bun.stdin.text()).replace(/[\r\n]+$/, '');
    if (value.length === 0) throw new InvalidArgumentError('Secret value is required on stdin.');
    const result = await applicationData('secret.set', { id, value });
    if (options.json === true) printJson(result);
    else console.log(`secret\tbound\t${id}`);
  });
secret
  .command('delete')
  .argument('<id>')
  .requiredOption('-y, --yes', 'confirm secret deletion')
  .option('--json')
  .action(async (id: string, options: { json?: boolean }) => {
    printApplicationResult(await applicationData('secret.delete', { id }), options.json, 'secret-deleted');
  });
secret
  .command('status')
  .argument('<id>')
  .option('--json')
  .action(async (id: string, options: { json?: boolean }) => {
    const result = await applicationData('secret.status', { id });
    if (options.json === true) printJson(result);
    else console.log(`secret\t${booleanField(result, 'bound') ? 'bound' : 'unbound'}\t${id}`);
  });

const remote = program.command('remote', { hidden: true }).description('Manage optional remote Manager access');
remote
  .command('enable')
  .argument('<endpoint>', 'Tailnet or custom HTTPS endpoint')
  .option('--json')
  .action(async (endpoint: string, options: { json?: boolean }) => {
    printApplicationResult(await applicationData('remote.enable', { endpoint }), options.json, 'remote-enabled');
  });
remote
  .command('disable')
  .option('--json')
  .action(async (options: { json?: boolean }) => {
    printApplicationResult(await applicationData('remote.disable', {}), options.json, 'remote-disabled');
  });
remote
  .command('status')
  .option('--json')
  .action(async (options: { json?: boolean }) => {
    const result = await applicationData('remote.status', {});
    if (options.json === true) printJson(result);
    else console.log(`remote\t${booleanField(result, 'enabled') ? 'enabled' : 'disabled'}`);
  });

const session = program.command('session', { hidden: true }).description('Pair and revoke scoped remote sessions');
session
  .command('pair')
  .option('--scope <scope>', 'read, write, or admin', parseSessionScope, 'read')
  .option('--json')
  .action(async (options: { scope: SessionScope; json?: boolean }) => {
    printApplicationResult(await applicationData('session.pair', { scope: options.scope }), options.json, 'pairing-created');
  });
session
  .command('list')
  .option('--json')
  .action(async (options: { json?: boolean }) => {
    const sessions = await applicationData('session.list', {});
    if (options.json === true) printJson(sessions);
    else for (const item of asRecordList(sessions)) console.log(`${stringField(item, 'id')}\t${stringField(item, 'scope')}\t${stringField(item, 'createdAt')}`);
  });
session
  .command('revoke')
  .argument('<session-id>')
  .requiredOption('-y, --yes', 'confirm session revocation')
  .option('--json')
  .action(async (sessionId: string, options: { json?: boolean }) => {
    printApplicationResult(await applicationData('session.revoke', { sessionId }), options.json, 'session-revoked');
  });

program
  .command('history', { hidden: true })
  .description('List retained canonical artifact revisions')
  .argument('<artifact>')
  .option('--json')
  .action(async (artifact: string, options: { json?: boolean }) => {
    const history = await applicationData('history.list', { artifact });
    if (options.json === true) printJson(history);
    else for (const item of asRecordList(history)) console.log(`${stringField(item, 'revision')}\t${stringField(item, 'createdAt')}\t${stringField(item, 'reason')}`);
  });

program
  .command('undo', { hidden: true })
  .description('Restore an artifact revision')
  .argument('<artifact>')
  .option('--revision <revision>')
  .requiredOption('-y, --yes', 'confirm history restore')
  .option('--json')
  .action(async (artifact: string, options: { revision?: string; json?: boolean }) => {
    printApplicationResult(await applicationData('history.undo', {
      artifact,
      confirmed: true,
      ...(options.revision === undefined ? {} : { revision: options.revision }),
    }), options.json, 'restored');
  });

program
  .command('diagnostics', { hidden: true })
  .description('Print redacted local Manager diagnostics')
  .option('--json')
  .action(async (options: { json?: boolean }) => {
    const result = await applicationData('diagnostics', {});
    if (options.json === true) printJson(result);
    else console.log(`diagnostics\t${booleanField(result, 'healthy') ? 'healthy' : 'attention'}`);
  });

program
  .command('serve', { hidden: true })
  .description('Run the persistent local Manager runtime')
  .option('--hostname <hostname>', 'bind hostname', '127.0.0.1')
  .option('--port <port>', 'bind port; 0 selects an available port', parsePort, 0)
  .option('--json', 'print one machine-readable readiness line')
  .option('--allow-remote', 'allow a non-loopback HTTPS binding')
  .option('--allow-public-wildcard', 'advanced override for wildcard binding')
  .option('--allow-insecure-lan-http', 'advanced override for raw LAN HTTP with a persistent warning')
  .option('--tls-cert <path>', 'TLS certificate path')
  .option('--tls-key <path>', 'TLS private key path')
  .action(async (options: {
    hostname: string;
    port: number;
    json?: boolean;
    allowRemote?: boolean;
    allowPublicWildcard?: boolean;
    allowInsecureLanHttp?: boolean;
    tlsCert?: string;
    tlsKey?: string;
  }) => {
    const runtime = await serveManagerRuntime({
      hostname: options.hostname,
      port: options.port,
      allowRemote: options.allowRemote,
      allowPublicWildcard: options.allowPublicWildcard,
      allowInsecureLanHttp: options.allowInsecureLanHttp,
      tlsCertificate: options.tlsCert,
      tlsPrivateKey: options.tlsKey,
    });
    if (options.json === true) printJsonLine(runtime.startup);
    else console.log(`manager\tready\t${runtime.startup.managerUrl}`);
    for (const warning of runtime.startup.warnings ?? []) console.error(`warning\t${warning}`);
    await waitForShutdownSignal();
    await runtime.stop();
  });

const manager = program.command('manager', { hidden: true }).description('Read local-only manager state');

manager
  .command('rpc')
  .description('Read one Manager RPC request from stdin and print one typed JSON response')
  .requiredOption('--json', 'print machine-readable JSON')
  .requiredOption('--protocol-version <version>', 'manager RPC protocol version', parseRpcProtocolVersion)
  .action(async (options: { json: boolean; protocolVersion: ManagerProtocolVersion }) => {
    const response = await handleManagerRpc(await readManagerRpcLine(), options.protocolVersion);
    printRpcJson(response);
  });

manager
  .command('snapshot')
  .description('Return one redacted local manager snapshot')
  .option('--json', 'print machine-readable JSON')
  .option('--contract-version <version>', 'manager snapshot contract version: 1 or 2', parseManagerContractVersion)
  .action(async (options: { json?: boolean; contractVersion?: ManagerContractVersion }) => {
    const contractVersion = options.contractVersion ?? 1;
    if (contractVersion === 1) {
      const snapshot = await buildManagerSnapshotV1();
      if (options.json === true) {
        printJson(snapshot);
        return;
      }
      console.log(`manager-snapshot\tproviders=${snapshot.scan.providers.length}\tdrift=${snapshot.status.driftedCount}\toperations=${snapshot.operations.length}`);
      return;
    }
    const snapshot = await buildManagerSnapshotV2();
    if (options.json === true) {
      printJson(snapshot);
      return;
    }
    console.log(`manager-snapshot-v2\tproviders=${snapshot.providerDiscovery.length}\tdrift=${snapshot.driftInbox.length}\treceipts=${snapshot.receipts.list.length}`);
  });

program
  .command('plan', { hidden: true })
  .description('Preview first-run onboarding reads and writes without changing files')
  .option('-p, --provider <provider...>', 'provider(s) to include', parseProviderList)
  .option('-c, --content <content...>', 'content type(s) to include', parseContentList)
  .option('--json', 'print machine-readable JSON for setup apps')
  .action(async (options: { provider?: ProviderId[]; content?: ApplyContent[]; json?: boolean }) => {
    const plan = await buildOnboardingPlanJson({
      providers: options.provider ?? (await detectedProviderIds()),
      contents: options.content ?? [...contentIds],
    });

    if (options.json === true) {
      printJson(plan);
      return;
    }

    printOnboardingPlan(plan);
  });

program
  .command('enroll', { hidden: true })
  .description('Enroll a provider or provider content type')
  .argument('<target>', 'provider or provider:rules|skills|mcp', parseProviderTarget)
  .action(async (target: ProviderTarget) => {
    await setEnrollment(target, true);
  });

program
  .command('unenroll', { hidden: true })
  .description('Unenroll a provider or provider content type')
  .argument('<target>', 'provider or provider:rules|skills|mcp', parseProviderTarget)
  .action(async (target: ProviderTarget) => {
    await setEnrollment(target, false);
  });

program
  .command('restore', { hidden: true })
  .description('Restore backed-up provider files for a provider or all providers')
  .argument('[provider]', 'provider to restore', parseProvider)
  .action(async (provider?: ProviderId) => {
    printRevertResults(await restore(provider));
  });

program
  .command('revert', { hidden: true })
  .description('Restore all backed-up provider files and remove Reglet-created outputs')
  .argument('[provider]', 'provider to revert', parseProvider)
  .action(async (provider?: ProviderId) => {
    printRevertResults(await revert(provider));
  });

const operations = program.command('operations', { hidden: true }).description('Inspect and restore Reglet apply operations');

operations
  .command('list')
  .description('List completed and recovered operation receipts')
  .option('--json', 'print machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    const receipts = await listOperationReceipts();
    if (options.json === true) {
      printJson({ version: 1, receipts });
      return;
    }
    for (const receipt of receipts) {
      console.log(`${receipt.id}\t${receipt.lifecycle}\t${receipt.startedAt}\ttargets=${receipt.targets.length}`);
    }
  });

const state = program.command('state', { hidden: true }).description('Inspect and clear local Reglet state');

state
  .command('legacy-network-status')
  .description('Report inert pre-V1 network state without reading credentials')
  .option('--json', 'print machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    const status = await inspectLegacySyncState();
    if (options.json === true) {
      printJson({ version: 1, legacyNetworkState: status });
      return;
    }
    console.log(status.present ? `legacy-network-state\tpresent\tpaths=${status.paths.length}` : 'legacy-network-state\tclear');
  });

state
  .command('clear-legacy-network-state')
  .description('Explicitly remove inert pre-V1 network credentials and snapshots')
  .option('--json', 'print machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    const cleared = await clearLegacySyncState();
    if (options.json === true) {
      printJson({ version: 1, legacyNetworkState: cleared });
      return;
    }
    console.log('legacy-network-state\tcleared');
  });

operations
  .command('show')
  .description('Show one operation receipt')
  .argument('<id>')
  .option('--json', 'print machine-readable JSON')
  .action(async (id: string, options: { json?: boolean }) => {
    const receipt = await getOperationReceipt(id);
    if (options.json === true) {
      printJson({ version: 1, receipt });
      return;
    }
    console.log(`${receipt.id}\t${receipt.lifecycle}\t${receipt.startedAt}`);
    for (const target of receipt.targets) {
      console.log(`${target.snapshotKind}\t${target.path}\t${target.snapshot ?? 'none'}`);
    }
  });

operations
  .command('restore')
  .description('Restore provider outputs captured by an operation receipt')
  .argument('<id>')
  .option('--json', 'print machine-readable JSON')
  .action(async (id: string, options: { json?: boolean }) => {
    const actions = await restoreOperationReceipt(id);
    if (options.json === true) {
      printJson({ version: 1, actions });
      return;
    }
    for (const action of actions) {
      console.log(`${action.action}\t${action.path}`);
    }
  });

operations
  .command('recover')
  .description('Recover unfinished apply operations')
  .option('--json', 'print machine-readable JSON')
  .action(async (options: { json?: boolean }) => {
    const result = await recoverPendingOperations();
    if (options.json === true) {
      printJson({ version: 1, ...result });
      return;
    }
    for (const receipt of result.recovered) {
      console.log(`${receipt.id}\t${receipt.lifecycle}\ttargets=${receipt.targets.length}`);
    }
  });

program
  .command('diff', { hidden: true })
  .description('Preview apply actions without writing files')
  .option('-p, --provider <provider>', 'provider to diff', parseProvider)
  .option('-c, --content <content>', 'content type to diff', parseContent)
  .action(async (options: { provider?: ProviderId; content?: ApplyContent }) => {
    const report = await applyAll({
      providers: options.provider === undefined ? undefined : [options.provider],
      contents: options.content === undefined ? undefined : [options.content],
      dryRun: true,
    });
    printApplyResults(report.results);
  });

const apply = program.command('apply-structured', { hidden: true }).description('Preview or apply exact structured provider writes');

apply
  .command('preview')
  .description('Print a digest-backed JSON preview for provider writes')
  .option('-p, --provider <provider...>', 'provider(s) to include', parseProviderList)
  .option('-c, --content <content...>', 'content type(s) to include', parseContentList)
  .action(async (options: { provider?: ProviderId[]; content?: ApplyContent[] }) => {
    printJson(await previewApplyStructured({ providers: options.provider, contents: options.content }));
  });

apply
  .command('apply')
  .description('Apply a structured preview if its digest is still current')
  .requiredOption('--digest <digest>', 'digest returned by apply-structured preview')
  .option('-p, --provider <provider...>', 'provider(s) to include', parseProviderList)
  .option('-c, --content <content...>', 'content type(s) to include', parseContentList)
  .action(async (options: { digest: string; provider?: ProviderId[]; content?: ApplyContent[] }) => {
    printJson(await applyStructuredPreview(options.digest, { providers: options.provider, contents: options.content }));
  });

const rules = program.command('rules').description('Read and edit master rule documents');

rules
  .command('list')
  .description('List master rule documents')
  .option('--json', 'print machine-readable JSON for manager apps')
  .action(async (options: { json?: boolean }) => {
    const master = await loadMasterDir();
    const documents = ruleDocuments(master);
    if (options.json === true) {
      printJson({ version: 1, documents });
      return;
    }
    for (const document of documents) {
      console.log(document.path);
    }
  });

rules
  .command('read')
  .description('Print one master rule document')
  .argument('<path>', 'path relative to the master rules directory')
  .action(async (relativePath: string) => {
    process.stdout.write(await readFile(masterRulePath(relativePath), 'utf8'));
  });

rules
  .command('write')
  .description('Replace one master rule document with UTF-8 content from stdin')
  .argument('<path>', 'path relative to the master rules directory')
  .action(async (relativePath: string) => {
    const target = masterRulePath(relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await Bun.stdin.text());
    console.log(`rules\tsaved\t${relativePath}`);
  });

rules
  .command('merge-runners')
  .description('List installed local AI tools available for rules drafting')
  .option('--json', 'print machine-readable JSON for setup apps')
  .action(async (options: { json?: boolean }) => {
    const runners = await listInstalledMergeRunners();
    if (options.json === true) {
      printJson({ version: 1, runners });
      return;
    }
    for (const runner of runners) {
      console.log(`${runner.id}\t${runner.displayName}\t${runner.executablePath}`);
    }
  });

rules
  .command('merge-draft')
  .description('Generate a reviewable unified rules draft from selected provider rules without writing files')
  .requiredOption('-p, --provider <provider...>', 'provider rule sources to merge', parseProviderList)
  .option('--runner <runner>', 'local AI tool to use: codex, claude, or gemini', parseAiMergeRunnerId)
  .option('--steer <prompt>', 'additional guidance for what the unified draft should include or exclude')
  .option('--json', 'print machine-readable JSON for setup apps')
  .action(async (options: { provider: ProviderId[]; runner?: AiMergeRunnerId; steer?: string; json?: boolean }) => {
    const result = await generateRulesMergeDraft(options.provider, options.runner, options.steer);
    if (options.json === true) {
      printJson({ version: 1, ...result });
      return;
    }
    process.stdout.write(result.draft);
  });

program
  .command('import', { hidden: true })
  .description('Import drifted provider content back into the master directory')
  .argument('<target>', 'provider:rules|skills|mcp', parseProviderTarget)
  .option('--json', 'print machine-readable JSON for manager apps')
  .option('--scope <scope>', 'shared or provider for MCP imports', parseMcpScope, 'shared')
  .action(async (target: ProviderTarget, options: { json?: boolean; scope?: 'shared' | 'provider' }) => {
    if (target.content === undefined) {
      throw new InvalidArgumentError('Specify the content to import, e.g. claude:rules');
    }

    if (target.content === 'rules') {
      const result = await importDriftedRules(target.provider);
      if (options.json === true) {
        printJson({ version: 1, content: 'rules', ...result });
        return;
      }
      console.log(`${result.provider}\trules\timported\t${result.importedPath}`);
      return;
    }

    if (target.content === 'skills') {
      const result = await importDriftedSkills(target.provider);
      if (options.json === true) {
        printJson({ version: 1, content: 'skills', ...result });
        return;
      }
      if (result.imported.length === 0) {
        console.log(`${result.provider}\tskills\tclean\tno drifted skills to import`);
      }
      for (const skill of result.imported) {
        console.log(`${result.provider}\tskills\timported\t${skill.importedPath}`);
      }
      return;
    }

    const result = await importDriftedMcp(target.provider, regletHome(), options.scope ?? 'shared');
    if (options.json === true) {
      printJson({ version: 1, content: 'mcp', ...result });
      return;
    }
    console.log(`${result.provider}\tmcp\timported\t${result.importedPath}\tservers=${result.importedServers.join(',')}`);
  });

const skills = program.command('skills').description('Inspect and adopt provider-local skills');

skills
  .command('list')
  .description('List managed and provider-local skills')
  .option('--json', 'print machine-readable JSON for manager apps')
  .action(async (options: { json?: boolean }) => {
    const overview = await listSkills();
    if (options.json === true) {
      printJson({ version: 1, regletHome: regletHome(), ...overview });
      return;
    }
    for (const skill of overview.shared) {
      console.log(`shared\t${skill.name}\t${skill.path}`);
    }
    for (const skill of overview.providerScoped) {
      console.log(`${skill.provider}\t${skill.name}\t${skill.path}`);
    }
    for (const skill of overview.unmanaged) {
      console.log(`${skill.provider}\t${skill.name}\t${skill.sourcePath}`);
    }
  });

skills
  .command('unmanaged')
  .description('List provider-local skills that Reglet does not manage')
  .option('--json', 'print machine-readable JSON for manager apps')
  .action(async (options: { json?: boolean }) => {
    const unmanaged = await listUnmanagedSkills();
    if (options.json === true) {
      printJson({ version: 1, skills: unmanaged });
      return;
    }
    for (const skill of unmanaged) {
      console.log(`${skill.provider}\t${skill.name}\t${skill.sourcePath}`);
    }
  });

skills
  .command('inspect')
  .description('Preview files in a provider-local skill without adopting it')
  .argument('<provider>', 'provider containing the local skill', parseProvider)
  .argument('<name>', 'skill directory name')
  .argument('[path]', 'relative file path to read')
  .option('--json', 'print machine-readable JSON for manager apps')
  .action(async (provider: ProviderId, name: string, relativePath: string | undefined, options: { json?: boolean }) => {
    if (relativePath === undefined) {
      const tree = await describeUnmanagedSkill(provider, name);
      if (options.json === true) printJson({ version: 1, tree });
      else tree.files.forEach((file) => console.log(file.path));
      return;
    }
    const document = await readUnmanagedSkillFile(provider, name, relativePath);
    if (options.json === true) printJson({ version: 1, document });
    else process.stdout.write(document.content);
  });

skills
  .command('adopt')
  .description('Copy a provider-local skill into the Reglet master')
  .argument('<provider>', 'provider containing the local skill', parseProvider)
  .argument('<name>', 'skill directory name')
  .requiredOption('--scope <scope>', 'shared or provider', parseSkillScope)
  .option('--overwrite', 'replace an existing master skill at the destination')
  .option('--json', 'print machine-readable JSON for manager apps')
  .action(
    async (
      provider: ProviderId,
      name: string,
      options: { scope: SkillAdoptionScope; overwrite?: boolean; json?: boolean },
    ) => {
      const adopted = await adoptSkill({
        provider,
        name,
        scope: options.scope,
        overwrite: options.overwrite,
      });
      if (options.json === true) {
        printJson({ version: 1, adoption: adopted });
        return;
      }
      console.log(`${adopted.provider}\t${adopted.name}\t${adopted.scope}\t${adopted.destination}`);
    },
  );

skills
  .command('read')
  .description('Read a managed skill file')
  .requiredOption('--scope <scope>', 'shared or provider', parseSkillScope)
  .option('--provider <provider>', 'provider for provider-scoped skills', parseProvider)
  .argument('<name>')
  .argument('<path>')
  .option('--json')
  .action(async (name: string, relativePath: string, options: SkillCommandOptions) => {
    const document = await readSkillFile(skillScope(options), name, relativePath);
    if (options.json === true) printJson({ version: 1, document });
    else process.stdout.write(document.content);
  });

skills
  .command('files')
  .description('List files in a managed skill')
  .requiredOption('--scope <scope>', 'shared or provider', parseSkillScope)
  .option('--provider <provider>', 'provider for provider-scoped skills', parseProvider)
  .argument('<name>')
  .option('--json')
  .action(async (name: string, options: SkillCommandOptions) => {
    const tree = (await listManagedSkillTrees()).find((skill) => skill.name === name && sameSkillScope(skill.scope, options));
    if (tree === undefined) throw new Error(`Skill does not exist: ${name}`);
    if (options.json === true) printJson({ version: 1, tree });
    else tree.files.forEach((file) => console.log(file.path));
  });

skills
  .command('create')
  .description('Create a managed skill with SKILL.md from stdin')
  .requiredOption('--scope <scope>', 'shared or provider', parseSkillScope)
  .option('--provider <provider>', 'provider for provider-scoped skills', parseProvider)
  .argument('<name>')
  .option('--json')
  .action(async (name: string, options: SkillCommandOptions) => {
    const input = await Bun.stdin.text();
    const document = await createSkill(skillScope(options), name, input.length > 0 ? input : '# Skill\n');
    if (options.json === true) printJson({ version: 1, document });
    else console.log(`skills\tcreated\t${name}`);
  });

skills
  .command('write')
  .description('Write a managed skill file from stdin')
  .requiredOption('--scope <scope>', 'shared or provider', parseSkillScope)
  .option('--provider <provider>', 'provider for provider-scoped skills', parseProvider)
  .argument('<name>')
  .argument('<path>')
  .option('--json')
  .action(async (name: string, relativePath: string, options: SkillCommandOptions) => {
    const document = await writeSkillFile(skillScope(options), name, relativePath, await Bun.stdin.text());
    if (options.json === true) printJson({ version: 1, document });
    else console.log(`skills\tsaved\t${name}\t${relativePath}`);
  });

skills
  .command('rename')
  .description('Rename a managed skill')
  .requiredOption('--scope <scope>', 'shared or provider', parseSkillScope)
  .option('--provider <provider>', 'provider for provider-scoped skills', parseProvider)
  .argument('<name>')
  .argument('<new-name>')
  .option('--json')
  .action(async (name: string, newName: string, options: SkillCommandOptions) => {
    const skill = await renameSkill(skillScope(options), name, newName);
    if (options.json === true) printJson({ version: 1, skill });
    else console.log(`skills\trenamed\t${name}\t${newName}`);
  });

skills
  .command('delete-file')
  .description('Delete a managed skill file')
  .requiredOption('--scope <scope>', 'shared or provider', parseSkillScope)
  .option('--provider <provider>', 'provider for provider-scoped skills', parseProvider)
  .argument('<name>')
  .argument('<path>')
  .action(async (name: string, relativePath: string, options: SkillCommandOptions) => {
    await deleteSkillFile(skillScope(options), name, relativePath);
    console.log(`skills\tdeleted-file\t${name}\t${relativePath}`);
  });

skills
  .command('rename-file')
  .description('Rename a managed skill file')
  .requiredOption('--scope <scope>', 'shared or provider', parseSkillScope)
  .option('--provider <provider>', 'provider for provider-scoped skills', parseProvider)
  .argument('<name>')
  .argument('<path>')
  .argument('<new-path>')
  .action(async (name: string, filePath: string, newPath: string, options: SkillCommandOptions) => {
    await renameSkillFile(skillScope(options), name, filePath, newPath);
    console.log(`skills\trenamed-file\t${name}\t${filePath}\t${newPath}`);
  });

skills
  .command('delete')
  .description('Delete a managed skill')
  .requiredOption('--scope <scope>', 'shared or provider', parseSkillScope)
  .option('--provider <provider>', 'provider for provider-scoped skills', parseProvider)
  .argument('<name>')
  .action(async (name: string, options: SkillCommandOptions) => {
    await deleteSkill(skillScope(options), name);
    console.log(`skills\tdeleted\t${name}`);
  });

const mcp = program.command('mcp').description('Read and edit master MCP definitions');

mcp
  .command('list')
  .option('--json')
  .option('--scope <scope>', 'shared or provider', parseMcpScope, 'shared')
  .option('--provider <provider>', 'provider for provider-scoped MCP', parseProvider)
  .option('--effective-provider <provider>', 'list effective MCP output for provider', parseProvider)
  .action(async (options: McpCommandOptions & { effectiveProvider?: ProviderId }) => {
    if (options.effectiveProvider !== undefined) {
      const servers = await listEffectiveMcpServers(options.effectiveProvider);
      if (options.json === true) printJson({ version: 1, scope: { kind: 'provider', provider: options.effectiveProvider }, effective: true, servers });
      else for (const entry of servers) console.log(`${entry.id}\t${entry.displayName}\t${entry.server.url ?? entry.server.command ?? ''}`);
      return;
    }
    const result = await listMcpServers(mcpScope(options));
    const servers = result.servers;
    if (options.json === true) printJson({ version: 1, scope: result.scope, servers });
    else for (const entry of servers) console.log(`${entry.id}\t${entry.displayName}\t${entry.server.url ?? entry.server.command ?? ''}`);
  });

mcp
  .command('read')
  .argument('<id>')
  .option('--json')
  .option('--scope <scope>', 'shared or provider', parseMcpScope, 'shared')
  .option('--provider <provider>', 'provider for provider-scoped MCP', parseProvider)
  .action(async (id: string, options: McpCommandOptions) => {
    const server = await readMcpServer(id, mcpScope(options));
    if (options.json === true) printJson({ version: 1, server });
    else console.log(`${server.id}\t${server.displayName}\t${server.server.url ?? server.server.command ?? ''}`);
  });

mcp
  .command('upsert')
  .argument('<id>')
  .option('--json')
  .option('--scope <scope>', 'shared or provider', parseMcpScope, 'shared')
  .option('--provider <provider>', 'provider for provider-scoped MCP', parseProvider)
  .option('--display-name <name>', 'editable provider output/display name')
  .action(async (id: string, options: McpCommandOptions) => {
    const input = JSON.parse(await Bun.stdin.text()) as McpServerDef;
    const server = await upsertMcpServer(id, input, mcpScope(options), undefined, options.displayName);
    if (options.json === true) printJson({ version: 1, server });
    else console.log(`mcp\tsaved\t${id}`);
  });

mcp
  .command('rename-display-name')
  .argument('<id>')
  .argument('<display-name>')
  .option('--json')
  .option('--scope <scope>', 'shared or provider', parseMcpScope, 'shared')
  .option('--provider <provider>', 'provider for provider-scoped MCP', parseProvider)
  .action(async (id: string, displayName: string, options: McpCommandOptions) => {
    const server = await renameMcpServerDisplayName(id, displayName, mcpScope(options));
    if (options.json === true) printJson({ version: 1, server });
    else console.log(`mcp\trenamed-display\t${id}\t${displayName}`);
  });

mcp
  .command('delete')
  .argument('<id>')
  .option('--json')
  .option('--scope <scope>', 'shared or provider', parseMcpScope, 'shared')
  .option('--provider <provider>', 'provider for provider-scoped MCP', parseProvider)
  .action(async (id: string, options: McpCommandOptions) => {
    const server = await deleteMcpServer(id, mcpScope(options));
    if (options.json === true) printJson({ version: 1, server });
    else console.log(`mcp\tdeleted\t${id}`);
  });

registerSyncV2PreviewCommands(program);
registerAuthCommands(program);

const daemon = program.command('daemon', { hidden: true }).description('Run or manage the background daemon');

daemon
  .command('run')
  .description('Run the foreground file watcher daemon')
  .action(async () => {
    await runDaemon();
  });

daemon
  .command('start')
  .description('Start the detached daemon')
  .action(async () => {
    const pid = await startDaemon();
    console.log(`daemon\trunning\t${pid}`);
  });

daemon
  .command('stop')
  .description('Stop the detached daemon')
  .action(async () => {
    console.log(`daemon\t${(await stopDaemon()) ? 'stopped' : 'not-running'}`);
  });

daemon
  .command('status')
  .description('Print daemon status')
  .action(async () => {
    console.log(`daemon\t${await daemonStatus()}`);
  });

daemon
  .command('install')
  .description('Install the daemon as a login service')
  .option('--dry-run', 'print the service command without installing')
  .action(async (options: { dryRun?: boolean }) => {
    const spec = options.dryRun === true ? daemonServiceSpec(process.platform, osHome()) : await installDaemon();
    console.log(`daemon\tinstall\t${spec.command.join(' ')}`);
  });

daemon
  .command('uninstall')
  .description('Uninstall the daemon login service')
  .option('--dry-run', 'print the service command without uninstalling')
  .action(async (options: { dryRun?: boolean }) => {
    const spec = options.dryRun === true ? daemonUninstallSpec(process.platform, osHome()) : await uninstallDaemon();
    console.log(`daemon\tuninstall\t${spec.command.join(' ')}`);
  });

try {
  await program.parseAsync();
} catch (error) {
  if (isManagerVisibleCommand(process.argv)) {
    writeJsonToStderr(redactManagerValue(managerErrorFromUnknown(error, managerCommandName(process.argv))));
  } else {
    console.error(redactManagerValue(error instanceof Error ? error.message : String(error)));
  }
  process.exitCode = exitCodeForError(error);
}

type DiscoveryState = 'new' | 'changed' | 'promoted' | 'conflict' | 'ignored';
type PromotionMode = 'global-instruction' | 'convert-to-skill' | 'disabled-draft';
type SessionScope = 'read' | 'write' | 'admin';

async function applicationData<Operation extends ManagerProtocolOperation>(
  operation: Operation,
  input: ManagerRpcInputs[Operation],
): Promise<unknown> {
  return (await managerApplication.execute({ operation, input } as ApplicationCommand)).data;
}

function parseLibraryKind(value: string): ManagerArtifactKind {
  if (value === 'instruction' || value === 'instructions' || value === 'rules') return 'instruction';
  if (value === 'skill' || value === 'skills') return 'skill';
  if (value === 'mcp') return 'mcp';
  throw new InvalidArgumentError(`Unknown artifact kind: ${value}`);
}

function parseDiscoveryState(value: string): DiscoveryState {
  if (value === 'new' || value === 'changed' || value === 'promoted' || value === 'conflict' || value === 'ignored') return value;
  throw new InvalidArgumentError(`Unknown discovery state: ${value}`);
}

function parsePromotionMode(value: string): PromotionMode {
  if (value === 'global-instruction' || value === 'convert-to-skill' || value === 'disabled-draft') return value;
  throw new InvalidArgumentError(`Unknown promotion mode: ${value}`);
}

function parseSessionScope(value: string): SessionScope {
  if (value === 'read' || value === 'write' || value === 'admin') return value;
  throw new InvalidArgumentError(`Unknown session scope: ${value}`);
}

function asArtifactList(value: unknown): Array<{
  id: string;
  kind: string;
  lifecycle: string;
  slug: string;
  title: string;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => isRecordValue(item) &&
    typeof item.id === 'string' && typeof item.kind === 'string' &&
    typeof item.lifecycle === 'string' && typeof item.slug === 'string' && typeof item.title === 'string'
    ? [{ id: item.id, kind: item.kind, lifecycle: item.lifecycle, slug: item.slug, title: item.title }]
    : []);
}

function asRecordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecordValue) : [];
}

function stringField(value: unknown, key: string): string {
  if (!isRecordValue(value)) return '';
  const field = value[key];
  return typeof field === 'string' || typeof field === 'number' ? String(field) : '';
}

function numberField(value: unknown, key: string): number {
  return isRecordValue(value) && typeof value[key] === 'number' ? value[key] : 0;
}

function booleanField(value: unknown, key: string): boolean {
  return isRecordValue(value) && value[key] === true;
}

function readResultContent(value: unknown): string {
  if (!isRecordValue(value) || typeof value.content !== 'string') throw new Error('Artifact content is unavailable.');
  return value.content;
}

function printApplicationResult(value: unknown, json: boolean | undefined, label: string): void {
  if (json === true) {
    printJson(value);
    return;
  }
  const artifact = isRecordValue(value) && isRecordValue(value.artifact) ? value.artifact : value;
  const identity = stringField(artifact, 'id') || stringField(artifact, 'slug');
  console.log(`manager\t${label}${identity.length === 0 ? '' : `\t${identity}`}`);
}

function titleFromCliSlug(slug: string): string {
  return slug.split('-').filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ') || slug;
}

async function openSystemPath(targetPath: string): Promise<void> {
  await access(targetPath);
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [targetPath], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function exitCodeForError(error: unknown): 1 | 2 | 3 | 4 {
  if (error instanceof ApplicationPermissionError) return 4;
  if (error instanceof RevisionConflictError) return 2;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('authentication') || message.includes('permission') || message.includes('unauthorized')) return 4;
  if (message.includes('drift') || message.includes('conflict')) return 2;
  if (message.includes('validation') || message.includes('invalid') || message.includes('blocked') ||
    message.includes('requires explicit') || message.includes('migration approval') || message.includes('unbound')) return 3;
  return 1;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ProviderTarget {
  provider: ProviderId;
  content?: ContentId;
}

interface ScanProviderJson {
  id: ProviderId;
  displayName: string;
  detected: boolean;
  enabled: boolean;
  contents: Record<ContentId, boolean>;
  inventory: ProviderInventory;
}

interface ScanJson {
  version: 1;
  regletHome: string;
  providers: ScanProviderJson[];
  safety: SafetyJson;
}

interface StatusProviderJson {
  id: ProviderId;
  displayName: string;
  enabled: boolean;
  contents: Record<ContentId, boolean>;
}

interface StatusJson {
  version: 1;
  regletHome: string;
  capabilities: {
    mode: 'public-v1';
    localOnly: true;
    sync: false;
  };
  providers: StatusProviderJson[];
  drift: DriftRecord[];
  driftedCount: number;
}

interface OnboardingPlanJson {
  version: 1;
  mode: 'onboarding';
  regletHome: string;
  providers: PlannedProviderJson[];
  reads: PlannedFileJson[];
  writes: PlannedFileJson[];
  reconciliation: OnboardingReconciliationJson;
  safety: SafetyJson;
}

interface OnboardingReconciliationJson {
  rules: RuleComparisonJson[];
}

interface RuleComparisonJson {
  provider: ProviderId;
  sourcePath: string;
  destinationPath: string;
  state: 'new' | 'matching' | 'different';
  preview: string;
  truncated: boolean;
}

interface RuleMergeSourceJson {
  provider: ProviderId;
  sourcePath: string;
  bytes: number;
}

interface RuleDocumentJson {
  path: string;
  scope: {
    kind: 'shared' | 'provider';
    provider?: ProviderId;
  };
}

interface RuleMergeDraftJson {
  provider: string;
  draft: string;
  sources: RuleMergeSourceJson[];
}

type AiMergeRunnerId = 'codex' | 'claude' | 'gemini';

interface AiMergeRunner {
  provider: string;
  command: string;
  args: string[];
  promptAsArgument: boolean;
}

interface InstalledAiMergeRunnerJson {
  id: AiMergeRunnerId;
  displayName: string;
  executablePath: string;
}

interface PlannedProviderJson {
  id: ProviderId;
  displayName: string;
  detected: boolean;
  contents: Partial<Record<ContentId, PlannedContentJson>>;
}

interface PlannedContentJson {
  selected: boolean;
  supported: boolean;
  readPaths: string[];
  writePaths: string[];
  notes: string[];
}

interface PlannedFileJson {
  provider: ProviderId;
  content: ContentId;
  path: string;
  scope: 'master' | 'provider';
  operation: 'read' | 'write';
  reason: string;
}

interface SafetyJson {
  daemonEnabled: false;
  syncEnabled: false;
  notificationsEnabled: false;
  requiresExplicitConfirmation: true;
}

interface ManagerSnapshotV1Json {
  version: 1;
  scan: ScanJson;
  status: StatusJson;
  skills: { version: 1; regletHome: string } & Awaited<ReturnType<typeof listSkills>>;
  rules: { version: 1; documents: RuleDocumentJson[] };
  mcp: { version: 1; servers: Awaited<ReturnType<typeof listMcpServers>>['servers'] };
  operations: Awaited<ReturnType<typeof listOperationReceipts>>;
  legacyNetworkState: Awaited<ReturnType<typeof inspectLegacySyncState>>;
}

interface BuildOnboardingPlanOptions {
  providers: ProviderId[];
  contents: ApplyContent[];
}

interface SkillCommandOptions {
  scope: SkillAdoptionScope;
  provider?: ProviderId;
  json?: boolean;
}

interface McpCommandOptions {
  scope?: 'shared' | 'provider';
  provider?: ProviderId;
  json?: boolean;
  displayName?: string;
}

function mcpScope(options: McpCommandOptions): McpScope {
  if (options.scope === 'provider') {
    if (options.provider === undefined) throw new InvalidArgumentError('--provider is required for provider scope');
    return providerMcpScope(options.provider);
  }
  return sharedMcpScope();
}

function skillScope(options: SkillCommandOptions): SkillScope {
  if (options.scope === 'provider') {
    if (options.provider === undefined) throw new InvalidArgumentError('--provider is required for provider scope');
    return { kind: 'provider', provider: options.provider };
  }
  return { kind: 'shared' };
}

function sameSkillScope(scope: SkillScope, options: SkillCommandOptions): boolean {
  return options.scope === 'shared' ? scope.kind === 'shared' : scope.kind === 'provider' && scope.provider === options.provider;
}

function safetyDefaults(): SafetyJson {
  return {
    daemonEnabled: false,
    syncEnabled: publicReleaseCapabilities.sync,
    notificationsEnabled: false,
    requiresExplicitConfirmation: true,
  };
}

function parseSkillScope(value: string): SkillAdoptionScope {
  if (value === 'shared' || value === 'provider') return value;
  throw new InvalidArgumentError(`Unknown skill scope: ${value}`);
}

function parseMcpScope(value: string): 'shared' | 'provider' {
  if (value === 'shared' || value === 'provider') return value;
  throw new InvalidArgumentError(`Unknown MCP scope: ${value}`);
}

function parseProvider(value: string): ProviderId {
  if (providerIds.includes(value as ProviderId)) {
    return value as ProviderId;
  }
  throw new InvalidArgumentError(`Unknown provider: ${value}`);
}

function parseAiMergeRunnerId(value: string): AiMergeRunnerId {
  if (value === 'codex' || value === 'claude' || value === 'gemini') return value;
  throw new InvalidArgumentError(`Unknown AI merge runner: ${value}`);
}

function parseContent(value: string): ApplyContent {
  if (contentIds.includes(value as ContentId)) {
    return value as ApplyContent;
  }
  throw new InvalidArgumentError(`Unknown content type: ${value}`);
}

function parseManagerContractVersion(value: string): ManagerContractVersion {
  if (value === '1' || value === 'v1') return 1;
  if (value === '2' || value === 'v2') return 2;
  throw new InvalidArgumentError(`Unsupported manager snapshot contract version: ${value}`);
}

function parseRpcProtocolVersion(value: string): ManagerProtocolVersion {
  if (value === '1' || value === 'v1') return legacyManagerProtocolVersion;
  if (value === '2' || value === 'v2') return managerProtocolVersion;
  throw new InvalidArgumentError(`Unsupported manager RPC protocol version: ${value}`);
}

function parseProviderList(value: string, previous: ProviderId[] = []): ProviderId[] {
  return [...previous, ...value.split(',').filter((item) => item.length > 0).map(parseProvider)];
}

function parseContentList(value: string, previous: ApplyContent[] = []): ApplyContent[] {
  return [...previous, ...value.split(',').filter((item) => item.length > 0).map(parseContent)];
}

function parseProviderTarget(value: string): ProviderTarget {
  const [providerRaw, contentRaw] = value.split(':');
  if (providerRaw === undefined || providerRaw.length === 0) {
    throw new InvalidArgumentError(`Invalid target: ${value}`);
  }
  const provider = parseProvider(providerRaw);
  if (contentRaw === undefined) {
    return { provider };
  }
  return { provider, content: parseContent(contentRaw) };
}

async function handleManagerRpc(rawInput: string, cliProtocolVersion: ManagerProtocolVersion): Promise<ManagerRpcResponse> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput) as unknown;
  } catch {
    return failureResponse('unknown', 'MALFORMED_REQUEST', 'Request body must be exactly one JSON object.', false, cliProtocolVersion);
  }

  if (!isRecord(parsed)) {
    return failureResponse('unknown', 'MALFORMED_REQUEST', 'Request body must be a JSON object.', false, cliProtocolVersion);
  }
  if (!isManagerProtocolVersion(parsed.protocolVersion) || parsed.protocolVersion !== cliProtocolVersion) {
    return failureResponse('unknown', 'UNKNOWN_PROTOCOL_VERSION', 'Unsupported or mismatched Manager RPC protocol version.', false, cliProtocolVersion);
  }
  if (!isManagerProtocolOperation(parsed.operation)) {
    return failureResponse('unknown', 'UNKNOWN_OPERATION', 'Unknown Manager RPC operation.', false, cliProtocolVersion);
  }
  if (!isManagerRpcEnvelope(parsed)) {
    return failureResponse(parsed.operation, 'MALFORMED_REQUEST', 'Request envelope is malformed.', false, cliProtocolVersion);
  }
  if (!managerRpcRequestValidator.validate(parsed)) {
    return failureResponse(parsed.operation, 'INVALID_INPUT', 'Operation input is invalid.', false, cliProtocolVersion);
  }

  try {
    return successResponse(parsed.operation, toJsonValue(await dispatchManagerRpc(parsed)), parsed.protocolVersion);
  } catch (error) {
    return managerRpcErrorResponse(parsed.operation, error, parsed.protocolVersion);
  }
}

async function readManagerRpcLine(): Promise<string> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    input.close();
    return line;
  }
  return '';
}

async function dispatchManagerRpc(request: ManagerRpcRequest): Promise<unknown> {
  const input = rpcInput(request);
  switch (request.operation) {
    case 'snapshot': {
      const contractVersion = readOptionalNumber(input, 'contractVersion') ?? 2;
      if (contractVersion === 1) return buildManagerSnapshotV1();
      if (contractVersion === 2) return buildManagerSnapshotV2();
      throw new InvalidArgumentError('contractVersion must be 1 or 2');
    }
    case 'scan':
      return buildScanJson();
    case 'plan':
      return buildOnboardingPlanJson({
        providers: readProviderArray(input, 'providers') ?? await detectedProviderIds(),
        contents: readContentArray(input, 'contents') ?? [...contentIds],
      });
    case 'onboard': {
      const providers = readProviderArray(input, 'providers') ?? await detectedProviderIds();
      const contents = readContentArray(input, 'contents') ?? [...contentIds];
      const stageOnly = readOptionalBoolean(input, 'stageOnly') ?? true;
      await initMasterDir();
      await runOnboarding(providers, contents, !stageOnly);
      return { version: 1, providers, contents, stageOnly };
    }
    case 'enroll':
      return setEnrollmentForRpc(readProviderTargetInput(input), true);
    case 'unenroll':
      return setEnrollmentForRpc(readProviderTargetInput(input), false);
    case 'status':
      return buildStatusJson();
    case 'import-drift':
      return importDriftForRpc(readProvider(input, 'provider'), readContent(input, 'content'), readOptionalMcpImportScope(input));
    case 'rules.list': {
      const master = await loadMasterDir();
      return { version: 1, documents: ruleDocuments(master) };
    }
    case 'rules.read':
      return { version: 1, path: readString(input, 'path'), content: await readFile(masterRulePath(readString(input, 'path')), 'utf8') };
    case 'rules.write': {
      const relativePath = readString(input, 'path');
      const target = masterRulePath(relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, readString(input, 'content'));
      return { version: 1, path: relativePath };
    }
    case 'rules.source-read': {
      const provider = readProvider(input, 'provider');
      const adapter = getAdapter(provider);
      const sourcePath = adapter.rulesPath();
      if (sourcePath === null) throw new Error(`${adapter.displayName} does not expose a rules file.`);
      const content = await readOptionalFile(sourcePath);
      if (content === null) throw new Error(`${adapter.displayName} rules were not found.`);
      return { version: 1, provider, fileName: path.basename(sourcePath), content };
    }
    case 'rules.merge-runners':
      return { version: 1, runners: await listInstalledMergeRunners() };
    case 'rules.merge-draft':
      return {
        version: 1,
        ...await generateRulesMergeDraft(
          readProviderArray(input, 'providers') ?? [],
          readOptionalRunner(input),
          readOptionalString(input, 'steeringPrompt'),
        ),
      };
    case 'skills.list':
      return { version: 1, regletHome: regletHome(), ...await listSkills() };
    case 'skills.tree': {
      const tree = (await listManagedSkillTrees()).find((skill) => skill.name === readString(input, 'name') && sameSkillScope(skill.scope, readSkillOptions(input)));
      if (tree === undefined) throw new Error(`Skill does not exist: ${readString(input, 'name')}`);
      return { version: 1, tree };
    }
    case 'skills.read':
      return { version: 1, document: await readSkillFile(readSkillScopeInput(input), readString(input, 'name'), readString(input, 'path')) };
    case 'skills.inspect':
      if (typeof input.path === 'string') {
        return { version: 1, document: await readUnmanagedSkillFile(readProvider(input, 'provider'), readString(input, 'name'), input.path) };
      }
      return { version: 1, tree: await describeUnmanagedSkill(readProvider(input, 'provider'), readString(input, 'name')) };
    case 'skills.write':
      return { version: 1, document: await writeSkillFile(readSkillScopeInput(input), readString(input, 'name'), readString(input, 'path'), readString(input, 'content')) };
    case 'skills.create':
      return { version: 1, document: await createSkill(readSkillScopeInput(input), readString(input, 'name'), readOptionalString(input, 'content') ?? '# Skill\n') };
    case 'skills.delete':
      return { version: 1, skill: await deleteSkill(readSkillScopeInput(input), readString(input, 'name')) };
    case 'skills.rename':
      return { version: 1, skill: await renameSkill(readSkillScopeInput(input), readString(input, 'name'), readString(input, 'newName')) };
    case 'skills.delete-file':
      return { version: 1, skill: await deleteSkillFile(readSkillScopeInput(input), readString(input, 'name'), readString(input, 'path')) };
    case 'skills.rename-file':
      return { version: 1, skill: await renameSkillFile(readSkillScopeInput(input), readString(input, 'name'), readString(input, 'path'), readString(input, 'newPath')) };
    case 'skills.adopt':
      return {
        version: 1,
        adoption: await adoptSkill({
          provider: readProvider(input, 'provider'),
          name: readString(input, 'name'),
          scope: readSkillAdoptionScope(input),
          overwrite: readOptionalBoolean(input, 'overwrite'),
        }),
      };
    case 'skills.update-sync':
      return {
        version: 1,
        providers: await updateSkillSyncProviders(readString(input, 'name'), readProviderArray(input, 'providers') ?? []),
      };
    case 'mcp.list':
      if (typeof input.effectiveProvider === 'string') {
        const provider = parseProvider(input.effectiveProvider);
        return { version: 1, scope: { kind: 'provider', provider }, effective: true, servers: await listEffectiveMcpServers(provider) };
      }
      return { version: 1, ...await listMcpServers(readMcpScopeInput(input)) };
    case 'mcp.upsert':
      return {
        version: 1,
        server: await upsertMcpServer(readString(input, 'id'), readMcpServerDefinition(input), readMcpScopeInput(input), undefined, readOptionalString(input, 'displayName')),
      };
    case 'mcp.delete':
      return { version: 1, server: await deleteMcpServer(readString(input, 'id'), readMcpScopeInput(input)) };
    case 'mcp.update-sync':
      return {
        version: 1,
        providers: await updateMcpSyncProviders(readString(input, 'id'), readProviderArray(input, 'providers') ?? []),
      };
    case 'structured-preview.preview':
      return previewApplyStructured({ providers: readProviderArray(input, 'providers'), contents: readContentArray(input, 'contents') });
    case 'structured-preview.apply':
      return applyStructuredPreview(readString(input, 'digest'), { providers: readProviderArray(input, 'providers'), contents: readContentArray(input, 'contents') });
    case 'operation.restore':
      return { version: 1, actions: await restoreOperationReceipt(readString(input, 'id')) };
    case 'legacy-state.clear':
      return { version: 1, legacyNetworkState: await clearLegacySyncState() };
    case 'sync.preview.set': {
      const config = await loadConfig();
      config.encryptedSyncPreview.acknowledged = readBoolean(input, 'acknowledged');
      await saveConfig(config);
      return buildSyncSnapshot();
    }
    case 'sync.snapshot':
      return buildSyncSnapshot();
    case 'sync.bootstrap.start':
      await requireSyncPreviewAcknowledged();
      return {
        version: 1,
        ...await startSyncV2BootstrapConnection({
          connectUrl: readString(input, 'connectUrl'),
          deviceName: readString(input, 'deviceName'),
        }),
      };
    case 'sync.invitation.create':
      await requireSyncPreviewAcknowledged();
      return createManagedSyncV2Invitation();
    case 'sync.pair.request':
      await requireSyncPreviewAcknowledged();
      return requestSyncV2Pairing({
        serverUrl: readOptionalString(input, 'serverUrl'),
        connectUrl: readOptionalString(input, 'connectUrl'),
        deviceName: readString(input, 'deviceName'),
      });
    case 'sync.pair.approve':
      await requireSyncPreviewAcknowledged();
      return approveSyncV2Pairing({ code: readString(input, 'code') });
    case 'sync.pair.status': {
      await requireSyncPreviewAcknowledged();
      const status = await pendingSyncV2ConnectionStatus();
      return { ...status, code: status.method === 'pair' ? status.code : null };
    }
    case 'sync.pair.complete': {
      await requireSyncPreviewAcknowledged();
      const state = await loadSyncV2State();
      if (state?.phase !== 'pending') throw new Error('This device has no pending encrypted sync connection');
      if (state.method === 'bootstrap') {
        await completeSyncV2BootstrapConnection({ confirmedFingerprint: readString(input, 'fingerprint') });
      } else {
        await completeSyncV2Pairing({ confirmedSas: readString(input, 'fingerprint') });
      }
      return buildSyncSnapshot();
    }
    case 'sync.pair.cancel':
      await requireSyncPreviewAcknowledged();
      await cancelPendingSyncV2Connection();
      return buildSyncSnapshot();
    case 'sync.run': {
      await requireSyncPreviewAcknowledged();
      const run: SyncRunResult = await syncOnceV2();
      return run;
    }
    case 'sync.device.rename':
      await requireSyncPreviewAcknowledged();
      await renameManagedSyncV2Device({ deviceId: readString(input, 'deviceId'), name: readString(input, 'name') });
      return { renamed: true, deviceId: readString(input, 'deviceId'), name: readString(input, 'name') };
    case 'sync.device.revoke':
      await requireSyncPreviewAcknowledged();
      return revokeManagedSyncV2Device({ deviceId: readString(input, 'deviceId') });
    case 'sync.disconnect':
      await requireSyncPreviewAcknowledged();
      await disconnectSyncV2({ localOnly: readOptionalBoolean(input, 'localOnly') });
      return buildSyncSnapshot();
    case 'migration.preview':
      return previewLibraryMigration();
    case 'migration.apply':
      return applyLibraryMigration({
        previewDigest: readString(input, 'previewDigest'),
        yes: readBoolean(input, 'yes'),
      });
    case 'migration.status':
      return libraryMigrationStatus();
    default:
      throw new InvalidArgumentError(`Manager operation is not available in this integration phase: ${request.operation}`);
  }
}

async function requireSyncPreviewAcknowledged(): Promise<void> {
  if (!(await loadConfig()).encryptedSyncPreview.acknowledged) {
    throw new Error('Encrypted Sync (Preview) must be acknowledged before making a network request');
  }
}

async function buildSyncSnapshot(): Promise<SyncSnapshot> {
  const previewAcknowledged = (await loadConfig()).encryptedSyncPreview.acknowledged;
  const empty: Pick<SyncSnapshot, 'devices' | 'conflicts' | 'lastSync' | 'lastError' | 'pending' | 'keyRotationRequired'> = {
    devices: [],
    conflicts: [],
    lastSync: null,
    lastError: null,
    pending: null,
    keyRotationRequired: false,
  };
  if (!previewAcknowledged) {
    return {
      version: 1,
      previewAcknowledged,
      phase: 'disabled',
      serverUrl: null,
      serverHost: null,
      compatibility: 'unknown',
      currentDeviceId: null,
      currentDeviceName: null,
      ...empty,
    };
  }
  const state = await loadSyncV2State();
  if (state === null) {
    return {
      version: 1,
      previewAcknowledged,
      phase: 'disconnected',
      serverUrl: null,
      serverHost: null,
      compatibility: 'unknown',
      currentDeviceId: null,
      currentDeviceName: null,
      ...empty,
    };
  }
  const serverHost = new URL(state.serverUrl).host;
  if (state.phase === 'pending') {
    return {
      version: 1,
      previewAcknowledged,
      phase: 'pending',
      serverUrl: state.serverUrl,
      serverHost,
      compatibility: 'unknown',
      currentDeviceId: state.method === 'bootstrap' ? state.deviceId : state.request.deviceId,
      currentDeviceName: state.method === 'bootstrap' ? state.deviceName : state.request.deviceName,
      pending: state.method === 'bootstrap'
        ? {
            method: 'bootstrap',
            status: 'pending',
            deviceName: state.deviceName,
            code: null,
            fingerprint: state.fingerprint,
            expiresAt: state.expiresAt,
          }
        : {
            method: 'pair',
            status: 'pending',
            deviceName: state.request.deviceName,
            code: state.request.code,
            fingerprint: null,
            expiresAt: state.request.expiresAt,
          },
      devices: [],
      conflicts: [],
      lastSync: null,
      lastError: null,
      keyRotationRequired: false,
    };
  }
  try {
    const response = await listManagedSyncV2Devices();
    return {
      version: 1,
      previewAcknowledged,
      phase: 'connected',
      serverUrl: state.serverUrl,
      serverHost,
      compatibility: 'compatible',
      currentDeviceId: state.deviceId,
      currentDeviceName: state.deviceName,
      pending: null,
      devices: response.devices.map((device) => ({
        id: device.deviceId,
        name: device.deviceName,
        current: device.deviceId === response.currentDeviceId,
        status: device.revokedAt === null ? 'active' : 'revoked',
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
        revokedAt: device.revokedAt,
      })),
      conflicts: Object.entries(state.files)
        .filter(([, file]) => file.conflicted === true)
        .map(([filePath]) => filePath)
        .sort((left, right) => left.localeCompare(right)),
      lastSync: state.lastSync ?? null,
      lastError: state.lastError ?? null,
      keyRotationRequired: state.keyRotationRequired === true,
    };
  } catch (error) {
    const revoked = error instanceof Error && error.message.includes('failed: 401');
    if (revoked && state.keyRotationRequired !== true) {
      state.keyRotationRequired = true;
      await saveSyncV2State(state);
    }
    return {
      version: 1,
      previewAcknowledged,
      phase: 'connected',
      serverUrl: state.serverUrl,
      serverHost,
      compatibility: revoked ? 'revoked' : 'unreachable',
      currentDeviceId: state.deviceId,
      currentDeviceName: state.deviceName,
      pending: null,
      devices: [],
      conflicts: Object.entries(state.files)
        .filter(([, file]) => file.conflicted === true)
        .map(([filePath]) => filePath)
        .sort((left, right) => left.localeCompare(right)),
      lastSync: state.lastSync ?? null,
      lastError: state.lastError ?? null,
      keyRotationRequired: state.keyRotationRequired === true || revoked,
    };
  }
}

async function setEnrollmentForRpc(target: ProviderTarget, enabled: boolean): Promise<JsonObject> {
  const config = await loadConfig();
  const detachment = enabled ? undefined : await detachManagedContent(target.provider, target.content);
  if (target.content === undefined) {
    config.providers[target.provider].enabled = enabled;
  } else {
    config.providers[target.provider][target.content] = enabled;
  }
  await saveConfig(config);
  return toJsonObject({ version: 1, target, enabled, detached: detachment?.detached ?? [] });
}

async function importDriftForRpc(provider: ProviderId, content: ApplyContent, scope: 'shared' | 'provider'): Promise<unknown> {
  if (content === 'rules') return { version: 1, content: 'rules', ...await importDriftedRules(provider) };
  if (content === 'skills') return { version: 1, content: 'skills', ...await importDriftedSkills(provider) };
  return { version: 1, content: 'mcp', ...await importDriftedMcp(provider, regletHome(), scope) };
}

function managerRpcErrorResponse(
  operation: ManagerProtocolOperation,
  error: unknown,
  protocolVersion: ManagerProtocolVersion,
): ManagerRpcResponse {
  const managerError = managerErrorFromUnknown(error, `manager.rpc.${operation}`);
  const code = protocolErrorCode(error, managerError.error.code);
  const message = redactManagerValue(error instanceof Error ? error.message : managerError.error.message);
  return failureResponse(operation, code, message, code === 'INVALID_INPUT' ? false : managerError.error.recoverable, protocolVersion);
}

function protocolErrorCode(error: unknown, managerCode: ManagerIssueCodeV2): ManagerProtocolErrorCode {
  if (error instanceof InvalidArgumentError) return 'INVALID_INPUT';
  if (managerCode === 'STALE_PLAN') return 'STALE_PLAN';
  if (managerCode === 'OPERATION_FAILED') return 'OPERATION_FAILED';
  return 'OPERATION_FAILED';
}

function rpcInput(request: ManagerRpcRequest): JsonObject {
  if (request.input === undefined) return {};
  if (!isJsonObject(request.input)) {
    throw new InvalidArgumentError('RPC input must be a JSON object');
  }
  return request.input;
}

function readProviderTargetInput(input: JsonObject): ProviderTarget {
  if (typeof input.target === 'string') return parseProviderTarget(input.target);
  return { provider: readProvider(input, 'provider'), content: readOptionalContent(input, 'content') };
}

function readSkillOptions(input: JsonObject): SkillCommandOptions {
  return { scope: readSkillAdoptionScope(input), provider: readOptionalProvider(input, 'provider') };
}

function readSkillScopeInput(input: JsonObject): SkillScope {
  return skillScope(readSkillOptions(input));
}

function readMcpScopeInput(input: JsonObject): McpScope {
  return mcpScope({ scope: readOptionalMcpImportScope(input), provider: readOptionalProvider(input, 'provider') });
}

function readMcpServerDefinition(input: JsonObject): McpServerDef {
  const server = input.server;
  if (!isJsonObject(server)) throw new InvalidArgumentError('server must be an object');
  return server as unknown as McpServerDef;
}

function readString(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== 'string') throw new InvalidArgumentError(`${key} must be a string`);
  return value;
}

function readOptionalString(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new InvalidArgumentError(`${key} must be a string`);
  return value;
}

function readOptionalNumber(input: JsonObject, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number') throw new InvalidArgumentError(`${key} must be a number`);
  return value;
}

function readOptionalBoolean(input: JsonObject, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new InvalidArgumentError(`${key} must be a boolean`);
  return value;
}

function readBoolean(input: JsonObject, key: string): boolean {
  const value = input[key];
  if (typeof value !== 'boolean') throw new InvalidArgumentError(`${key} must be a boolean`);
  return value;
}

function readProvider(input: JsonObject, key: string): ProviderId {
  return parseProvider(readString(input, key));
}

function readOptionalProvider(input: JsonObject, key: string): ProviderId | undefined {
  const value = readOptionalString(input, key);
  return value === undefined ? undefined : parseProvider(value);
}

function readContent(input: JsonObject, key: string): ApplyContent {
  return parseContent(readString(input, key));
}

function readOptionalContent(input: JsonObject, key: string): ApplyContent | undefined {
  const value = readOptionalString(input, key);
  return value === undefined ? undefined : parseContent(value);
}

function readProviderArray(input: JsonObject, key: string): ProviderId[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new InvalidArgumentError(`${key} must be a string array`);
  }
  return value.map(parseProvider);
}

function readContentArray(input: JsonObject, key: string): ApplyContent[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new InvalidArgumentError(`${key} must be a string array`);
  }
  return value.map(parseContent);
}

function readSkillAdoptionScope(input: JsonObject): SkillAdoptionScope {
  return parseSkillScope(readOptionalString(input, 'scope') ?? 'shared');
}

function readOptionalMcpImportScope(input: JsonObject): 'shared' | 'provider' {
  return parseMcpScope(readOptionalString(input, 'scope') ?? 'shared');
}

function readOptionalRunner(input: JsonObject): AiMergeRunnerId | undefined {
  const value = readOptionalString(input, 'runner');
  return value === undefined ? undefined : parseAiMergeRunnerId(value);
}

function toJsonObject(value: unknown): JsonObject {
  const json = toJsonValue(value);
  if (!isJsonObject(json)) throw new Error('RPC result is not a JSON object');
  return json;
}

function toJsonValue(value: unknown): JsonValue {
  const normalized = JSON.parse(JSON.stringify(redactManagerValue(value))) as unknown;
  if (!isJsonValueForRpc(normalized)) {
    throw new Error('RPC result is not JSON-serializable');
  }
  return normalized;
}

function isJsonValueForRpc(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValueForRpc);
  return isJsonObject(value);
}

function printRpcJson(value: ManagerRpcResponse): void {
  process.stdout.write(`${JSON.stringify(redactManagerValue(value))}\n`);
}

async function runOnboarding(providers: ProviderId[], contents: ApplyContent[], applyProviderOutputs = true): Promise<void> {
  const config = await loadConfig();
  for (const provider of providers) {
    config.providers[provider].enabled = true;
    for (const content of contentIds) {
      config.providers[provider][content] = contents.includes(content);
    }
    if (contents.includes('rules')) {
      await importProviderRules(provider);
    }
    // Existing provider skills stay local and unmanaged by default. Importing
    // them into the master would otherwise copy one provider's skills to all
    // enrolled providers on the next apply.
    if (contents.includes('mcp')) {
      await importProviderMcp(provider);
    }
  }
  await saveConfig(config);
  if (applyProviderOutputs) {
    await applyAll({ providers, contents });
  }
}

async function runInteractiveOnboarding(): Promise<void> {
  console.log('\n╭────────────────────────────────────────────────────────╮');
  console.log('│  Welcome to Reglet!                                    │');
  console.log('│  The control plane for AI agent rules, skills & MCP.  │');
  console.log('╰────────────────────────────────────────────────────────╯\n');

  // Step 1: Detect and select providers
  const detected = await detectedProviderIds();
  const allKnown = allAdapters();

  const providerChoices = allKnown.map((adapter) => {
    const isDetected = detected.includes(adapter.id);
    return {
      value: adapter.id,
      label: `${adapter.displayName}${isDetected ? ' (detected on this machine)' : ''}`,
    };
  });

  const selectedProviders = await multiselect({
    message: 'Select AI coding assistants to manage on this machine:',
    options: providerChoices,
    initialValues: detected.length > 0 ? detected : ['claude', 'cursor'],
    required: false,
  });

  if (isCancel(selectedProviders)) {
    outro('Setup cancelled.');
    return;
  }

  const providersToEnroll = normalizeProviderSelections(selectedProviders as string[]);

  // Step 2: Content types to manage
  const selectedContents = await multiselect({
    message: 'Select content types to manage and synchronize:',
    options: [
      { value: 'rules', label: 'Master Rules (shared instructions & guidelines)' },
      { value: 'skills', label: 'Skills (custom workflows & agent prompts)' },
      { value: 'mcp', label: 'MCP Configurations (Model Context Protocol servers)' },
    ],
    initialValues: ['rules', 'skills', 'mcp'],
    required: true,
  });

  if (isCancel(selectedContents)) {
    outro('Setup cancelled.');
    return;
  }

  const contentsToEnroll = normalizeContentSelections(selectedContents as string[]);

  if (providersToEnroll.length > 0) {
    await runOnboarding(providersToEnroll, contentsToEnroll, true);
    console.log(`\n✓ Configured ${providersToEnroll.length} assistant(s): ${providersToEnroll.join(', ')}\n`);
  }

  // Step 3: Sync server setup
  const wantSync = await select({
    message: 'Would you like to connect to an encrypted Reglet sync server?',
    options: [
      { value: 'later', label: 'Skip for now (use in local-only mode)' },
      { value: 'now', label: 'Connect now (enter server URL or invitation link)' },
    ],
  });

  if (!isCancel(wantSync) && wantSync === 'now') {
    try {
      await handleConnect();
    } catch (connectError) {
      console.log(`Sync connection note: ${connectError instanceof Error ? connectError.message : String(connectError)}. You can run "reglet connect" anytime.`);
    }
  }

  // Step 4: Tool authentication guidance
  const creds = await listCredentials().catch(() => []);
  const githubCred = creds.find((c) => c.provider === 'github');
  if (!githubCred) {
    console.log('GitHub Integration:');
    console.log('  Connect GitHub credentials for MCP tools anytime with: reglet auth login\n');
  }

  outro('Reglet setup complete! Run "reglet status" anytime to inspect your system.');
}

function normalizeProviderSelections(values: readonly string[]): ProviderId[] {
  return values.map(parseProvider);
}

function normalizeContentSelections(values: readonly string[]): ApplyContent[] {
  return values.map(parseContent);
}

async function buildManagerSnapshotV1(): Promise<ManagerSnapshotV1Json> {
  const master = await loadMasterDir();
  const skills = await listSkills();
  const mcpServers = await listMcpServers();
  return {
    version: 1,
    scan: await buildScanJson(),
    status: await buildStatusJson(),
    skills: { version: 1, regletHome: regletHome(), ...skills },
    rules: { version: 1, documents: ruleDocuments(master) },
    mcp: { version: 1, servers: mcpServers.servers },
    operations: await listOperationReceipts(),
    legacyNetworkState: await inspectLegacySyncState(),
  };
}

async function buildManagerSnapshotV2(): Promise<ManagerSnapshotV2> {
  const [config, master, mcpServers, receipts, legacyNetworkState, manifest] = await Promise.all([
    loadConfig(),
    loadMasterDir(),
    listMcpServers(),
    listOperationReceipts(),
    inspectLegacySyncState(),
    loadManifest(),
  ]);
  const revisions = await deriveMasterRevisions(master, config);
  const providerMcpServers = Object.fromEntries(
    await Promise.all(
      providerIds.map(async (provider) => [provider, (await listMcpServers(providerMcpScope(provider))).servers] as const),
    ),
  ) as Record<ProviderId, Awaited<ReturnType<typeof listMcpServers>>['servers']>;
  const discovery: ManagerProviderDiscoveryV2[] = [];
  const sourceInventory: ManagerSourceInventoryItemV2[] = [];
  const enrollmentMatrix: ManagerEnrollmentProviderV2[] = [];
  const structuredEntries: ManagerStructuredPlanEntryV2[] = [];

  for (const adapter of allAdapters()) {
    const providerConfig = config.providers[adapter.id];
    const state = await readProviderState(adapter.id);
    const capabilities = contentCapabilities(state);
    discovery.push({
      provider: adapter.id,
      displayName: adapter.displayName,
      presence: Object.keys(state.contentIssues).length === 0 ? (state.detected ? 'installed' : 'not-found') : 'needs-attention',
      detected: state.detected,
      capabilities,
    });
    sourceInventory.push(...inventoryItems(
      adapter.id,
      state.inventory,
      Object.fromEntries(
        Object.entries(state.contentIssues).map(([content, issue]) => [content, issue.message]),
      ) as Partial<Record<ApplyContent, string>>,
    ));

    const cells = Object.fromEntries(
      contentIds.map((content): [ContentId, ManagerEnrollmentProviderV2['cells'][ContentId]] => {
        const capability = capabilities[content];
        const cell = {
          provider: adapter.id,
          content,
          enrolled: providerConfig.enabled && providerConfig[content],
          capability,
          destinationPath: destinationPath(state.inventory, content),
        };
        structuredEntries.push(planEntry(cell));
        return [content, cell];
      }),
    ) as ManagerEnrollmentProviderV2['cells'];
    enrollmentMatrix.push({
      provider: adapter.id,
      displayName: adapter.displayName,
      enabled: providerConfig.enabled,
      cells,
    });
  }

  const state = await deriveManagerState(enrollmentMatrix, manifest, receipts, revisions.compositionRevisions);
  const snapshot: ManagerSnapshotV2 = {
    version: 2,
    contract: 'manager-snapshot',
    regletHome: regletHome(),
    safety: {
      localOnly: true,
      requiresExplicitReview: true,
    },
    providerDiscovery: discovery,
    sourceInventory,
    enrollmentMatrix,
    master: masterSummary(master, mcpServers.servers, providerMcpServers),
    masterRevision: revisions.masterRevision,
    state,
    problems: managerSnapshotIssues(discovery, state, receipts),
    effectiveProviders: await effectiveProviders(enrollmentMatrix, master, manifest, receipts, revisions.compositionRevisions),
    structuredPlan: {
      available: false,
      reason: 'snapshot-read-only',
      entries: structuredEntries,
    },
    driftInbox: await driftInboxFromManifest(manifest),
    receipts: {
      list: receipts.map(receiptListItem),
      details: receipts.map(receiptDetail),
    },
    legacyNetworkState,
  };
  return validateManagerSnapshotV2(redactManagerValue(snapshot));
}

function managerSnapshotIssues(
  discovery: ManagerProviderDiscoveryV2[],
  state: ManagerDerivedStateV2,
  receipts: Awaited<ReturnType<typeof listOperationReceipts>>,
): ManagerIssueV2[] {
  const issues: ManagerIssueV2[] = [];
  for (const provider of discovery) {
    for (const content of contentIds) {
      const capability = provider.capabilities[content];
      if (capability.state !== 'needs-attention') continue;
      if (!issues.some((issue) => issue.code === 'PARTIAL_SNAPSHOT')) {
        issues.push(managerIssue('PARTIAL_SNAPSHOT'));
      }
      issues.push(managerIssue(capability.reason === managerIssueMessage('INVALID_CONTENT') ? 'INVALID_CONTENT' : 'UNREADABLE_SOURCE', {
        provider: provider.provider,
        content,
      }));
    }
  }
  if (state.reasons.includes('requiredMcpEnvironmentMissing')) {
    issues.push(managerIssue('MISSING_MCP_ENVIRONMENT'));
  }
  if (state.reasons.includes('compositionRevisionChanged')) {
    issues.push(managerIssue('STALE_PLAN'));
  }
  for (const receipt of receipts) {
    if (receipt.lifecycle === 'pending') {
      issues.push(managerIssue('INTERRUPTED_OPERATION_RECOVERED', { operationId: receipt.id }));
    }
    if (receipt.lifecycle === 'rolled-back') {
      issues.push(managerIssue('OPERATION_FAILED', { operationId: receipt.id }));
    }
  }
  return issues;
}

function isInvalidContentError(error: unknown): boolean {
  return error instanceof Error && /invalid|parse|json/i.test(error.message);
}

async function readProviderState(provider: ProviderId): Promise<{
  detected: boolean;
  inventory: ProviderInventory;
  contentIssues: Partial<Record<ContentId, ManagerIssueV2>>;
}> {
  const adapter = getAdapter(provider);
  let detected = false;
  try {
    detected = await adapter.detect();
    return { detected, inventory: await adapter.inventory(), contentIssues: {} };
  } catch (error) {
    const code: ManagerIssueCodeV2 = isInvalidContentError(error) ? 'INVALID_CONTENT' : 'UNREADABLE_SOURCE';
    const issue = managerIssue(code, { provider, content: 'mcp', path: adapter.mcpPath() ?? undefined });
    const rulesPath = adapter.rulesPath();
    const skillsDir = adapter.skillsDir();
    return {
      detected,
      inventory: {
        rulesPath,
        rulesExists: rulesPath !== null && await fileExistsForSnapshot(rulesPath),
        skillsDir,
        skills: await childDirsForSnapshot(skillsDir),
        mcpPath: adapter.mcpPath(),
        mcpServers: [],
      },
      contentIssues: { mcp: issue },
    };
  }
}

function contentCapabilities(state: { inventory: ProviderInventory; contentIssues: Partial<Record<ContentId, ManagerIssueV2>> }): Record<ContentId, CapabilityState> {
  return {
    rules: state.contentIssues.rules === undefined
      ? state.inventory.rulesPath === null ? unsupportedCapability('provider has no system-instructions path') : supportedCapability()
      : needsAttentionCapability(state.contentIssues.rules.message),
    skills: state.contentIssues.skills === undefined
      ? state.inventory.skillsDir === null ? unsupportedCapability('provider has no skills directory') : supportedCapability()
      : needsAttentionCapability(state.contentIssues.skills.message),
    mcp: state.contentIssues.mcp === undefined
      ? state.inventory.mcpPath === null ? unsupportedCapability('provider has no MCP configuration path') : supportedCapability()
      : needsAttentionCapability(state.contentIssues.mcp.message),
  };
}

async function fileExistsForSnapshot(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function childDirsForSnapshot(dirPath: string | null): Promise<string[]> {
  if (dirPath === null) return [];
  try {
    return (await readdir(dirPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function planEntry(cell: ManagerEnrollmentProviderV2['cells'][ContentId]): ManagerStructuredPlanEntryV2 {
  if (cell.capability.state === 'unsupported') {
    return { provider: cell.provider, content: cell.content, destinationPath: cell.destinationPath, state: 'unsupported', reason: cell.capability.reason };
  }
  if (cell.capability.state === 'needs-attention') {
    return { provider: cell.provider, content: cell.content, destinationPath: cell.destinationPath, state: 'needs-attention', reason: cell.capability.reason };
  }
  if (!cell.enrolled) {
    return { provider: cell.provider, content: cell.content, destinationPath: cell.destinationPath, state: 'unenrolled' };
  }
  return { provider: cell.provider, content: cell.content, destinationPath: cell.destinationPath, state: 'eligible' };
}

function destinationPath(inventory: ProviderInventory, content: ContentId): string | null {
  if (content === 'rules') return inventory.rulesPath;
  if (content === 'skills') return inventory.skillsDir;
  return inventory.mcpPath;
}

function masterSummary(
  master: Awaited<ReturnType<typeof loadMasterDir>>,
  mcpServers: Awaited<ReturnType<typeof listMcpServers>>['servers'],
  providerMcpServers: Record<ProviderId, Awaited<ReturnType<typeof listMcpServers>>['servers']>,
): ManagerMasterSummaryV2 {
  return {
    rules: {
      sharedDocuments: master.rules.length,
      providerOverlays: providerCountRecord((provider) => master.providerRules[provider].length),
    },
    skills: {
      sharedSkills: master.skills.length,
      providerScopedSkills: providerCountRecord((provider) => master.providerSkills[provider].length),
    },
    mcp: {
      sharedServers: mcpServers.map(mcpServerSummary),
      providerServers: Object.fromEntries(
        providerIds.map((provider) => [provider, providerMcpServers[provider].map(mcpServerSummary)]),
      ) as Record<ProviderId, ReturnType<typeof mcpServerSummary>[]>,
    },
  };
}

async function effectiveProviders(
  enrollmentMatrix: ManagerEnrollmentProviderV2[],
  master: Awaited<ReturnType<typeof loadMasterDir>>,
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  receipts: Awaited<ReturnType<typeof listOperationReceipts>>,
  compositionRevisions: Awaited<ReturnType<typeof deriveMasterRevisions>>['compositionRevisions'],
): Promise<ManagerEffectiveProviderCompositionV2[]> {
  return Promise.all(enrollmentMatrix
    .filter((provider) => Object.values(provider.cells).some((cell) => cell.enrolled))
    .map(async (provider) => {
      const contents: ManagerEffectiveProviderCompositionV2['contents'] = {};
      for (const content of contentIds) {
        const cell = provider.cells[content];
        if (!cell.enrolled || cell.destinationPath === null) continue;
        const lastAppliedCompositionRevision = findLastAppliedCompositionRevision(cell, manifest, receipts);
        const mcpServers = content === 'mcp' ? (await listEffectiveMcpServers(provider.provider)).map(effectiveMcpServerSummary) : undefined;
        contents[content] = {
          enrolled: true,
          destinationPath: cell.destinationPath,
          masterItems: mcpServers === undefined ? masterItemCount(master, provider.provider, content) : mcpServers.length,
          capability: cell.capability,
          compositionRevision: compositionRevisions[provider.provider][content],
          ...(typeof lastAppliedCompositionRevision === 'string' ? { lastAppliedCompositionRevision } : {}),
          ...(mcpServers === undefined ? {} : { mcpServers }),
        };
      }
      return {
        provider: provider.provider,
        displayName: provider.displayName,
        contents,
      };
    }));
}

async function deriveManagerState(
  enrollmentMatrix: ManagerEnrollmentProviderV2[],
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  receipts: Awaited<ReturnType<typeof listOperationReceipts>>,
  compositionRevisions: Awaited<ReturnType<typeof deriveMasterRevisions>>['compositionRevisions'],
): Promise<ManagerDerivedStateV2> {
  const enrolledCells = enrollmentMatrix.flatMap((provider) =>
    contentIds
      .map((content) => provider.cells[content])
      .filter((cell) => cell.enrolled),
  );
  if (enrolledCells.length === 0) {
    return { state: 'draftOnly', reasons: ['noDestinationsEnrolled'] };
  }

  const reasons = new Set<ManagerDerivedStateV2['reasons'][number]>();
  if (enrolledCells.some((cell) => cell.capability.state === 'needs-attention')) {
    reasons.add('contentNeedsAttention');
  }
  if (enrolledCells.some((cell) => cell.capability.state === 'unsupported')) {
    reasons.add('contentUnsupported');
  }
  for (const cell of enrolledCells.filter((enrolledCell) => enrolledCell.content === 'mcp')) {
    try {
      await resolveEffectiveMcpServersEnv(cell.provider);
    } catch {
      reasons.add('requiredMcpEnvironmentMissing');
    }
  }
  if (reasons.has('contentNeedsAttention') || reasons.has('contentUnsupported') || reasons.has('requiredMcpEnvironmentMissing')) {
    return { state: 'blocked', reasons: Array.from(reasons).sort() };
  }

  const driftByPath = new Map((await detectDrift()).map((record) => [record.outputPath, record.status] as const));
  for (const outputPath of Object.keys(manifest.outputs)) {
    const status = driftByPath.get(outputPath);
    if (status === 'missing') reasons.add('managedOutputMissing');
    if (status === 'modified') reasons.add('managedOutputModified');
  }
  if (reasons.has('managedOutputMissing') || reasons.has('managedOutputModified')) {
    return { state: 'driftDetected', reasons: Array.from(reasons).sort() };
  }

  for (const cell of enrolledCells) {
    if (cell.destinationPath === null) continue;
    const appliedRevision = findLastAppliedCompositionRevision(cell, manifest, receipts);
    if (appliedRevision === undefined) {
      reasons.add('noAppliedRevision');
      continue;
    }
    if (appliedRevision === null || appliedRevision !== compositionRevisions[cell.provider][cell.content]) {
      reasons.add('compositionRevisionChanged');
    }
  }

  if (reasons.has('noAppliedRevision') || reasons.has('compositionRevisionChanged')) {
    return { state: 'changesReady', reasons: Array.from(reasons).sort() };
  }
  return { state: 'upToDate', reasons: ['compositionRevisionCurrent'] };
}

function findLastAppliedCompositionRevision(
  cell: ManagerEnrollmentProviderV2['cells'][ContentId],
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  receipts: Awaited<ReturnType<typeof listOperationReceipts>>,
): string | null | undefined {
  if (cell.destinationPath === null) return undefined;
  const matchingOutputs = Object.entries(manifest.outputs).filter(([outputPath, output]) =>
    output.provider === cell.provider &&
    output.content === cell.content &&
    (cell.content === 'skills' ? path.dirname(outputPath) === cell.destinationPath : outputPath === cell.destinationPath),
  );
  if (matchingOutputs.length > 0) {
    const revisions = new Set(
      matchingOutputs.flatMap(([, output]) => output.compositionRevision === undefined ? [] : [output.compositionRevision]),
    );
    if (revisions.size === 0) return undefined;
    if (revisions.size > 1 || revisions.size !== matchingOutputs.length) return null;
    return revisions.values().next().value;
  }

  const key = `${cell.provider}:${cell.content}`;
  return receipts.find((receipt) => receipt.lifecycle === 'completed' && receipt.compositionRevisions?.[key] !== undefined)
    ?.compositionRevisions?.[key];
}

function masterItemCount(master: Awaited<ReturnType<typeof loadMasterDir>>, provider: ProviderId, content: ContentId): number {
  if (content === 'rules') return master.rules.length + master.providerRules[provider].length;
  if (content === 'skills') return new Set([...master.skills.map((skill) => skill.name), ...master.providerSkills[provider].map((skill) => skill.name)]).size;
  return Object.keys(master.mcpServers).length;
}

function providerCountRecord(read: (provider: ProviderId) => number): Record<ProviderId, number> {
  return Object.fromEntries(providerIds.map((provider) => [provider, read(provider)])) as Record<ProviderId, number>;
}

async function driftInboxFromManifest(manifest: Awaited<ReturnType<typeof loadManifest>>): Promise<ManagerDriftInboxItemV2[]> {
  const items: ManagerDriftInboxItemV2[] = [];
  for (const [outputPath, output] of Object.entries(manifest.outputs)) {
    items.push({
      provider: output.provider,
      content: output.content,
      outputPath,
      ...(await driftStatusWithoutSecrets(outputPath, output.hash)),
    });
  }
  return items;
}

async function driftStatusWithoutSecrets(outputPath: string, expectedHash: string): Promise<Pick<ManagerDriftInboxItemV2, 'status' | 'issue'>> {
  try {
    const current = await currentTargetHash(outputPath);
    return { status: current === expectedHash ? 'clean' : 'modified' };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { status: 'missing' };
    }
    return { status: 'unknown', issue: 'Unable to inspect this managed output.' };
  }
}

async function currentTargetHash(outputPath: string): Promise<string> {
  const info = await stat(outputPath);
  if (!info.isDirectory()) return sha256String(await readFile(outputPath));
  const parts: string[] = [];
  async function visit(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        parts.push(`${path.relative(outputPath, entryPath).split(path.sep).join('/')}\0${await readFile(entryPath, 'utf8')}`);
      }
    }
  }
  await visit(outputPath);
  return sha256String(parts.join('\0'));
}

async function buildScanJson(): Promise<ScanJson> {
  const config = await loadConfig();
  const providers: ScanProviderJson[] = [];

  for (const adapter of allAdapters()) {
    const providerConfig = config.providers[adapter.id];
    providers.push({
      id: adapter.id,
      displayName: adapter.displayName,
      detected: await adapter.detect(),
      enabled: providerConfig.enabled,
      contents: {
        rules: providerConfig.rules,
        skills: providerConfig.skills,
        mcp: providerConfig.mcp,
      },
      inventory: await adapter.inventory(),
    });
  }

  return {
    version: 1,
    regletHome: regletHome(),
    providers,
    safety: safetyDefaults(),
  };
}

async function buildStatusJson(): Promise<StatusJson> {
  const config = await loadConfig();
  const drift = await detectDrift();

  return {
    version: 1,
    regletHome: regletHome(),
    capabilities: {
      mode: publicReleaseCapabilities.mode,
      localOnly: publicReleaseCapabilities.localOnly,
      sync: publicReleaseCapabilities.sync,
    },
    providers: allAdapters().map((adapter) => {
      const providerConfig = config.providers[adapter.id];
      return {
        id: adapter.id,
        displayName: adapter.displayName,
        enabled: providerConfig.enabled,
        contents: {
          rules: providerConfig.rules,
          skills: providerConfig.skills,
          mcp: providerConfig.mcp,
        },
      };
    }),
    drift,
    driftedCount: drift.filter((record) => record.status !== 'clean').length,
  };
}

async function buildOnboardingPlanJson(options: BuildOnboardingPlanOptions): Promise<OnboardingPlanJson> {
  const reads: PlannedFileJson[] = [];
  const writes: PlannedFileJson[] = [];
  const providers: PlannedProviderJson[] = [];
  const ruleComparisons: RuleComparisonJson[] = [];

  for (const provider of options.providers) {
    const adapter = getAdapter(provider);
    const inventory = await adapter.inventory();
    const plannedProvider: PlannedProviderJson = {
      id: provider,
      displayName: adapter.displayName,
      detected: await adapter.detect(),
      contents: {},
    };

    for (const content of options.contents) {
      const contentPlan = await buildContentPlan(provider, content, inventory);
      plannedProvider.contents[content] = contentPlan;
      reads.push(...contentPlan.readPaths.map((filePath) => plannedFile(provider, content, filePath, 'provider', 'read')));
      writes.push(...contentPlan.writePaths.map((filePath) => plannedFile(provider, content, filePath, plannedScope(filePath), 'write')));
      if (content === 'rules') {
        const comparison = await buildRuleComparison(provider, inventory);
        if (comparison !== null) {
          ruleComparisons.push(comparison);
        }
      }
    }

    providers.push(plannedProvider);
  }

  return {
    version: 1,
    mode: 'onboarding',
    regletHome: regletHome(),
    providers,
    reads,
    writes,
    reconciliation: {
      rules: ruleComparisons,
    },
    safety: safetyDefaults(),
  };
}

async function buildRuleComparison(provider: ProviderId, inventory: ProviderInventory): Promise<RuleComparisonJson | null> {
  if (inventory.rulesPath === null || !inventory.rulesExists) {
    return null;
  }

  const sourceContent = await readFile(inventory.rulesPath, 'utf8');
  const destinationPath = providerRuleImportPath(provider);
  const destinationContent = await readOptionalFile(destinationPath);

  return {
    provider,
    sourcePath: inventory.rulesPath,
    destinationPath,
    state: destinationContent === null ? 'new' : destinationContent === sourceContent ? 'matching' : 'different',
    preview: sourceContent.slice(0, rulesPreviewLimit),
    truncated: sourceContent.length > rulesPreviewLimit,
  };
}

async function generateRulesMergeDraft(
  providers: ProviderId[],
  selectedRunner?: AiMergeRunnerId,
  steeringPrompt?: string,
): Promise<RuleMergeDraftJson> {
  const uniqueProviders = Array.from(new Set(providers));
  const sources: (RuleMergeSourceJson & { content: string })[] = [];

  for (const provider of uniqueProviders) {
    const rulesPath = getAdapter(provider).rulesPath();
    if (rulesPath === null) {
      continue;
    }
    const content = await readOptionalFile(rulesPath);
    if (content === null || content.trim().length === 0) {
      continue;
    }
    sources.push({
      provider,
      sourcePath: rulesPath,
      bytes: Buffer.byteLength(content, 'utf8'),
      content,
    });
  }

  if (sources.length < 2) {
    throw new Error('Select at least two providers with non-empty rule files before generating a unified draft.');
  }

  const runner = selectedRunner === undefined
    ? mergeRunnerFromEnvironment() ?? (await detectMergeRunner())
    : await resolveMergeRunner(selectedRunner);
  if (runner === null) {
    throw new Error(selectedRunner === undefined
      ? 'No supported local AI CLI was found. Install Codex, Claude, or Gemini CLI, then retry.'
      : `${runnerDisplayName(selectedRunner)} was not found. Install it or choose another AI tool.`);
  }

  const normalizedSteeringPrompt = steeringPrompt?.trim();
  if ((normalizedSteeringPrompt?.length ?? 0) > rulesSteeringPromptLimit) {
    throw new InvalidArgumentError(`Draft guidance must be ${rulesSteeringPromptLimit.toLocaleString()} characters or fewer.`);
  }
  const prompt = buildRulesMergePrompt(sources, normalizedSteeringPrompt);
  const draft = (await runAiMerge(runner, prompt)).trim();
  if (draft.length === 0) {
    throw new Error(`${runner.provider} returned an empty draft. Retry or choose provider-specific prompts.`);
  }

  return {
    provider: runner.provider,
    draft: `${draft}\n`,
    sources: sources.map(({ provider, sourcePath, bytes }) => ({ provider, sourcePath, bytes })),
  };
}

function buildRulesMergePrompt(
  sources: (RuleMergeSourceJson & { content: string })[],
  steeringPrompt?: string,
): string {
  const sections = sources
    .map((source) => [
      `--- ${source.provider} (${source.sourcePath}) ---`,
      source.content.trim(),
    ].join('\n'))
    .join('\n\n');

  return [
    'You are helping compile local AI-agent system prompts into one Reglet unified prompt.',
    'Merge the selected provider prompts into a concise Markdown draft for ~/.reglet/rules/00-general.md.',
    'Preserve concrete behavioral instructions, safety constraints, workflow preferences, and provider-neutral details.',
    'Remove duplicates, contradictions, generated-file warnings, provider-specific file-management boilerplate, and stale onboarding prose.',
    'When instructions conflict, keep the stricter or more explicit instruction and phrase it provider-neutrally.',
    'Return only the merged Markdown draft. Do not wrap it in code fences. Do not include analysis.',
    '',
    sections,
    ...(steeringPrompt === undefined ? [] : [
      '',
      'Additional guidance from the user:',
      steeringPrompt,
    ]),
  ].join('\n');
}

async function detectMergeRunner(): Promise<AiMergeRunner | null> {
  for (const id of aiMergeRunnerIds()) {
    const runner = await resolveMergeRunner(id);
    if (runner !== null) {
      return runner;
    }
  }
  return null;
}

function aiMergeRunnerIds(): AiMergeRunnerId[] {
  return ['codex', 'claude', 'gemini'];
}

function runnerDisplayName(id: AiMergeRunnerId): string {
  switch (id) {
    case 'codex': return 'Codex CLI';
    case 'claude': return 'Claude Code';
    case 'gemini': return 'Gemini CLI';
  }
}

async function listInstalledMergeRunners(): Promise<InstalledAiMergeRunnerJson[]> {
  const runners = await Promise.all(aiMergeRunnerIds().map(async (id) => {
    const executablePath = await resolveCommand(id);
    return executablePath === null ? null : {
      id,
      displayName: runnerDisplayName(id),
      executablePath,
    };
  }));
  return runners.filter((runner): runner is InstalledAiMergeRunnerJson => runner !== null);
}

async function resolveMergeRunner(id: AiMergeRunnerId): Promise<AiMergeRunner | null> {
  const command = await resolveCommand(id);
  if (command === null) return null;
  switch (id) {
    case 'codex':
      return {
        provider: id,
        command,
        args: ['exec', '-s', 'read-only', '--skip-git-repo-check', '--ephemeral', '-'],
        promptAsArgument: false,
      };
    case 'claude':
      return { provider: id, command, args: ['-p'], promptAsArgument: true };
    case 'gemini':
      return { provider: id, command, args: ['-p'], promptAsArgument: true };
  }
}

function mergeRunnerFromEnvironment(): AiMergeRunner | null {
  const raw = process.env.REGLET_RULES_MERGE_COMMAND_JSON;
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string') || parsed.length === 0) {
    throw new Error('REGLET_RULES_MERGE_COMMAND_JSON must be a JSON string array such as ["codex","exec","-s","read-only"].');
  }

  const [command, ...args] = parsed;
  if (command === undefined || command.length === 0) {
    throw new Error('REGLET_RULES_MERGE_COMMAND_JSON must include a command.');
  }

  return {
    provider: 'custom',
    command,
    args,
    promptAsArgument: false,
  };
}

async function runAiMerge(runner: AiMergeRunner, prompt: string): Promise<string> {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'reglet-ai-merge-'));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(runner.command, runner.promptAsArgument ? [...runner.args, prompt] : runner.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workingDirectory,
      });
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${runner.provider} merge timed out after 120 seconds.`));
      }, 120_000);
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      child.on('error', (error) => {
        clearTimeout(timeout);
        if (isNodeError(error) && error.code === 'ENOENT') {
          reject(new Error(`${runner.provider} CLI was not found. Install it or choose provider-specific prompts.`));
          return;
        }
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        if (code !== 0) {
          reject(new Error(`${runner.provider} merge failed: ${stderr.trim() || `exit ${code ?? 'unknown'}`}`));
          return;
        }
        resolve(stdout);
      });

      child.stdin.on('error', (error) => {
        if (isNodeError(error) && (error.code === 'EPIPE' || error.code === 'ERR_STREAM_WRITE_AFTER_END')) {
          return;
        }
      });

      if (!runner.promptAsArgument) {
        child.stdin.end(prompt);
      } else {
        child.stdin.end();
      }
    });
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

async function resolveCommand(command: string): Promise<string | null> {
  for (const candidatePath of fallbackCommandPaths(command)) {
    if (await executableExists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function fallbackCommandPaths(command: string): string[] {
  const home = process.env.HOME;
  const userProfile = process.env.USERPROFILE;
  const userDirs = Array.from(new Set([home, userProfile].filter((dir): dir is string => dir !== undefined)));
  const dirs = [
    ...(process.env.PATH?.split(path.delimiter) ?? []),
    ...userDirs.flatMap((dir) => [
      path.join(dir, '.local', 'bin'),
      path.join(dir, '.bun', 'bin'),
      path.join(dir, '.npm-global', 'bin'),
      path.join(dir, '.deno', 'bin'),
      path.join(dir, '.cargo', 'bin'),
      path.join(dir, '.codex', 'packages', 'standalone', 'current', 'bin'),
    ]),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  return Array.from(new Set(dirs.filter((dir) => dir.length > 0).flatMap((dir) => commandPathCandidates(dir, command))));
}

function commandPathCandidates(dir: string, command: string): string[] {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  return extensions.map((extension) => path.join(dir, `${command}${extension}`));
}

async function executableExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function buildContentPlan(
  provider: ProviderId,
  content: ApplyContent,
  inventory: ProviderInventory,
): Promise<PlannedContentJson> {
  if (content === 'rules') {
    const readPaths = inventory.rulesPath === null || !inventory.rulesExists ? [] : [inventory.rulesPath];
    const writePaths = [
      providerRuleImportPath(provider),
      ...(inventory.rulesPath === null ? [] : [inventory.rulesPath]),
    ];
    return {
      selected: true,
      supported: inventory.rulesPath !== null,
      readPaths,
      writePaths,
      notes: inventory.rulesPath === null ? [`${provider}:rules unsupported`] : [],
    };
  }

  if (content === 'skills') {
    const skillsDir = inventory.skillsDir;
    const supported = skillsDir !== null;
    const writePaths = supported ? [skillsDir] : [];
    return {
      selected: true,
      supported,
      readPaths: skillsDir !== null && inventory.skills.length > 0 ? [skillsDir] : [],
      writePaths,
      notes: supported
        ? ['Provider-local skills remain unmanaged until explicitly adopted']
        : [`${provider}:skills unsupported`],
    };
  }

  const readPaths = inventory.mcpPath === null || inventory.mcpServers.length === 0 ? [] : [inventory.mcpPath];
  const writePaths = [
    path.join(regletHome(), 'mcp', 'servers.json'),
    ...(inventory.mcpPath === null ? [] : [inventory.mcpPath]),
  ];
  return {
    selected: true,
    supported: inventory.mcpPath !== null,
    readPaths,
    writePaths,
    notes: inventory.mcpPath === null ? [`${provider}:mcp unsupported`] : [],
  };
}

function plannedFile(
  provider: ProviderId,
  content: ContentId,
  filePath: string,
  scope: 'master' | 'provider',
  operation: 'read' | 'write',
): PlannedFileJson {
  return {
    provider,
    content,
    path: filePath,
    scope,
    operation,
    reason: operation === 'read' ? `import ${provider}:${content}` : `manage ${provider}:${content}`,
  };
}

function plannedScope(filePath: string): 'master' | 'provider' {
  return path.relative(regletHome(), filePath).startsWith('..') ? 'provider' : 'master';
}

function printOnboardingPlan(plan: OnboardingPlanJson): void {
  console.log(`plan\t${plan.mode}\tproviders=${plan.providers.length}\treads=${plan.reads.length}\twrites=${plan.writes.length}`);
  for (const read of plan.reads) {
    console.log(`read\t${read.provider}\t${read.content}\t${read.path}`);
  }
  for (const write of plan.writes) {
    console.log(`write\t${write.provider}\t${write.content}\t${write.path}`);
  }
  console.log('safety\tdaemon=off\tsync=off\tnotifications=off');
}

function printLibraryMigrationPreview(
  preview: Awaited<ReturnType<typeof previewLibraryMigration>>,
): void {
  console.log(`library-v2\t${preview.required ? 'migration-required' : 'current'}\tartifacts=${preview.artifacts.length}`);
  console.log(`digest\t${preview.digest}`);
  for (const item of preview.artifacts) {
    const scope = item.artifact.scope.kind === 'global'
      ? 'global'
      : `provider-overlay:${item.artifact.scope.provider}`;
    const locator = item.artifact.locator.type === 'mcp-server'
      ? `${item.artifact.locator.path}#${item.artifact.locator.serverName}`
      : item.artifact.locator.path;
    console.log(`${item.artifact.kind}\t${scope}\t${item.artifact.id}\t${locator}`);
  }
}

function printJson(value: unknown): void {
  console.log(`${JSON.stringify(value, null, 2)}\n`);
}

function printJsonLine(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function writeJsonToStderr(value: unknown): void {
  process.stderr.write(`${JSON.stringify(value, null, 2)}\n`);
}

function isManagerVisibleCommand(argv: readonly string[]): boolean {
  return argv.includes('manager') || argv.includes('apply-structured');
}

function managerCommandName(argv: readonly string[]): string {
  const args = argv.slice(2);
  if (args[0] === 'manager' && args[1] === 'snapshot') return 'manager.snapshot';
  if (args[0] === 'apply-structured' && args[1] === 'preview') return 'apply-structured.preview';
  if (args[0] === 'apply-structured' && args[1] === 'apply') return 'apply-structured.apply';
  return args.slice(0, 2).join('.') || 'manager';
}

async function detectedProviderIds(): Promise<ProviderId[]> {
  const providers: ProviderId[] = [];
  for (const adapter of allAdapters()) {
    if (await adapter.detect()) {
      providers.push(adapter.id);
    }
  }
  return providers;
}

async function setEnrollment(target: ProviderTarget, enabled: boolean): Promise<void> {
  const config = await loadConfig();
  const detachment = enabled ? undefined : await detachManagedContent(target.provider, target.content);
  if (target.content === undefined) {
    config.providers[target.provider].enabled = enabled;
  } else {
    config.providers[target.provider][target.content] = enabled;
  }
  await saveConfig(config);
  console.log(`${enabled ? 'Enrolled' : 'Unenrolled'} ${formatTarget(target)}`);
  if (detachment !== undefined) {
    for (const output of detachment.detached) {
      console.log(`detached\t${output.content}\t${output.outputPath}\theader=${output.headerRemoved ? 'removed' : 'preserved'}`);
    }
  }
}

async function importProviderRules(provider: ProviderId): Promise<void> {
  const adapter = getAdapter(provider);
  const rulesPath = adapter.rulesPath();
  if (rulesPath === null) {
    return;
  }

  try {
    const content = await readFile(rulesPath, 'utf8');
    const targetPath = providerRuleImportPath(provider);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeIfMissing(path.join(path.dirname(targetPath), PROVIDER_RULES_MARKER), 'v1\n');
    await writeFile(targetPath, content, { flag: 'wx' });
  } catch (error) {
    if (!isNodeError(error) || (error.code !== 'ENOENT' && error.code !== 'EEXIST')) {
      throw error;
    }
  }
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await writeFile(filePath, content, { flag: 'wx' });
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') {
      throw error;
    }
  }
}

function providerRuleImportPath(provider: ProviderId): string {
  return path.join(regletHome(), 'rules', provider, '00-imported.md');
}

function ruleDocuments(master: Awaited<ReturnType<typeof loadMasterDir>>): RuleDocumentJson[] {
  return [
    ...master.rules.map((rule) => ({
      path: rule.relPath,
      scope: { kind: 'shared' as const },
    })),
    ...providerIds.flatMap((provider) =>
      master.providerRules[provider].map((rule) => ({
        path: rule.relPath,
        scope: { kind: 'provider' as const, provider },
      })),
    ),
  ];
}

async function importProviderMcp(provider: ProviderId): Promise<void> {
  const adapter = getAdapter(provider);
  const mcpPath = adapter.mcpPath();
  if (mcpPath === null) {
    return;
  }

  const importedServers = await readProviderMcpServers(provider, mcpPath);
  if (Object.keys(importedServers).length === 0) {
    return;
  }

  const master = await loadMasterDir();
  const existingNames = new Set(Object.keys(master.mcpServers));
  const nextServers: Record<string, McpServerDef> = { ...master.mcpServers };
  const skippedNames: string[] = [];

  for (const [name, server] of Object.entries(importedServers).sort(([left], [right]) => left.localeCompare(right))) {
    const validation = validateMcpServer(name, server);
    if (!validation.ok || !isCanonicalMcpServerDef(name, server)) {
      skippedNames.push(name);
      continue;
    }
    const targetName = sameMcpServer(nextServers[name], server) ? name : uniqueName(name, provider, existingNames);
    existingNames.add(targetName);
    nextServers[targetName] = server;
  }

  const targetPath = path.join(regletHome(), 'mcp', 'servers.json');
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, serializeMcpServers(nextServers));
  if (skippedNames.length > 0) {
    const visibleNames = skippedNames.slice(0, 5).join(', ');
    const remainingCount = skippedNames.length - 5;
    const remaining = remainingCount > 0 ? `, and ${remainingCount} more` : '';
    console.warn(
      `Warning: Left ${skippedNames.length} incompatible MCP server${skippedNames.length === 1 ? '' : 's'} from ${provider} local and unmanaged (${visibleNames}${remaining}). Reglet does not copy literal environment values into mcp/servers.json.`,
    );
  }
}

function uniqueName(name: string, provider: ProviderId, existingNames: Set<string>): string {
  if (!existingNames.has(name)) {
    return name;
  }

  const prefixed = `${provider}-${name}`;
  if (!existingNames.has(prefixed)) {
    return prefixed;
  }

  let index = 2;
  while (existingNames.has(`${prefixed}-${index}`)) {
    index += 1;
  }
  return `${prefixed}-${index}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function masterRulePath(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
  if (normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new InvalidArgumentError('Rule path must stay inside the master rules directory');
  }
  return path.join(regletHome(), 'rules', ...normalized.split('/'));
}

function sameMcpServer(left: McpServerDef | undefined, right: McpServerDef): boolean {
  return left !== undefined && JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}

function printApplyResults(results: ApplyResult[]): void {
  for (const result of results) {
    const suffix = result.message === undefined ? result.outputPath : result.message;
    console.log(`${result.provider}\t${result.content}\t${result.status}\t${suffix}`);
  }
}

function printRevertResults(results: { outputPath: string; provider: string; action: string }[]): void {
  for (const result of results) {
    console.log(`${result.provider}\t${result.action}\t${result.outputPath}`);
  }
}

function formatTarget(target: ProviderTarget): string {
  return target.content === undefined ? target.provider : `${target.provider}:${target.content}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new InvalidArgumentError('Port must be an integer from 0 through 65535.');
  }
  return port;
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      process.off('SIGINT', done);
      process.off('SIGTERM', done);
      resolve();
    };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}

function osHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '';
}
