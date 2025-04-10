import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  optimizeDeps: {
    include: ['jszip', 'fast-xml-parser', 'xml2js']  // 添加XML解析库
  },
  build: {
    commonjsOptions: {
      include: [/jszip/, /node_modules/, /fast-xml-parser/, /xml2js/]  // 添加XML解析库
    }
  },
  server: {
    fs: {
      strict: false
    }
  }
});