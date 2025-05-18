import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
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
      allow: ['src']
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cross-Origin-Isolation': 'require-corp'
    },
    proxy: {
      '/@ffmpeg': {
        target: 'https://unpkg.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/@ffmpeg/, '/@ffmpeg'),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            proxyReq.setHeader('Origin', 'https://unpkg.com');
          });
        }
      },
      '/wx': {
        target: 'https://res.wx.qq.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/wx/, ''),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            proxyReq.setHeader('Origin', 'https://res.wx.qq.com');
            proxyReq.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          });
        },
        onProxyRes: (proxyRes, req, res) => {
          proxyRes.headers['cross-origin-resource-policy'] = 'cross-origin';
          proxyRes.headers['access-control-allow-origin'] = '*';
          proxyRes.headers['access-control-allow-methods'] = 'GET, OPTIONS';
          proxyRes.headers['access-control-allow-headers'] = 'Content-Type';
          proxyRes.headers['cross-origin-embedder-policy'] = 'require-corp';
          proxyRes.headers['cross-origin-opener-policy'] = 'same-origin';
          proxyRes.headers['cross-origin-isolation'] = 'require-corp';
        }
      }
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
  assetsInclude: ['**/*.woff2', '**/*.woff', '**/*.ttf', '**/*.eot', '**/*.otf']
});