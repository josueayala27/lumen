import { defineConfig } from '@pandacss/dev'
import { lumenPreset } from '@lumen/design'

export default defineConfig({
  presets: ['@pandacss/preset-base', '@pandacss/preset-panda', lumenPreset],
  preflight: true,
  strictTokens: true,
  include: ['./app/**/*.{vue,ts}'],
  exclude: ['./app/**/*.test.ts', './app/**/*.spec.ts'],
  outdir: 'styled-system',
})
