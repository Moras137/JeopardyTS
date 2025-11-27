// vite.config.ts
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'frontend', // Unser Quellcode liegt hier
  build: {
    outDir: '../public', // Das Ziel ist der öffentliche Server-Ordner
    emptyOutDir: true,   // Löscht public vor jedem Build
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'frontend/create.html'),
        host: path.resolve(__dirname, 'frontend/host.html'),
        board: path.resolve(__dirname, 'frontend/board.html'),
        player: path.resolve(__dirname, 'frontend/player.html'),
      },
    },
  },
  server: {
    host: true,
    proxy: {
      // Leitet API-Anfragen im Dev-Modus an dein Express-Backend weiter
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      },
      '/uploads': 'http://localhost:3000'
    }
  }
});