import { createScreen, frameInRegion, layoutIncludesLayer, paintToCss, resolveLayoutText } from '@lumen/core'
import type { Composition, Frame, GradientSource, Layer, LayoutText, Screen, SlideElement } from '@lumen/schema'

/**
 * Browser fallback for the compositor: a schematic of what one screen shows,
 * drawn as DOM boxes straight from a `Composition` and a `Screen`. Solids and
 * gradients are filled boxes, images and videos are labelled boxes, slide
 * text is plain text. Effects, masks, blend modes and mapping are not drawn.
 * The desktop app renders the real frame with `preview_render_composition`.
 */

export interface SchematicLayer {
  id: string
  kind: 'text' | 'shape' | 'image' | 'video'
  /** Normalized to the screen output. */
  x: number
  y: number
  w: number
  h: number
  opacity: number
  /** CSS background for shapes, solids, gradients and generators. */
  fill: string | null
  text: string
}

export interface SchematicFrame {
  /** CSS colour under every layer. */
  background: string
  /** Bottom to top. */
  layers: SchematicLayer[]
}

const BLACK = '#000000'
/** Stand-in fill for shader generators, which only the compositor draws. */
const GENERATOR_FILL = 'linear-gradient(135deg, #312e81, #0e7490)'
const BARS = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000']

/** Output-space frames for re-laid-out text, per layout text preset. */
const TEXT_PRESET_FRAMES: Partial<Record<LayoutText['preset'], Frame>> = {
  lowerThird: { x: 0.06, y: 0.74, w: 0.88, h: 0.2, rotation: 0 },
  strip: { x: 0.02, y: 0.88, w: 0.96, h: 0.1, rotation: 0 },
}

/** Joins the lines of a slide on a strip, as `STRIP_SEPARATOR` in `lumen-render` `mapping.rs`. */
export const STRIP_SEPARATOR = ' / '

/**
 * The text a preset shows for an element. Presets never drop lines: `strip`
 * puts every line of the slide on one line (breaks become `STRIP_SEPARATOR`)
 * and shrinks it to fit; the other presets keep the line breaks. Same rule as
 * `join_lines` in `mapping.rs`.
 */
export function presetText(element: Extract<SlideElement, { kind: 'text' }>, preset: LayoutText['preset']): string {
  const text = element.runs.map((run) => run.text).join('')
  if (preset !== 'strip') return text
  return text
    .split(/[\r\n]+/)
    .filter((line) => line.length > 0)
    .join(STRIP_SEPARATOR)
}

function box(id: string, kind: SchematicLayer['kind'], frame: Frame, opacity: number, fill: string | null = null, text = ''): SchematicLayer {
  return { id, kind, x: frame.x, y: frame.y, w: frame.w, h: frame.h, opacity, fill, text }
}

/** Colour bars, a centre cross and the screen name, as the compositor draws a test pattern. */
export function testPatternLayers(name: string): SchematicLayer[] {
  const layers = BARS.map((fill, index) =>
    box(`pattern-bar-${index}`, 'shape', { x: index / BARS.length, y: 0, w: 1 / BARS.length, h: 1, rotation: 0 }, 1, fill),
  )
  layers.push(box('pattern-h', 'shape', { x: 0, y: 0.4995, w: 1, h: 0.001, rotation: 0 }, 1, '#808080'))
  layers.push(box('pattern-v', 'shape', { x: 0.4995, y: 0, w: 0.001, h: 1, rotation: 0 }, 1, '#808080'))
  const plate = { x: 0.3, y: 0.42, w: 0.4, h: 0.16, rotation: 0 }
  layers.push(box('pattern-plate', 'shape', plate, 1, BLACK))
  layers.push(box('pattern-label', 'text', plate, 1, null, name))
  return layers
}

function gradientCss(source: GradientSource): string {
  if (source.gradient === 'linear') return paintToCss({ kind: 'linear', angle: source.angle, stops: source.stops })
  const stops = source.stops.map((stop) => `${stop.color} ${Math.round(stop.at * 100)}%`).join(', ')
  return `radial-gradient(circle, ${stops})`
}

function layerFrame(layer: Layer): Frame {
  const { x, y, w, h, rotation } = layer.transform
  return { x, y, w, h, rotation }
}

/** Places a slide-space frame inside the layer's box on the canvas. */
function frameInLayer(frame: Frame, layerBox: Frame): Frame {
  return {
    x: layerBox.x + frame.x * layerBox.w,
    y: layerBox.y + frame.y * layerBox.h,
    w: frame.w * layerBox.w,
    h: frame.h * layerBox.h,
    rotation: frame.rotation + layerBox.rotation,
  }
}

function elementLayer(element: SlideElement, id: string, frame: Frame, opacity: number, text: LayoutText): SchematicLayer | null {
  switch (element.kind) {
    case 'text': {
      if (text.preset === 'hidden') return null
      const preset = TEXT_PRESET_FRAMES[text.preset] ?? frame
      return box(id, 'text', preset, opacity, null, presetText(element, text.preset))
    }
    case 'shape':
      return box(id, 'shape', frame, opacity, element.fill)
    case 'image':
      return box(id, 'image', frame, opacity)
  }
}

/**
 * What `screen` shows of `composition` (the bare canvas when `screen` is
 * null): its layers bottom to top, filtered by its layout, cropped to its
 * region and over its background. Blackout is a black frame; a test pattern
 * wins over everything, as in the compositor.
 */
export function schematicFrame(composition: Composition, screen: Screen | null): SchematicFrame {
  const target = screen ?? createScreen({ id: 'canvas', name: 'Canvas', size: composition.canvas })
  if (target.testPattern) return { background: BLACK, layers: testPatternLayers(target.name) }
  if (target.blackout) return { background: BLACK, layers: [] }

  const layout = target.layout
  const text = resolveLayoutText(layout)
  const sources = new Map(composition.sources.map((source) => [source.id, source]))
  const layers: SchematicLayer[] = []
  for (const layer of composition.layers) {
    if (!layer.enabled || layer.sourceId === null || !layoutIncludesLayer(layout, layer)) continue
    const opacity = layer.opacity * composition.master.opacity
    const source = sources.get(layer.sourceId)
    if (opacity <= 0 || !source) continue
    const frame = frameInRegion(layerFrame(layer), layout.region)
    switch (source.kind) {
      case 'solid':
        layers.push(box(layer.id, 'shape', frame, opacity, source.color))
        break
      case 'gradient':
        layers.push(box(layer.id, 'shape', frame, opacity, gradientCss(source)))
        break
      case 'shader':
        layers.push(box(layer.id, 'shape', frame, opacity, GENERATOR_FILL))
        break
      case 'image':
      case 'video':
        layers.push(box(layer.id, source.kind, frame, opacity))
        break
      case 'slide': {
        const layerBox = layerFrame(layer)
        const ordered = source.elements
          .map((element, index) => ({ element, index }))
          .sort((a, b) => a.element.z - b.element.z || a.index - b.index)
        for (const { element } of ordered) {
          const elementFrame = frameInRegion(frameInLayer(element.frame, layerBox), layout.region)
          const entry = elementLayer(element, `${layer.id}.${element.id}`, elementFrame, element.opacity * opacity, text)
          if (entry) layers.push(entry)
        }
        break
      }
      case 'ndi':
      case 'camera':
        break
    }
  }
  return { background: layout.background ?? BLACK, layers }
}
