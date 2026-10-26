import { schema } from '@lumen/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer, magicLink } from 'better-auth/plugins'
import type { Db } from '@lumen/db'
import type { Context, MiddlewareHandler } from 'hono'
import type { Env } from './env'
import { ApiError } from './errors'
import type { AppEnv, AuthUser } from './types'

export function createAuth(env: Env, db: Db) {
  return betterAuth({
    baseURL: env.API_ORIGIN,
    basePath: '/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_ORIGIN, env.STUDIO_ORIGIN ?? 'tauri://localhost', 'http://tauri.localhost'],
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : undefined,
    plugins: [
      bearer(),
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          if (!env.RESEND_API_KEY) {
            console.log(`[auth] magic link for ${email}: ${url}`)
            return
          }
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: env.EMAIL_FROM ?? 'Lumen <login@lumen.app>',
              to: email,
              subject: 'Sign in to Lumen',
              html: `<p><a href="${url}">Sign in to Lumen</a></p><p>This link expires soon.</p>`,
            }),
          })
          if (!response.ok) console.error('[auth] magic link send failed', await response.text())
        },
      }),
    ],
  })
}

export async function sessionMiddleware(c: Context<AppEnv>, next: () => Promise<void>) {
  const auth = createAuth(c.env, c.var.db)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (session?.user) {
    c.set('user', {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image ?? null,
    } satisfies AuthUser)
  }
  await next()
}

export function requireUser(c: Context<AppEnv>): AuthUser {
  const user = c.var.user
  if (!user) throw new ApiError(401, 'unauthorized', 'Sign in required')
  return user
}

export function requireBearerOrCookie(c: Context<AppEnv>): AuthUser {
  return requireUser(c)
}

export const authHandler: MiddlewareHandler<AppEnv> = async (c) => {
  const auth = createAuth(c.env, c.var.db)
  return auth.handler(c.req.raw)
}
