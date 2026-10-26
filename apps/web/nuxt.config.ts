import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  modules: ['@nuxt/fonts', '@nuxt/icon/module'],
  compatibilityDate: '2026-10-01',
  devtools: { enabled: true },
  imports: { autoImport: false },
  components: { dirs: [] },

  css: ['~/assets/css/panda.css'],
  postcss: { plugins: { '@pandacss/dev/postcss': {} } },
  alias: {
    'styled-system': fileURLToPath(new URL('./styled-system', import.meta.url)),
  },

  runtimeConfig: {
    apiOrigin: process.env.NUXT_API_ORIGIN ?? 'http://localhost:4000',
    public: {
      realtimeUrl: process.env.NUXT_PUBLIC_REALTIME_URL ?? 'ws://localhost:8788',
      appName: 'Lumen',
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

  nitro: {
    preset: 'cloudflare_module',
    cloudflare: { deployConfig: true, nodeCompat: true },
  },
})
