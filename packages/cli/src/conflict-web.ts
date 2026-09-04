import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  inspectSyncV2Conflict,
  listSyncV2Conflicts,
  regletHome,
  resolveSyncV2Conflict,
} from '@reglet/core';

function openUrlInBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  try {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

export async function runConflictWebGui(
  options: { port?: number; openBrowser?: boolean } = {},
  home = regletHome(),
): Promise<void> {
  const initialConflicts = await listSyncV2Conflicts(home);
  if (initialConflicts.length === 0) {
    console.log('✓ No sync conflicts detected.');
    return;
  }

  const sessionToken = randomBytes(16).toString('hex');
  let shutdownResolver: () => void;
  const shutdownPromise = new Promise<void>((resolve) => {
    shutdownResolver = resolve;
  });

  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === '/') {
        return new Response(generateConflictHtml(sessionToken), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      if (url.pathname === '/api/conflicts') {
        const token = url.searchParams.get('token');
        if (token !== sessionToken) {
          return new Response('Unauthorized', { status: 401 });
        }
        const conflicts = await listSyncV2Conflicts(home);
        const details = await Promise.all(
          conflicts.map(async (c) => {
            try {
              const preview = await inspectSyncV2Conflict(c.canonicalPath, home);
              return {
                canonicalPath: c.canonicalPath,
                conflictPath: c.conflictPath,
                local: preview.local,
                remote: preview.remote,
              };
            } catch (err) {
              return {
                canonicalPath: c.canonicalPath,
                conflictPath: c.conflictPath,
                error: err instanceof Error ? err.message : String(err),
                local: { state: 'error', content: null, size: 0, hash: null },
                remote: { state: 'error', content: null, size: 0, hash: null },
              };
            }
          }),
        );
        return Response.json({ conflicts: details });
      }

      if (url.pathname === '/api/resolve' && req.method === 'POST') {
        try {
          const body = (await req.json()) as { token?: string; path?: string; choice?: 'ours' | 'theirs' };
          if (body.token !== sessionToken) {
            return new Response('Unauthorized', { status: 401 });
          }
          if (!body.path || !body.choice || (body.choice !== 'ours' && body.choice !== 'theirs')) {
            return new Response('Invalid request', { status: 400 });
          }
          await resolveSyncV2Conflict(body.path, body.choice, home);
          const remaining = await listSyncV2Conflicts(home);
          if (remaining.length === 0) {
            setTimeout(() => {
              shutdownResolver();
            }, 2000);
          }
          return Response.json({ success: true, remaining: remaining.length });
        } catch (err) {
          return new Response(err instanceof Error ? err.message : String(err), { status: 500 });
        }
      }

      if (url.pathname === '/api/shutdown' && req.method === 'POST') {
        const body = (await req.json()) as { token?: string };
        if (body.token === sessionToken) {
          setTimeout(() => shutdownResolver(), 100);
          return Response.json({ status: 'shutting down' });
        }
        return new Response('Unauthorized', { status: 401 });
      }

      return new Response('Not Found', { status: 404 });
    },
  });

  const appUrl = `http://127.0.0.1:${server.port}/?token=${sessionToken}`;
  console.log(`\n🚀 Conflict Resolution Web GUI is running at:`);
  console.log(`   ${appUrl}\n`);
  console.log(`Resolving ${initialConflicts.length} conflict(s). Press Ctrl+C anytime to cancel.\n`);

  if (options.openBrowser !== false) {
    openUrlInBrowser(appUrl);
  }

  await shutdownPromise;
  server.stop(true);
  console.log('✓ All conflicts resolved! Run "reglet sync" to push your changes to the vault.\n');
}

function generateConflictHtml(token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reglet Conflict Resolver</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --accent-hover: #79c0ff;
      --ours-btn: #238636;
      --ours-hover: #2ea043;
      --theirs-btn: #8957e5;
      --theirs-hover: #a371f7;
      --diff-add: rgba(46, 160, 67, 0.15);
      --diff-del: rgba(248, 81, 73, 0.15);
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      background: var(--card-bg);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 600;
      font-size: 1.1rem;
    }
    .logo-badge {
      background: #1f6feb;
      color: white;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .status-counter {
      color: var(--text-muted);
      font-size: 0.9rem;
    }
    .layout {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .sidebar {
      width: 280px;
      border-right: 1px solid var(--border);
      background: var(--card-bg);
      display: flex;
      flex-direction: column;
    }
    .sidebar-title {
      padding: 16px;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
    }
    .file-list {
      flex: 1;
      overflow-y: auto;
      list-style: none;
    }
    .file-item {
      padding: 12px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.85rem;
      font-family: var(--font-mono);
      transition: background 0.15s;
    }
    .file-item:hover { background: rgba(255,255,255,0.04); }
    .file-item.active { background: rgba(88, 166, 255, 0.15); border-left: 3px solid var(--accent); }
    .file-item.resolved { color: var(--text-muted); text-decoration: line-through; }
    .check { color: #3fb950; margin-left: 8px; }
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .action-bar {
      padding: 16px 24px;
      background: var(--card-bg);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .active-file-title {
      font-family: var(--font-mono);
      font-weight: 600;
      font-size: 1rem;
    }
    .btn-group { display: flex; gap: 12px; }
    button {
      cursor: pointer;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 8px 16px;
      font-weight: 600;
      font-size: 0.85rem;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s ease;
    }
    .btn-ours { background: var(--ours-btn); color: white; }
    .btn-ours:hover { background: var(--ours-hover); }
    .btn-theirs { background: var(--theirs-btn); color: white; }
    .btn-theirs:hover { background: var(--theirs-hover); }
    .split-view {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    .pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-right: 1px solid var(--border);
    }
    .pane:last-child { border-right: none; }
    .pane-header {
      padding: 10px 16px;
      background: rgba(255,255,255,0.02);
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      font-size: 0.85rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .pane-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      font-family: var(--font-mono);
      font-size: 0.82rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .empty-message {
      padding: 40px;
      text-align: center;
      color: var(--text-muted);
    }
    .done-banner {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 16px;
      padding: 40px;
    }
    .done-icon { font-size: 48px; }
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #238636;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      display: none;
      font-weight: 500;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">
      <span>Reglet</span>
      <span class="logo-badge">Conflict Resolver</span>
    </div>
    <div class="status-counter" id="counter">Loading...</div>
  </header>
  <div class="layout">
    <div class="sidebar">
      <div class="sidebar-title">Conflicted Files</div>
      <ul class="file-list" id="fileList"></ul>
    </div>
    <div class="main" id="mainArea">
      <div class="empty-message">Select a conflict to resolve...</div>
    </div>
  </div>
  <div class="toast" id="toast"></div>

  <script>
    const token = ${JSON.stringify(token)};
    let conflicts = [];
    let activeIndex = 0;

    async function loadConflicts() {
      const res = await fetch('/api/conflicts?token=' + token);
      const data = await res.json();
      conflicts = data.conflicts || [];
      render();
    }

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.innerText = msg;
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 2000);
    }

    async function resolve(choice) {
      const current = conflicts[activeIndex];
      if (!current) return;

      const res = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, path: current.canonicalPath, choice })
      });

      if (res.ok) {
        showToast('✓ Resolved ' + current.canonicalPath + ' (' + choice + ')');
        current.resolved = true;
        current.choice = choice;
        // Advance to next unresolved
        let next = conflicts.findIndex(c => !c.resolved);
        if (next !== -1) {
          activeIndex = next;
        }
        render();
      } else {
        alert('Failed to resolve: ' + await res.text());
      }
    }

    function render() {
      const counter = document.getElementById('counter');
      const unresolvedCount = conflicts.filter(c => !c.resolved).length;
      counter.innerText = unresolvedCount + ' conflict(s) remaining';

      const fileList = document.getElementById('fileList');
      fileList.innerHTML = '';
      conflicts.forEach((c, i) => {
        const li = document.createElement('li');
        li.className = 'file-item' + (i === activeIndex ? ' active' : '') + (c.resolved ? ' resolved' : '');
        li.innerHTML = '<span>' + c.canonicalPath + '</span>' + (c.resolved ? '<span class="check">✓</span>' : '');
        li.onclick = () => { activeIndex = i; render(); };
        fileList.appendChild(li);
      });

      const main = document.getElementById('mainArea');
      if (unresolvedCount === 0) {
        main.innerHTML = \`
          <div class="done-banner">
            <div class="done-icon">🎉</div>
            <h2>All Conflicts Resolved!</h2>
            <p style="color: var(--text-muted)">Your local library files have been updated.</p>
            <p style="color: var(--text-muted)">You can now close this tab and run <code>reglet sync</code> to push to your vault.</p>
          </div>
        \`;
        return;
      }

      const current = conflicts[activeIndex];
      if (!current) return;

      main.innerHTML = \`
        <div class="action-bar">
          <div class="active-file-title">\${current.canonicalPath}</div>
          <div class="btn-group">
            <button class="btn-ours" onclick="resolve('ours')">
              <span>✓ Keep Local (Ours)</span>
            </button>
            <button class="btn-theirs" onclick="resolve('theirs')">
              <span>Accept Remote (Theirs) →</span>
            </button>
          </div>
        </div>
        <div class="split-view">
          <div class="pane">
            <div class="pane-header">
              <span>Local Copy (Ours)</span>
              <span style="color: var(--text-muted); font-size: 0.75rem">\${current.local.state}</span>
            </div>
            <div class="pane-body">\${escapeHtml(current.local.content || '[Empty or Non-text content]')}</div>
          </div>
          <div class="pane">
            <div class="pane-header">
              <span>Incoming Vault Copy (Theirs)</span>
              <span style="color: var(--text-muted); font-size: 0.75rem">\${current.remote.state}</span>
            </div>
            <div class="pane-body">\${escapeHtml(current.remote.content || '[Empty or Non-text content]')}</div>
          </div>
        </div>
      \`;
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    loadConflicts();
  </script>
</body>
</html>`;
}
