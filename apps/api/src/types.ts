import type { Db } from '@lumen/db'
import type { Env } from './env'

export interface AuthUser {
  id: string
  email: string
  name: string
  image: string | null
}

export type AppEnv = {
  Bindings: Env
  Variables: {
    db: Db
    user?: AuthUser
  }
}
