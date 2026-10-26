import { z } from 'zod'
import { controlCommandSchema, frameRateSchema } from './control'
import { idSchema } from './presentation'

export const timelineCueSchema = z.object({
  id: idSchema,
  label: z.string().default(''),
  /** Absolute frame position on the timeline clock. */
  atFrames: z.number().int().nonnegative(),
  action: controlCommandSchema,
  enabled: z.boolean().default(true),
})
export type TimelineCue = z.infer<typeof timelineCueSchema>

export const timelineSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  name: z.string().min(1),
  frameRate: frameRateSchema,
  cues: z.array(timelineCueSchema).default([]),
})
export type TimelineDoc = z.infer<typeof timelineSchema>
