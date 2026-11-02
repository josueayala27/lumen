import { z } from 'zod'
import { assetRefSchema, colorSchema, frameSchema } from './presentation'

/**
 * Slide content of render contract v2: the fonts and assets a composition
 * carries and the elements a `slide` source draws. See
 * docs/architecture/02-render-contract.md § Sources. Rust mirrors these in
 * `lumen-render/src/composition.rs`.
 */

export const compositionFontSchema = z.object({
  id: z.string().min(1),
  family: z.string().min(1),
  path: z.string().min(1),
  hash: z.string().min(1),
  fallback: z.array(z.string()).default([]),
})
export type CompositionFont = z.infer<typeof compositionFontSchema>

export const compositionAssetSchema = z.object({
  id: z.string().min(1),
  hash: z.string().min(1),
  kind: z.enum(['image', 'video', 'font']),
  localPath: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  intrinsic: z.object({ width: z.number().nonnegative(), height: z.number().nonnegative() }),
  state: z.enum(['ready', 'missing']).default('ready'),
})
export type CompositionAsset = z.infer<typeof compositionAssetSchema>

/** Fields every slide element has. `frame` is normalized to the slide. */
const slideElementBase = z.object({
  id: z.string().min(1),
  frame: frameSchema,
  z: z.number().int().default(0),
  opacity: z.number().min(0).max(1).default(1),
})

export const slideTextRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  color: colorSchema.nullable().default(null),
})
export type SlideTextRun = z.infer<typeof slideTextRunSchema>

export const slideTextElementSchema = slideElementBase.extend({
  kind: z.literal('text'),
  runs: z.array(slideTextRunSchema),
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
export type SlideTextElement = z.infer<typeof slideTextElementSchema>

export const slideImageElementSchema = slideElementBase.extend({
  kind: z.literal('image'),
  source: assetRefSchema,
  fit: z.enum(['cover', 'contain', 'stretch']).default('cover'),
  radius: z.number().nonnegative().default(0),
})
export type SlideImageElement = z.infer<typeof slideImageElementSchema>

/** `fill` and `stroke` are CSS colours or `linear-gradient(...)` strings. */
export const slideShapeElementSchema = slideElementBase.extend({
  kind: z.literal('shape'),
  fill: z.string(),
  stroke: z.string().nullable().default(null),
  strokeWidth: z.number().nonnegative().default(0),
  radius: z.number().nonnegative().default(0),
})
export type SlideShapeElement = z.infer<typeof slideShapeElementSchema>

/** What a `slide` source draws. Videos are their own sources, never slide elements. */
export const slideElementSchema = z.discriminatedUnion('kind', [
  slideTextElementSchema,
  slideShapeElementSchema,
  slideImageElementSchema,
])
export type SlideElement = z.infer<typeof slideElementSchema>
