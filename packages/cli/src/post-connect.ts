/**
 * Post-connect and onboarding helpers shared between the top-level `connect`
 * command and the `setup` wizard.
 *
 * Extracted into a separate module so that sync-preview.ts can inject an
 * `onConnected` callback without creating a circular import:
 *   index.ts → sync-preview.ts → (callback from index.ts)
 */
import { isCancel, multiselect, select } from '@clack/prompts';
import {
  allAdapters,
  applyAll,
  detectDrift,
  importDriftedMcp,
  importDriftedRules,
  initMasterDir,
  loadConfig,
  type ApplyContent,
  type ApplyResult,
  type ProviderId,
} from '@reglet/core';

// ─── Shared utilities ────────────────────────────────────────────────────────

const providerIds = ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'] as const;
const contentIds = ['rules', 'skills', 'mcp'] as const;

export function normalizeProviderSelections(values: readonly string[]): ProviderId[] {
  return values.filter((v): v is ProviderId => (providerIds as readonly string[]).includes(v));
}

export function normalizeContentSelections(values: readonly string[]): ApplyContent[] {
  return values.filter((v): v is ApplyContent => (contentIds as readonly string[]).includes(v));
}

export async function detectedProviderIds(): Promise<ProviderId[]> {
  const ids: ProviderId[] = [];
  for (const adapter of allAdapters()) {
    const found = await adapter.detect().catch(() => false);
    if (found) ids.push(adapter.id);
  }
  return ids;
}

function printApplyResults(results: ApplyResult[]): void {
  for (const result of results) {
    const suffix = result.message === undefined ? result.outputPath : result.message;
    console.log(`${result.provider}\t${result.content}\t${result.status}\t${suffix}`);
  }
}

// ─── Interactive drift/merge review ──────────────────────────────────────────

/**
 * Shows each drifted provider file and prompts the user to keep (import to
 * master), overwrite, or skip. Handles the applyAll call.
 */
export async function interactiveDriftReview(enrolledProviders?: ProviderId[]): Promise<void> {
  const drift = (await detectDrift()).filter((record) => record.status !== 'clean');
  const relevant =
    enrolledProviders === undefined
      ? drift
      : drift.filter((record) => enrolledProviders.includes(record.provider as ProviderId));

  if (relevant.length === 0) {
    const report = await applyAll({ reviewedReplacement: true });
    printApplyResults(report.results);
    return;
  }

  console.log('\n⚠  Reglet found existing provider files that differ from the master:\n');
  for (const record of relevant) {
    const icon = record.status === 'missing' ? '✗ missing' : '≠ modified';
    console.log(`  ${icon}  ${record.outputPath}  (${record.provider}:${record.content})`);
  }
  console.log('');

  const choice = await select({
    message: 'How should Reglet handle these existing files?',
    options: [
      {
        value: 'keep',
        label: 'Keep & import — pull existing content into the master so both devices match',
      },
      {
        value: 'overwrite',
        label: 'Overwrite — replace with the synced master content (existing edits will be lost)',
      },
      {
        value: 'skip',
        label: 'Decide later — run "reglet apply --reviewed-replacement" when ready',
      },
    ],
  });

  if (isCancel(choice) || choice === 'skip') {
    console.log('\nSkipped. Run "reglet apply --reviewed-replacement" when ready to resolve conflicts.\n');
    return;
  }

  if (choice === 'keep') {
    console.log('\nImporting existing provider content into master…');
    const driftedProviders = [...new Set(relevant.map((r) => r.provider as ProviderId))];
    const driftedContents = [...new Set(relevant.map((r) => r.content as ApplyContent))];
    for (const p of driftedProviders) {
      if (driftedContents.includes('rules')) await importDriftedRules(p);
      if (driftedContents.includes('mcp')) await importDriftedMcp(p);
    }
    const report = await applyAll({ reviewedReplacement: true });
    printApplyResults(report.results);
    console.log('\n✓ Existing files imported into master and applied.\n');
    return;
  }

  // overwrite
  console.log('\nOverwriting existing provider files with master content…');
  const report = await applyAll({ reviewedReplacement: true });
  printApplyResults(report.results);
  console.log('\n✓ Provider files updated from master.\n');
}

// ─── Provider + content selection ────────────────────────────────────────────

/**
 * Interactive provider and content selection followed by drift review.
 * Accepts a `runOnboarding` callback from index.ts to avoid a circular import.
 */
export async function runInteractiveProviderSelection(
  runOnboarding: (providers: ProviderId[], contents: ApplyContent[], apply: boolean) => Promise<void>,
): Promise<void> {
  const detected = await detectedProviderIds();
  const allKnown = allAdapters();
  const providerChoices = allKnown.map((adapter) => ({
    value: adapter.id,
    label: `${adapter.displayName}${detected.includes(adapter.id) ? ' (detected on this machine)' : ''}`,
  }));

  const selectedProviders = await multiselect({
    message: 'Select AI coding assistants to manage on this machine:',
    options: providerChoices,
    initialValues: detected.length > 0 ? detected : ['claude', 'cursor'],
    required: false,
  });

  if (isCancel(selectedProviders)) {
    console.log('Skipped. Run "reglet setup" anytime.\n');
    return;
  }

  const providersToEnroll = normalizeProviderSelections(selectedProviders as string[]);
  if (providersToEnroll.length === 0) {
    console.log('No providers selected. Run "reglet enable <provider>" to add one later.\n');
    return;
  }

  const selectedContents = await multiselect({
    message: 'Select content types to sync to these providers:',
    options: [
      { value: 'rules', label: 'Master Rules (shared instructions & guidelines)' },
      { value: 'skills', label: 'Skills (custom workflows & agent prompts)' },
      { value: 'mcp', label: 'MCP Configurations (Model Context Protocol servers)' },
    ],
    initialValues: ['rules', 'skills', 'mcp'],
    required: true,
  });

  if (isCancel(selectedContents)) {
    console.log('Skipped. Run "reglet setup" anytime.\n');
    return;
  }

  const contentsToEnroll = normalizeContentSelections(selectedContents as string[]);
  // Enroll without applying yet — drift review handles apply
  await runOnboarding(providersToEnroll, contentsToEnroll, false);
  console.log(`\n✓ Enrolled ${providersToEnroll.length} provider(s): ${providersToEnroll.join(', ')}\n`);
  await interactiveDriftReview(providersToEnroll);
}

// ─── Post-connect entry point ─────────────────────────────────────────────────

/**
 * Called after a successful `reglet connect` to walk the user through
 * provider selection and drift review when no providers are enrolled yet,
 * or when the vault has content not yet applied locally.
 *
 * Accepts `runOnboarding` as a callback to avoid importing from index.ts.
 */
export async function runPostConnectProviderSetup(
  opts: { providerReviewRequired: boolean; forcePrompt?: boolean },
  runOnboarding: (providers: ProviderId[], contents: ApplyContent[], apply: boolean) => Promise<void>,
): Promise<void> {
  if (!process.stdin.isTTY) return;

  if (opts.forcePrompt !== true) {
    const config = await loadConfig();
    const anyEnrolled = allAdapters().some((a) => config.providers[a.id]?.enabled === true);

    if (!anyEnrolled) {
      console.log('\nNo providers are enrolled on this device yet.');
    } else if (opts.providerReviewRequired) {
      console.log(
        "\nThe synced vault contains rules/skills that haven't been applied to providers on this device yet.",
      );
    } else {
      return;
    }

    const wantSetup = await select({
      message: 'Would you like to configure which providers to sync now?',
      options: [
        { value: 'yes', label: 'Yes — choose providers and review any conflicts' },
        { value: 'later', label: 'Later — run "reglet setup" when ready' },
      ],
    });

    if (isCancel(wantSetup) || wantSetup === 'later') {
      console.log('Run "reglet setup" anytime to configure providers.\n');
      return;
    }
  }

  await initMasterDir();
  await runInteractiveProviderSelection(runOnboarding);
}
