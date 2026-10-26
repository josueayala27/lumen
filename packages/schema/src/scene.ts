import { z } from 'zod'
import { assetRefSchema, colorSchema, frameSchema, normalizedSchema } from './presentation'

export const sceneRoleSchema = z.enum(['audience', 'stage', 'preview'])
export type SceneRole = z.infer<typeof sceneRoleSchema>

export const sceneFontSchema = z.object({
  id: z.string().min(1),
  family: z.string().min(1),
  path: z.string().min(1),
  hash: z.string().min(1),
  fallback: z.array(z.string()).default([]),
})
export type SceneFont = z.infer<typeof sceneFontSchema>

export const sceneAssetSchema = z.object({
  id: z.string().min(1),
  hash: z.string().min(1),
  kind: z.enum(['image', 'video', 'font']),
  localPath: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  intrinsic: z.object({ width: z.number().nonnegative(), height: z.number().nonnegative() }),
  state: z.enum(['ready', 'missing']).default('ready'),
})
export type SceneAsset = z.infer<typeof sceneAssetSchema>

const baseLayerSchema = z.object({
  id: z.string().min(1),
  frame: frameSchema,
  z: z.number().int().default(0),
  opacity: z.number().min(0).max(1).default(1),
})

export const sceneTextRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  color: colorSchema.nullable().default(null),
})

export const sceneTextLayerSchema = baseLayerSchema.extend({
  kind: z.literal('text'),
  runs: z.array(sceneTextRunSchema),
  fontId: z.string().min(1),
  fontSize: z.number().positive(),
  weight: z.number().int().min(100).max(900).default(400),
  color: colorSchema,
  align: z.enum(['left', 'center', 'right']).default('center'),
  vAlign: z.enum(['top', 'middle', 'bottom']).default('middle'),
  lineHeight: z.number().positive().default(1.2),
  letterSpacing: z.number().default(0),
  fit: z.enum(['wrap', 'shrink', 'none']).default('wrap'),
  padding: z.number().nonnegative().default(0),
  maxLines: z.number().int().positive().nullable().default(null),
  shadow: z.object({ color: colorSchema, blur: z.number(), offsetX: z.number(), offsetY: z.number() }).nullable().default(null),
  outline: z.object({ color: colorSchema, width: z.number() }).nullable().default(null),
})

export const sceneImageLayerSchema = baseLayerSchema.extend({
  kind: z.literal('image'),
  source: assetRefSchema,
  fit: z.enum(['cover', 'contain', 'stretch']).default('cover'),
  radius: z.number().nonnegative().default(0),
})

export const sceneShapeLayerSchema = baseLayerSchema.extend({
  kind: z.literal('shape'),
  fill: z.string(),
  stroke: z.string().nullable().default(null),
  strokeWidth: z.number().nonnegative().default(0),
  radius: z.number().nonnegative().default(0),
})

export const sceneVideoLayerSchema = baseLayerSchema.extend({
  kind: z.literal('video'),
  source: assetRefSchema,
  fit: z.enum(['cover', 'contain', 'stretch']).default('cover'),
  loop: z.boolean().default(true),
  muted: z.boolean().default(true),
  volume: z.number().min(0).max(1).default(1),
  startMs: z.number().nonnegative().default(0),
})

export const sceneLayerSchema = z.discriminatedUnion('kind', [
  sceneTextLayerSchema,
  sceneImageLayerSchema,
  sceneShapeLayerSchema,
  sceneVideoLayerSchema,
])
export type SceneLayer = z.infer<typeof sceneLayerSchema>

export const sceneSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  role: sceneRoleSchema,
  viewport: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    scale: z.number().positive().default(1),
  }),
  colorSpace: z.literal('srgb').default('srgb'),
  background: sceneLayerSchema.nullable(),
  layers: z.array(sceneLayerSchema),
  fonts: z.array(sceneFontSchema),
  assets: z.array(sceneAssetSchema),
  safeArea: z.object({
    top: normalizedSchema,
    right: normalizedSchema,
    bottom: normalizedSchema,
    left: normalizedSchema,
  }),
})
export type Scene = z.infer<typeof sceneSchema>

export const previewBoundsSchema = z.object({
  elementId: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})
export const previewTextRunSchema = z.object({
  elementId: z.string(),
  line: z.number().int().nonnegative(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  caretStops: z.array(z.number()),
})
export const previewResultSchema = z.object({
  revision: z.number().int().nonnegative(),
  bounds: z.array(previewBoundsSchema),
  textRuns: z.array(previewTextRunSchema),
})
export type PreviewResult = z.infer<typeof previewResultSchema>

export const transitionPlanSchema = z.object({
  fromRevision: z.number().int().nonnegative(),
  toRevision: z.number().int().nonnegative(),
  from: sceneSchema,
  to: sceneSchema,
  kind: z.enum(['cut', 'fade', 'dissolve', 'slide', 'zoom']),
  durationMs: z.number().int().nonnegative(),
  easing: z.string(),
})
export type TransitionPlan = z.infer<typeof transitionPlanSchema>
