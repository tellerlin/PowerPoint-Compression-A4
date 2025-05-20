import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// 由于不再需要CSP，我们可以简化或移除此插件
const noncePlugin = () => {
  return {
    name: 'vite:nonce-injection',
    // 保留插件以避免其他代码依赖它，但不执行任何CSP相关操作
  };
};

export default defineConfig({
  plugins: [sveltekit(), noncePlugin()],
  worker: {
    format: 'es',
    plugins: []
  },
  optimizeDeps: {
    exclude: [
      '@ffmpeg/ffmpeg',
      '@ffmpeg/util',
      'jszip',
      'strnum',
      'fast-xml-parser',
      'xml2js'
    ]
  },
  build: {
    commonjsOptions: {
      include: [/jszip/, /node_modules/, /fast-xml-parser/, /xml2js/]
    },
    sourcemap: {
      exclude: [/ffmpeg/]
    },
    rollupOptions: {
      output: {
        manualChunks: {
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
      strict: false,
      allow: ['src', 'static']
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cross-Origin-Isolation': 'require-corp'
    }
  },
  ssr: {
    noExternal: ['fast-xml-parser'],
    external: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cross-Origin-Isolation': 'require-corp'
    }
  },
  assetsInclude: ['**/*.woff2', '**/*.woff', '**/*.ttf', '**/*.eot', '**/*.otf', '**/*.wasm']
});