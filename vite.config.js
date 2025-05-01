import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  optimizeDeps: {
    include: ['jszip', 'fast-xml-parser', 'xml2js']
  },
  build: {
    commonjsOptions: {
      include: [/jszip/, /node_modules/, /fast-xml-parser/, /xml2js/]
    },
    rollupOptions: {
      output: {
        manualChunks: {
          // parser: ['xml2js'], // 暂时移除 fast-xml-parser
          utils: [
            '/src/lib/utils/image.js',
            '/src/lib/utils/file.js'
          ]
        }
      }
    }
  },
  server: {
    fs: {
      strict: false
    }
  },
  ssr: {
    noExternal: ['fast-xml-parser']
  }
});