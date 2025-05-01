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
    // 添加代码分割和懒加载配置
    rollupOptions: {
      output: {
        manualChunks: {
          jszip: ['jszip'],
          parser: ['fast-xml-parser', 'xml2js'],
          utils: [
            // 将工具函数分组到单独的chunk
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
  }
});