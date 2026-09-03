import { spawn } from 'node:child_process';
import { isCancel, password, select, spinner, text } from '@clack/prompts';
import {
  deleteCredential,
  listCredentials,
  loginWithGitHubToken,
  pollGitHubDeviceToken,
  readCredential,
  requestGitHubDeviceCode,
} from '@reglet/core';
import type { Command } from 'commander';

export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('Manage OAuth credentials and cross-device sync');

  auth
    .command('login')
    .description('Authenticate with an OAuth provider (e.g. github)')
    .argument('[provider]', 'OAuth provider name', 'github')
    .option('--token <token>', 'authenticate non-interactively using an access token or PAT')
    .option('--client-id <id>', 'custom OAuth App Client ID')
    .option('--scopes <scopes...>', 'OAuth scopes to request (defaults to repo, read:user)')
    .option('--no-browser', 'do not automatically open the browser')
    .option('--json', 'print machine-readable JSON output')
    .action(async (provider: string, options: {
      token?: string;
      clientId?: string;
      scopes?: string[];
      browser?: boolean;
      json?: boolean;
    }) => {
      const normalized = provider.toLowerCase();
      if (normalized !== 'github') {
        throw new Error(`Unsupported OAuth provider: ${provider}. Supported providers: github`);
      }

      if (options.token !== undefined && options.token.trim().length > 0) {
        const cred = await loginWithGitHubToken(options.token.trim());
        if (options.json === true) {
          console.log(JSON.stringify({ version: 1, status: 'logged-in', credential: cred }, null, 2));
        } else {
          console.log(`auth\tlogged-in\tprovider=github\tuser=${cred.user?.login ?? 'unknown'}\tscopes=${cred.scopes?.join(',') ?? 'none'}`);
        }
        return;
      }

      // Interactive login flow
      let token = '';
      let clientId: string | undefined = options.clientId ?? process.env.REGLET_GITHUB_CLIENT_ID;

      if (clientId === undefined || clientId.trim().length === 0) {
        if (!process.stdin.isTTY) {
          throw new Error('Non-interactive login requires --token <pat> or --client-id <id> (or REGLET_GITHUB_CLIENT_ID).');
        }

        const method = await select({
          message: 'How would you like to authenticate with GitHub?',
          options: [
            { value: 'pat', label: 'Personal Access Token (classic or fine-grained)', hint: 'fastest, no OAuth app required' },
            { value: 'device', label: 'GitHub Device Flow', hint: 'requires a GitHub OAuth App Client ID' },
          ],
        });

        if (isCancel(method)) {
          process.exitCode = 1;
          return;
        }

        if (method === 'pat') {
          const input = await password({
            message: 'Paste your GitHub Personal Access Token:',
            validate(val) {
              if (!val || val.trim().length === 0) return 'Token is required.';
            },
          });
          if (isCancel(input)) {
            process.exitCode = 1;
            return;
          }
          token = String(input).trim();
        } else {
          const input = await text({
            message: 'Enter your GitHub OAuth App Client ID:',
            placeholder: 'e.g. Ov23li...',
            validate(val) {
              if (!val || val.trim().length === 0) return 'Client ID is required.';
            },
          });
          if (isCancel(input)) {
            process.exitCode = 1;
            return;
          }
          clientId = String(input).trim();
        }
      }

      if (token.length > 0) {
        const s = spinner();
        s.start('Validating GitHub token...');
        try {
          const cred = await loginWithGitHubToken(token);
          s.stop(`Authenticated as ${cred.user?.login ?? 'GitHub user'}!`);
          if (options.json === true) {
            console.log(JSON.stringify({ version: 1, status: 'logged-in', credential: cred }, null, 2));
          } else {
            console.log(`auth\tlogged-in\tprovider=github\tuser=${cred.user?.login ?? 'unknown'}\tscopes=${cred.scopes?.join(',') ?? 'none'}`);
          }
          return;
        } catch (error) {
          s.stop('Authentication failed.');
          throw error;
        }
      }

      // Device Flow with clientId
      const scopes = options.scopes ?? ['repo', 'read:user'];
      const device = await requestGitHubDeviceCode({ clientId, scopes });

      console.log('\n! Copy your one-time GitHub device code:');
      console.log(`\n    ${device.user_code}\n`);
      console.log(`Verification URL: ${device.verification_uri}`);

      if (options.browser !== false) {
        openUrlInBrowser(device.verification_uri);
      }

      const s = spinner();
      s.start('Waiting for GitHub authorization in your browser...');
      try {
        const tokenRes = await pollGitHubDeviceToken(device.device_code, {
          clientId: clientId!,
          interval: device.interval,
          expiresIn: device.expires_in,
        });

        const cred = await loginWithGitHubToken(tokenRes.access_token);
        s.stop(`Authorization approved! Authenticated as ${cred.user?.login ?? 'GitHub user'}.`);
        if (options.json === true) {
          console.log(JSON.stringify({ version: 1, status: 'logged-in', credential: cred }, null, 2));
        } else {
          console.log(`auth\tlogged-in\tprovider=github\tuser=${cred.user?.login ?? 'unknown'}\tscopes=${cred.scopes?.join(',') ?? 'none'}`);
        }
      } catch (error) {
        s.stop('Authorization failed or timed out.');
        throw error;
      }
    });

  auth
    .command('status')
    .description('Check authentication status')
    .argument('[provider]', 'OAuth provider name')
    .option('--json', 'print machine-readable JSON output')
    .action(async (provider: string | undefined, options: { json?: boolean }) => {
      if (provider !== undefined) {
        const cred = await readCredential(provider.toLowerCase());
        if (options.json === true) {
          console.log(JSON.stringify({
            version: 1,
            provider: provider.toLowerCase(),
            authenticated: cred !== null,
            credential: cred,
          }, null, 2));
          return;
        }
        if (cred === null) {
          console.log(`auth\t${provider.toLowerCase()}\tnot-authenticated`);
          process.exitCode = 1;
        } else {
          console.log(`auth\t${cred.provider}\tauthenticated\tuser=${cred.user?.login ?? 'unknown'}\tscopes=${cred.scopes?.join(',') ?? 'none'}\tupdated=${cred.updatedAt}`);
        }
        return;
      }

      const all = await listCredentials();
      if (options.json === true) {
        console.log(JSON.stringify({ version: 1, credentials: all }, null, 2));
        return;
      }
      if (all.length === 0) {
        console.log('No credentials configured. Run `reglet auth login github` to log in.');
        return;
      }
      for (const cred of all) {
        console.log(`${cred.provider}\tauthenticated\tuser=${cred.user?.login ?? 'unknown'}\tscopes=${cred.scopes?.join(',') ?? 'none'}\tupdated=${cred.updatedAt}`);
      }
    });

  auth
    .command('list')
    .description('List all active credentials')
    .option('--json', 'print machine-readable JSON output')
    .action(async (options: { json?: boolean }) => {
      const all = await listCredentials();
      if (options.json === true) {
        console.log(JSON.stringify({ version: 1, credentials: all }, null, 2));
        return;
      }
      if (all.length === 0) {
        console.log('No credentials configured.');
        return;
      }
      for (const cred of all) {
        console.log(`${cred.provider}\tauthenticated\tuser=${cred.user?.login ?? 'unknown'}\tscopes=${cred.scopes?.join(',') ?? 'none'}\tupdated=${cred.updatedAt}`);
      }
    });

  auth
    .command('logout')
    .description('Log out and remove credential for a provider')
    .argument('<provider>', 'OAuth provider name')
    .option('-y, --yes', 'skip confirmation prompt')
    .option('--json', 'print machine-readable JSON output')
    .action(async (provider: string, options: { yes?: boolean; json?: boolean }) => {
      const normalized = provider.toLowerCase();
      const existed = await deleteCredential(normalized);
      if (options.json === true) {
        console.log(JSON.stringify({ version: 1, provider: normalized, status: existed ? 'logged-out' : 'not-found' }, null, 2));
        return;
      }
      if (!existed) {
        console.log(`auth\t${normalized}\tnot-found\tno active credential was stored`);
      } else {
        console.log(`auth\t${normalized}\tlogged-out`);
      }
    });
}

function openUrlInBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  try {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Ignore if desktop browser opener is unavailable
  }
}
