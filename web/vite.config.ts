import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', ws: true, changeOrigin: false } },
  },
});
