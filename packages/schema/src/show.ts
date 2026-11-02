import { z } from 'zod'
import { idSchema } from './presentation'
import { compositionSchema, sourceSchema } from './composition'
import { screenSchema } from './screen'

/**
 * Show document v2: one composition, the screens it plays on and a clip grid
 * (composition layers × columns). Live state (which clip plays) is not saved.
 */

/** What a grid cell launches onto its layer. */
export const clipContentSchema = z.discriminatedUnion('kind', [
  /** A source stored with the clip, such as a solid or a generator. */
  z.object({ kind: z.literal('source'), source: sourceSchema }),
  /** A source already in the composition. */
  z.object({ kind: z.literal('sourceRef'), sourceId: idSchema }),
  /** An image or video from the media library, resolved when launched. */
  z.object({ kind: z.literal('media'), assetId: idSchema, loop: z.boolean().default(true) }),
  /** A presentation or song; its current slide becomes a `slide` source. */
  z.object({ kind: z.literal('presentation'), presentationId: idSchema }),
])
export type ClipContent = z.infer<typeof clipContentSchema>

export const showClipSchema = z.object({
  id: idSchema,
  layerId: idSchema,
  column: z.number().int().nonnegative(),
  label: z.string(),
  content: clipContentSchema,
})
export type ShowClip = z.infer<typeof showClipSchema>

export const MAX_SHOW_COLUMNS = 32

export const showGridSchema = z.object({
  columns: z.number().int().min(1).max(MAX_SHOW_COLUMNS),
  clips: z.array(showClipSchema),
})
export type ShowGrid = z.infer<typeof showGridSchema>

export const showDocSchema = z.object({
  schemaVersion: z.literal(2),
  id: idSchema,
  name: z.string(),
  composition: compositionSchema,
  screens: z.array(screenSchema),
  grid: showGridSchema,
})
export type ShowDoc = z.infer<typeof showDocSchema>
