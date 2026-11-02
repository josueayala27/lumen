import { z } from 'zod'
import { assetRefSchema, colorSchema, idSchema, normalizedSchema, paintStopSchema } from './presentation'
import { compositionAssetSchema, compositionFontSchema, slideElementSchema } from './slide'

/**
 * Render contract v2: a composition of sources, layers, effects and masks.
 * See docs/architecture/02-render-contract.md. The composition knows nothing
 * about screens; `screen.ts` picks layers, a region and overrides per output.
 */

export const fitSchema = z.enum(['cover', 'contain', 'stretch'])
export type Fit = z.infer<typeof fitSchema>

// --- Sources -----------------------------------------------------------------

export const insetsSchema = z.object({
  top: normalizedSchema,
  right: normalizedSchema,
  bottom: normalizedSchema,
  left: normalizedSchema,
})
export type Insets = z.infer<typeof insetsSchema>

export const sizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
})
export type Size = z.infer<typeof sizeSchema>

/** Value an animatable parameter can hold: a number, a colour string or a boolean. */
export const paramValueSchema = z.union([z.number(), colorSchema, z.boolean()])
export type ParamValue = z.infer<typeof paramValueSchema>

const sourceBase = {
  id: idSchema,
  name: z.string().default(''),
}

export const videoSourceSchema = z.object({
  ...sourceBase,
  kind: z.literal('video'),
  asset: assetRefSchema,
  loop: z.boolean().default(true),
  inMs: z.number().nonnegative().default(0),
  /** End of the played range; null plays to the end of the file. */
  outMs: z.number().nonnegative().nullable().default(null),
  rate: z.number().positive().default(1),
  reverse: z.boolean().default(false),
  muted: z.boolean().default(true),
  volume: normalizedSchema.default(1),
})

export const imageSourceSchema = z.object({
  ...sourceBase,
  kind: z.literal('image'),
  asset: assetRefSchema,
})

export const slideSourceSchema = z.object({
  ...sourceBase,
  kind: z.literal('slide'),
  /** Bumps when the slide content changes; drives slide transitions. */
  revision: z.number().int().nonnegative().default(0),
  elements: z.array(slideElementSchema),
  safeArea: insetsSchema,
  size: sizeSchema,
})

export const solidSourceSchema = z.object({
  ...sourceBase,
  kind: z.literal('solid'),
  color: colorSchema,
})

/**
 * Doc 02 names the gradient shape `kind`; that name is the source
 * discriminator here, so the shape is `gradient`.
 */
export const gradientSourceSchema = z.object({
  ...sourceBase,
  kind: z.literal('gradient'),
  gradient: z.enum(['linear', 'radial']).default('linear'),
  stops: z.array(paintStopSchema).min(2),
  angle: z.number().default(0),
})

export const SHADER_IDS = ['noise', 'plasma', 'lines'] as const
export const shaderSourceSchema = z.object({
  ...sourceBase,
  kind: z.literal('shader'),
  shaderId: z.string().min(1),
  params: z.record(z.string(), paramValueSchema).default({}),
})

/** Reserved for Wave E3; the compositor skips them. */
export const ndiSourceSchema = z.object({
  ...sourceBase,
  kind: z.literal('ndi'),
  name: z.string().min(1),
})
export const cameraSourceSchema = z.object({
  ...sourceBase,
  kind: z.literal('camera'),
  deviceId: z.string().min(1),
})

export const sourceSchema = z.discriminatedUnion('kind', [
  videoSourceSchema,
  imageSourceSchema,
  slideSourceSchema,
  solidSourceSchema,
  gradientSourceSchema,
  shaderSourceSchema,
  ndiSourceSchema,
  cameraSourceSchema,
])
export type Source = z.infer<typeof sourceSchema>
export type SourceKind = Source['kind']
export type VideoSource = z.infer<typeof videoSourceSchema>
export type ImageSource = z.infer<typeof imageSourceSchema>
export type SlideSource = z.infer<typeof slideSourceSchema>
export type SolidSource = z.infer<typeof solidSourceSchema>
export type GradientSource = z.infer<typeof gradientSourceSchema>
export type ShaderSource = z.infer<typeof shaderSourceSchema>

// --- Effects -----------------------------------------------------------------

export const EFFECT_KINDS = ['color', 'blur', 'key', 'transform', 'kaleidoscope', 'feedback'] as const
export const effectKindSchema = z.enum(EFFECT_KINDS)
export type EffectKind = z.infer<typeof effectKindSchema>

export const effectSchema = z.object({
  id: idSchema,
  kind: effectKindSchema,
  enabled: z.boolean().default(true),
  params: z.record(z.string(), paramValueSchema).default({}),
})
export type Effect = z.infer<typeof effectSchema>

export type EffectParamSpec =
  | { name: string; label: string; type: 'number'; min: number; max: number; step: number; default: number }
  | { name: string; label: string; type: 'color'; default: string }
  | { name: string; label: string; type: 'boolean'; default: boolean }
  | { name: string; label: string; type: 'enum'; options: readonly string[]; default: string }

function num(name: string, label: string, min: number, max: number, value: number, step = 0.01): EffectParamSpec {
  return { name, label, type: 'number', min, max, step, default: value }
}

/**
 * Typed parameters per effect kind, mirrored by the WGSL passes in
 * `lumen-render`. Inspectors build their controls from this list.
 */
export const EFFECT_CATALOG: Record<EffectKind, { label: string; params: readonly EffectParamSpec[] }> = {
  color: {
    label: 'Colour',
    params: [
      num('brightness', 'Brightness', -1, 1, 0),
      num('contrast', 'Contrast', 0, 2, 1),
      num('saturation', 'Saturation', 0, 2, 1),
      num('hue', 'Hue', -180, 180, 0, 1),
      { name: 'tint', label: 'Tint', type: 'color', default: '#ffffff' },
      num('tintAmount', 'Tint amount', 0, 1, 0),
    ],
  },
  blur: {
    label: 'Blur',
    params: [num('radius', 'Radius', 0, 100, 8, 0.5)],
  },
  key: {
    label: 'Key',
    params: [
      { name: 'mode', label: 'Mode', type: 'enum', options: ['chroma', 'luma'], default: 'chroma' },
      { name: 'keyColor', label: 'Key colour', type: 'color', default: '#00ff00' },
      num('threshold', 'Threshold', 0, 1, 0.4),
      num('softness', 'Softness', 0, 1, 0.1),
      { name: 'invert', label: 'Invert', type: 'boolean', default: false },
    ],
  },
  transform: {
    label: 'Transform',
    params: [
      num('scale', 'Scale', 0, 10, 1),
      num('offsetX', 'Offset X', -1, 1, 0),
      num('offsetY', 'Offset Y', -1, 1, 0),
      num('rotate', 'Rotate', -360, 360, 0, 1),
      { name: 'mirrorX', label: 'Mirror X', type: 'boolean', default: false },
      { name: 'mirrorY', label: 'Mirror Y', type: 'boolean', default: false },
    ],
  },
  kaleidoscope: {
    label: 'Kaleidoscope',
    params: [
      num('segments', 'Segments', 2, 32, 6, 1),
      num('rotate', 'Rotate', -360, 360, 0, 1),
      num('centerX', 'Centre X', 0, 1, 0.5),
      num('centerY', 'Centre Y', 0, 1, 0.5),
    ],
  },
  feedback: {
    label: 'Feedback',
    params: [
      num('amount', 'Amount', 0, 1, 0.8),
      num('zoom', 'Zoom', 0.5, 2, 1.02),
      num('rotate', 'Rotate', -45, 45, 0, 0.1),
    ],
  },
}

/** Default parameter values for an effect kind. */
export function defaultEffectParams(kind: EffectKind): Record<string, ParamValue> {
  return Object.fromEntries(EFFECT_CATALOG[kind].params.map((param) => [param.name, param.default]))
}

// --- Masks -------------------------------------------------------------------

export const rectMaskSchema = z.object({
  kind: z.literal('rect'),
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
  radius: z.number().nonnegative().default(0),
  feather: z.number().nonnegative().default(0),
  invert: z.boolean().default(false),
})
export const polygonMaskSchema = z.object({
  kind: z.literal('polygon'),
  points: z.array(z.tuple([z.number(), z.number()])).min(3),
  feather: z.number().nonnegative().default(0),
  invert: z.boolean().default(false),
})
export const imageMaskSchema = z.object({
  kind: z.literal('image'),
  asset: assetRefSchema,
  invert: z.boolean().default(false),
})
export const maskSchema = z.discriminatedUnion('kind', [rectMaskSchema, polygonMaskSchema, imageMaskSchema])
export type Mask = z.infer<typeof maskSchema>

// --- Layers ------------------------------------------------------------------

export const BLEND_MODES = ['normal', 'add', 'screen', 'multiply', 'overlay', 'difference', 'alpha'] as const
export const blendModeSchema = z.enum(BLEND_MODES)
export type BlendMode = z.infer<typeof blendModeSchema>

/** Normalized to the canvas. Positions may leave 0..1 to place content off-canvas. */
export const layerTransformSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  w: z.number().nonnegative().default(1),
  h: z.number().nonnegative().default(1),
  rotation: z.number().default(0),
  anchorX: z.number().default(0.5),
  anchorY: z.number().default(0.5),
})
export type LayerTransform = z.infer<typeof layerTransformSchema>

export const layerSchema = z.object({
  id: idSchema,
  name: z.string(),
  /** null renders nothing. */
  sourceId: idSchema.nullable().default(null),
  enabled: z.boolean().default(true),
  transform: layerTransformSchema,
  fit: fitSchema.default('cover'),
  opacity: normalizedSchema.default(1),
  blend: blendModeSchema.default('normal'),
  effects: z.array(effectSchema).default([]),
  mask: maskSchema.nullable().default(null),
  /** Layouts select layers by id or tag, e.g. 'lyrics' or 'content'. */
  tags: z.array(z.string().min(1)).default([]),
})
export type Layer = z.infer<typeof layerSchema>

// --- Composition -------------------------------------------------------------

export const masterSchema = z.object({
  opacity: normalizedSchema.default(1),
  effects: z.array(effectSchema).default([]),
})
export type Master = z.infer<typeof masterSchema>

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>()
  return ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
}

export const compositionSchema = z
  .object({
    schemaVersion: z.literal(2),
    revision: z.number().int().nonnegative(),
    canvas: sizeSchema,
    colorSpace: z.literal('srgb').default('srgb'),
    sources: z.array(sourceSchema),
    /** Bottom to top. */
    layers: z.array(layerSchema),
    master: masterSchema,
    fonts: z.array(compositionFontSchema).default([]),
    assets: z.array(compositionAssetSchema).default([]),
  })
  .superRefine((composition, ctx) => {
    const sourceIds = composition.sources.map((source) => source.id)
    for (const id of duplicates(sourceIds)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate source id ${id}`, path: ['sources'] })
    }
    for (const id of duplicates(composition.layers.map((layer) => layer.id))) {
      ctx.addIssue({ code: 'custom', message: `Duplicate layer id ${id}`, path: ['layers'] })
    }
    const known = new Set(sourceIds)
    composition.layers.forEach((layer, index) => {
      if (layer.sourceId !== null && !known.has(layer.sourceId)) {
        ctx.addIssue({
          code: 'custom',
          message: `Layer ${layer.id} uses unknown source ${layer.sourceId}`,
          path: ['layers', index, 'sourceId'],
        })
      }
    })
  })
export type Composition = z.infer<typeof compositionSchema>

// --- Preview result ----------------------------------------------------------

/**
 * Editor bounds of a layer box (`elementId` null) or a slide element, from
 * `preview_render_composition`. Normalized to the screen output before mapping,
 * or to the canvas when no screen is given.
 */
export const compositionBoundsSchema = z.object({
  layerId: z.string(),
  sourceId: z.string().nullable(),
  elementId: z.string().nullable(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})
export type CompositionBounds = z.infer<typeof compositionBoundsSchema>

/** One shaped text line of a slide source, in the same space as the bounds. */
export const compositionTextRunSchema = z.object({
  layerId: z.string(),
  sourceId: z.string(),
  elementId: z.string(),
  line: z.number().int().nonnegative(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  caretStops: z.array(z.number()),
})
export type CompositionTextRun = z.infer<typeof compositionTextRunSchema>

/** Layout JSON returned with a composition preview frame. */
export const compositionPreviewResultSchema = z.object({
  revision: z.number().int().nonnegative(),
  bounds: z.array(compositionBoundsSchema),
  textRuns: z.array(compositionTextRunSchema),
})
export type CompositionPreviewResult = z.infer<typeof compositionPreviewResultSchema>
