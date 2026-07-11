#!/usr/bin/env bun
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { confirm, isCancel, multiselect, outro } from '@clack/prompts';
import { Command, InvalidArgumentError } from 'commander';
import { parse as parseToml } from 'smol-toml';
import {
  applyAll,
  configureTokenLogin,
  copyDirRecursive,
  detectDrift,
  getAdapter,
  importDriftedRules,
  initMasterDir,
  loadConfig,
  loadMasterDir,
  type McpServerDef,
  regletHome,
  restore,
  revert,
  saveConfig,
  syncOnce,
  type ApplyContent,
  type ApplyResult,
  type ProviderId,
  type ProviderInventory,
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

type ContentId = (typeof contentIds)[number];

const program = new Command();

program
  .name('reglet')
  .description('Manage global AI agent rules, skills, and MCP configs')
  .version('0.1.0');

program
  .command('init')
  .description('Create the master directory and optionally enroll detected providers')
  .option('-y, --yes', 'run non-interactively and enroll detected providers')
  .option('-p, --provider <provider...>', 'provider(s) to enroll/import', parseProviderList)
  .option('-c, --content <content...>', 'content type(s) to import/apply', parseContentList)
  .option('-s, --skill <provider:skill...>', 'specific provider skill(s) to import/apply', parseSkillTargetList)
  .action(async (options: { yes?: boolean; provider?: ProviderId[]; content?: ApplyContent[]; skill?: SkillTarget[] }) => {
    await initMasterDir();
    if (options.yes === true || options.provider !== undefined || options.content !== undefined || options.skill !== undefined) {
      const providers = options.provider ?? (await detectedProviderIds());
      const contents = options.content ?? [...contentIds];
      await runOnboarding(providers, contents, skillSelectionsFromTargets(options.skill));
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
  .option('-s, --skill <provider:skill...>', 'specific provider skill(s) to include', parseSkillTargetList)
  .option('--json', 'print machine-readable JSON for setup apps')
  .action(async (options: { provider?: ProviderId[]; content?: ApplyContent[]; skill?: SkillTarget[]; json?: boolean }) => {
    const plan = await buildOnboardingPlanJson({
      providers: options.provider ?? (await detectedProviderIds()),
      contents: options.content ?? [...contentIds],
      skillSelections: skillSelectionsFromTargets(options.skill),
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
  .action(async (options: { check?: boolean }) => {
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
  .action(async (options: { provider?: ProviderId }) => {
    const report = await applyAll({
      providers: options.provider === undefined ? undefined : [options.provider],
      dryRun: true,
    });
    printApplyResults(report.results);
  });

program
  .command('import')
  .description('Import drifted provider content back into the master directory')
  .argument('<target>', 'provider:rules', parseProviderTarget)
  .action(async (target: ProviderTarget) => {
    if (target.content !== 'rules') {
      throw new InvalidArgumentError('Only rules import is supported in v1');
    }
    const result = await importDriftedRules(target.provider);
    console.log(`${result.provider}\trules\timported\t${result.importedPath}`);
  });

program
  .command('login')
  .description('Configure sync login')
  .argument('<url>', 'sync server URL')
  .option('--token <token>', 'single-user server token')
  .option('--device <name>', 'device name', 'device')
  .action(async (url: string, options: { token?: string; device: string }) => {
    if (options.token === undefined) {
      throw new InvalidArgumentError('Only --token login is implemented in this build');
    }
    await configureTokenLogin(url, options.token, options.device);
    console.log(`sync\tlogged-in\t${url}`);
  });

program
  .command('sync')
  .description('Pull then push master directory changes')
  .action(async () => {
    const result = await syncOnce();
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

interface SkillTarget {
  provider: ProviderId;
  skill: string;
}

type SkillSelections = Partial<Record<ProviderId, Set<string>>>;

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

interface OnboardingPlanJson {
  version: 1;
  mode: 'onboarding';
  regletHome: string;
  providers: PlannedProviderJson[];
  reads: PlannedFileJson[];
  writes: PlannedFileJson[];
  safety: SafetyJson;
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
  items?: string[];
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
  skillSelections?: SkillSelections;
}

function safetyDefaults(): SafetyJson {
  return {
    daemonEnabled: false,
    syncEnabled: false,
    notificationsEnabled: false,
    requiresExplicitConfirmation: true,
  };
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

function parseSkillTargetList(value: string, previous: SkillTarget[] = []): SkillTarget[] {
  return [...previous, ...value.split(',').filter((item) => item.length > 0).map(parseSkillTarget)];
}

function parseSkillTarget(value: string): SkillTarget {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    throw new InvalidArgumentError(`Invalid skill target: ${value}. Use provider:skill-name.`);
  }

  return {
    provider: parseProvider(value.slice(0, separator)),
    skill: value.slice(separator + 1),
  };
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

function skillSelectionsFromTargets(targets: SkillTarget[] | undefined): SkillSelections | undefined {
  if (targets === undefined) {
    return undefined;
  }

  const selections: SkillSelections = {};
  for (const target of targets) {
    selections[target.provider] ??= new Set<string>();
    selections[target.provider]?.add(target.skill);
  }
  return selections;
}

async function runOnboarding(providers: ProviderId[], contents: ApplyContent[], skillSelections?: SkillSelections): Promise<void> {
  const config = await loadConfig();
  for (const provider of providers) {
    config.providers[provider].enabled = true;
    for (const content of contentIds) {
      config.providers[provider][content] = contents.includes(content);
    }
    if (contents.includes('rules')) {
      await importProviderRules(provider);
    }
    if (contents.includes('skills')) {
      await importProviderSkills(provider, skillSelections?.[provider]);
    }
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

  const selectedProviders = normalizeProviderSelections(providers);
  const selectedContents = normalizeContentSelections(contents);
  const skillSelections = selectedContents.includes('skills') ? await promptForSkillSelections(selectedProviders) : undefined;
  if (skillSelections === 'cancelled') {
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

  await runOnboarding(selectedProviders, selectedContents, skillSelections);
  outro('Onboarding complete.');
}

async function promptForSkillSelections(providers: ProviderId[]): Promise<SkillSelections | 'cancelled' | undefined> {
  const options: { value: string; label: string }[] = [];
  const initialValues: string[] = [];
  for (const provider of providers) {
    const adapter = getAdapter(provider);
    const inventory = await adapter.inventory();
    for (const skill of inventory.skills.sort((left, right) => left.localeCompare(right))) {
      const value = `${provider}:${skill}`;
      options.push({ value, label: `${adapter.displayName} / ${skill}` });
      initialValues.push(value);
    }
  }

  if (options.length === 0) {
    return undefined;
  }

  const selected = await multiselect({
    message: 'Select skills to transfer into the unified directory',
    options,
    initialValues,
    required: false,
  });
  if (isCancel(selected)) {
    return 'cancelled';
  }

  return skillSelectionsFromTargets(selected.map(parseSkillTarget));
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

async function buildOnboardingPlanJson(options: BuildOnboardingPlanOptions): Promise<OnboardingPlanJson> {
  const reads: PlannedFileJson[] = [];
  const writes: PlannedFileJson[] = [];
  const providers: PlannedProviderJson[] = [];

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
      const contentPlan = await buildContentPlan(provider, content, inventory, options.skillSelections);
      plannedProvider.contents[content] = contentPlan;
      reads.push(...contentPlan.readPaths.map((filePath) => plannedFile(provider, content, filePath, 'provider', 'read')));
      writes.push(...contentPlan.writePaths.map((filePath) => plannedFile(provider, content, filePath, plannedScope(filePath), 'write')));
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
    safety: safetyDefaults(),
  };
}

async function buildContentPlan(
  provider: ProviderId,
  content: ApplyContent,
  inventory: ProviderInventory,
  skillSelections?: SkillSelections,
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
    const selectedSkills = selectedSkillsForProvider(provider, inventory.skills, skillSelections);
    const writePaths = supported
      ? [
          ...(await plannedSkillImportPaths(provider, selectedSkills)),
          skillsDir,
        ]
      : [];
    return {
      selected: true,
      supported,
      items: selectedSkills,
      readPaths: skillsDir !== null && selectedSkills.length > 0 ? [skillsDir] : [],
      writePaths,
      notes: supported ? [] : [`${provider}:skills unsupported`],
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

function selectedSkillsForProvider(
  provider: ProviderId,
  availableSkills: string[],
  skillSelections: SkillSelections | undefined,
): string[] {
  const selected = skillSelections?.[provider];
  if (selected === undefined) {
    return [...availableSkills];
  }
  return availableSkills.filter((skill) => selected.has(skill));
}

async function plannedSkillImportPaths(provider: ProviderId, skillNames: string[]): Promise<string[]> {
  const masterSkillsDir = path.join(regletHome(), 'skills');
  const existingNames = new Set<string>();
  try {
    for (const entry of await readdir(masterSkillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        existingNames.add(entry.name);
      }
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  const paths: string[] = [];
  for (const skillName of skillNames.sort((left, right) => left.localeCompare(right))) {
    const targetName = uniqueName(skillName, provider, existingNames);
    existingNames.add(targetName);
    paths.push(path.join(masterSkillsDir, targetName));
  }
  return paths;
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

async function importProviderSkills(provider: ProviderId, selectedSkills?: Set<string>): Promise<void> {
  const adapter = getAdapter(provider);
  const skillsDir = adapter.skillsDir();
  if (skillsDir === null) {
    return;
  }

  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const masterSkillsDir = path.join(regletHome(), 'skills');
  const existingNames = new Set<string>();
  try {
    for (const entry of await readdir(masterSkillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        existingNames.add(entry.name);
      }
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  const missingSkills = selectedSkills === undefined ? new Set<string>() : new Set(selectedSkills);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (selectedSkills !== undefined && !selectedSkills.has(entry.name)) {
      continue;
    }

    missingSkills.delete(entry.name);
    const targetName = uniqueName(entry.name, provider, existingNames);
    existingNames.add(targetName);
    await copyDirRecursive(path.join(skillsDir, entry.name), path.join(masterSkillsDir, targetName));
  }

  if (missingSkills.size > 0) {
    throw new Error(`Unknown ${provider} skill(s): ${[...missingSkills].sort((left, right) => left.localeCompare(right)).join(', ')}`);
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

async function readProviderMcpServers(provider: ProviderId, mcpPath: string): Promise<Record<string, McpServerDef>> {
  if (provider === 'codex') {
    return readCodexMcpServers(mcpPath);
  }

  if (provider === 'opencode') {
    return readOpenCodeMcpServers(mcpPath);
  }

  return readJsonMcpServers(mcpPath);
}

async function readJsonMcpServers(mcpPath: string): Promise<Record<string, McpServerDef>> {
  const config = await readJsonObject(mcpPath);
  if (!isRecord(config.mcpServers)) {
    return {};
  }
  return normalizeMcpServers(config.mcpServers);
}

async function readCodexMcpServers(mcpPath: string): Promise<Record<string, McpServerDef>> {
  try {
    const parsed = parseToml(await readFile(mcpPath, 'utf8')) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.mcp_servers)) {
      return {};
    }
    return normalizeMcpServers(parsed.mcp_servers);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function readOpenCodeMcpServers(mcpPath: string): Promise<Record<string, McpServerDef>> {
  const config = await readJsonObject(mcpPath);
  if (!isRecord(config.mcp)) {
    return {};
  }

  const servers: Record<string, McpServerDef> = {};
  for (const [name, server] of Object.entries(config.mcp)) {
    const normalized = normalizeOpenCodeServer(server);
    if (normalized !== null) {
      servers[name] = normalized;
    }
  }
  return servers;
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function normalizeMcpServers(value: Record<string, unknown>): Record<string, McpServerDef> {
  const servers: Record<string, McpServerDef> = {};
  for (const [name, server] of Object.entries(value)) {
    if (isMcpServerDef(server)) {
      servers[name] = server;
    }
  }
  return servers;
}

function normalizeOpenCodeServer(value: unknown): McpServerDef | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  if (value.type === 'remote' && typeof value.url === 'string') {
    return { url: value.url };
  }

  if (
    value.type !== 'local' ||
    !Array.isArray(value.command) ||
    !value.command.every((item) => typeof item === 'string')
  ) {
    return null;
  }

  const [command, ...args] = value.command;
  if (command === undefined) {
    return null;
  }

  return {
    command,
    ...(args.length === 0 ? {} : { args }),
    ...(isStringRecord(value.environment) ? { env: value.environment } : {}),
  };
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

function isMcpServerDef(value: unknown): value is McpServerDef {
  if (!isRecord(value)) {
    return false;
  }

  return (
    readOptionalString(value.command) &&
    readOptionalStringArray(value.args) &&
    isOptionalStringRecord(value.env) &&
    readOptionalString(value.url)
  );
}

function readOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function readOptionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function isOptionalStringRecord(value: unknown): boolean {
  return value === undefined || isStringRecord(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
