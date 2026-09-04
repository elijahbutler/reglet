import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ManagerApp } from '@reglet/manager-ui';
import { FixtureManagerClient } from '@reglet/manager-ui/testing';
import type { ManagerProtocolOperation, ManagerRpcInputs } from '@reglet/manager-protocol';

describe('Library external dispatch', () => {
  test('dispatches external.open to launch canonical artifact in native editor', async () => {
    class ExternalOpenClient extends FixtureManagerClient {
      openedTarget: import('@reglet/manager-protocol').ExternalTargetInput | null = null;

      override async command<Operation extends ManagerProtocolOperation>(
        operation: Operation,
        input?: ManagerRpcInputs[Operation],
        options?: import('@reglet/manager-ui').ManagerCommandOptions,
      ) {
        if (operation === 'external.open') {
          this.openedTarget = (input as ManagerRpcInputs['external.open'])?.target ?? null;
          return { revision: 1, changed: false, data: { delegated: true } };
        }
        return super.command(operation, input, options);
      }
    }

    const client = new ExternalOpenClient();
    render(<ManagerApp client={client} initialDestination="library" />);

    // Click on the "Open in Editor" button in the pane header
    const openBtn = (await screen.findAllByRole('button', { name: /Open in Editor/i }))[0];
    expect(openBtn).toBeInTheDocument();

    fireEvent.click(openBtn!);

    await waitFor(() => {
      expect(client.openedTarget).toMatchObject({
        kind: 'canonical',
        artifact: 'artifact-general-instructions',
      });
    });
  });
});
