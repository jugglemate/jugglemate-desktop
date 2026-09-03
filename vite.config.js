import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE !== undefined ? env.VITE_BASE : './'

  return {
    base,
    plugins: [
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => tag === 'tgs-player'
          }
        }
      }),
      vueDevTools(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      },
    },
    define: {
      // 注入到 import.meta.env，供 main.js / config.js 在 web 模式下做条件分支
      __VITE_WEB_ONLY__: JSON.stringify(env.WEB_ONLY === '1'),
      __VITE_API_BASE__: JSON.stringify(env.VITE_API_BASE || ''),
      __VITE_WS_BASE__: JSON.stringify(env.VITE_WS_BASE || ''),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // 单 chunk 500K 警告。jugglemate 业务含 juggleim SDK + Vue 全家桶，
      // 500K 一次会触发但不影响功能。如果后续要拆，可用 manualChunks 拆 vendor。
      chunkSizeWarningLimit: 1024,
      // 输出更友好的文件名便于部署后定位
      rollupOptions: {
        output: {
          // rolldown 要求 manualChunks 是函数，不能是对象 map
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('vue') || id.includes('@vue')) return 'vendor-vue'
            if (id.includes('ws') || id.includes('juggleim')) return 'vendor-im'
            return undefined
          }
        }
      }
    }
  }
})
