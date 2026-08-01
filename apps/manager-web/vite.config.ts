import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/manager/',
  plugins: [react()],
  clearScreen: false,
});
