import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    // Direct, non-pooler Neon URL. Hyperdrive is runtime-only.
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
})
