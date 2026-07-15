import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.js';
import { tauriBridge } from './managerBridge.js';
import './styles.css';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Missing root element');
}

createRoot(root).render(
  <React.StrictMode>
    <App bridge={tauriBridge} />
  </React.StrictMode>,
);
