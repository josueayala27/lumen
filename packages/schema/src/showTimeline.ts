import { z } from 'zod'
import { controlCommandSchema, frameRateSchema } from './control'
import { idSchema } from './presentation'

export const timelineEasingSchema = z.object({
  kind: z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut', 'bezier']).default('linear'),
  x1: z.number().min(0).max(1).default(0.25),
  y1: z.number().default(0),
  x2: z.number().min(0).max(1).default(0.75),
  y2: z.number().default(1),
})
export type TimelineEasing = z.infer<typeof timelineEasingSchema>

export const timelineKeyframeSchema = z.object({
  id: idSchema,
  frame: z.number().int().nonnegative(),
  value: z.union([z.number(), z.string()]),
  easing: timelineEasingSchema,
})
export type TimelineKeyframe = z.infer<typeof timelineKeyframeSchema>

export const timelinePropertySchema = z.object({
  id: idSchema,
  property: z.enum([
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'opacity',
    'color',
    'fontSize',
    'letterSpacing',
    'lineHeight',
  ]),
  keyframes: z.array(timelineKeyframeSchema).default([]),
})
export type TimelineProperty = z.infer<typeof timelinePropertySchema>

export const timelineClipSchema = z.object({
  id: idSchema,
  kind: z.enum(['slide', 'media', 'audio', 'macro']),
  label: z.string().default(''),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
  trimStartFrames: z.number().int().nonnegative().default(0),
  presentationId: idSchema.nullable().default(null),
  slideIndex: z.number().int().nonnegative().nullable().default(null),
  assetId: idSchema.nullable().default(null),
  action: controlCommandSchema.nullable().default(null),
  gain: z.number().min(0).max(1).default(1),
  loop: z.boolean().default(false),
})
export type TimelineClip = z.infer<typeof timelineClipSchema>

export const timelineTrackSchema = z.object({
  id: idSchema,
  kind: z.enum(['slide', 'layer', 'media', 'audio', 'macro']),
  name: z.string().default(''),
  muted: z.boolean().default(false),
  locked: z.boolean().default(false),
  presentationId: idSchema.nullable().default(null),
  slideIndex: z.number().int().nonnegative().nullable().default(null),
  elementId: idSchema.nullable().default(null),
  clips: z.array(timelineClipSchema).default([]),
  properties: z.array(timelinePropertySchema).default([]),
})
export type TimelineTrack = z.infer<typeof timelineTrackSchema>

export const timelineMarkerSchema = z.object({
  id: idSchema,
  frame: z.number().int().nonnegative(),
  label: z.string().default(''),
  action: controlCommandSchema.nullable().default(null),
  enabled: z.boolean().default(true),
})
export type TimelineMarker = z.infer<typeof timelineMarkerSchema>

export const showTimelineSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  name: z.string().min(1),
  frameRate: frameRateSchema,
  durationFrames: z.number().int().positive(),
  tracks: z.array(timelineTrackSchema).default([]),
  markers: z.array(timelineMarkerSchema).default([]),
})
export type ShowTimeline = z.infer<typeof showTimelineSchema>
