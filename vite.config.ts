/// <reference types="vitest" />
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so GitHub Pages (/burqora-ops-dashboard/) and local/Vercel all load assets.
  base: './',
  server: {
    port: 5173,
  },
  // BUR-25: unit + component tests (mocked Supabase; no network).
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Pin a non-UTC zone so tests prove the code never depends on the browser's own zone.
    env: {TZ: 'Pacific/Auckland'},
  },
});
