import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileText,
  Folder,
  Plug,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  JsonObject,
  JsonValue,
  ManagerContentId,
  ManagerMergeRunnerId,
  ManagerProviderId,
  ManagerSnapshotV2,
} from '@reglet/manager-protocol';
import { jsonObject, type ManagerBridge } from '../managerBridge.js';
import { BrandMark } from './BrandMark.js';

type WizardStep = 'welcome' | 'choose' | 'instructions' | 'skills' | 'preview' | 'changes' | 'done';
type ChangeKind = 'New' | 'Updated' | 'Removed';

interface RuleComparison {
  provider: ManagerProviderId;
  preview: string;
}

interface MergeRunner {
  id: ManagerMergeRunnerId;
  displayName: string;
}

interface UnmanagedSkill {
  provider: ManagerProviderId;
  name: string;
  sharedConflict: string;
}

interface ManagedSkill {
  provider?: ManagerProviderId;
  name: string;
}

interface PreviewChange {
  provider: ManagerProviderId;
  content: ManagerContentId;
  operation: string;
  path: string;
  diff: string;
  expectedTargetHash: string | null;
  resultingTargetHash: string | null;
}

interface StructuredReview {
  digest: string;
  entries: PreviewChange[];
  validationIssues: string[];
}

interface ConfirmAction {
  title: string;
  body: string;
  label: string;
  run: () => Promise<void>;
}

interface OnboardingWizardProps {
  bridge: ManagerBridge;
  snapshot: ManagerSnapshotV2;
  onClose: () => void;
  onStateChanged: () => Promise<void>;
}

const steps: { id: WizardStep; label: string }[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'choose', label: 'Choose' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'skills', label: 'Skills' },
  { id: 'preview', label: 'Preview' },
  { id: 'changes', label: 'Changes' },
  { id: 'done', label: 'Done' },
];

const contentOptions: { id: ManagerContentId; title: string; body: string }[] = [
  { id: 'rules', title: 'Instructions', body: 'One unified AGENT.md' },
  { id: 'skills', title: 'Skills', body: 'Raw skill folders' },
  { id: 'mcp', title: 'MCP', body: 'Shared server settings' },
];

export function OnboardingWizard({ bridge, snapshot, onClose, onStateChanged }: OnboardingWizardProps) {
  const detectedProviders = snapshot.providerDiscovery.filter((provider) => provider.detected);
  const [step, setStep] = useState<WizardStep>('welcome');
  const [selectedProviders, setSelectedProviders] = useState<ManagerProviderId[]>(
    detectedProviders.map((provider) => provider.provider),
  );
  const [selectedContents, setSelectedContents] = useState<ManagerContentId[]>(['rules', 'skills', 'mcp']);
  const [comparisons, setComparisons] = useState<RuleComparison[]>([]);
  const [runners, setRunners] = useState<MergeRunner[]>([]);
  const [selectedRunner, setSelectedRunner] = useState<ManagerMergeRunnerId | null>(null);
  const [unmanagedSkills, setUnmanagedSkills] = useState<UnmanagedSkill[]>([]);
  const [managedSkills, setManagedSkills] = useState<ManagedSkill[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [ruleDraft, setRuleDraft] = useState('');
  const [review, setReview] = useState<StructuredReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const shellRef = useRef<HTMLElement>(null);

  const selectedUnmanagedSkills = useMemo(
    () => uniqueSkills(unmanagedSkills.filter((skill) => selectedProviders.includes(skill.provider))),
    [selectedProviders, unmanagedSkills],
  );
  const hasSkillsStep = selectedContents.includes('skills') && selectedUnmanagedSkills.length > 0;
  const currentIndex = steps.findIndex((item) => item.id === step);

  useEffect(() => {
    shellRef.current?.querySelector<HTMLElement>('.onboarding-content button:not([disabled])')?.focus();
  }, [step]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy || confirmAction !== null || step === 'done') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, confirmAction, onClose, step]);

  const continueFromSelection = async () => {
    setBusy(true);
    setError(null);
    try {
      const [planValue, runnersValue, skillsValue] = await Promise.all([
        bridge.rpc('plan', { providers: selectedProviders, contents: selectedContents }),
        bridge.rpc('rules.merge-runners', {}),
        bridge.rpc('skills.list', {}),
      ]);
      const plan = jsonObject(planValue);
      const reconciliation = objectFromUnknown(plan.reconciliation);
      const nextComparisons = objectArray(reconciliation?.rules).map(ruleComparisonFromJson).filter(isDefined);
      const nextRunners = objectArray(jsonObject(runnersValue).runners).map(mergeRunnerFromJson).filter(isDefined);
      const skillResult = jsonObject(skillsValue);
      const nextUnmanaged = objectArray(skillResult.unmanaged).map(unmanagedSkillFromJson).filter(isDefined);
      const nextManaged = [
        ...objectArray(skillResult.shared).map((item) => managedSkillFromJson(item)),
        ...objectArray(skillResult.providerScoped).map((item) => managedSkillFromJson(item)),
      ].filter(isDefined);

      setComparisons(nextComparisons);
      setRunners(nextRunners);
      setSelectedRunner(nextRunners[0]?.id ?? null);
      setUnmanagedSkills(nextUnmanaged);
      setManagedSkills(nextManaged);
      setRuleDraft((current) => current.length > 0 ? current : initialRuleDraft(nextComparisons));
      setStep(selectedContents.includes('rules') ? 'instructions' : nextUnmanaged.length > 0 && selectedContents.includes('skills') ? 'skills' : 'preview');
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  const generateDraft = async (runner: MergeRunner) => {
    setConfirmAction(null);
    setBusy(true);
    setError(null);
    try {
      const result = jsonObject(await bridge.rpc('rules.merge-draft', {
        providers: comparisons.map((comparison) => comparison.provider),
        runner: runner.id,
      }));
      if (typeof result.draft !== 'string' || result.draft.trim().length === 0) {
        throw new Error('The AI tool returned an empty draft.');
      }
      setRuleDraft(result.draft);
    } catch (draftError) {
      setError(errorMessage(draftError));
    } finally {
      setBusy(false);
    }
  };

  const reviewSetup = async (overwriteConfirmed = false) => {
    if (overwriteConfirmed) setConfirmAction(null);
    const selected = selectedUnmanagedSkills.filter((skill) => selectedSkills.includes(skillKey(skill)));
    const conflicts = selected.filter((skill) => skill.sharedConflict !== 'none');
    if (conflicts.length > 0 && !overwriteConfirmed) {
      setConfirmAction({
        title: 'Replace existing unified skills?',
        body: `${conflicts.map((skill) => skill.name).join(', ')} already exist in Reglet. Replace them with the selected provider copies?`,
        label: 'Replace and review',
        run: () => reviewSetup(true),
      });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const stagedContents = selectedContents.includes('rules')
        ? selectedContents.filter((content) => content !== 'rules')
        : selectedContents;
      await bridge.rpc('onboard', { providers: selectedProviders, contents: stagedContents, stageOnly: true });

      for (const provider of selectedProviders) {
        for (const content of stagedContents) {
          if (!providerSupports(snapshot, provider, content)) {
            await bridge.rpc('unenroll', { provider, content });
          }
        }
      }

      if (selectedContents.includes('rules')) {
        await bridge.rpc('rules.write', { path: '00-general.md', content: normalizedRuleDraft(ruleDraft) });
        for (const provider of selectedProviders) {
          if (providerSupports(snapshot, provider, 'rules')) {
            await bridge.rpc('enroll', { provider, content: 'rules' });
          }
        }
      }

      for (const skill of selected) {
        await bridge.rpc('skills.adopt', {
          provider: skill.provider,
          name: skill.name,
          scope: 'shared',
          overwrite: skill.sharedConflict !== 'none',
        });
      }

      const result = jsonObject(await bridge.rpc('structured-preview.preview', {
        providers: selectedProviders,
        contents: selectedContents,
      }));
      const digest = result.digest;
      if (typeof digest !== 'string') throw new Error('Reglet returned an invalid review digest.');
      setReview({
        digest,
        entries: objectArray(result.entries).map(previewChangeFromJson).filter(isDefined),
        validationIssues: stringArray(result.validationIssues),
      });
      await onStateChanged();
      setStep('changes');
    } catch (reviewError) {
      setError(errorMessage(reviewError));
    } finally {
      setBusy(false);
    }
  };

  const applyReview = async () => {
    if (review === null) return;
    setConfirmAction(null);
    setBusy(true);
    setError(null);
    try {
      await bridge.rpc('structured-preview.apply', {
        digest: review.digest,
        providers: selectedProviders,
        contents: selectedContents,
      });
      await onStateChanged();
      setStep('done');
    } catch (applyError) {
      setError(errorMessage(applyError));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (step === 'choose') setStep('welcome');
    if (step === 'instructions') setStep('choose');
    if (step === 'skills') setStep(selectedContents.includes('rules') ? 'instructions' : 'choose');
    if (step === 'preview') setStep(hasSkillsStep ? 'skills' : selectedContents.includes('rules') ? 'instructions' : 'choose');
    if (step === 'changes') setStep('preview');
  };

  return (
    <div className="onboarding-backdrop" role="presentation">
      <section ref={shellRef} className="onboarding-shell" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <header className="onboarding-header">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-sm font-semibold text-reglet-text">Reglet setup</p>
              <p className="text-xs text-reglet-muted">One source of truth for local agent configuration</p>
            </div>
          </div>
          <StepRail currentIndex={currentIndex} />
          {step !== 'done' && (
            <button className="icon-button" onClick={onClose} aria-label="Close setup" disabled={busy}>
              <X size={17} aria-hidden="true" />
            </button>
          )}
        </header>

        <div className="onboarding-content">
          {error !== null && <div className="banner banner-error" role="alert">{error}</div>}
          {step === 'welcome' && <WelcomeStep onContinue={() => setStep('choose')} />}
          {step === 'choose' && (
            <ChooseStep
              snapshot={snapshot}
              selectedProviders={selectedProviders}
              selectedContents={selectedContents}
              setSelectedProviders={setSelectedProviders}
              setSelectedContents={setSelectedContents}
              onBack={back}
              onContinue={() => void continueFromSelection()}
              busy={busy}
            />
          )}
          {step === 'instructions' && (
            <InstructionsStep
              comparisons={comparisons}
              runners={runners}
              selectedRunner={selectedRunner}
              setSelectedRunner={setSelectedRunner}
              draft={ruleDraft}
              setDraft={setRuleDraft}
              onGenerate={(runner) => setConfirmAction({
                title: `Generate with ${runner.displayName}?`,
                body: `${runner.displayName} will read ${comparisons.length} selected local instruction files and return an editable draft. Nothing is applied until the final review.`,
                label: 'Generate draft',
                run: () => generateDraft(runner),
              })}
              onBack={back}
              onContinue={() => setStep(hasSkillsStep ? 'skills' : 'preview')}
              busy={busy}
            />
          )}
          {step === 'skills' && (
            <SkillsStep
              skills={selectedUnmanagedSkills}
              selectedSkills={selectedSkills}
              setSelectedSkills={setSelectedSkills}
              onBack={back}
              onContinue={() => setStep('preview')}
            />
          )}
          {step === 'preview' && (
            <SetupPreviewStep
              snapshot={snapshot}
              providers={selectedProviders}
              contents={selectedContents}
              managedSkills={managedSkills}
              unmanagedSkills={selectedUnmanagedSkills}
              selectedSkills={selectedSkills}
              onBack={back}
              onReview={() => void reviewSetup()}
              busy={busy}
              rulesReady={!selectedContents.includes('rules') || ruleDraft.trim().length > 0}
            />
          )}
          {step === 'changes' && review !== null && (
            <ChangesStep
              review={review}
              providers={selectedProviders}
              snapshot={snapshot}
              contents={selectedContents}
              onBack={back}
              onApply={() => setConfirmAction({
                title: 'Apply reviewed changes?',
                body: `Apply exactly ${changedEntries(review.entries).length} digest-backed changes? Reglet will snapshot existing targets first.`,
                label: 'Apply to providers',
                run: applyReview,
              })}
              busy={busy}
            />
          )}
          {step === 'done' && <DoneStep providers={selectedProviders} onDone={onClose} />}
        </div>
      </section>
      {confirmAction !== null && <WizardConfirmation action={confirmAction} onClose={() => setConfirmAction(null)} />}
    </div>
  );
}

function StepRail({ currentIndex }: { currentIndex: number }) {
  return (
    <ol className="onboarding-rail" aria-label={`Setup step ${currentIndex + 1} of ${steps.length}`}>
      {steps.map((step, index) => (
        <li key={step.id} className={index === currentIndex ? 'onboarding-step-active' : index < currentIndex ? 'onboarding-step-complete' : ''}>
          <span className="onboarding-step-marker">{index < currentIndex ? <Check size={12} aria-hidden="true" /> : index + 1}</span>
          <span className="onboarding-step-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="onboarding-centered">
      <div className="onboarding-hero-icon"><BrandMark /></div>
      <p className="onboarding-eyebrow">LOCAL AND REVIEWED</p>
      <h1 id="onboarding-title" className="onboarding-title">Set up Reglet without surprises.</h1>
      <p className="onboarding-lede">Reglet will collect your local instructions and skills into one source, then show every provider change before writing it.</p>
      <div className="onboarding-safety-ledger">
        <SafetyItem title="Nothing runs in the background" body="Setup does not start a daemon or notifications." />
        <SafetyItem title="AI is always opt-in" body="Drafting only runs after per-use consent." />
        <SafetyItem title="Every write is reviewed" body="Provider files are backed up before apply." />
      </div>
      <button className="primary-button mt-8" onClick={onContinue}>Continue <ArrowRight size={16} aria-hidden="true" /></button>
    </div>
  );
}

function SafetyItem({ title, body }: { title: string; body: string }) {
  return <div><CheckCircle2 size={18} aria-hidden="true" /><strong>{title}</strong><span>{body}</span></div>;
}

function ChooseStep(props: {
  snapshot: ManagerSnapshotV2;
  selectedProviders: ManagerProviderId[];
  selectedContents: ManagerContentId[];
  setSelectedProviders: (providers: ManagerProviderId[]) => void;
  setSelectedContents: (contents: ManagerContentId[]) => void;
  onBack: () => void;
  onContinue: () => void;
  busy: boolean;
}) {
  return (
    <StepLayout title="Choose what Reglet manages" body="Detected tools are selected. You can change this later from Providers." footer={<StepActions onBack={props.onBack} onContinue={props.onContinue} continueLabel="Continue" disabled={props.busy || props.selectedProviders.length === 0 || props.selectedContents.length === 0} busy={props.busy} />}>
      <div className="onboarding-two-column">
        <div>
          <h3 className="onboarding-section-title">Providers</h3>
          <div className="onboarding-choice-list">
            {props.snapshot.providerDiscovery.map((provider) => (
              <label className={`onboarding-choice ${provider.detected ? '' : 'opacity-50'}`} key={provider.provider}>
                <input
                  type="checkbox"
                  checked={props.selectedProviders.includes(provider.provider)}
                  disabled={!provider.detected}
                  onChange={(event) => props.setSelectedProviders(toggle(props.selectedProviders, provider.provider, event.currentTarget.checked))}
                  aria-label={`Select ${simpleProviderName(provider.provider)}`}
                />
                <span><strong>{simpleProviderName(provider.provider)}</strong><small>{provider.detected ? 'Detected' : 'Not found'}</small></span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <h3 className="onboarding-section-title">Unified content</h3>
          <div className="onboarding-choice-list">
            {contentOptions.map((content) => (
              <label className="onboarding-choice" key={content.id}>
                <input type="checkbox" checked={props.selectedContents.includes(content.id)} onChange={(event) => props.setSelectedContents(toggle(props.selectedContents, content.id, event.currentTarget.checked))} />
                <span><strong>{content.title}</strong><small>{content.body}</small></span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </StepLayout>
  );
}

function InstructionsStep(props: {
  comparisons: RuleComparison[];
  runners: MergeRunner[];
  selectedRunner: ManagerMergeRunnerId | null;
  setSelectedRunner: (runner: ManagerMergeRunnerId) => void;
  draft: string;
  setDraft: (draft: string) => void;
  onGenerate: (runner: MergeRunner) => void;
  onBack: () => void;
  onContinue: () => void;
  busy: boolean;
}) {
  const runner = props.runners.find((item) => item.id === props.selectedRunner);
  return (
    <StepLayout title="Create one AGENT.md" body="Review the unified instructions Reglet will sync to every selected provider." footer={<StepActions onBack={props.onBack} onContinue={props.onContinue} continueLabel="Continue" disabled={props.busy || props.draft.trim().length === 0} busy={props.busy} />}>
      <div className="onboarding-editor-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">Unified instructions</p>
            <p className="text-sm text-reglet-muted">{props.comparisons.length === 0 ? 'Start with a clean shared document.' : `${props.comparisons.length} existing provider document${props.comparisons.length === 1 ? '' : 's'} found.`}</p>
          </div>
          {props.runners.length > 0 && props.comparisons.length >= 2 && (
            <div className="flex items-center gap-2">
              <select className="text-input" value={props.selectedRunner ?? ''} onChange={(event) => props.setSelectedRunner(event.currentTarget.value as ManagerMergeRunnerId)} aria-label="AI drafting tool">
                {props.runners.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
              </select>
              <button className="secondary-button" onClick={() => runner !== undefined && props.onGenerate(runner)} disabled={props.busy || runner === undefined}>
                <Sparkles size={16} aria-hidden="true" /> Draft merge
              </button>
            </div>
          )}
        </div>
        <textarea className="onboarding-editor" value={props.draft} onChange={(event) => props.setDraft(event.currentTarget.value)} aria-label="Unified AGENT.md" />
        <p className="text-xs text-reglet-muted">Editable now and later. No provider files change on this step.</p>
      </div>
    </StepLayout>
  );
}

function SkillsStep(props: {
  skills: UnmanagedSkill[];
  selectedSkills: string[];
  setSelectedSkills: (skills: string[]) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <StepLayout title="Choose unified skills" body="Skill names are shown without internal file paths. Unselected skills stay provider-local." footer={<StepActions onBack={props.onBack} onContinue={props.onContinue} continueLabel="Review setup" />}>
      <div className="onboarding-choice-list mx-auto max-w-2xl">
        {props.skills.map((skill) => (
          <label className="onboarding-choice" key={skillKey(skill)}>
            <input type="checkbox" checked={props.selectedSkills.includes(skillKey(skill))} onChange={(event) => props.setSelectedSkills(toggle(props.selectedSkills, skillKey(skill), event.currentTarget.checked))} />
            <Wrench size={18} aria-hidden="true" />
            <span>
              <strong>{skill.name}</strong>
              <small>From {simpleProviderName(skill.provider)}{skill.sharedConflict === 'none' ? '' : ' · replaces an existing unified skill'}</small>
            </span>
          </label>
        ))}
      </div>
    </StepLayout>
  );
}

function SetupPreviewStep(props: {
  snapshot: ManagerSnapshotV2;
  providers: ManagerProviderId[];
  contents: ManagerContentId[];
  managedSkills: ManagedSkill[];
  unmanagedSkills: UnmanagedSkill[];
  selectedSkills: string[];
  onBack: () => void;
  onReview: () => void;
  busy: boolean;
  rulesReady: boolean;
}) {
  const skillNamesByProvider = Object.fromEntries(props.providers.map((provider) => [
    provider,
    previewSkillNames(props.managedSkills, props.unmanagedSkills, props.selectedSkills, provider),
  ])) as Partial<Record<ManagerProviderId, string[]>>;
  const unifiedSkillNames = Array.from(new Set(Object.values(skillNamesByProvider).flat())).sort((left, right) => left.localeCompare(right));
  return (
    <StepLayout title="Preview setup" body="Reglet keeps one unified source and translates it to each provider's native files." footer={<StepActions onBack={props.onBack} onContinue={props.onReview} continueLabel="Review changes" disabled={props.busy || !props.rulesReady} busy={props.busy} />}>
      <UnifiedSource contents={props.contents} skillCount={unifiedSkillNames.length} />
      <div className="mt-6">
        <h3 className="onboarding-section-title">Provider destinations</h3>
        <div className="onboarding-disclosures">
          {props.providers.map((provider) => (
            <ProviderSyncDisclosure key={provider} provider={provider} snapshot={props.snapshot} contents={props.contents} skillNames={skillNamesByProvider[provider] ?? []} />
          ))}
        </div>
      </div>
    </StepLayout>
  );
}

function UnifiedSource({ contents, skillCount }: { contents: ManagerContentId[]; skillCount: number }) {
  return (
    <section className="unified-source-card" aria-label="Unified Reglet source">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="font-semibold">Unified source</h3><p className="text-sm text-reglet-muted">Stored locally in .reglet</p></div>
        <span className="unified-badge">One source of truth</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {contents.includes('rules') && <UnifiedItem icon={<FileText size={18} />} name="AGENT.md" detail="Unified instructions" />}
        {contents.includes('skills') && <UnifiedItem icon={<Folder size={18} />} name="skills" detail={`${skillCount} raw skill${skillCount === 1 ? '' : 's'}`} />}
        {contents.includes('mcp') && <UnifiedItem icon={<Plug size={18} />} name="MCP" detail="Unified servers" />}
      </div>
    </section>
  );
}

function UnifiedItem({ icon, name, detail }: { icon: React.ReactNode; name: string; detail: string }) {
  return <div className="unified-source-item"><span aria-hidden="true">{icon}</span><span><strong>{name}</strong><small>{detail}</small></span></div>;
}

function ProviderSyncDisclosure(props: {
  provider: ManagerProviderId;
  snapshot: ManagerSnapshotV2;
  contents: ManagerContentId[];
  skillNames: string[];
}) {
  const matrix = props.snapshot.enrollmentMatrix.find((item) => item.provider === props.provider);
  const rulesName = !providerSupports(props.snapshot, props.provider, 'rules')
    ? null
    : fileName(matrix?.cells.rules.destinationPath ?? '') || providerRuleName(props.provider);
  const supportsSkills = providerSupports(props.snapshot, props.provider, 'skills');
  const supportsMcp = providerSupports(props.snapshot, props.provider, 'mcp');
  const parts = [
    props.contents.includes('rules') && rulesName !== null ? rulesName : null,
    props.contents.includes('skills') && supportsSkills ? `${props.skillNames.length} skill${props.skillNames.length === 1 ? '' : 's'}` : null,
    props.contents.includes('mcp') && supportsMcp ? 'MCP' : null,
  ].filter(isDefined);
  return (
    <details className="provider-disclosure">
      <summary><span><strong>{simpleProviderName(props.provider)}</strong><small>{parts.join(' · ') || 'Nothing to sync'}</small></span></summary>
      <div className="provider-disclosure-body">
        {props.contents.includes('rules') && rulesName !== null && <SyncRow icon={<FileText size={16} />} name={`AGENT.md → ${rulesName}`} detail="Unified instructions" />}
        {props.contents.includes('skills') && supportsSkills && props.skillNames.map((name) => <SyncRow key={name} icon={<Wrench size={16} />} name={name} detail="Skill" />)}
        {props.contents.includes('mcp') && supportsMcp && <SyncRow icon={<Plug size={16} />} name="MCP settings" detail="Provider configuration" />}
      </div>
    </details>
  );
}

function SyncRow({ icon, name, detail, badge }: { icon: React.ReactNode; name: string; detail: string; badge?: ChangeKind }) {
  return <div className="sync-row"><span aria-hidden="true">{icon}</span><span><strong>{name}</strong><small>{detail}</small></span>{badge !== undefined && <span className={`change-badge change-${badge.toLowerCase()}`}>{badge}</span>}</div>;
}

function ChangesStep(props: {
  review: StructuredReview;
  providers: ManagerProviderId[];
  snapshot: ManagerSnapshotV2;
  contents: ManagerContentId[];
  onBack: () => void;
  onApply: () => void;
  busy: boolean;
}) {
  const changes = changedEntries(props.review.entries);
  return (
    <StepLayout title="Review changes" body="Only files that will be created, updated, or removed are shown." footer={<StepActions onBack={props.onBack} onContinue={props.onApply} continueLabel="Apply to providers" disabled={props.busy || props.review.validationIssues.length > 0} busy={props.busy} />}>
      {props.review.validationIssues.length > 0 && <div className="banner banner-error" role="alert">{props.review.validationIssues.join(' ')}</div>}
      <UnifiedSource contents={props.contents} skillCount={uniqueSkillNames(props.review.entries).length} />
      <div className="onboarding-disclosures mt-6" aria-label="Condensed provider changes">
        {props.providers.map((provider) => {
          const providerChanges = changes.filter((change) => change.provider === provider);
          return (
            <details className="provider-disclosure" key={provider}>
              <summary><span><strong>{simpleProviderName(provider)}</strong><small>{changeSummary(providerChanges)}</small></span></summary>
              <div className="provider-disclosure-body">
                {providerChanges.length === 0 && <div className="sync-row"><CheckCircle2 size={16} aria-hidden="true" /><span><strong>Up to date</strong><small>No files need changes</small></span></div>}
                {providerChanges.map((change) => <SyncRow key={`${change.provider}-${change.content}-${change.path}`} icon={changeIcon(change.content)} name={friendlyChangeName(change)} detail={changeDetail(change.content)} badge={changeKind(change) ?? undefined} />)}
              </div>
            </details>
          );
        })}
      </div>
      <p className="mt-5 text-sm text-reglet-muted">{changes.length === 0 ? 'All selected providers are up to date.' : `${changes.length} change${changes.length === 1 ? '' : 's'} ready. Existing targets are snapshotted before apply.`}</p>
    </StepLayout>
  );
}

function DoneStep({ providers, onDone }: { providers: ManagerProviderId[]; onDone: () => void }) {
  return (
    <div className="onboarding-centered">
      <div className="onboarding-hero-icon onboarding-complete-icon"><Check size={24} aria-hidden="true" /></div>
      <p className="onboarding-eyebrow">SETUP COMPLETE</p>
      <h1 id="onboarding-title" className="onboarding-title">Reglet is ready.</h1>
      <p className="onboarding-lede">Your unified configuration is now managed across {providers.length} provider{providers.length === 1 ? '' : 's'}.</p>
      <button className="primary-button mt-8" onClick={onDone}>Done</button>
    </div>
  );
}

function StepLayout({ title, body, children, footer }: { title: string; body: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="onboarding-step-layout">
      <div className="onboarding-step-body">
        <div className="mb-7"><h1 id="onboarding-title" className="text-2xl font-semibold">{title}</h1><p className="mt-2 text-reglet-muted">{body}</p></div>
        {children}
      </div>
      <footer className="onboarding-footer">{footer}</footer>
    </div>
  );
}

function StepActions({ onBack, onContinue, continueLabel, disabled = false, busy = false }: { onBack: () => void; onContinue: () => void; continueLabel: string; disabled?: boolean; busy?: boolean }) {
  return <div className="flex w-full items-center justify-between"><button className="secondary-button" onClick={onBack} disabled={busy}><ArrowLeft size={16} aria-hidden="true" /> Back</button><button className="primary-button" onClick={onContinue} disabled={disabled}>{busy ? 'Working…' : continueLabel} <ArrowRight size={16} aria-hidden="true" /></button></div>;
}

function WizardConfirmation({ action, onClose }: { action: ConfirmAction; onClose: () => void }) {
  const [working, setWorking] = useState(false);
  return (
    <div className="modal-backdrop z-50" role="presentation">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="wizard-confirm-title" aria-describedby="wizard-confirm-body">
        <h2 id="wizard-confirm-title" className="text-lg font-semibold">{action.title}</h2>
        <p id="wizard-confirm-body" className="mt-2 text-sm text-reglet-muted">{action.body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-button" onClick={onClose} disabled={working}>Cancel</button>
          <button className="primary-button" disabled={working} onClick={() => { setWorking(true); void action.run().finally(() => setWorking(false)); }}>{working ? 'Working…' : action.label}</button>
        </div>
      </div>
    </div>
  );
}

function simpleProviderName(provider: ManagerProviderId): string {
  if (provider === 'claude') return 'Claude';
  if (provider === 'codex') return 'Codex';
  if (provider === 'cursor') return 'Cursor';
  if (provider === 'gemini') return 'Gemini';
  if (provider === 'windsurf') return 'Windsurf';
  return 'OpenCode';
}

function providerRuleName(provider: ManagerProviderId): string {
  if (provider === 'claude') return 'CLAUDE.md';
  if (provider === 'codex' || provider === 'opencode') return 'AGENTS.md';
  if (provider === 'gemini') return 'GEMINI.md';
  if (provider === 'windsurf') return 'global_rules.md';
  return 'Not supported';
}

function initialRuleDraft(comparisons: RuleComparison[]): string {
  if (comparisons.length === 0) return '# Agent instructions\n\n<!-- Add shared instructions here. -->\n';
  const unique = Array.from(new Set(comparisons.map((comparison) => comparison.preview.trim()))).filter((item) => item.length > 0);
  return unique.length === 1 ? `${unique[0]}\n` : '';
}

function normalizedRuleDraft(draft: string): string {
  return `${draft.trimEnd()}\n`;
}

function uniqueSkills(skills: UnmanagedSkill[]): UnmanagedSkill[] {
  const byName = new Map<string, UnmanagedSkill>();
  for (const skill of skills) if (!byName.has(skill.name)) byName.set(skill.name, skill);
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function previewSkillNames(managed: ManagedSkill[], unmanaged: UnmanagedSkill[], selectedKeys: string[], provider: ManagerProviderId): string[] {
  const names = new Set(
    managed.filter((skill) => skill.provider === undefined || skill.provider === provider).map((skill) => skill.name),
  );
  for (const skill of unmanaged) if (selectedKeys.includes(skillKey(skill))) names.add(skill.name);
  return [...names].sort((left, right) => left.localeCompare(right));
}

function skillKey(skill: Pick<UnmanagedSkill, 'provider' | 'name'>): string {
  return `${skill.provider}:${skill.name}`;
}

function changedEntries(entries: PreviewChange[]): PreviewChange[] {
  return entries.filter((entry) => changeKind(entry) !== null);
}

function changeKind(entry: PreviewChange): ChangeKind | null {
  if (entry.operation === 'remove') return entry.expectedTargetHash === null && entry.diff.length === 0 ? null : 'Removed';
  if (entry.operation !== 'write' || entry.expectedTargetHash === entry.resultingTargetHash || entry.diff.length === 0) return null;
  return entry.expectedTargetHash === null ? 'New' : 'Updated';
}

function changeSummary(entries: PreviewChange[]): string {
  const counts = { New: 0, Updated: 0, Removed: 0 };
  for (const entry of entries) {
    const kind = changeKind(entry);
    if (kind !== null) counts[kind] += 1;
  }
  const parts = (Object.keys(counts) as ChangeKind[]).filter((kind) => counts[kind] > 0).map((kind) => `${counts[kind]} ${kind.toLowerCase()}`);
  return parts.length === 0 ? 'Up to date' : parts.join(' · ');
}

function friendlyChangeName(change: PreviewChange): string {
  if (change.content === 'rules') return `AGENT.md → ${fileName(change.path)}`;
  if (change.content === 'mcp') return 'MCP settings';
  return fileName(change.path);
}

function changeDetail(content: ManagerContentId): string {
  if (content === 'rules') return 'Unified instructions';
  if (content === 'skills') return 'Skill';
  return 'Provider configuration';
}

function changeIcon(content: ManagerContentId) {
  if (content === 'rules') return <FileText size={16} />;
  if (content === 'skills') return <Wrench size={16} />;
  return <Plug size={16} />;
}

function uniqueSkillNames(changes: PreviewChange[]): string[] {
  return Array.from(new Set(changes.filter((change) => change.content === 'skills').map((change) => fileName(change.path))));
}

function fileName(value: string): string {
  return value.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? value;
}

function providerSupports(snapshot: ManagerSnapshotV2, provider: ManagerProviderId, content: ManagerContentId): boolean {
  const cell = snapshot.enrollmentMatrix.find((item) => item.provider === provider)?.cells[content];
  return cell !== undefined && cell.destinationPath !== null && cell.capability.state !== 'unsupported';
}

function ruleComparisonFromJson(value: JsonObject): RuleComparison | undefined {
  return isProvider(value.provider) && typeof value.preview === 'string' ? { provider: value.provider, preview: value.preview } : undefined;
}

function mergeRunnerFromJson(value: JsonObject): MergeRunner | undefined {
  return isRunner(value.id) && typeof value.displayName === 'string' ? { id: value.id, displayName: value.displayName } : undefined;
}

function unmanagedSkillFromJson(value: JsonObject): UnmanagedSkill | undefined {
  return isProvider(value.provider) && typeof value.name === 'string'
    ? { provider: value.provider, name: value.name, sharedConflict: typeof value.sharedConflict === 'string' ? value.sharedConflict : 'none' }
    : undefined;
}

function managedSkillFromJson(value: JsonObject): ManagedSkill | undefined {
  if (typeof value.name !== 'string') return undefined;
  return isProvider(value.provider) ? { provider: value.provider, name: value.name } : { name: value.name };
}

function previewChangeFromJson(value: JsonObject): PreviewChange | undefined {
  if (!isProvider(value.provider) || !isContent(value.content) || typeof value.operation !== 'string' || typeof value.path !== 'string') return undefined;
  return {
    provider: value.provider,
    content: value.content,
    operation: value.operation,
    path: value.path,
    diff: typeof value.diff === 'string' ? value.diff : '',
    expectedTargetHash: typeof value.expectedTargetHash === 'string' ? value.expectedTargetHash : null,
    resultingTargetHash: typeof value.resultingTargetHash === 'string' ? value.resultingTargetHash : null,
  };
}

function objectArray(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => objectFromUnknown(item) !== undefined) : [];
}

function objectFromUnknown(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isProvider(value: JsonValue | undefined): value is ManagerProviderId {
  return value === 'claude' || value === 'codex' || value === 'cursor' || value === 'gemini' || value === 'windsurf' || value === 'opencode';
}

function isContent(value: JsonValue | undefined): value is ManagerContentId {
  return value === 'rules' || value === 'skills' || value === 'mcp';
}

function isRunner(value: JsonValue | undefined): value is ManagerMergeRunnerId {
  return value === 'codex' || value === 'claude' || value === 'gemini';
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function toggle<T>(items: T[], item: T, checked: boolean): T[] {
  if (checked) return items.includes(item) ? items : [...items, item];
  return items.filter((candidate) => candidate !== item);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
