import React from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopManager } from './DesktopManager.js';
import '@reglet/manager-ui/styles.css';
import './desktop-shell.css';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Missing root element');
}

createRoot(root).render(
  <React.StrictMode>
    <DesktopManager />
  </React.StrictMode>,
);
