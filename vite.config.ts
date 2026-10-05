import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.AGORA_API ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: API, changeOrigin: true } } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
});
