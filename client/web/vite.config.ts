import { defineConfig } from 'vite';
import { resolve } from 'node:path';
// Two pages: the game (index.html) and the desktop app's hidden P2P engine (p2p.html, src/p2p/start.ts).
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200, rollupOptions: { input: { main: resolve(__dirname, 'index.html'), p2p: resolve(__dirname, 'p2p.html') } } },
});
