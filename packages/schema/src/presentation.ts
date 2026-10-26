import { z } from 'zod'

export const idSchema = z.string().min(1)
export const colorSchema = z.string().min(1)
export const normalizedSchema = z.number().min(0).max(1)

export const frameSchema = z.object({
  x: normalizedSchema,
  y: normalizedSchema,
  w: normalizedSchema,
  h: normalizedSchema,
  rotation: z.number().default(0),
})
export type Frame = z.infer<typeof frameSchema>

export const paintStopSchema = z.object({
  at: normalizedSchema,
  color: colorSchema,
})
export const paintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: colorSchema }),
  z.object({ kind: z.literal('linear'), angle: z.number(), stops: z.array(paintStopSchema).min(2) }),
  z.object({ kind: z.literal('none') }),
])
export type Paint = z.infer<typeof paintSchema>

export const shadowSchema = z.object({
  color: colorSchema,
  blur: z.number().nonnegative(),
  offsetX: z.number(),
  offsetY: z.number(),
})
export const outlineSchema = z.object({
  color: colorSchema,
  width: z.number().nonnegative(),
})
export const textEffectsSchema = z.object({
  shadow: shadowSchema.nullable().default(null),
  outline: outlineSchema.nullable().default(null),
})
export type TextEffects = z.infer<typeof textEffectsSchema>

export const textRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  color: colorSchema.nullable().default(null),
})
export type TextRun = z.infer<typeof textRunSchema>

export const textLayoutSchema = z.object({
  align: z.enum(['left', 'center', 'right']).default('center'),
  vAlign: z.enum(['top', 'middle', 'bottom']).default('middle'),
  lineHeight: z.number().positive().default(1.2),
  letterSpacing: z.number().default(0),
  fit: z.enum(['wrap', 'shrink', 'none']).default('wrap'),
  padding: z.number().nonnegative().default(0),
  maxLines: z.number().int().positive().nullable().default(null),
})
export type TextLayout = z.infer<typeof textLayoutSchema>

export const textStyleSchema = z.object({
  fontId: idSchema,
  fontSize: z.number().positive(),
  weight: z.number().int().min(100).max(900).default(400),
  italic: z.boolean().default(false),
  color: colorSchema,
  align: z.enum(['left', 'center', 'right']).default('center'),
  lineHeight: z.number().positive().default(1.2),
  letterSpacing: z.number().default(0),
})
export type TextStyle = z.infer<typeof textStyleSchema>

export const assetRefSchema = z.object({
  assetId: idSchema,
  hash: z.string().min(1),
})
export type AssetRef = z.infer<typeof assetRefSchema>

export const elementSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    id: idSchema,
    frame: frameSchema,
    z: z.number().int().default(0),
    opacity: z.number().min(0).max(1).default(1),
    runs: z.array(textRunSchema),
    style: textStyleSchema,
    layout: textLayoutSchema,
    effects: textEffectsSchema,
  }),
  z.object({
    kind: z.literal('shape'),
    id: idSchema,
    frame: frameSchema,
    z: z.number().int().default(0),
    opacity: z.number().min(0).max(1).default(1),
    fill: paintSchema,
    stroke: paintSchema.nullable().default(null),
    strokeWidth: z.number().nonnegative().default(0),
    radius: z.number().nonnegative().default(0),
  }),
  z.object({
    kind: z.literal('image'),
    id: idSchema,
    frame: frameSchema,
    z: z.number().int().default(0),
    opacity: z.number().min(0).max(1).default(1),
    source: assetRefSchema,
    fit: z.enum(['cover', 'contain', 'stretch']).default('cover'),
    radius: z.number().nonnegative().default(0),
  }),
  z.object({
    kind: z.literal('video'),
    id: idSchema,
    frame: frameSchema,
    z: z.number().int().default(0),
    opacity: z.number().min(0).max(1).default(1),
    source: assetRefSchema,
    fit: z.enum(['cover', 'contain', 'stretch']).default('cover'),
    loop: z.boolean().default(true),
    muted: z.boolean().default(true),
    volume: z.number().min(0).max(1).default(1),
    startMs: z.number().nonnegative().default(0),
  }),
])
export type Element = z.infer<typeof elementSchema>

export const backgroundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('transparent') }),
  z.object({ kind: z.literal('solid'), color: colorSchema }),
  z.object({ kind: z.literal('gradient'), paint: paintSchema }),
  z.object({ kind: z.literal('image'), source: assetRefSchema, fit: z.enum(['cover', 'contain', 'stretch']).default('cover'), dim: normalizedSchema.default(0) }),
  z.object({
    kind: z.literal('video'),
    source: assetRefSchema,
    fit: z.enum(['cover', 'contain', 'stretch']).default('cover'),
    loop: z.boolean().default(true),
    muted: z.boolean().default(true),
    volume: z.number().min(0).max(1).default(0.4),
  }),
])
export type Background = z.infer<typeof backgroundSchema>

export const transitionSchema = z.object({
  kind: z.enum(['cut', 'fade', 'dissolve', 'slide', 'zoom']).default('fade'),
  durationMs: z.number().int().nonnegative().default(300),
  easing: z.string().default('cubic-bezier(0.2, 0, 0, 1)'),
})
export type Transition = z.infer<typeof transitionSchema>

export const slideSchema = z.object({
  id: idSchema,
  label: z.string().nullable().default(null),
  notes: z.string().default(''),
  background: backgroundSchema,
  transition: transitionSchema.nullable().default(null),
  elements: z.array(elementSchema).default([]),
})
export type Slide = z.infer<typeof slideSchema>

export const songSectionSchema = z.object({
  id: idSchema,
  label: z.string(),
  lyrics: z.string(),
})
export type SongSection = z.infer<typeof songSectionSchema>

export const songMetaSchema = z.object({
  author: z.string().default(''),
  ccli: z.string().default(''),
  key: z.string().default(''),
  tempo: z.number().positive().nullable().default(null),
  sections: z.array(songSectionSchema).default([]),
  arrangement: z.array(idSchema).default([]),
})
export type SongMeta = z.infer<typeof songMetaSchema>

export const presentationSettingsSchema = z.object({
  aspectRatio: z.enum(['16:9', '4:3', 'custom']).default('16:9'),
  width: z.number().positive().default(1920),
  height: z.number().positive().default(1080),
  safeArea: z.number().min(0).max(0.25).default(0.05),
})
export type PresentationSettings = z.infer<typeof presentationSettingsSchema>

export const presentationDocSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(['presentation', 'song']),
  title: z.string().min(1),
  themeId: idSchema.nullable().default(null),
  settings: presentationSettingsSchema,
  slides: z.array(slideSchema).min(1),
  song: songMetaSchema.nullable().default(null),
})
export type PresentationDoc = z.infer<typeof presentationDocSchema>

export const themeSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  background: backgroundSchema,
  textStyles: z.object({
    title: textStyleSchema,
    body: textStyleSchema,
  }),
  transition: transitionSchema,
})
export type Theme = z.infer<typeof themeSchema>
