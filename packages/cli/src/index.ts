#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { confirm, isCancel, multiselect, outro } from '@clack/prompts';
import { Command, InvalidArgumentError } from 'commander';
import {
  accountSession,
  applyAll,
  adoptSkill,
  claimPairing,
  configureTokenLogin,
  detectDrift,
  getAdapter,
  importDriftedMcp,
  importDriftedRules,
  importDriftedSkills,
  initMasterDir,
  loadConfig,
  loadMasterDir,
  loadSyncState,
  loginWithAccount,
  listSkills,
  listUnmanagedSkills,
  type McpServerDef,
  readProviderMcpServers,
  regletHome,
  restore,
  revert,
  saveConfig,
  startPairing,
  syncOnce,
  type ApplyContent,
  type ApplyResult,
  type DriftRecord,
  type ProviderId,
  type ProviderInventory,
  type SkillAdoptionScope,
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

const providerIds = ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'] as const;
const contentIds = ['rules', 'skills', 'mcp'] as const;
const rulesPreviewLimit = 800;

type ContentId = (typeof contentIds)[number];

const program = new Command();
const version = process.env.REGLET_VERSION ?? '0.1.0';

program
  .name('reglet')
  .description('Manage global AI agent rules, skills, and MCP configs')
  .version(version);

program
  .command('init')
  .description('Create the master directory and optionally enroll detected providers')
  .option('-y, --yes', 'run non-interactively and enroll detected providers')
  .option('-p, --provider <provider...>', 'provider(s) to enroll/import', parseProviderList)
  .option('-c, --content <content...>', 'content type(s) to import/apply', parseContentList)
  .action(async (options: { yes?: boolean; provider?: ProviderId[]; content?: ApplyContent[] }) => {
    await initMasterDir();
    if (options.yes === true || options.provider !== undefined || options.content !== undefined) {
      const providers = options.provider ?? (await detectedProviderIds());
      const contents = options.content ?? [...contentIds];
      await runOnboarding(providers, contents);
    } else if (process.stdin.isTTY) {
      await runInteractiveOnboarding();
    }
    console.log(`Initialized ${regletHome()}`);
  });

program
  .command('scan')
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
  .command('plan')
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
  .command('apply')
  .description('Apply master rules, skills, and MCP config to enrolled providers')
  .option('-p, --provider <provider>', 'provider to apply', parseProvider)
  .option('-c, --content <content>', 'content type to apply', parseContent)
  .option('--dry-run', 'report planned writes without changing files')
  .action(async (options: { provider?: ProviderId; content?: ApplyContent; dryRun?: boolean }) => {
    const report = await applyAll({
      providers: options.provider === undefined ? undefined : [options.provider],
      contents: options.content === undefined ? undefined : [options.content],
      dryRun: options.dryRun,
    });
    printApplyResults(report.results);
  });

program
  .command('status')
  .description('Print enrollment and drift status')
  .option('--check', 'exit with 2 when drift is found')
  .option('--json', 'print machine-readable JSON for manager apps')
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
    for (const provider of providerIds) {
      const providerConfig = config.providers[provider];
      console.log(
        `${provider}\t${providerConfig.enabled ? 'enabled' : 'disabled'}\trules=${providerConfig.rules ? 'on' : 'off'}\tskills=${providerConfig.skills ? 'on' : 'off'}\tmcp=${providerConfig.mcp ? 'on' : 'off'}`,
      );
    }

    const drift = await detectDrift();
    const drifted = drift.filter((record) => record.status !== 'clean');
    for (const record of drift) {
      console.log(`drift\t${record.provider}\t${record.content}\t${record.status}\t${record.outputPath}`);
    }

    if (options.check === true && drifted.length > 0) {
      process.exitCode = 2;
    }
  });

program
  .command('enroll')
  .description('Enroll a provider or provider content type')
  .argument('<target>', 'provider or provider:rules|skills|mcp', parseProviderTarget)
  .action(async (target: ProviderTarget) => {
    await setEnrollment(target, true);
  });

program
  .command('unenroll')
  .description('Unenroll a provider or provider content type')
  .argument('<target>', 'provider or provider:rules|skills|mcp', parseProviderTarget)
  .action(async (target: ProviderTarget) => {
    await setEnrollment(target, false);
  });

program
  .command('restore')
  .description('Restore backed-up provider files for a provider or all providers')
  .argument('[provider]', 'provider to restore', parseProvider)
  .action(async (provider?: ProviderId) => {
    printRevertResults(await restore(provider));
  });

program
  .command('revert')
  .description('Restore all backed-up provider files and remove Reglet-created outputs')
  .argument('[provider]', 'provider to revert', parseProvider)
  .action(async (provider?: ProviderId) => {
    printRevertResults(await revert(provider));
  });

program
  .command('diff')
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

const rules = program.command('rules').description('Read and edit master rule documents');

rules
  .command('list')
  .description('List master rule documents')
  .option('--json', 'print machine-readable JSON for manager apps')
  .action(async (options: { json?: boolean }) => {
    const master = await loadMasterDir();
    const documents = master.rules.map((rule) => ({ path: rule.relPath }));
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

program
  .command('import')
  .description('Import drifted provider content back into the master directory')
  .argument('<target>', 'provider:rules|skills|mcp', parseProviderTarget)
  .option('--json', 'print machine-readable JSON for manager apps')
  .action(async (target: ProviderTarget, options: { json?: boolean }) => {
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

    const result = await importDriftedMcp(target.provider);
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

program
  .command('login')
  .description('Configure sync login with a server token or account credentials')
  .argument('<url>', 'sync server URL')
  .option('--token <token>', 'single-user server token')
  .option('--email <email>', 'account email')
  .option('--password <password>', 'account password')
  .option('--device <name>', 'device name', 'device')
  .action(async (url: string, options: { token?: string; email?: string; password?: string; device: string }) => {
    if (options.token !== undefined) {
      await configureTokenLogin(url, options.token, options.device);
      console.log(`sync\tlogged-in\t${url}`);
      return;
    }

    if (options.email === undefined || options.password === undefined) {
      throw new InvalidArgumentError('Pass --token, or --email and --password for account login');
    }

    await loginWithAccount({
      serverUrl: url,
      email: options.email,
      password: options.password,
      deviceName: options.device,
      mode: 'login',
    });
    console.log(`sync\tlogged-in\t${url}\tdevice=${options.device}`);
  });

program
  .command('register')
  .description('Create a sync account and pair this device')
  .argument('<url>', 'sync server URL')
  .requiredOption('--email <email>', 'account email')
  .requiredOption('--password <password>', 'account password')
  .option('--device <name>', 'device name', 'device')
  .action(async (url: string, options: { email: string; password: string; device: string }) => {
    await loginWithAccount({
      serverUrl: url,
      email: options.email,
      password: options.password,
      deviceName: options.device,
      mode: 'register',
    });
    console.log(`sync\tregistered\t${url}\tdevice=${options.device}`);
  });

const pair = program.command('pair').description('Pair another device to a sync account');

pair
  .command('start')
  .description('Print a pairing code for another device to claim')
  .argument('<url>', 'sync server URL')
  .requiredOption('--email <email>', 'account email')
  .requiredOption('--password <password>', 'account password')
  .action(async (url: string, options: { email: string; password: string }) => {
    const sessionToken = await accountSession(url, options.email, options.password, 'login');
    const code = await startPairing(url, sessionToken);
    console.log(`pair\tcode\t${code}\texpires in 10 minutes`);
  });

pair
  .command('claim')
  .description('Claim a pairing code on this device and store its sync token')
  .argument('<url>', 'sync server URL')
  .argument('<code>', 'pairing code from pair start')
  .option('--device <name>', 'device name', 'device')
  .action(async (url: string, code: string, options: { device: string }) => {
    await claimPairing(url, code, options.device);
    console.log(`sync\tlogged-in\t${url}\tdevice=${options.device}`);
  });

program
  .command('sync')
  .description('Pull then push master directory changes')
  .option('--json', 'print machine-readable JSON for manager apps')
  .action(async (options: { json?: boolean }) => {
    const result = await syncOnce();
    if (options.json === true) {
      printJson({ version: 1, ...result });
      return;
    }
    console.log(
      `sync\tpulled=${result.pulled.length}\tpushed=${result.pushed.length}\tconflicts=${result.conflicts.length}\tdeleted=${result.deleted.length}`,
    );
    for (const conflict of result.conflicts) {
      console.log(`conflict\t${conflict}`);
    }
  });

const daemon = program.command('daemon').description('Run or manage the background daemon');

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
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
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

interface StatusSyncJson {
  configured: boolean;
  serverUrl: string;
  deviceName: string;
}

interface StatusJson {
  version: 1;
  regletHome: string;
  providers: StatusProviderJson[];
  drift: DriftRecord[];
  driftedCount: number;
  sync: StatusSyncJson;
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

interface BuildOnboardingPlanOptions {
  providers: ProviderId[];
  contents: ApplyContent[];
}

function safetyDefaults(): SafetyJson {
  return {
    daemonEnabled: false,
    syncEnabled: false,
    notificationsEnabled: false,
    requiresExplicitConfirmation: true,
  };
}

function parseSkillScope(value: string): SkillAdoptionScope {
  if (value === 'shared' || value === 'provider') return value;
  throw new InvalidArgumentError(`Unknown skill scope: ${value}`);
}

function parseProvider(value: string): ProviderId {
  if (providerIds.includes(value as ProviderId)) {
    return value as ProviderId;
  }
  throw new InvalidArgumentError(`Unknown provider: ${value}`);
}

function parseContent(value: string): ApplyContent {
  if (contentIds.includes(value as ContentId)) {
    return value as ApplyContent;
  }
  throw new InvalidArgumentError(`Unknown content type: ${value}`);
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

async function runOnboarding(providers: ProviderId[], contents: ApplyContent[]): Promise<void> {
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
  await applyAll({ providers, contents });
}

async function runInteractiveOnboarding(): Promise<void> {
  const detected = await detectedProviderIds();
  if (detected.length === 0) {
    outro('No provider directories detected. Created the master directory only.');
    return;
  }

  const providers = await multiselect({
    message: 'Select providers to enroll',
    options: detected.map((provider) => ({
      value: provider,
      label: `${provider} (${getAdapter(provider).displayName})`,
    })),
    required: true,
  });
  if (isCancel(providers)) {
    outro('Onboarding cancelled.');
    return;
  }

  const contents = await multiselect({
    message: 'Select content types to import and manage',
    options: contentIds.map((content) => ({ value: content, label: content })),
    initialValues: ['rules', 'skills', 'mcp'],
    required: true,
  });
  if (isCancel(contents)) {
    outro('Onboarding cancelled.');
    return;
  }

  const shouldApply = await confirm({
    message: `Import selected content and apply to ${providers.length} provider(s)?`,
    initialValue: true,
  });
  if (isCancel(shouldApply) || !shouldApply) {
    outro('Onboarding cancelled.');
    return;
  }

  await runOnboarding(normalizeProviderSelections(providers), normalizeContentSelections(contents));
  outro('Onboarding complete.');
}

function normalizeProviderSelections(values: readonly string[]): ProviderId[] {
  return values.map(parseProvider);
}

function normalizeContentSelections(values: readonly string[]): ApplyContent[] {
  return values.map(parseContent);
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
  const syncState = await loadSyncState();

  return {
    version: 1,
    regletHome: regletHome(),
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
    sync: {
      configured: syncState.serverUrl.length > 0 && syncState.deviceToken.length > 0,
      serverUrl: syncState.serverUrl,
      deviceName: syncState.deviceName,
    },
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
  const destinationPath = path.join(regletHome(), 'rules', `imported-${provider}.md`);
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
      path.join(regletHome(), 'rules', `imported-${provider}.md`),
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

function printJson(value: unknown): void {
  console.log(`${JSON.stringify(value, null, 2)}\n`);
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
  if (target.content === undefined) {
    config.providers[target.provider].enabled = enabled;
  } else {
    config.providers[target.provider][target.content] = enabled;
  }
  await saveConfig(config);
  console.log(`${enabled ? 'Enrolled' : 'Unenrolled'} ${formatTarget(target)}`);
}

async function importProviderRules(provider: ProviderId): Promise<void> {
  const adapter = getAdapter(provider);
  const rulesPath = adapter.rulesPath();
  if (rulesPath === null) {
    return;
  }

  try {
    const content = await readFile(rulesPath, 'utf8');
    const targetPath = path.join(regletHome(), 'rules', `imported-${provider}.md`);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, { flag: 'wx' });
  } catch (error) {
    if (!isNodeError(error) || (error.code !== 'ENOENT' && error.code !== 'EEXIST')) {
      throw error;
    }
  }
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

  for (const [name, server] of Object.entries(importedServers).sort(([left], [right]) => left.localeCompare(right))) {
    const targetName = sameMcpServer(nextServers[name], server) ? name : uniqueName(name, provider, existingNames);
    existingNames.add(targetName);
    nextServers[targetName] = server;
  }

  const targetPath = path.join(regletHome(), 'mcp', 'servers.json');
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify({ mcpServers: nextServers }, null, 2)}\n`);
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

function osHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '';
}
