import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const backendPort = Number(process.env.PORT) || 3001;
  const hmrPort = Number(process.env.VITE_HMR_PORT) || 24678;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: 'localhost',
      port: backendPort,
      strictPort: true,
      hmr: process.env.DISABLE_HMR === 'true'
        ? false
        : {
            host: 'localhost',
            port: hmrPort,
          },
      // Never treat SQLite runtime files as source changes. In development the
      // live controller writes to data/fms.db-wal, which otherwise triggers a
      // full page reload even though no application source changed.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/*.db', '**/*.db-wal', '**/*.db-shm', '**/*.db-journal'],
      },
    },
  };
});
