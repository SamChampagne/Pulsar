import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Read API_PORT from the monorepo-root .env so the dev proxy follows the API,
  // wherever it binds. Defaults to 3000; some environments (e.g. a Windows host
  // whose winnat reserves the 2949-3048 range) move the API to another port.
  const env = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), '');
  const apiPort = env.API_PORT || '3000';
  return {
    plugins: [tailwindcss(), sveltekit()],
    resolve: {
      alias: {
        // Consume the shared package's TypeScript source directly: Vite compiles it,
        // avoiding CJS interop issues with the package's dist build (used by the API).
        '@pulsar/shared': fileURLToPath(
          new URL('../../packages/shared/src/index.ts', import.meta.url),
        ),
      },
    },
    server: {
      proxy: {
        // Local dev: forward API calls to the NestJS server (port follows API_PORT).
        '/api': `http://localhost:${apiPort}`,
      },
    },
    // `vite preview` (the static production bundle server, used by the CI
    // browser-e2e job when CI=true) does NOT inherit `server.proxy` — it has its
    // own `preview.proxy`. Without this, every `/api/v1/...` call from the SPA
    // would hit the preview server's SPA fallback and 200-with-index.html
    // instead of reaching the API, so all authenticated Playwright specs would
    // fail. Mirror the dev proxy so the same-origin `/api` contract holds under
    // preview too.
    preview: {
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
  };
});
