import { z } from 'zod'
import { colorSchema, idSchema } from './presentation'
import { insetsSchema, maskSchema, sizeSchema } from './composition'

/**
 * Screens, layouts and mapping. See docs/architecture/10-screens-and-mapping.md.
 * A screen shows the composition through its own layout and mapping.
 */

/** Stable monitor identity: name plus position, per 05-desktop-output.md. */
export const screenRefSchema = z.object({
  name: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
})
export type ScreenRef = z.infer<typeof screenRefSchema>

export const screenTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('display'), ref: screenRefSchema }),
  /** Later. */
  z.object({ kind: z.literal('ndi'), name: z.string().min(1) }),
  /** Preview only, for planning and tests. */
  z.object({ kind: z.literal('virtual') }),
])
export type ScreenTarget = z.infer<typeof screenTargetSchema>

export const layerFilterSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({
    mode: z.literal('only'),
    ids: z.array(idSchema).default([]),
    tags: z.array(z.string().min(1)).default([]),
  }),
])
export type LayerFilter = z.infer<typeof layerFilterSchema>

export const regionSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
})
export type Region = z.infer<typeof regionSchema>

export const TEXT_PRESETS = ['full', 'lowerThird', 'strip', 'hidden'] as const
export const textPresetSchema = z.enum(TEXT_PRESETS)
export type TextPreset = z.infer<typeof textPresetSchema>

export const layoutTextSchema = z.object({
  preset: textPresetSchema.default('full'),
  /** Multiplies font size. */
  scale: z.number().positive().default(1),
  color: colorSchema.nullable().default(null),
})
export type LayoutText = z.infer<typeof layoutTextSchema>

export const STAGE_PARTS = ['current', 'next', 'notes', 'clock', 'timers', 'message'] as const
export const stagePartSchema = z.enum(STAGE_PARTS)
export type StagePart = z.infer<typeof stagePartSchema>

export const layoutSchema = z.object({
  layers: layerFilterSchema,
  region: regionSchema,
  safeArea: insetsSchema,
  text: layoutTextSchema.nullable().default(null),
  /** Drawn under the screen's layers. */
  background: colorSchema.nullable().default(null),
  stage: z.object({ show: z.array(stagePartSchema) }).nullable().default(null),
})
export type Layout = z.infer<typeof layoutSchema>

export const pointSchema = z.object({ x: z.number(), y: z.number() })
export type Point = z.infer<typeof pointSchema>

export const edgeBlendSideSchema = z.object({
  /** Normalized overlap width; 0 turns the side off. */
  width: z.number().min(0).max(1).default(0),
  gamma: z.number().positive().default(2.2),
  power: z.number().positive().default(1),
})
export type EdgeBlendSide = z.infer<typeof edgeBlendSideSchema>

export const meshSchema = z
  .object({
    cols: z.number().int().min(2),
    rows: z.number().int().min(2),
    /** Row-major control points, normalized output. */
    points: z.array(pointSchema),
  })
  .refine((mesh) => mesh.points.length === mesh.cols * mesh.rows, {
    message: 'Mesh needs cols × rows points',
    path: ['points'],
  })
export type Mesh = z.infer<typeof meshSchema>

export const mappingColorSchema = z.object({
  brightness: z.number().default(0),
  contrast: z.number().nonnegative().default(1),
  gamma: z.number().positive().default(1),
  red: z.number().nonnegative().default(1),
  green: z.number().nonnegative().default(1),
  blue: z.number().nonnegative().default(1),
})
export type MappingColor = z.infer<typeof mappingColorSchema>

export const mappingSchema = z.object({
  /** tl, tr, br, bl in normalized output space. */
  cornerPin: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]).nullable().default(null),
  mesh: meshSchema.nullable().default(null),
  edgeBlend: z
    .object({
      left: edgeBlendSideSchema,
      right: edgeBlendSideSchema,
      top: edgeBlendSideSchema,
      bottom: edgeBlendSideSchema,
    })
    .nullable()
    .default(null),
  /** In output space. */
  masks: z.array(maskSchema).default([]),
  color: mappingColorSchema,
})
export type Mapping = z.infer<typeof mappingSchema>

export const screenRoleSchema = z.enum(['audience', 'stage'])
export type ScreenRole = z.infer<typeof screenRoleSchema>

export const testPatternSchema = z.enum(['grid', 'bars', 'identify'])
export type TestPattern = z.infer<typeof testPatternSchema>

export const screenSchema = z.object({
  id: idSchema,
  name: z.string(),
  target: screenTargetSchema,
  /** Output pixels; display targets follow the monitor. */
  size: sizeSchema,
  role: screenRoleSchema.default('audience'),
  enabled: z.boolean().default(true),
  blackout: z.boolean().default(false),
  testPattern: testPatternSchema.nullable().default(null),
  layout: layoutSchema,
  mapping: mappingSchema,
})
export type Screen = z.infer<typeof screenSchema>
