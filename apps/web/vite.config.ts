import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  resolve: {
    alias: {
      // Consume the shared package's TypeScript source directly: Vite compiles it,
      // avoiding CJS interop issues with the package's dist build (used by the API).
      '@pulsar/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Local dev: forward API calls to the NestJS server.
      '/api': 'http://localhost:3000',
    },
  },
});
