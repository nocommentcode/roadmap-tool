import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5290,
    // Vite binds IPv6-only by default, so http://127.0.0.1:5290 refuses the
    // connection while localhost works. Bind v4 so both addresses resolve.
    host: '127.0.0.1',
    proxy: {
      // SSE passes through untouched — Vite's dev proxy does not buffer it.
      '/api': { target: 'http://127.0.0.1:5291', changeOrigin: true },
    },
  },
});
