import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  optimizeDeps: {
    include: ['jszip']
  },
  build: {
    commonjsOptions: {
      include: [/jszip/, /node_modules/]
    }
  },
  server: {
    fs: {
      strict: false
    }
  }
});