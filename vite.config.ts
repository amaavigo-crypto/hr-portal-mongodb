import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        // On Vercel, static files beat rewrites, so a built index.html would always answer "/" and the landing pages could not be
        // pre-rendered for search engines. Rename it; vercel.json points the app fallback at app-shell.html and sends landing paths to
        // /api/landing. Does nothing outside Vercel (the Node server reads dist/index.html).
        name: 'vercel-app-shell',
        apply: 'build' as const,
        closeBundle() {
          if (!process.env.VERCEL) return;
          const from = path.resolve(__dirname, 'dist/index.html');
          if (fs.existsSync(from)) fs.renameSync(from, path.resolve(__dirname, 'dist/app-shell.html'));
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
