import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Stamped into every build. A public store map is asked for under it (see
// api.publicStore): the offline service worker keeps maps for 30 days and
// shows the saved one first, so without the stamp the first visit after a
// deploy would get the previous build's map — another layout, other shelf ids.
const BUILD_ID = String(Date.now());

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
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
