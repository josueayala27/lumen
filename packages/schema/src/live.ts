import { z } from 'zod'
import { idSchema } from './presentation'

export const playlistItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('presentation'), id: idSchema, presentationId: idSchema, label: z.string().default('') }),
  z.object({ kind: z.literal('media'), id: idSchema, assetId: idSchema, label: z.string().default('') }),
  z.object({ kind: z.literal('header'), id: idSchema, label: z.string().min(1) }),
])
export type PlaylistItem = z.infer<typeof playlistItemSchema>

export const playlistDocSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  items: z.array(playlistItemSchema).default([]),
})
export type PlaylistDoc = z.infer<typeof playlistDocSchema>

export const outputModeSchema = z.enum(['live', 'black', 'clear', 'logo', 'freeze'])
export type OutputMode = z.infer<typeof outputModeSchema>

export const timerSchema = z.object({
  id: idSchema,
  label: z.string().default('Timer'),
  kind: z.enum(['countdown', 'elapsed']).default('countdown'),
  durationMs: z.number().int().nonnegative().default(300_000),
  running: z.boolean().default(false),
  startedAt: z.number().nullable().default(null),
  remainingMs: z.number().int().nonnegative().nullable().default(null),
})
export type Timer = z.infer<typeof timerSchema>

export const liveStateSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  playlistId: idSchema.nullable().default(null),
  itemIndex: z.number().int().nonnegative().default(0),
  slideIndex: z.number().int().nonnegative().default(0),
  buildIndex: z.number().int().nonnegative().default(0),
  previewItemIndex: z.number().int().nonnegative().default(0),
  previewSlideIndex: z.number().int().nonnegative().default(0),
  mode: outputModeSchema.default('live'),
  stageMessage: z.string().default(''),
  timers: z.array(timerSchema).default([]),
})
export type LiveState = z.infer<typeof liveStateSchema>

export const liveCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('prev') }),
  z.object({ type: z.literal('goTo'), slideIndex: z.number().int().nonnegative() }),
  z.object({ type: z.literal('nextItem') }),
  z.object({ type: z.literal('prevItem') }),
  z.object({ type: z.literal('previewNext') }),
  z.object({ type: z.literal('previewPrev') }),
  z.object({ type: z.literal('previewGoTo'), itemIndex: z.number().int().nonnegative(), slideIndex: z.number().int().nonnegative() }),
  z.object({ type: z.literal('take') }),
  z.object({ type: z.literal('setMode'), mode: outputModeSchema }),
  z.object({ type: z.literal('setMessage'), message: z.string() }),
  z.object({ type: z.literal('timerStart'), timerId: z.string(), now: z.number() }),
  z.object({ type: z.literal('timerStop'), timerId: z.string(), now: z.number() }),
  z.object({ type: z.literal('timerReset'), timerId: z.string() }),
])
export type LiveCommand = z.infer<typeof liveCommandSchema>

export const liveMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), lastSeq: z.number().int().nonnegative().default(0) }),
  z.object({ type: z.literal('snapshot'), seq: z.number().int().nonnegative(), state: liveStateSchema }),
  z.object({ type: z.literal('command'), seq: z.number().int().nonnegative(), command: liveCommandSchema }),
  z.object({ type: z.literal('ack'), seq: z.number().int().nonnegative() }),
])
export type LiveMessage = z.infer<typeof liveMessageSchema>
