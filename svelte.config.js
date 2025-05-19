import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    csrf: {
      checkOrigin: true
    },
    csp: {
      mode: 'auto',
      directives: {}
    }
  },
  preprocess: vitePreprocess()
};

export default config;