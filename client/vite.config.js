import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // Allow Cloudflare quick-tunnel hosts (https://*.trycloudflare.com) plus
    // LAN access (http://192.168.x.x:5173) for same-WiFi phone testing.
    host: true,
    allowedHosts: ['.trycloudflare.com'],
  },
  preview: {
    port: 4173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Leaflet is large; splitting it keeps the main bundle small.
    rollupOptions: {
      output: {
        manualChunks: {
          leaflet: ['leaflet', 'react-leaflet'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
