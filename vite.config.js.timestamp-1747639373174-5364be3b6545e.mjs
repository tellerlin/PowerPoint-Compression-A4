// vite.config.js
import { sveltekit } from "file:///C:/Users/I041705/Documents/GitHub/PowerPoint-Compression-A4/node_modules/@sveltejs/kit/src/exports/vite/index.js";
import { defineConfig } from "file:///C:/Users/I041705/Documents/GitHub/PowerPoint-Compression-A4/node_modules/vite/dist/node/index.js";
var noncePlugin = () => {
  return {
    name: "vite:nonce-injection"
    // 保留插件以避免其他代码依赖它，但不执行任何CSP相关操作
  };
};
var vite_config_default = defineConfig({
  plugins: [sveltekit(), noncePlugin()],
  worker: {
    format: "es",
    plugins: []
  },
  optimizeDeps: {
    exclude: [
      "@ffmpeg/ffmpeg",
      "@ffmpeg/util",
      "jszip",
      "strnum",
      "fast-xml-parser",
      "xml2js"
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
            "/src/lib/utils/image.js",
            "/src/lib/utils/file.js"
          ]
        }
      }
    }
  },
  server: {
    fs: {
      strict: false,
      allow: ["src"]
    },
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Cross-Origin-Isolation": "require-corp"
      // CSP头已移除
    },
    proxy: {
      "/@ffmpeg": {
        target: "https://unpkg.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/@ffmpeg/, "/@ffmpeg"),
        configure: (proxy, _options) => {
          proxy.on("proxyReq", (proxyReq, req, _res) => {
            proxyReq.setHeader("Origin", "https://unpkg.com");
          });
        }
      },
      "/wx": {
        target: "https://res.wx.qq.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/wx/, ""),
        configure: (proxy, _options) => {
          proxy.on("proxyReq", (proxyReq, req, _res) => {
            proxyReq.setHeader("Origin", "https://res.wx.qq.com");
            proxyReq.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
          });
        },
        onProxyRes: (proxyRes, req, res) => {
          proxyRes.headers["cross-origin-resource-policy"] = "cross-origin";
          proxyRes.headers["access-control-allow-origin"] = "*";
          proxyRes.headers["access-control-allow-methods"] = "GET, OPTIONS";
          proxyRes.headers["access-control-allow-headers"] = "Content-Type";
          proxyRes.headers["cross-origin-embedder-policy"] = "require-corp";
          proxyRes.headers["cross-origin-opener-policy"] = "same-origin";
          proxyRes.headers["cross-origin-isolation"] = "require-corp";
        }
      }
    }
  },
  ssr: {
    noExternal: ["fast-xml-parser"],
    external: ["@ffmpeg/ffmpeg", "@ffmpeg/util"]
  },
  preview: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Cross-Origin-Isolation": "require-corp"
      // CSP头已移除
    }
  },
  assetsInclude: ["**/*.woff2", "**/*.woff", "**/*.ttf", "**/*.eot", "**/*.otf"]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxJMDQxNzA1XFxcXERvY3VtZW50c1xcXFxHaXRIdWJcXFxcUG93ZXJQb2ludC1Db21wcmVzc2lvbi1BNFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiQzpcXFxcVXNlcnNcXFxcSTA0MTcwNVxcXFxEb2N1bWVudHNcXFxcR2l0SHViXFxcXFBvd2VyUG9pbnQtQ29tcHJlc3Npb24tQTRcXFxcdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L1VzZXJzL0kwNDE3MDUvRG9jdW1lbnRzL0dpdEh1Yi9Qb3dlclBvaW50LUNvbXByZXNzaW9uLUE0L3ZpdGUuY29uZmlnLmpzXCI7aW1wb3J0IHsgc3ZlbHRla2l0IH0gZnJvbSAnQHN2ZWx0ZWpzL2tpdC92aXRlJztcclxuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XHJcblxyXG4vLyBcdTc1MzFcdTRFOEVcdTRFMERcdTUxOERcdTk3MDBcdTg5ODFDU1BcdUZGMENcdTYyMTFcdTRFRUNcdTUzRUZcdTRFRTVcdTdCODBcdTUzMTZcdTYyMTZcdTc5RkJcdTk2NjRcdTZCNjRcdTYzRDJcdTRFRjZcclxuY29uc3Qgbm9uY2VQbHVnaW4gPSAoKSA9PiB7XHJcbiAgcmV0dXJuIHtcclxuICAgIG5hbWU6ICd2aXRlOm5vbmNlLWluamVjdGlvbicsXHJcbiAgICAvLyBcdTRGRERcdTc1NTlcdTYzRDJcdTRFRjZcdTRFRTVcdTkwN0ZcdTUxNERcdTUxNzZcdTRFRDZcdTRFRTNcdTc4MDFcdTRGOURcdThENTZcdTVCODNcdUZGMENcdTRGNDZcdTRFMERcdTYyNjdcdTg4NENcdTRFRkJcdTRGNTVDU1BcdTc2RjhcdTUxNzNcdTY0Q0RcdTRGNUNcclxuICB9O1xyXG59O1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcclxuICBwbHVnaW5zOiBbc3ZlbHRla2l0KCksIG5vbmNlUGx1Z2luKCldLFxyXG4gIHdvcmtlcjoge1xyXG4gICAgZm9ybWF0OiAnZXMnLFxyXG4gICAgcGx1Z2luczogW11cclxuICB9LFxyXG4gIG9wdGltaXplRGVwczoge1xyXG4gICAgZXhjbHVkZTogW1xyXG4gICAgICAnQGZmbXBlZy9mZm1wZWcnLFxyXG4gICAgICAnQGZmbXBlZy91dGlsJyxcclxuICAgICAgJ2pzemlwJyxcclxuICAgICAgJ3N0cm51bScsXHJcbiAgICAgICdmYXN0LXhtbC1wYXJzZXInLFxyXG4gICAgICAneG1sMmpzJ1xyXG4gICAgXVxyXG4gIH0sXHJcbiAgYnVpbGQ6IHtcclxuICAgIGNvbW1vbmpzT3B0aW9uczoge1xyXG4gICAgICBpbmNsdWRlOiBbL2pzemlwLywgL25vZGVfbW9kdWxlcy8sIC9mYXN0LXhtbC1wYXJzZXIvLCAveG1sMmpzL11cclxuICAgIH0sXHJcbiAgICBzb3VyY2VtYXA6IHtcclxuICAgICAgZXhjbHVkZTogWy9mZm1wZWcvXVxyXG4gICAgfSxcclxuICAgIHJvbGx1cE9wdGlvbnM6IHtcclxuICAgICAgb3V0cHV0OiB7XHJcbiAgICAgICAgbWFudWFsQ2h1bmtzOiB7XHJcbiAgICAgICAgICB1dGlsczogW1xyXG4gICAgICAgICAgICAnL3NyYy9saWIvdXRpbHMvaW1hZ2UuanMnLFxyXG4gICAgICAgICAgICAnL3NyYy9saWIvdXRpbHMvZmlsZS5qcydcclxuICAgICAgICAgIF1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9LFxyXG4gIHNlcnZlcjoge1xyXG4gICAgZnM6IHtcclxuICAgICAgc3RyaWN0OiBmYWxzZSxcclxuICAgICAgYWxsb3c6IFsnc3JjJ11cclxuICAgIH0sXHJcbiAgICBoZWFkZXJzOiB7XHJcbiAgICAgICdDcm9zcy1PcmlnaW4tRW1iZWRkZXItUG9saWN5JzogJ3JlcXVpcmUtY29ycCcsXHJcbiAgICAgICdDcm9zcy1PcmlnaW4tT3BlbmVyLVBvbGljeSc6ICdzYW1lLW9yaWdpbicsXHJcbiAgICAgICdDcm9zcy1PcmlnaW4tUmVzb3VyY2UtUG9saWN5JzogJ2Nyb3NzLW9yaWdpbicsXHJcbiAgICAgICdDcm9zcy1PcmlnaW4tSXNvbGF0aW9uJzogJ3JlcXVpcmUtY29ycCdcclxuICAgICAgLy8gQ1NQXHU1OTM0XHU1REYyXHU3OUZCXHU5NjY0XHJcbiAgICB9LFxyXG4gICAgcHJveHk6IHtcclxuICAgICAgJy9AZmZtcGVnJzoge1xyXG4gICAgICAgIHRhcmdldDogJ2h0dHBzOi8vdW5wa2cuY29tJyxcclxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgcmV3cml0ZTogKHBhdGgpID0+IHBhdGgucmVwbGFjZSgvXlxcL0BmZm1wZWcvLCAnL0BmZm1wZWcnKSxcclxuICAgICAgICBjb25maWd1cmU6IChwcm94eSwgX29wdGlvbnMpID0+IHtcclxuICAgICAgICAgIHByb3h5Lm9uKCdwcm94eVJlcScsIChwcm94eVJlcSwgcmVxLCBfcmVzKSA9PiB7XHJcbiAgICAgICAgICAgIHByb3h5UmVxLnNldEhlYWRlcignT3JpZ2luJywgJ2h0dHBzOi8vdW5wa2cuY29tJyk7XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgIH0sXHJcbiAgICAgICcvd3gnOiB7XHJcbiAgICAgICAgdGFyZ2V0OiAnaHR0cHM6Ly9yZXMud3gucXEuY29tJyxcclxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgcmV3cml0ZTogKHBhdGgpID0+IHBhdGgucmVwbGFjZSgvXlxcL3d4LywgJycpLFxyXG4gICAgICAgIGNvbmZpZ3VyZTogKHByb3h5LCBfb3B0aW9ucykgPT4ge1xyXG4gICAgICAgICAgcHJveHkub24oJ3Byb3h5UmVxJywgKHByb3h5UmVxLCByZXEsIF9yZXMpID0+IHtcclxuICAgICAgICAgICAgcHJveHlSZXEuc2V0SGVhZGVyKCdPcmlnaW4nLCAnaHR0cHM6Ly9yZXMud3gucXEuY29tJyk7XHJcbiAgICAgICAgICAgIHByb3h5UmVxLnNldEhlYWRlcignQ3Jvc3MtT3JpZ2luLVJlc291cmNlLVBvbGljeScsICdjcm9zcy1vcmlnaW4nKTtcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb25Qcm94eVJlczogKHByb3h5UmVzLCByZXEsIHJlcykgPT4ge1xyXG4gICAgICAgICAgcHJveHlSZXMuaGVhZGVyc1snY3Jvc3Mtb3JpZ2luLXJlc291cmNlLXBvbGljeSddID0gJ2Nyb3NzLW9yaWdpbic7XHJcbiAgICAgICAgICBwcm94eVJlcy5oZWFkZXJzWydhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW4nXSA9ICcqJztcclxuICAgICAgICAgIHByb3h5UmVzLmhlYWRlcnNbJ2FjY2Vzcy1jb250cm9sLWFsbG93LW1ldGhvZHMnXSA9ICdHRVQsIE9QVElPTlMnO1xyXG4gICAgICAgICAgcHJveHlSZXMuaGVhZGVyc1snYWNjZXNzLWNvbnRyb2wtYWxsb3ctaGVhZGVycyddID0gJ0NvbnRlbnQtVHlwZSc7XHJcbiAgICAgICAgICBwcm94eVJlcy5oZWFkZXJzWydjcm9zcy1vcmlnaW4tZW1iZWRkZXItcG9saWN5J10gPSAncmVxdWlyZS1jb3JwJztcclxuICAgICAgICAgIHByb3h5UmVzLmhlYWRlcnNbJ2Nyb3NzLW9yaWdpbi1vcGVuZXItcG9saWN5J10gPSAnc2FtZS1vcmlnaW4nO1xyXG4gICAgICAgICAgcHJveHlSZXMuaGVhZGVyc1snY3Jvc3Mtb3JpZ2luLWlzb2xhdGlvbiddID0gJ3JlcXVpcmUtY29ycCc7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfSxcclxuICBzc3I6IHtcclxuICAgIG5vRXh0ZXJuYWw6IFsnZmFzdC14bWwtcGFyc2VyJ10sXHJcbiAgICBleHRlcm5hbDogWydAZmZtcGVnL2ZmbXBlZycsICdAZmZtcGVnL3V0aWwnXVxyXG4gIH0sXHJcbiAgcHJldmlldzoge1xyXG4gICAgaGVhZGVyczoge1xyXG4gICAgICAnQ3Jvc3MtT3JpZ2luLUVtYmVkZGVyLVBvbGljeSc6ICdyZXF1aXJlLWNvcnAnLFxyXG4gICAgICAnQ3Jvc3MtT3JpZ2luLU9wZW5lci1Qb2xpY3knOiAnc2FtZS1vcmlnaW4nLFxyXG4gICAgICAnQ3Jvc3MtT3JpZ2luLVJlc291cmNlLVBvbGljeSc6ICdjcm9zcy1vcmlnaW4nLFxyXG4gICAgICAnQ3Jvc3MtT3JpZ2luLUlzb2xhdGlvbic6ICdyZXF1aXJlLWNvcnAnXHJcbiAgICAgIC8vIENTUFx1NTkzNFx1NURGMlx1NzlGQlx1OTY2NFxyXG4gICAgfVxyXG4gIH0sXHJcbiAgYXNzZXRzSW5jbHVkZTogWycqKi8qLndvZmYyJywgJyoqLyoud29mZicsICcqKi8qLnR0ZicsICcqKi8qLmVvdCcsICcqKi8qLm90ZiddXHJcbn0pOyJdLAogICJtYXBwaW5ncyI6ICI7QUFBK1csU0FBUyxpQkFBaUI7QUFDelksU0FBUyxvQkFBb0I7QUFHN0IsSUFBTSxjQUFjLE1BQU07QUFDeEIsU0FBTztBQUFBLElBQ0wsTUFBTTtBQUFBO0FBQUEsRUFFUjtBQUNGO0FBRUEsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLFVBQVUsR0FBRyxZQUFZLENBQUM7QUFBQSxFQUNwQyxRQUFRO0FBQUEsSUFDTixRQUFRO0FBQUEsSUFDUixTQUFTLENBQUM7QUFBQSxFQUNaO0FBQUEsRUFDQSxjQUFjO0FBQUEsSUFDWixTQUFTO0FBQUEsTUFDUDtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLGlCQUFpQjtBQUFBLE1BQ2YsU0FBUyxDQUFDLFNBQVMsZ0JBQWdCLG1CQUFtQixRQUFRO0FBQUEsSUFDaEU7QUFBQSxJQUNBLFdBQVc7QUFBQSxNQUNULFNBQVMsQ0FBQyxRQUFRO0FBQUEsSUFDcEI7QUFBQSxJQUNBLGVBQWU7QUFBQSxNQUNiLFFBQVE7QUFBQSxRQUNOLGNBQWM7QUFBQSxVQUNaLE9BQU87QUFBQSxZQUNMO0FBQUEsWUFDQTtBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixJQUFJO0FBQUEsTUFDRixRQUFRO0FBQUEsTUFDUixPQUFPLENBQUMsS0FBSztBQUFBLElBQ2Y7QUFBQSxJQUNBLFNBQVM7QUFBQSxNQUNQLGdDQUFnQztBQUFBLE1BQ2hDLDhCQUE4QjtBQUFBLE1BQzlCLGdDQUFnQztBQUFBLE1BQ2hDLDBCQUEwQjtBQUFBO0FBQUEsSUFFNUI7QUFBQSxJQUNBLE9BQU87QUFBQSxNQUNMLFlBQVk7QUFBQSxRQUNWLFFBQVE7QUFBQSxRQUNSLGNBQWM7QUFBQSxRQUNkLFNBQVMsQ0FBQyxTQUFTLEtBQUssUUFBUSxjQUFjLFVBQVU7QUFBQSxRQUN4RCxXQUFXLENBQUMsT0FBTyxhQUFhO0FBQzlCLGdCQUFNLEdBQUcsWUFBWSxDQUFDLFVBQVUsS0FBSyxTQUFTO0FBQzVDLHFCQUFTLFVBQVUsVUFBVSxtQkFBbUI7QUFBQSxVQUNsRCxDQUFDO0FBQUEsUUFDSDtBQUFBLE1BQ0Y7QUFBQSxNQUNBLE9BQU87QUFBQSxRQUNMLFFBQVE7QUFBQSxRQUNSLGNBQWM7QUFBQSxRQUNkLFNBQVMsQ0FBQyxTQUFTLEtBQUssUUFBUSxTQUFTLEVBQUU7QUFBQSxRQUMzQyxXQUFXLENBQUMsT0FBTyxhQUFhO0FBQzlCLGdCQUFNLEdBQUcsWUFBWSxDQUFDLFVBQVUsS0FBSyxTQUFTO0FBQzVDLHFCQUFTLFVBQVUsVUFBVSx1QkFBdUI7QUFDcEQscUJBQVMsVUFBVSxnQ0FBZ0MsY0FBYztBQUFBLFVBQ25FLENBQUM7QUFBQSxRQUNIO0FBQUEsUUFDQSxZQUFZLENBQUMsVUFBVSxLQUFLLFFBQVE7QUFDbEMsbUJBQVMsUUFBUSw4QkFBOEIsSUFBSTtBQUNuRCxtQkFBUyxRQUFRLDZCQUE2QixJQUFJO0FBQ2xELG1CQUFTLFFBQVEsOEJBQThCLElBQUk7QUFDbkQsbUJBQVMsUUFBUSw4QkFBOEIsSUFBSTtBQUNuRCxtQkFBUyxRQUFRLDhCQUE4QixJQUFJO0FBQ25ELG1CQUFTLFFBQVEsNEJBQTRCLElBQUk7QUFDakQsbUJBQVMsUUFBUSx3QkFBd0IsSUFBSTtBQUFBLFFBQy9DO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxLQUFLO0FBQUEsSUFDSCxZQUFZLENBQUMsaUJBQWlCO0FBQUEsSUFDOUIsVUFBVSxDQUFDLGtCQUFrQixjQUFjO0FBQUEsRUFDN0M7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLFNBQVM7QUFBQSxNQUNQLGdDQUFnQztBQUFBLE1BQ2hDLDhCQUE4QjtBQUFBLE1BQzlCLGdDQUFnQztBQUFBLE1BQ2hDLDBCQUEwQjtBQUFBO0FBQUEsSUFFNUI7QUFBQSxFQUNGO0FBQUEsRUFDQSxlQUFlLENBQUMsY0FBYyxhQUFhLFlBQVksWUFBWSxVQUFVO0FBQy9FLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
