import { z } from 'zod'

export * from './presentation'
export * from './scene'
export * from './live'
export * from './control'
export * from './timeline'

export const API_ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'internal',
] as const
export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
  }),
})
export type ApiError = z.infer<typeof apiErrorSchema>
