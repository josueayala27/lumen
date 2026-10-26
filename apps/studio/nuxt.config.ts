import { fileURLToPath } from 'node:url'

const desktopBuild = process.env.DESKTOP_BUILD === '1'

export default defineNuxtConfig({
  modules: ['@nuxt/fonts', '@nuxt/icon/module'],
  compatibilityDate: '2026-10-01',
  devtools: { enabled: true },

  // Explicit imports everywhere, matching Builder.
  imports: { autoImport: false },
  components: { dirs: [] },

  ssr: false,
  app: {
    // Tauri serves static files from a custom protocol; relative asset URLs keep it working.
    baseURL: desktopBuild ? './' : '/',
  },

  css: ['~/assets/css/panda.css'],
  postcss: { plugins: { '@pandacss/dev/postcss': {} } },
  alias: {
    'styled-system': fileURLToPath(new URL('./styled-system', import.meta.url)),
  },

  runtimeConfig: {
    public: {
      apiOrigin: process.env.NUXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4000',
      realtimeUrl: process.env.NUXT_PUBLIC_REALTIME_URL ?? 'ws://localhost:8788',
    },
  },

  fonts: {
    families: [
      { name: 'Inter', provider: 'google', weights: [300, 400, 500, 600, 700] },
      { name: 'JetBrains Mono', provider: 'google', weights: [400, 500] },
    ],
  },

  icon: {
    clientBundle: { scan: { globInclude: ['**/*.{vue,ts}'] } },
    localApiEndpoint: '/_nuxt_icon',
  },

  nitro: { preset: 'static' },
})
