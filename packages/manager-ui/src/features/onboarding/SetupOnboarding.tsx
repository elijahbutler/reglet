import { Check, Cloud, HardDrive, Library, Server } from 'lucide-react';
import { useState } from 'react';
import type { ManagerProviderId, ManagerSnapshotV3 } from '@reglet/manager-protocol';
import type { ManagerClient } from '../../client/ManagerClient.js';
import { Button } from '../../design-system/Button.js';
import { useDialogFocus } from '../../design-system/useDialogFocus.js';
import { SyncConnectionPanel } from '../settings/SyncConnectionPanel.js';

const steps = [
  { id: 'machine', label: 'This machine', icon: HardDrive },
  { id: 'defaults', label: 'Global library', icon: Library },
  { id: 'sync', label: 'Connect', icon: Cloud },
] as const;

type SetupStep = (typeof steps)[number]['id'];

const starterDefaults = `# Global agent defaults

- Follow the nearest project instructions.
- Preserve existing work and explain consequential changes.
- Prefer clear, verifiable results over hidden automation.
`;

export function SetupOnboarding({ client, snapshot, onRefresh, onComplete, onError, canCancel = false, onCancel }: {
  client: ManagerClient;
  snapshot: ManagerSnapshotV3;
  onRefresh: () => Promise<void>;
  onComplete: (openProjectInbox: boolean) => void;
  onError: (message: string) => void;
  canCancel?: boolean;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState<SetupStep>('machine');
  const [globalContent, setGlobalContent] = useState(starterDefaults);
  const [targets, setTargets] = useState<ManagerProviderId[]>(() => snapshot.providers.filter((provider) => provider.detected).map((provider) => provider.id));
  const [rootPath, setRootPath] = useState('');
  const [scanProject, setScanProject] = useState(true);
  const [busy, setBusy] = useState(false);
  const isCancelable = Boolean(canCancel && onCancel);
  const dialog = useDialogFocus<HTMLElement>(true, isCancelable ? onCancel : undefined);
  const currentIndex = steps.findIndex((candidate) => candidate.id === step);

  const complete = async (includeSelections: boolean) => {
    setBusy(true);
    try {
      await client.command('setup.complete', {
        createGlobalDefaults: includeSelections,
        ...(includeSelections ? { globalInstructionContent: globalContent, targets } : {}),
        ...(!includeSelections || rootPath.trim().length === 0 ? {} : { rootPath: rootPath.trim(), scanProject }),
      });
      await onRefresh();
      onComplete(includeSelections && rootPath.trim().length > 0 && scanProject);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Reglet setup could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="rg-setup-backdrop">
    <section ref={dialog} tabIndex={-1} className="rg-setup" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <aside className="rg-setup-rail">
        <div className="rg-setup-brand"><span className="rg-brand__mark" aria-hidden="true">R</span><span><strong>Set up Reglet</strong><small>About 2 minutes</small></span></div>
        <nav aria-label="Setup progress">
          {steps.map(({ id, label, icon: Icon }, index) => <button type="button" key={id} aria-current={step === id ? 'step' : undefined} onClick={() => setStep(id)}><span>{index < currentIndex ? <Check size={14} /> : <Icon size={14} />}</span>{label}</button>)}
        </nav>
        <div className="rg-setup-boundary"><Server size={15} /><span><strong>Local first</strong><small>No provider file is changed during setup.</small></span></div>
      </aside>
      <div className="rg-setup-main">
        <header><span>Step {currentIndex + 1} of {steps.length}</span><h1 id="setup-title">{setupTitle(step)}</h1><p>{setupDescription(step)}</p></header>
        <div className="rg-setup-content">
          {step === 'machine' ? <MachineStep providers={snapshot.providers} rootPath={rootPath} onRootPath={setRootPath} scanProject={scanProject} onScanProject={setScanProject} /> : null}
          {step === 'defaults' ? <DefaultsStep providers={snapshot.providers} content={globalContent} targets={targets} onContent={setGlobalContent} onTargets={setTargets} /> : null}
          {step === 'sync' ? <SyncStep client={client} snapshot={snapshot} onRefresh={onRefresh} onError={onError} /> : null}
        </div>
        <footer><button type="button" className="rg-setup-skip" disabled={busy} onClick={isCancelable ? onCancel : () => void complete(false)}>{isCancelable ? 'Close walkthrough' : 'Skip guided setup'}</button><div>{currentIndex > 0 ? <Button tone="secondary" disabled={busy} onClick={() => setStep(steps[currentIndex - 1]?.id ?? 'machine')}>Back</Button> : null}{currentIndex < steps.length - 1 ? <Button tone="primary" disabled={step === 'defaults' && globalContent.trim().length === 0} onClick={() => setStep(steps[currentIndex + 1]?.id ?? 'sync')}>Continue</Button> : <Button tone="primary" disabled={busy} onClick={() => void complete(true)}>{busy ? 'Finishing…' : 'Finish setup'}</Button>}</div></footer>
      </div>
    </section>
  </div>;
}

function MachineStep({ providers, rootPath, onRootPath, scanProject, onScanProject }: {
  providers: ManagerSnapshotV3['providers'];
  rootPath: string;
  onRootPath: (value: string) => void;
  scanProject: boolean;
  onScanProject: (value: boolean) => void;
}) {
  const detected = providers.filter((provider) => provider.detected);
  const hasRoot = rootPath.trim().length > 0;
  return <div className="rg-setup-machine"><div className="rg-setup-callout"><HardDrive size={17} /><span><strong>{detected.length} provider{detected.length === 1 ? '' : 's'} detected on this machine</strong><small>{detected.length === 0 ? 'Reglet will keep the global library ready until an agent is installed.' : detected.map((provider) => provider.displayName).join(', ')}</small></span></div><label className="rg-field"><span>Project root location</span><input autoFocus value={rootPath} onChange={(event) => onRootPath(event.currentTarget.value)} placeholder="Absolute path to your projects" /></label><p className="rg-setup-help">Optional. Reglet only reads project configuration under this directory.</p><div className="rg-choice-list"><button type="button" aria-pressed={scanProject && hasRoot} disabled={!hasRoot} onClick={() => onScanProject(true)}><span className="rg-choice-check">{scanProject && hasRoot ? <Check size={15} /> : null}</span><span><strong>Scan into Project Inbox</strong><small>Review discovered rules, skills, and MCP configurations before promoting or merging anything.</small></span></button><button type="button" aria-pressed={!scanProject || !hasRoot} onClick={() => onScanProject(false)}><span className="rg-choice-check">{!scanProject || !hasRoot ? <Check size={15} /> : null}</span><span><strong>Review projects later</strong><small>Set up the global library without importing project content.</small></span></button></div></div>;
}

function DefaultsStep({ providers, content, targets, onContent, onTargets }: {
  providers: ManagerSnapshotV3['providers'];
  content: string;
  targets: ManagerProviderId[];
  onContent: (value: string) => void;
  onTargets: (value: ManagerProviderId[]) => void;
}) {
  const toggle = (provider: ManagerProviderId) => onTargets(targets.includes(provider) ? targets.filter((candidate) => candidate !== provider) : [...targets, provider]);
  return <div className="rg-setup-defaults"><div className="rg-setup-callout"><Library size={17} /><span><strong>One global source of truth</strong><small>Provider-specific agent rules, skills, and MCP overrides remain available in the Library, but stay hidden from its default Global view.</small></span></div><label className="rg-field"><span>Global agent rules</span><textarea value={content} onChange={(event) => onContent(event.currentTarget.value)} spellCheck={false} /></label><fieldset className="rg-provider-picker"><legend>Make available to these providers after review</legend>{providers.map((provider) => <label key={provider.id}><input type="checkbox" checked={targets.includes(provider.id)} onChange={() => toggle(provider.id)} /><span><strong>{provider.displayName}</strong><small>{provider.detected ? 'Detected' : 'Not detected'}</small></span></label>)}</fieldset></div>;
}

function SyncStep({ client, snapshot, onRefresh, onError }: { client: ManagerClient; snapshot: ManagerSnapshotV3; onRefresh: () => Promise<void>; onError: (message: string) => void }) {
  return <div><div className="rg-setup-callout"><Cloud size={17} /><span><strong>Connection is optional</strong><small>Only canonical library content is encrypted and exchanged. Project paths, drafts, provider output, and secrets remain on this machine.</small></span></div><SyncConnectionPanel client={client} snapshot={snapshot} onRefresh={onRefresh} onError={onError} /></div>;
}

function setupTitle(step: SetupStep): string {
  if (step === 'machine') return 'Set up this machine';
  if (step === 'defaults') return 'Create your global defaults';
  return 'Connect your library anywhere';
}

function setupDescription(step: SetupStep): string {
  if (step === 'machine') return 'Choose where Reglet discovers existing agent configuration. Discovery never writes provider files.';
  if (step === 'defaults') return 'Start with one canonical rule set that can be projected into every selected coding agent.';
  return 'Stay local, connect an existing encrypted server, or install your own Reglet Connect server.';
}
