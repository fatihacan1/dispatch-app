import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The renderer only needs src/ watched. Ignore Electron main files, tests and runtime data so
// files being written by other tools (locked on Windows) can't crash the dev server (EBUSY).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    watch: {
      ignored: ['**/electron/**', '**/e2e/**', '**/test-results/**', '**/.dispatch/**', '**/.myarmy/**', '**/*.test.*', '**/*.spec.*', '**/dist/**', '**/release/**'],
    },
  },
});
