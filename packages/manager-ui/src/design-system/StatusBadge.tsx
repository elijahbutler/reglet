import { AlertTriangle, CheckCircle2, CircleDashed, CircleMinus, Clock3, XCircle } from 'lucide-react';
import type { ManagerProjectionStatusV3 } from '@reglet/manager-protocol';

const statusLabels: Record<ManagerProjectionStatusV3, string> = {
  'not-targeted': 'Not targeted',
  unsupported: 'Unsupported',
  pending: 'Pending',
  applied: 'Applied',
  drifted: 'Drifted',
  missing: 'Missing',
  blocked: 'Blocked',
  error: 'Error',
};

export function StatusBadge({ status }: { status: ManagerProjectionStatusV3 }) {
  const Icon = status === 'applied'
    ? CheckCircle2
    : status === 'pending'
      ? Clock3
      : status === 'drifted' || status === 'blocked'
        ? AlertTriangle
        : status === 'error'
          ? XCircle
          : status === 'not-targeted'
            ? CircleMinus
            : CircleDashed;
  return (
    <span className={`rg-status rg-status--${status}`}>
      <Icon size={13} strokeWidth={1.8} aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}
