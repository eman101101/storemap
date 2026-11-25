import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/uploads': 'http://localhost:8787',
      // demo product photos, served from the database
      '/media': 'http://localhost:8787',
    },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
});
