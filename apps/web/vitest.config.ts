import { fileURLToPath } from 'node:url';
import { defineConfig, configDefaults } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // Expose vi globally so mock files can use vi.fn() without import
    setupFiles: [],
    // Unit tests live under src/. The Playwright browser specs under e2e/ use
    // @playwright/test's own runner (`pnpm test:e2e`) and must NOT be collected
    // by Vitest — its `test.describe()` throws under the Vitest runtime.
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
  resolve: {
    alias: {
      // SvelteKit path aliases
      $lib: `${root}src/lib`,
      // $app/* — replace with hand-rolled stubs so tests don't need SvelteKit runtime
      '$app/navigation': `${root}src/__mocks__/$app/navigation.ts`,
      '$app/environment': `${root}src/__mocks__/$app/environment.ts`,
      '$app/stores': `${root}src/__mocks__/$app/stores.ts`,
      // Point @pulsar/shared at its TypeScript source (same trick as vite.config.ts)
      '@pulsar/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
});
