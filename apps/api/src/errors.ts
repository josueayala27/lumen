import type { Context } from 'hono'
import type { ApiErrorCode } from '@lumen/schema'
import type { AppEnv } from './types'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export function errorBody(code: ApiErrorCode, message: string) {
  return { error: { code, message } }
}

export function onError(error: Error, c: Context<AppEnv>) {
  if (error instanceof ApiError) {
    return c.json(errorBody(error.code, error.message), error.status as 400)
  }
  console.error('api error', error)
  return c.json(errorBody('internal', 'Internal server error'), 500)
}

export function onNotFound(c: Context<AppEnv>) {
  return c.json(errorBody('not_found', 'Not found'), 404)
}
