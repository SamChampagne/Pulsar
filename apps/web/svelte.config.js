import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // SPA mode: auth lives client-side (JWT). Revisit SSR when sessions/SSO land.
    adapter: adapter({ fallback: 'index.html' }),
  },
};

export default config;
