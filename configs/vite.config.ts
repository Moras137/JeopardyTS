// vite.config.ts
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, '../frontend'),
  build: {
    outDir: path.resolve(__dirname, '../output/public'),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, '../frontend/create.html'),
        host: path.resolve(__dirname, '../frontend/host.html'),
        board: path.resolve(__dirname, '../frontend/board.html'),
        player: path.resolve(__dirname, '../frontend/player.html'),
      },
    },
  },
  server: {
    host: true,
    proxy: {
      // Leitet API-Anfragen im Dev-Modus an dein Express-Backend weiter
      '/api': {
        target: 'http://127.0.0.1:3000'
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        ws: true
      },
      '/uploads': {
        target: 'http://127.0.0.1:3000'
      }
    }
  }
});