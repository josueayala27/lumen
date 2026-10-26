import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  modules: ['@nuxt/fonts', '@nuxt/icon/module'],
  compatibilityDate: '2026-10-01',
  devtools: { enabled: true },

  // Explicit imports everywhere, matching Builder.
  imports: { autoImport: false },
  components: { dirs: [] },

  ssr: false,
  app: {
    // Tauri serves the built files at the protocol root; hash routing handles SPA navigation.
    baseURL: '/',
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

  vite: {
    optimizeDeps: {
      include: [
        '@floating-ui/vue',
        '@vueuse/core',
        'gsap',
        'gsap/CustomEase',
        'gsap/Flip',
        'gsap/ScrollSmoother',
        'gsap/ScrollTrigger',
        'gsap/SplitText',
      ],
    },
  },

  nitro: { preset: 'static' },
})
