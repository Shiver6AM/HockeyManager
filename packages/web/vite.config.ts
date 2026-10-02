import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Allow sharing the dev server through a tunnel (localtunnel, Tailscale, ngrok…).
    allowedHosts: true,
    proxy: { '/trpc': 'http://localhost:3001', '/api': 'http://localhost:3001' },
  },
});
