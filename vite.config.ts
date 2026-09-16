import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so GitHub Pages (/burqora-ops-dashboard/) and local/Vercel all load assets.
  base: './',
  server: {
    port: 5173,
  },
});
