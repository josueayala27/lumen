import { createDb, type Db } from '@lumen/db'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from './types'

export type DbFactory = (connectionString: string) => { db: Db; close: () => Promise<void> }

export function dbMiddleware(injected?: Db, factory: DbFactory = createDb): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (injected) {
      c.set('db', injected)
      await next()
      return
    }
    const connectionString = c.env.HYPERDRIVE?.connectionString ?? c.env.DATABASE_URL
    if (!connectionString) throw new Error('No database connection configured')
    const handle = factory(connectionString)
    c.set('db', handle.db)
    try {
      await next()
    } finally {
      const close = handle.close().catch((error) => console.error('db close failed', error))
      try {
        c.executionCtx.waitUntil(close)
      } catch {
        await close
      }
    }
  }
}
