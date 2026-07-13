# Recovery

Every Reglet mutation creates an operation receipt. Before replacing a file or directory, the transaction engine snapshots the current target and records a durable journal. Snapshots and receipts are never automatically deleted in V1.

## Inspect an operation

```bash
reglet operations list
reglet operations show <receipt-id>
```

`show` lists each affected path and the snapshot source. The macOS manager presents the same information in its Recovery screen.

## Restore a receipt

```bash
reglet operations restore <receipt-id>
```

This is an explicit destructive recovery action: it replaces the affected provider paths with the captured pre-operation snapshots. It does not silently alter unrelated later work.

If an operation is interrupted, the next mutation automatically recovers the unfinished journal first. You can also inspect that state directly:

```bash
reglet operations recover
```

## Compatibility commands

`reglet restore [provider]` and `reglet revert [provider]` remain available for existing scripts. Prefer receipt-based recovery for a precise operation and its exact snapshot sources.

## Stop managing without deleting content

```bash
reglet unenroll claude:rules
```

Unenrollment preserves the current provider content, removes Reglet's ownership record, and strips the generated rules header. It is the safe lifecycle action when you want to take a scope back under manual control.
